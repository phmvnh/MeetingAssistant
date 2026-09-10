const fs = require("node:fs/promises");
const path = require("node:path");
const { randomBytes } = require("node:crypto");

const STORE_VERSION = 1;
const AUDIO_RETENTION_POLICIES = Object.freeze([
  "after_meeting",
  "1_day",
  "7_days",
  "30_days",
]);

function createDefaultStorageSettings() {
  return {
    version: STORE_VERSION,
    initialized: false,
    saveRawAudio: false,
    audioRetention: "after_meeting",
  };
}

function normalizeAudioRetention(value) {
  if (!AUDIO_RETENTION_POLICIES.includes(value)) {
    throw new Error("Thời hạn lưu cache âm thanh không hợp lệ.");
  }

  return value;
}

function sanitizeStoredData(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Cấu hình lưu trữ không đúng định dạng.");
  }

  if (input.version !== STORE_VERSION) {
    throw new Error("Phiên bản cấu hình lưu trữ chưa được hỗ trợ.");
  }

  const hasValidRetention = AUDIO_RETENTION_POLICIES.includes(
    input.audioRetention,
  );

  if (input.initialized === true && !hasValidRetention) {
    throw new Error(
      "Cấu hình lưu trữ đã xác nhận nhưng thiếu thời hạn lưu hợp lệ.",
    );
  }

  return {
    version: STORE_VERSION,
    initialized: input.initialized === true && hasValidRetention,
    saveRawAudio:
      typeof input.saveRawAudio === "boolean" ? input.saveRawAudio : false,
    audioRetention: hasValidRetention
      ? input.audioRetention
      : "after_meeting",
  };
}

class StorageSettingsStore {
  constructor(options = {}) {
    if (!options.filePath) {
      throw new Error("Thiếu đường dẫn cấu hình lưu trữ.");
    }

    this.filePath = options.filePath;
    this.fs = options.fs || fs;
    this.randomBytes = options.randomBytes || randomBytes;
    this.processId = options.processId || process.pid;
    this.operationQueue = Promise.resolve();
  }

  _runExclusive(operation) {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async _readData() {
    try {
      const content = await this.fs.readFile(this.filePath, "utf8");
      return sanitizeStoredData(JSON.parse(content));
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) {
        return createDefaultStorageSettings();
      }

      if (/Cấu hình lưu trữ|Phiên bản cấu hình/.test(error.message)) {
        return createDefaultStorageSettings();
      }

      throw new Error(`Không thể đọc cấu hình lưu trữ: ${error.message}`);
    }
  }

  async _writeData(data) {
    const directory = path.dirname(this.filePath);
    const temporaryPath = path.join(
      directory,
      `${path.basename(this.filePath)}.${this.processId}.${this.randomBytes(8).toString("hex")}.tmp`,
    );
    let renamed = false;

    await this.fs.mkdir(directory, { recursive: true });

    try {
      await this.fs.writeFile(temporaryPath, JSON.stringify(data, null, 2), {
        encoding: "utf8",
        mode: 0o600,
      });
      await this.fs.rename(temporaryPath, this.filePath);
      renamed = true;
    } finally {
      if (!renamed) {
        await this.fs.unlink(temporaryPath).catch(() => {});
      }
    }
  }

  getSettings() {
    return this._runExclusive(() => this._readData());
  }

  save(settings = {}, options = {}) {
    return this._runExclusive(async () => {
      const current = await this._readData();
      const next = {
        version: STORE_VERSION,
        // `initialized` means the user explicitly confirmed an automatic
        // cleanup policy. Merely toggling raw-audio capture must never enable
        // deletion of cache left by an older or damaged configuration.
        initialized:
          options.confirmCleanup === true ? true : current.initialized,
        saveRawAudio:
          settings.saveRawAudio === undefined
            ? current.saveRawAudio
            : settings.saveRawAudio,
        audioRetention:
          settings.audioRetention === undefined
            ? current.audioRetention
            : normalizeAudioRetention(settings.audioRetention),
      };

      if (typeof next.saveRawAudio !== "boolean") {
        throw new Error("Tùy chọn lưu âm thanh phải là true hoặc false.");
      }

      await this._writeData(next);
      return next;
    });
  }
}

module.exports = {
  AUDIO_RETENTION_POLICIES,
  STORE_VERSION,
  StorageSettingsStore,
  createDefaultStorageSettings,
  normalizeAudioRetention,
  sanitizeStoredData,
};
