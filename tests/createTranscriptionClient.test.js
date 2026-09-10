const test = require("node:test");
const assert = require("node:assert/strict");
const { createTranscriptionClient } = require("../src/transcription/createTranscriptionClient");
const { LocalWhisperClient } = require("../src/transcription/localWhisperClient");
const { GeminiLiveTranscriptionClient } = require("../src/transcription/geminiLiveClient");

test("createTranscriptionClient creates LocalWhisperClient by default", () => {
  const client = createTranscriptionClient({
    engine: "whisper",
    modelPath: "fake/path/model.bin",
    saveRawAudio: true,
  });
  assert.ok(client instanceof LocalWhisperClient);
  assert.equal(client.saveRawAudio, true);
});

test("createTranscriptionClient creates GeminiLiveClient when requested", () => {
  const client = createTranscriptionClient({
    engine: "gemini",
    apiKey: "test-api-key",
  });
  assert.ok(client instanceof GeminiLiveTranscriptionClient);
});
