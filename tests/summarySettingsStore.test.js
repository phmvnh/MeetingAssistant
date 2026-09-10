const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  normalizeModel,
  sanitizeStoredData,
  SummarySettingsStore,
} = require("../src/desktop/summarySettingsStore");

function createSafeStorage(overrides = {}) {
  return {
    isEncryptionAvailable: () => true,
    isAsyncEncryptionAvailable: () => true,
    encryptStringAsync: async (value) => Buffer.from(`encrypted:${value}`),
    decryptStringAsync: async (value) =>
      ({
        result: value.toString("utf8").replace(/^encrypted:/, ""),
        shouldReEncrypt: false,
      }),
    ...overrides,
  };
}

async function createStore(t, options = {}) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "meeting-assistant-summary-settings-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  return {
    directory,
    filePath: path.join(directory, "summary-ai-settings.json"),
    store: new SummarySettingsStore({
      filePath: path.join(directory, "summary-ai-settings.json"),
      safeStorage: options.safeStorage || createSafeStorage(),
      platform: options.platform || "win32",
      processId: 123,
      randomBytes: () => Buffer.from("12345678"),
    }),
  };
}

test("models can only be selected from each provider's configured list", () => {
  assert.equal(
    normalizeModel("gemini", "gemini-3.7-flash"),
    "gemini-3.7-flash",
  );
  assert.equal(normalizeModel("gemini", ""), "gemini-3.7-flash");
  assert.throws(
    () => normalizeModel("gemini", "gemini-model-typed-by-user"),
    /không nằm trong danh sách được hỗ trợ/,
  );
});

test("stored models that are no longer supported fall back to the default", () => {
  const data = sanitizeStoredData({
    version: 1,
    activeProvider: "gemini",
    providers: {
      gemini: {
        model: "gemini-retired-model",
        encryptedApiKey: "encrypted-key",
      },
    },
  });

  assert.equal(data.providers.gemini.model, "gemini-3.7-flash");
});

test("summary settings encrypt keys and never expose them publicly", async (t) => {
  const { filePath, store } = await createStore(t);
  const secret = "super-secret-gemini-key";

  await store.save({
    provider: "gemini",
    model: "gemini-3.7-flash",
    apiKey: secret,
  });

  const publicSettings = await store.getPublicSettings();
  const rawFile = await fs.readFile(filePath, "utf8");
  const activeConfig = await store.getActiveConfig();

  assert.equal(publicSettings.activeProvider, "gemini");
  assert.equal(
    publicSettings.providers.find((item) => item.id === "gemini").configured,
    true,
  );
  assert.doesNotMatch(JSON.stringify(publicSettings), /encryptedApiKey/);
  assert.doesNotMatch(JSON.stringify(publicSettings), new RegExp(secret));
  assert.doesNotMatch(rawFile, new RegExp(secret));
  assert.equal(activeConfig.apiKey, secret);
});

test("re-encrypts a key when async decryption requests key rotation", async (t) => {
  const encryptedValues = [];
  const { filePath, store } = await createStore(t, {
    safeStorage: createSafeStorage({
      encryptStringAsync: async (value) => {
        const prefix = encryptedValues.length === 0 ? "encrypted" : "rotated";
        const encrypted = Buffer.from(`${prefix}:${value}`);
        encryptedValues.push(encrypted.toString("base64"));
        return encrypted;
      },
      decryptStringAsync: async (value) => ({
        result: value.toString("utf8").replace(/^(encrypted|rotated):/, ""),
        shouldReEncrypt: value.toString("utf8").startsWith("encrypted:"),
      }),
    }),
  });

  await store.save({
    provider: "gemini",
    apiKey: "rotating-secret",
  });
  const beforeRead = await fs.readFile(filePath, "utf8");

  assert.equal((await store.getActiveConfig()).apiKey, "rotating-secret");

  const afterRead = await fs.readFile(filePath, "utf8");
  assert.notEqual(afterRead, beforeRead);
  assert.equal(encryptedValues.length, 2);
  const stored = JSON.parse(afterRead);
  assert.equal(
    stored.providers.gemini.encryptedApiKey,
    encryptedValues[1],
  );
});

test("saving a blank key preserves the encrypted key and updates the model", async (t) => {
  const { store } = await createStore(t);

  await store.save({
    provider: "openai",
    model: "gpt-5.6-luna",
    apiKey: "openai-secret",
  });
  await store.save({
    provider: "openai",
    model: "gpt-5.6-terra",
    apiKey: "",
  });

  assert.deepEqual(await store.getActiveConfig(), {
    provider: "openai",
    model: "gpt-5.6-terra",
    apiKey: "openai-secret",
  });
});

test("each provider keeps a separate key and removing active selects another", async (t) => {
  const { store } = await createStore(t);

  await store.save({
    provider: "gemini",
    apiKey: "gemini-secret",
  });
  await store.save({
    provider: "anthropic",
    apiKey: "claude-secret",
  });

  assert.equal((await store.getActiveConfig()).provider, "anthropic");
  assert.equal(
    (await store.getProviderConfig("gemini")).apiKey,
    "gemini-secret",
  );

  const publicSettings = await store.remove("anthropic");

  assert.equal(publicSettings.activeProvider, "gemini");
  assert.equal(await store.getProviderConfig("anthropic"), null);
  assert.equal((await store.getActiveConfig()).apiKey, "gemini-secret");
});

test("a new provider cannot be saved without an API key", async (t) => {
  const { store } = await createStore(t);

  await assert.rejects(
    store.save({
      provider: "xai",
      model: "grok-4.6",
      apiKey: "",
    }),
    /Hãy nhập API key/,
  );
});

test("store refuses platforms without secure encryption", async (t) => {
  const { store } = await createStore(t, {
    safeStorage: createSafeStorage({
      isAsyncEncryptionAvailable: async () => false,
      isEncryptionAvailable: () => false,
    }),
  });

  await assert.rejects(
    store.save({
      provider: "gemini",
      apiKey: "secret",
    }),
    /chưa cung cấp kho mã hóa an toàn/,
  );
});

test("store rejects Linux basic_text backend", async (t) => {
  const { store } = await createStore(t, {
    platform: "linux",
    safeStorage: createSafeStorage({
      isAsyncEncryptionAvailable: async () => false,
      getSelectedStorageBackend: () => "basic_text",
    }),
  });

  await assert.rejects(
    store.save({
      provider: "gemini",
      apiKey: "secret",
    }),
    /basic_text/,
  );
});

test("corrupt settings fail safely without returning file contents", async (t) => {
  const { filePath, store } = await createStore(t);
  await fs.writeFile(filePath, "{not-json", "utf8");

  await assert.rejects(
    store.getPublicSettings(),
    (error) => {
      assert.match(error.message, /Kho cấu hình AI bị lỗi/);
      assert.doesNotMatch(error.message, /not-json/);
      return true;
    },
  );
});
