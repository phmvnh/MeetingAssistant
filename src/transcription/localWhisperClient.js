const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const {
  encodeAudioFrame,
  encodeFlushFrame,
  encodeCloseFrame,
  NdjsonParser,
} = require("./sidecarProtocol");
const { TranscriptAssembler } = require("./transcriptAssembler");

function normalizeMeetingId(value) {
  const meetingId = String(value || "");

  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(meetingId)) {
    throw new Error("Meeting ID dùng cho cache âm thanh không hợp lệ.");
  }

  return meetingId;
}

class LocalWhisperClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.sidecarPath = options.sidecarPath || null;
    this.sidecarArgs = options.sidecarArgs || [];
    this.sidecarEnv = options.sidecarEnv || null;
    this.modelPath = options.modelPath || null;
    this.spawnFn = options.spawnFn || spawn;
    this.language = options.language || "vi";
    this.prompt = options.prompt || "";
    this.meetingId = normalizeMeetingId(
      options.meetingId || `meeting-${Date.now()}`,
    );
    this.cacheDir = options.cacheDir || null;
    this.saveRawAudio = options.saveRawAudio === true;
    this.streamingFlushIntervalMs = Number.isFinite(
      options.streamingFlushIntervalMs,
    )
      ? Math.max(0, options.streamingFlushIntervalMs)
      : 3000;
    this.finishTimeoutMs = Number.isFinite(options.finishTimeoutMs)
      ? Math.max(1, options.finishTimeoutMs)
      : 5 * 60 * 1000;
    this.connectTimeoutMs = Number.isFinite(options.connectTimeoutMs)
      ? Math.max(1, options.connectTimeoutMs)
      : 30000;
    this.closeGracePeriodMs = Number.isFinite(options.closeGracePeriodMs)
      ? Math.max(0, options.closeGracePeriodMs)
      : 1000;
    this.closeTerminateTimeoutMs = Number.isFinite(
      options.closeTerminateTimeoutMs,
    )
      ? Math.max(0, options.closeTerminateTimeoutMs)
      : 2000;
    this.closeKillTimeoutMs = Number.isFinite(options.closeKillTimeoutMs)
      ? Math.max(1, options.closeKillTimeoutMs)
      : 1000;

    this.child = null;
    this.ndjsonParser = null;
    this.assembler = new TranscriptAssembler();
    this.isReady = false;
    this.isClosed = false;
    this.spoolStream = null;
    this.spoolClosePromise = null;
    this.closePromise = null;
    this.connectTimeoutTimer = null;
    this.pendingFinishPromise = null;
    this.streamingFlushTimer = null;
    this.pendingAudioBytes = 0;
    this.flushInFlight = false;
    this.isFinishing = false;
    this.hasFinished = false;
    this.closeRequested = false;
    this.terminalError = null;
  }

  get currentItemId() {
    return `whisper-seg-${this.assembler.getItems().length + 1}`;
  }

  _initSpool() {
    if (this.saveRawAudio && this.cacheDir && this.meetingId) {
      try {
        const meetingCacheDir = path.join(this.cacheDir, this.meetingId);
        fs.mkdirSync(meetingCacheDir, { recursive: true });
        const spoolFile = path.join(meetingCacheDir, "audio.pcm.part");
        this.spoolStream = fs.createWriteStream(spoolFile, { flags: "w" });
        this.spoolStream.on("error", (error) => {
          this.emit("cache-error", error);
        });
      } catch (error) {
        this.emit("cache-error", error);
      }
    }
  }

  async connect() {
    if (this.child) {
      throw new Error("Sidecar đã được kết nối.");
    }

    if (!this.modelPath || !fs.existsSync(this.modelPath)) {
      throw new Error(`Không tìm thấy file model Whisper tại: ${this.modelPath}`);
    }

    this._initSpool();

    const args = [
      ...this.sidecarArgs,
      "--model",
      this.modelPath,
      "--language",
      this.language,
    ];

    if (this.prompt) {
      args.push("--prompt", this.prompt);
    }

    const sidecarExecutable = this.sidecarPath || "whisper-sidecar";

    return new Promise((resolve, reject) => {
      let isSettled = false;

      const clearConnectTimeout = () => {
        clearTimeout(this.connectTimeoutTimer);
        this.connectTimeoutTimer = null;
      };
      const resolveConnect = (value) => {
        if (isSettled) {
          return false;
        }

        isSettled = true;
        clearConnectTimeout();
        resolve(value);
        return true;
      };
      const rejectConnect = (error) => {
        if (isSettled) {
          return false;
        }

        isSettled = true;
        clearConnectTimeout();
        reject(error);
        return true;
      };

      this.connectTimeoutTimer = setTimeout(() => {
        const timeoutError = this._recordTerminalError(
          new Error(
            `Quá thời gian khởi tạo sidecar Whisper (timeout ${Math.ceil(this.connectTimeoutMs / 1000)}s).`,
          ),
          false,
        );
        if (rejectConnect(timeoutError)) {
          void this.close().catch(() => {});
        }
      }, this.connectTimeoutMs);

      try {
        this.child = this.spawnFn(sidecarExecutable, args, {
          shell: false,
          windowsHide: true,
          env: this.sidecarEnv
            ? { ...process.env, ...this.sidecarEnv }
            : undefined,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (err) {
        const processError = this._recordTerminalError(
          new Error(`Không thể khởi chạy sidecar: ${err.message}`),
          false,
        );
        rejectConnect(processError);
        return;
      }

      this.ndjsonParser = new NdjsonParser((event) => {
        this._handleSidecarEvent(event, resolveConnect);
      });

      this.child.stdout.on("data", (chunk) => {
        this.ndjsonParser.push(chunk);
      });

      this.child.stderr.on("data", (chunk) => {
        const text = chunk.toString("utf8").trim();
        if (text) {
          console.error(`[WhisperSidecar stderr]: ${text}`);
        }
      });

      this.child.on("error", (err) => {
        this.isClosed = true;
        const wasConnected = isSettled;
        const processError = this._recordTerminalError(
          new Error(`Lỗi tiến trình sidecar Whisper: ${err.message}`),
          wasConnected && !this.closeRequested,
        );

        if (!isSettled) {
          rejectConnect(processError);
        }
        if (this.pendingFinishPromise) {
          this._settleFinish(processError);
        }
      });

      this.child.on("close", (code, signal) => {
        this.isClosed = true;
        const exitReason = signal
          ? `tín hiệu ${signal}`
          : `mã exit ${code ?? "không xác định"}`;
        let closeError = this.terminalError;

        if (!isSettled) {
          closeError = this._recordTerminalError(
            new Error(`Sidecar Whisper đóng sớm với ${exitReason}.`),
            false,
          );
          rejectConnect(closeError);
        } else if (!this.closeRequested) {
          closeError = this._recordTerminalError(
            new Error(
              `Sidecar Whisper đã dừng đột ngột (${exitReason}). Transcript có thể chưa đầy đủ.`,
            ),
          );
        }

        if (this.pendingFinishPromise) {
          this._settleFinish(
            closeError ||
              new Error(
                `Sidecar Whisper đóng trước khi hoàn thiện transcript (${exitReason}).`,
              ),
          );
        }
      });
    });
  }

  _recordTerminalError(error, shouldEmit = true) {
    if (this.terminalError) {
      return this.terminalError;
    }

    this.terminalError =
      error instanceof Error ? error : new Error(String(error));
    if (shouldEmit) {
      // `client-error` không có hành vi ném đặc biệt của EventEmitter `error`.
      this.emit("client-error", this.terminalError);
    }
    return this.terminalError;
  }

  _handleSidecarEvent(event, resolveConnect) {
    if (!event || typeof event !== "object") return;

    switch (event.type) {
      case "ready": {
        if (!resolveConnect()) {
          break;
        }
        this.isReady = true;
        this._startStreamingFlushTimer();
        this.emit("ready", event);
        break;
      }

      case "delta": {
        const itemId = event.itemId || `seg-${event.order || 1}`;
        const item = this.assembler.setPartial(itemId, event.transcript || event.partial || "");
        this.emit("delta", {
          itemId: item.itemId,
          order: item.order,
          partial: item.partial,
          transcript: item.transcript,
          completed: false,
        });
        break;
      }

      case "completed": {
        const itemId = event.itemId || `seg-${event.order || 1}`;
        const item = this.assembler.complete(itemId, event.transcript || "");
        this.emit("completed", {
          itemId: item.itemId,
          order: item.order,
          partial: item.partial,
          transcript: item.transcript,
          completed: true,
        });
        break;
      }

      case "speech-started":
        this.emit("speech-started", event);
        break;

      case "speech-stopped":
        this.emit("speech-stopped", event);
        break;

      case "stats":
        this.emit("stats", event);
        break;

      case "flush-completed":
        this.flushInFlight = false;
        if (this.pendingFinishPromise) {
          if (this.pendingAudioBytes > 0) {
            this._flushStreamingAudio();
          } else {
            this._settleFinish();
          }
        }
        break;

      case "error":
        this.emit(
          "client-error",
          new Error(event.message || "Lỗi từ sidecar whisper.cpp"),
        );
        break;

      default:
        break;
    }
  }

  appendAudio(pcmBuffer) {
    if (
      this.isClosed ||
      this.isFinishing ||
      !this.child ||
      !this.child.stdin.writable
    ) {
      return false;
    }

    if (this.spoolStream && this.spoolStream.writable) {
      this.spoolStream.write(pcmBuffer);
    }

    const frame = encodeAudioFrame(pcmBuffer);
    this.pendingAudioBytes += pcmBuffer.length;
    return this.child.stdin.write(frame);
  }

  _startStreamingFlushTimer() {
    if (this.streamingFlushTimer || this.streamingFlushIntervalMs <= 0) {
      return;
    }

    this.streamingFlushTimer = setInterval(() => {
      this._flushStreamingAudio();
    }, this.streamingFlushIntervalMs);
  }

  _stopStreamingFlushTimer() {
    clearInterval(this.streamingFlushTimer);
    this.streamingFlushTimer = null;
  }

  _flushStreamingAudio(force = false) {
    if (
      this.isClosed ||
      this.flushInFlight ||
      (!force && this.pendingAudioBytes === 0) ||
      !this.child?.stdin.writable
    ) {
      return false;
    }

    this.pendingAudioBytes = 0;
    this.flushInFlight = true;
    try {
      this.child.stdin.write(encodeFlushFrame());
      return true;
    } catch (error) {
      this.flushInFlight = false;
      if (this.pendingFinishPromise) {
        this._settleFinish(
          new Error(`Không thể chốt transcript Whisper: ${error.message}`),
        );
      } else {
        this.emit("client-error", error);
      }
      return false;
    }
  }

  endAudioStream() {
    // Tạm dừng/flush boundary nhưng giữ sidecar sống
    this._stopStreamingFlushTimer();
    this._flushStreamingAudio();
  }

  resumeAudioStream() {
    if (!this.isClosed && this.isReady) {
      this._startStreamingFlushTimer();
    }
  }

  async finish() {
    if (this.hasFinished) {
      return this.assembler.getTranscript();
    }

    if (this.terminalError) {
      throw this.terminalError;
    }

    if (this.isClosed || !this.child) {
      return this.assembler.getTranscript();
    }

    if (this.pendingFinishPromise) {
      return this.pendingFinishPromise.promise;
    }

    this.isFinishing = true;
    this._stopStreamingFlushTimer();

    let resolveFinish;
    let rejectFinish;
    const promise = new Promise((resolve, reject) => {
      resolveFinish = resolve;
      rejectFinish = reject;
    });
    const timeout = setTimeout(() => {
      this._settleFinish(
        new Error(
          "Quá thời gian hoàn thiện transcript Whisper. Vui lòng thử lại với model nhỏ hơn hoặc kiểm tra tài nguyên máy.",
        ),
      );
    }, this.finishTimeoutMs);

    this.pendingFinishPromise = {
      promise,
      resolve: resolveFinish,
      reject: rejectFinish,
      timeout,
    };

    // Nếu một flush định kỳ đang chạy, chờ ACK của nó. Handler ACK sẽ gửi
    // thêm flush cho mọi audio đến sau boundary cũ trước khi resolve finish.
    if (!this.flushInFlight && !this._flushStreamingAudio(true)) {
      this._settleFinish(
        new Error("Không thể gửi yêu cầu hoàn thiện transcript tới Whisper."),
      );
    }

    return promise;
  }

  _settleFinish(error = null) {
    const pending = this.pendingFinishPromise;
    if (!pending) {
      return;
    }

    this.pendingFinishPromise = null;
    clearTimeout(pending.timeout);

    if (error) {
      pending.reject(error);
      return;
    }

    this.hasFinished = true;
    pending.resolve(this.assembler.getTranscript());
  }

  _closeSpool() {
    if (this.spoolClosePromise) {
      return this.spoolClosePromise;
    }

    const stream = this.spoolStream;
    this.spoolStream = null;

    if (!stream) {
      this.spoolClosePromise = Promise.resolve();
      return this.spoolClosePromise;
    }

    this.spoolClosePromise = new Promise((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(() => {
        try {
          stream.destroy();
        } catch {
          // ignore
        }
        settle();
      }, 10000);

      stream.once("close", settle);
      stream.once("error", settle);

      try {
        if (stream.destroyed) {
          settle();
        } else {
          stream.end();
        }
      } catch {
        try {
          stream.destroy();
        } catch {
          // ignore
        }
        settle();
      }
    });

    return this.spoolClosePromise;
  }

  _closeChild() {
    const child = this.child;
    this.child = null;

    if (!child) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let terminateTimer = null;
      let killTimer = null;
      let finalTimer = null;

      const clearTimers = () => {
        clearTimeout(terminateTimer);
        clearTimeout(killTimer);
        clearTimeout(finalTimer);
      };

      const settle = (error = null) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimers();
        child.removeListener("close", onClose);

        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      const onClose = () => settle();
      const sendSignal = (signal) => {
        try {
          child.kill(signal);
        } catch {
          // Tiếp tục đến bước cưỡng bức tiếp theo hoặc timeout cuối.
        }
      };

      child.once("close", onClose);

      if (child.exitCode !== null && child.exitCode !== undefined) {
        settle();
        return;
      }

      if (child.signalCode !== null && child.signalCode !== undefined) {
        settle();
        return;
      }

      try {
        if (child.stdin) {
          // Tránh EPIPE không được xử lý nếu sidecar đóng đúng lúc teardown.
          child.stdin.once("error", () => {});

          if (!child.stdin.destroyed && !child.stdin.writableEnded) {
            if (child.stdin.writable) {
              child.stdin.write(encodeCloseFrame());
            }
            child.stdin.end();
          }
        }
      } catch {
        // Vẫn tiếp tục chuỗi SIGTERM/SIGKILL bên dưới.
      }

      terminateTimer = setTimeout(() => {
        if (settled) {
          return;
        }

        sendSignal("SIGTERM");
        killTimer = setTimeout(() => {
          if (settled) {
            return;
          }

          sendSignal("SIGKILL");
          finalTimer = setTimeout(() => {
            settle(
              new Error(
                "Không thể xác nhận sidecar Whisper đã dừng sau khi cưỡng bức kết thúc.",
              ),
            );
          }, this.closeKillTimeoutMs);
        }, this.closeTerminateTimeoutMs);
      }, this.closeGracePeriodMs);
    });
  }

  close() {
    if (this.closePromise) {
      return this.closePromise;
    }

    this.closeRequested = true;
    this.isClosed = true;
    this._stopStreamingFlushTimer();
    const spoolClosePromise = this._closeSpool();
    const childClosePromise = this._closeChild();

    this.closePromise = Promise.allSettled([
      spoolClosePromise,
      childClosePromise,
    ]).then((results) => {
      const failure = results.find((result) => result.status === "rejected");
      if (failure) {
        throw failure.reason;
      }
    });

    return this.closePromise;
  }
}

module.exports = {
  LocalWhisperClient,
  normalizeMeetingId,
};
