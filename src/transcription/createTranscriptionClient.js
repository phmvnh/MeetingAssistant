const { LocalWhisperClient } = require("./localWhisperClient");
const { GeminiLiveTranscriptionClient } = require("./geminiLiveClient");

function createTranscriptionClient(options = {}) {
  const engine = (options.engine || "whisper").toLowerCase();

  if (engine === "whisper") {
    return new LocalWhisperClient({
      sidecarPath: options.sidecarPath,
      sidecarArgs: options.sidecarArgs,
      sidecarEnv: options.sidecarEnv,
      modelPath: options.modelPath,
      language: options.language || "vi",
      prompt: options.prompt,
      cacheDir: options.cacheDir,
      meetingId: options.meetingId,
      saveRawAudio: options.saveRawAudio,
    });
  }

  if (engine === "gemini") {
    return new GeminiLiveTranscriptionClient({
      apiKey: options.apiKey,
      model: options.liveModel,
      languages: options.languages,
      prompt: options.prompt,
      keywords: options.keywords,
    });
  }

  throw new Error(`Engine nhận dạng giọng nói không được hỗ trợ: ${engine}`);
}

module.exports = {
  createTranscriptionClient,
};
