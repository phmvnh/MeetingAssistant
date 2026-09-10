const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  StorageSettingsStore,
  createDefaultStorageSettings,
} = require("../src/desktop/storageSettingsStore");

test("StorageSettingsStore defaults to not saving raw audio", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "meeting-storage-settings-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const store = new StorageSettingsStore({
    filePath: path.join(directory, "storage-settings.json"),
  });

  assert.deepEqual(await store.getSettings(), createDefaultStorageSettings());
});

test("StorageSettingsStore persists audio without enabling automatic cleanup", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "meeting-storage-settings-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "storage-settings.json");
  const store = new StorageSettingsStore({ filePath });

  await store.save({ saveRawAudio: true });
  const restartedStore = new StorageSettingsStore({ filePath });

  assert.deepEqual(await restartedStore.getSettings(), {
    version: 1,
    initialized: false,
    saveRawAudio: true,
    audioRetention: "after_meeting",
  });

  await restartedStore.save(
    { audioRetention: "7_days" },
    { confirmCleanup: true },
  );
  assert.deepEqual(await restartedStore.getSettings(), {
    version: 1,
    initialized: true,
    saveRawAudio: true,
    audioRetention: "7_days",
  });
  await assert.rejects(
    restartedStore.save({ audioRetention: "forever" }),
    /không hợp lệ/i,
  );
});

test("StorageSettingsStore safely falls back when its file is corrupted", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "meeting-storage-settings-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "storage-settings.json");
  await fs.writeFile(filePath, "{broken-json", "utf8");

  const store = new StorageSettingsStore({ filePath });
  assert.deepEqual(await store.getSettings(), createDefaultStorageSettings());

  await store.save({ saveRawAudio: true });
  assert.equal((await store.getSettings()).initialized, false);
});

test("StorageSettingsStore never trusts an invalid confirmed retention", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "meeting-storage-settings-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "storage-settings.json");
  await fs.writeFile(
    filePath,
    JSON.stringify({
      version: 1,
      initialized: true,
      saveRawAudio: true,
      audioRetention: "invalid-policy",
    }),
    "utf8",
  );

  const store = new StorageSettingsStore({ filePath });
  assert.deepEqual(await store.getSettings(), createDefaultStorageSettings());
});
