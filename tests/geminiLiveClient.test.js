const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const {
  createGeminiError,
  GeminiLiveTranscriptionClient,
} = require("../src/transcription/geminiLiveClient");

class FakeWebSocket extends EventEmitter {
  static OPEN = 1;

  constructor(url) {
    super();
    this.url = url;
    this.readyState = FakeWebSocket.OPEN;
    this.sent = [];
    queueMicrotask(() => this.emit("open"));
  }

  send(value) {
    const event = JSON.parse(value);
    this.sent.push(event);

    if (event.setup) {
      queueMicrotask(() => {
        this.emit("message", Buffer.from(JSON.stringify({ setupComplete: {} })));
      });
    }
  }

  close() {
    this.readyState = 3;
    this.emit("close", 1000, Buffer.from("test"));
  }
}

test("Gemini Live client sends documented setup and 16 kHz PCM audio", async () => {
  const client = new GeminiLiveTranscriptionClient({
    apiKey: "test-key",
    model: "gemini-3.1-flash-live-preview",
    languages: ["vi", "en"],
    prompt: "Cuộc họp kỹ thuật",
    keywords: ["Meeting Assistant"],
    WebSocketImpl: FakeWebSocket,
  });

  await client.connect();
  const setupEvent = client.socket.sent[0];
  assert.match(client.socket.url, /BidiGenerateContent\?key=test-key$/);
  assert.equal(
    setupEvent.setup.model,
    "models/gemini-3.1-flash-live-preview",
  );
  assert.deepEqual(
    setupEvent.setup.generationConfig.responseModalities,
    ["AUDIO"],
  );
  assert.deepEqual(setupEvent.setup.inputAudioTranscription, {});
  assert.match(
    setupEvent.setup.systemInstruction.parts[0].text,
    /Meeting Assistant/,
  );

  client.appendAudio(Buffer.from([1, 2, 3, 4]));
  const audioEvent = client.socket.sent[1];
  assert.equal(
    audioEvent.realtimeInput.audio.mimeType,
    "audio/pcm;rate=16000",
  );
  client.close();
});

test("Gemini Live client assembles input transcription events", async () => {
  const client = new GeminiLiveTranscriptionClient({
    apiKey: "test-key",
    WebSocketImpl: FakeWebSocket,
  });
  let completed;
  client.on("completed", (item) => {
    completed = item;
  });

  await client.connect();
  client.handleMessage(Buffer.from(JSON.stringify({
    serverContent: {
      inputTranscription: { text: "Xin chào mọi người." },
      turnComplete: true,
    },
  })));

  assert.equal(completed.transcript, "Xin chào mọi người.");
  assert.equal(client.assembler.getTranscript(), "Xin chào mọi người.");
  client.close();
});

test("Gemini Live client rejects an API error before setup completes", async () => {
  class RejectingWebSocket extends FakeWebSocket {
    send(value) {
      this.sent.push(JSON.parse(value));
      queueMicrotask(() => {
        this.emit("message", Buffer.from(JSON.stringify({
          error: {
            code: 400,
            status: "INVALID_ARGUMENT",
            message: "Model is invalid.",
          },
        })));
      });
    }
  }

  const client = new GeminiLiveTranscriptionClient({
    apiKey: "test-key",
    WebSocketImpl: RejectingWebSocket,
  });

  client.on("api-error", () => {});
  await assert.rejects(client.connect(), /Model is invalid/);
  assert.equal(client.connected, false);
  client.close();
});

test("Gemini authentication errors explain how to replace a deleted-project key", () => {
  const error = createGeminiError(
    "Request had invalid authentication credentials.",
    401,
  );

  assert.match(error.message, /GEMINI_API_KEY không hợp lệ/);
  assert.match(error.message, /Google AI Studio/);
  assert.equal(error.code, 401);
});
