const fs = require("node:fs/promises");
const path = require("node:path");
const { randomBytes } = require("node:crypto");

const {
  getSummaryProvider,
  listSummaryProviders,
} = require("../meeting/summaryProviders");

const STORE_VERSION = 1;

function createEmptyStore() {
  return {
    version: STORE_VERSION,
    activeProvider: "gemini",
    providers: {},
  };
}

function normalizeModel(providerId, model, options = {}) {
  const provider = getSummaryProvider(providerId);
  const value = model?.trim() || provider.defaultModel;

  if (!provider.models.includes(value)) {
    if (options.fallbackToDefault) {
      return provider.defaultModel;
    }

    throw new Error(
      `Model ${value} không nằm trong danh sách được hỗ trợ của ${provider.label}.`,
    );
  }

  return value;
}

function normalizeApiKey(apiKey) {
  const value = apiKey?.trim() || "";

  if (value.length > 4096 || /[\r\n\0]/.test(value)) {
    throw new Error("API key không hợp lệ.");
  }

  return value;
}

function sanitizeStoredData(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Kho cấu hình AI không đúng định dạng.");
  }

  if (input.version !== STORE_VERSION) {
    throw new Error("Phiên bản kho cấu hình AI chưa được hỗ trợ.");
  }

  const data = createEmptyStore();
  const knownProviders = new Set(
    listSummaryProviders().map((provider) => provider.id),
  );

  if (knownProviders.has(input.activeProvider)) {
    data.activeProvider = input.activeProvider;
  }

  for (const providerId of knownProviders) {
    const stored = input.providers?.[providerId];

    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
      continue;
    }

    const encryptedApiKey =
      typeof stored.encryptedApiKey === "string"
        ? stored.encryptedApiKey.trim()
        : "";

    if (encryptedApiKey.length > 32768) {
      throw new Error("API key đã mã hóa không hợp lệ.");
    }

    data.providers[providerId] = {
      model: normalizeModel(providerId, stored.model, {
        fallbackToDefault: true,
      }),
      encryptedApiKey,
    };
  }

  return data;
}

class SummarySettingsStore {
  constructor(options = {}) {
    if (!options.filePath) {
      throw new Error("Thiếu đường dẫn kho cấu hình AI.");
    }

    if (!options.safeStorage) {
      throw new Error("Thiếu Electron safeStorage.");
    }

    this.filePath = options.filePath;
    this.safeStorage = options.safeStorage;
    this.fs = options.fs || fs;
    this.randomBytes = options.randomBytes || randomBytes;
    this.processId = options.processId || process.pid;
    this.platform = options.platform || process.platform;
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
    let content;

    try {
      content = await this.fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        return createEmptyStore();
      }

      throw new Error(`Không thể đọc kho cấu hình AI: ${error.message}`);
    }

    try {
      return sanitizeStoredData(JSON.parse(content));
    } catch (error) {
      throw new Error(`Kho cấu hình AI bị lỗi: ${error.message}`);
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

  async _getEncryptionMode() {
    if (
      typeof this.safeStorage.encryptStringAsync === "function" &&
      typeof this.safeStorage.decryptStringAsync === "function"
    ) {
      try {
        const available =
          typeof this.safeStorage.isAsyncEncryptionAvailable === "function"
            ? await this.safeStorage.isAsyncEncryptionAvailable()
            : true;

        if (available) {
          return "async";
        }
      } catch {
        // Fall back to the synchronous OS-backed API when async initialization
        // is temporarily unavailable.
      }
    }

    if (
      typeof this.safeStorage.isEncryptionAvailable !== "function" ||
      !this.safeStorage.isEncryptionAvailable()
    ) {
      throw new Error(
        "Thiết bị chưa cung cấp kho mã hóa an toàn cho API key.",
      );
    }

    if (
      this.platform === "linux" &&
      this.safeStorage.getSelectedStorageBackend?.() === "basic_text"
    ) {
      throw new Error(
        "Linux đang dùng basic_text nên ứng dụng từ chối lưu API key không mã hóa.",
      );
    }

    return "sync";
  }

  async _encrypt(apiKey) {
    const mode = await this._getEncryptionMode();
    const encrypted =
      mode === "async"
        ? await this.safeStorage.encryptStringAsync(apiKey)
        : this.safeStorage.encryptString(apiKey);

    if (!Buffer.isBuffer(encrypted) || encrypted.length === 0) {
      throw new Error("Không thể mã hóa API key.");
    }

    return encrypted.toString("base64");
  }

  async _decrypt(encryptedApiKey) {
    const mode = await this._getEncryptionMode();
    const encrypted = Buffer.from(encryptedApiKey, "base64");

    try {
      if (mode === "async") {
        const decrypted =
          await this.safeStorage.decryptStringAsync(encrypted);

        if (!decrypted || typeof decrypted.result !== "string") {
          throw new Error("Kết quả giải mã không hợp lệ.");
        }

        return {
          value: decrypted.result,
          shouldReEncrypt: Boolean(decrypted.shouldReEncrypt),
        };
      }

      return {
        value: this.safeStorage.decryptString(encrypted),
        shouldReEncrypt: false,
      };
    } catch {
      throw new Error(
        "Không thể giải mã API key. Hãy xóa cấu hình và nhập lại key.",
      );
    }
  }

  _toPublicSettings(data) {
    return {
      activeProvider: data.activeProvider,
      providers: listSummaryProviders().map((provider) => ({
        ...provider,
        model:
          data.providers[provider.id]?.model || provider.defaultModel,
        configured: Boolean(
          data.providers[provider.id]?.encryptedApiKey,
        ),
      })),
    };
  }

  getPublicSettings() {
    return this._runExclusive(async () => {
      const data = await this._readData();
      return this._toPublicSettings(data);
    });
  }

  save(settings = {}) {
    return this._runExclusive(async () => {
      const provider = getSummaryProvider(settings.provider);
      const model = normalizeModel(provider.id, settings.model);
      const apiKey = normalizeApiKey(settings.apiKey);
      const data = await this._readData();
      const existing = data.providers[provider.id];
      let encryptedApiKey = existing?.encryptedApiKey || "";

      if (apiKey) {
        encryptedApiKey = await this._encrypt(apiKey);
      } else if (!encryptedApiKey) {
        throw new Error(
          `Hãy nhập API key cho ${provider.label} trước khi lưu.`,
        );
      }

      data.activeProvider = provider.id;
      data.providers[provider.id] = {
        model,
        encryptedApiKey,
      };
      await this._writeData(data);
      return this._toPublicSettings(data);
    });
  }

  remove(providerId) {
    return this._runExclusive(async () => {
      const provider = getSummaryProvider(providerId);
      const data = await this._readData();
      delete data.providers[provider.id];

      if (data.activeProvider === provider.id) {
        data.activeProvider =
          listSummaryProviders().find(
            (candidate) =>
              Boolean(data.providers[candidate.id]?.encryptedApiKey),
          )?.id || "gemini";
      }

      await this._writeData(data);
      return this._toPublicSettings(data);
    });
  }

  getProviderConfig(providerId) {
    return this._runExclusive(async () => {
      const provider = getSummaryProvider(providerId);
      const data = await this._readData();
      const stored = data.providers[provider.id];

      if (!stored?.encryptedApiKey) {
        return null;
      }

      const decrypted = await this._decrypt(stored.encryptedApiKey);

      if (decrypted.shouldReEncrypt) {
        stored.encryptedApiKey = await this._encrypt(decrypted.value);
        await this._writeData(data);
      }

      return {
        provider: provider.id,
        model: stored.model || provider.defaultModel,
        apiKey: decrypted.value,
      };
    });
  }

  getActiveConfig() {
    return this._runExclusive(async () => {
      const data = await this._readData();
      const provider = getSummaryProvider(data.activeProvider);
      const stored = data.providers[provider.id];

      if (!stored?.encryptedApiKey) {
        return null;
      }

      const decrypted = await this._decrypt(stored.encryptedApiKey);

      if (decrypted.shouldReEncrypt) {
        stored.encryptedApiKey = await this._encrypt(decrypted.value);
        await this._writeData(data);
      }

      return {
        provider: provider.id,
        model: stored.model || provider.defaultModel,
        apiKey: decrypted.value,
      };
    });
  }
}

module.exports = {
  STORE_VERSION,
  SummarySettingsStore,
  createEmptyStore,
  normalizeApiKey,
  normalizeModel,
  sanitizeStoredData,
};
