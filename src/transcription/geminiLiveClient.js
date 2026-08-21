const { EventEmitter } = require("node:events");
const WebSocket = require("ws");

const { TranscriptAssembler } = require("./transcriptAssembler");

const PCM_SAMPLE_RATE = 16000;
const DEFAULT_LIVE_MODEL = "gemini-3.1-flash-live-preview";
const GEMINI_LIVE_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const MAX_PENDING_AUDIO_BYTES = PCM_SAMPLE_RATE * 2 * 5;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createGeminiError(message, code) {
  const rawMessage = message || "Gemini Live API báo lỗi.";
  let friendlyMessage = rawMessage;

  if (/invalid authentication credentials|unauthenticated/i.test(rawMessage)) {
    friendlyMessage =
      "GEMINI_API_KEY không hợp lệ hoặc thuộc Google Cloud project đã bị xóa. " +
      "Hãy tạo key mới tại Google AI Studio và cập nhật .env.";
  } else if (/quota|resource_exhausted|rate limit/i.test(rawMessage)) {
    friendlyMessage =
      "Gemini API đã hết quota hoặc đang bị giới hạn tần suất. Hãy kiểm tra quota của project trong Google AI Studio.";
  }

  const error = new Error(friendlyMessage);
  error.code = code;
  return error;
}

class GeminiLiveTranscriptionClient extends EventEmitter {
  constructor(options = {}) {
    super();

    if (!options.apiKey?.trim()) {
      throw new Error("Thiếu GEMINI_API_KEY.");
    }

    this.apiKey = options.apiKey.trim();
    this.model = options.model?.trim() || DEFAULT_LIVE_MODEL;
    this.languages = Array.isArray(options.languages)
      ? options.languages.filter(Boolean)
      : ["vi", "en"];
    this.prompt = options.prompt?.trim() || "";
    this.keywords = Array.isArray(options.keywords)
      ? options.keywords.filter(Boolean).slice(0, 100)
      : [];
    this.WebSocketImpl = options.WebSocketImpl || WebSocket;
    this.connectionTimeoutMs = options.connectionTimeoutMs || 15000;
    this.finishMinWaitMs = options.finishMinWaitMs || 1500;
    this.finishMaxWaitMs = options.finishMaxWaitMs || 5000;
    this.socket = null;
    this.connected = false;
    this.closed = false;
    this.manualClose = false;
    this.finishing = false;
    this.hasEverConnected = false;
    this.reconnectPromise = null;
    this.resumptionHandle = "";
    this.pendingAudio = [];
    this.pendingAudioBytes = 0;
    this.pendingStreamEnd = false;
    this.assembler = new TranscriptAssembler();
    this.currentItemNumber = 1;
    this.lastTranscriptAt = 0;
  }

  get currentItemId() {
    return `gemini-turn-${this.currentItemNumber}`;
  }

  buildSystemInstruction() {
    const languageHint = this.languages.length
      ? `Ngôn ngữ dự kiến: ${this.languages.join(", ")}.`
      : "";
    const keywordHint = this.keywords.length
      ? `Từ khóa cần nhận diện chính xác: ${this.keywords.join(", ")}.`
      : "";

    return [
      "Bạn là bộ chép lời cuộc họp, không phải trợ lý hội thoại.",
      "Chỉ lắng nghe để hệ thống lấy input transcription.",
      "Không trả lời người nói, không đặt câu hỏi và không phát biểu bằng âm thanh.",
      this.prompt,
      languageHint,
      keywordHint,
    ]
      .filter(Boolean)
      .join(" ");
  }

  buildSetupMessage(resumptionHandle = "") {
    return {
      setup: {
        model: `models/${this.model}`,
        generationConfig: {
          responseModalities: ["AUDIO"],
        },
        systemInstruction: {
          parts: [{ text: this.buildSystemInstruction() }],
        },
        inputAudioTranscription: {},
        contextWindowCompression: {
          triggerTokens: 25000,
          slidingWindow: {
            targetTokens: 8000,
          },
        },
        sessionResumption: resumptionHandle
          ? { handle: resumptionHandle }
          : {},
      },
    };
  }

  async connect() {
    if (this.socket) {
      throw new Error("Gemini Live transcription đã được khởi tạo.");
    }

    this.manualClose = false;
    this.closed = false;
    await this.openSocket();
  }

  openSocket(resumptionHandle = "") {
    const url = `${GEMINI_LIVE_URL}?key=${encodeURIComponent(this.apiKey)}`;

    return new Promise((resolve, reject) => {
      let settled = false;
      let ready = false;
      let timeoutId;
      const socket = new this.WebSocketImpl(url);
      this.socket = socket;

      const settle = (error) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeoutId);

        if (error) {
          reject(error);
        } else {
          ready = true;
          this.connected = true;
          this.closed = false;
          const wasConnected = this.hasEverConnected;
          this.hasEverConnected = true;
          this.flushPendingAudio();
          this.emit(wasConnected ? "reconnected" : "ready");
          resolve();
        }
      };

      timeoutId = setTimeout(() => {
        settle(
          new Error("Gemini không xác nhận cấu hình Live API trong thời gian cho phép."),
        );
        socket.close();
      }, this.connectionTimeoutMs);

      socket.on("open", () => {
        socket.send(JSON.stringify(this.buildSetupMessage(resumptionHandle)));
      });

      socket.on("message", (data) => {
        const result = this.handleMessage(data);

        if (result?.setupComplete) {
          settle();
        } else if (result?.error) {
          settle(result.error);
        }
      });

      socket.on("error", (error) => {
        this.emit("client-error", error);
        settle(error);
      });

      socket.on("close", (code, reasonBuffer) => {
        clearTimeout(timeoutId);

        if (this.socket === socket) {
          this.connected = false;
        }

        const reason = reasonBuffer?.toString() || "";
        this.emit("closed", { code, reason });

        if (!ready) {
          settle(createGeminiError(
            reason || `Gemini Live WebSocket đóng trước khi sẵn sàng (${code}).`,
            code,
          ));
        }

        if (ready && !this.manualClose && !this.finishing) {
          this.startReconnect();
        }
      });
    });
  }

  startReconnect() {
    if (this.reconnectPromise || this.manualClose || this.finishing) {
      return;
    }

    this.reconnectPromise = (async () => {
      let lastError;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await sleep(500 * 2 ** attempt);

        if (this.manualClose || this.finishing) {
          return;
        }

        this.emit("reconnecting", { attempt: attempt + 1 });

        try {
          await this.openSocket(attempt === 0 ? this.resumptionHandle : "");
          return;
        } catch (error) {
          lastError = error;
        }
      }

      const error = new Error(
        `Không thể kết nối lại Gemini Live: ${lastError?.message || "không rõ lỗi"}`,
      );
      this.emit("api-error", error);
    })().finally(() => {
      this.reconnectPromise = null;
    });
  }

  queueAudio(buffer) {
    this.pendingAudio.push(buffer);
    this.pendingAudioBytes += buffer.length;

    while (
      this.pendingAudioBytes > MAX_PENDING_AUDIO_BYTES &&
      this.pendingAudio.length > 1
    ) {
      const removed = this.pendingAudio.shift();
      this.pendingAudioBytes -= removed.length;
    }
  }

  flushPendingAudio() {
    if (!this.connected) {
      return;
    }

    const queued = this.pendingAudio;
    this.pendingAudio = [];
    this.pendingAudioBytes = 0;

    for (const buffer of queued) {
      this.sendAudio(buffer);
    }

    if (this.pendingStreamEnd) {
      this.pendingStreamEnd = false;
      this.endAudioStream();
    }
  }

  send(event) {
    if (!this.socket || this.socket.readyState !== this.WebSocketImpl.OPEN) {
      throw new Error("Gemini Live WebSocket chưa sẵn sàng.");
    }

    this.socket.send(JSON.stringify(event));
  }

  sendAudio(buffer) {
    this.send({
      realtimeInput: {
        audio: {
          data: buffer.toString("base64"),
          mimeType: `audio/pcm;rate=${PCM_SAMPLE_RATE}`,
        },
      },
    });
  }

  appendAudio(audio) {
    if (this.closed || this.manualClose) {
      return false;
    }

    const buffer = Buffer.isBuffer(audio) ? audio : Buffer.from(audio);

    if (buffer.length === 0) {
      return false;
    }

    if (this.connected) {
      this.sendAudio(buffer);
      return true;
    }

    if (this.hasEverConnected) {
      this.queueAudio(buffer);
      return true;
    }

    return false;
  }

  endAudioStream() {
    if (this.connected) {
      this.send({ realtimeInput: { audioStreamEnd: true } });
      return true;
    }

    if (this.hasEverConnected && !this.manualClose) {
      this.pendingStreamEnd = true;
    }

    return false;
  }

  addTranscription(text) {
    if (typeof text !== "string" || !text.trim()) {
      return null;
    }

    const item = this.assembler.addChunk(this.currentItemId, text);
    this.lastTranscriptAt = Date.now();
    this.emit("delta", item);
    return item;
  }

  completeCurrentItem() {
    const item = this.assembler
      .getItems()
      .find((entry) => entry.itemId === this.currentItemId);

    if (!item?.partial.trim()) {
      return null;
    }

    const completed = this.assembler.complete(item.itemId, item.partial);
    this.currentItemNumber += 1;
    this.emit("completed", completed);
    return completed;
  }

  handleMessage(rawData) {
    let event;

    try {
      event = JSON.parse(rawData.toString());
    } catch {
      const error = new Error("Gemini trả về sự kiện không phải JSON.");
      this.emit("client-error", error);
      return { event: null, error };
    }

    if (event.error) {
      const error = createGeminiError(
        event.error.message,
        event.error.code || event.error.status,
      );
      this.emit("api-error", error);
      return { event, error };
    }

    if (event.sessionResumptionUpdate?.resumable) {
      this.resumptionHandle = event.sessionResumptionUpdate.newHandle || "";
    }

    const serverContent = event.serverContent;

    if (serverContent?.inputTranscription?.text) {
      this.addTranscription(serverContent.inputTranscription.text);
    }

    if (serverContent?.turnComplete) {
      this.completeCurrentItem();
    }

    if (event.goAway) {
      this.emit("go-away", event.goAway);
    }

    this.emit("event", event);
    return {
      event,
      error: null,
      setupComplete: Object.hasOwn(event, "setupComplete"),
    };
  }

  async finish() {
    if (this.closed || this.manualClose) {
      return this.assembler.getTranscript();
    }

    this.finishing = true;
    this.endAudioStream();
    const startedAt = Date.now();

    while (Date.now() - startedAt < this.finishMaxWaitMs) {
      await sleep(100);
      const elapsed = Date.now() - startedAt;
      const quietFor = this.lastTranscriptAt
        ? Date.now() - this.lastTranscriptAt
        : elapsed;

      if (elapsed >= this.finishMinWaitMs && quietFor >= 800) {
        break;
      }
    }

    this.completeCurrentItem();
    const transcript = this.assembler.getTranscript();
    this.close();
    return transcript;
  }

  close() {
    if (this.manualClose) {
      return;
    }

    this.manualClose = true;
    this.closed = true;
    this.connected = false;
    this.pendingAudio = [];
    this.pendingAudioBytes = 0;

    if (this.socket) {
      this.socket.close(1000, "Meeting finished");
    }
  }
}

module.exports = {
  DEFAULT_LIVE_MODEL,
  GEMINI_LIVE_URL,
  PCM_SAMPLE_RATE,
  createGeminiError,
  GeminiLiveTranscriptionClient,
};
