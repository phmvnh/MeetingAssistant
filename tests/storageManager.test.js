const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { StorageManager } = require("../src/desktop/storageManager");
const { StorageSettingsStore } = require("../src/desktop/storageSettingsStore");

async function createFixture(t, now = Date.now()) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "meeting-storage-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const audioCacheDirectory = path.join(root, "cache", "meetings");
  const localDocumentsDirectory = path.join(root, "documents");
  const settingsStore = new StorageSettingsStore({
    filePath: path.join(root, "storage-settings.json"),
  });
  const manager = new StorageManager({
    audioCacheDirectory,
    localDocumentsDirectory,
    settingsStore,
    now: () => now,
  });

  return {
    root,
    audioCacheDirectory,
    localDocumentsDirectory,
    settingsStore,
    manager,
  };
}

async function writeAudioSession(root, name, bytes, modifiedAt) {
  const directory = path.join(root, name);
  await fs.mkdir(directory, { recursive: true });
  const filePath = path.join(directory, "audio.pcm.part");
  await fs.writeFile(filePath, Buffer.alloc(bytes, 1));
  await fs.utimes(filePath, modifiedAt, modifiedAt);
  await fs.utimes(directory, modifiedAt, modifiedAt);
  return directory;
}

test("StorageManager reports audio and only app-managed local documents", async (t) => {
  const fixture = await createFixture(t);
  await writeAudioSession(
    fixture.audioCacheDirectory,
    "meeting-a",
    128,
    new Date(),
  );
  await fs.mkdir(fixture.localDocumentsDirectory, { recursive: true });
  const baseName = "2026-08-25 - Họp thử - 12345678";
  const record = {
    meeting: { meetingId: "12345678-test" },
    notes: { title: "Họp thử" },
    transcript: "Nội dung",
    savedAt: new Date().toISOString(),
  };
  const jsonContent = JSON.stringify(record);
  const markdownContent = "# Biên bản";
  await fs.writeFile(
    path.join(fixture.localDocumentsDirectory, `${baseName}.json`),
    jsonContent,
  );
  await fs.writeFile(
    path.join(fixture.localDocumentsDirectory, `${baseName}.md`),
    markdownContent,
  );
  await fs.writeFile(
    path.join(fixture.localDocumentsDirectory, "unrelated.json"),
    JSON.stringify({ personal: true }),
  );
  await fs.writeFile(
    path.join(fixture.localDocumentsDirectory, "unrelated.md"),
    "Không phải dữ liệu của app",
  );

  const status = await fixture.manager.getStatus();

  assert.equal(status.settings.saveRawAudio, false);
  assert.equal(status.audioCache.bytes, 128);
  assert.equal(status.audioCache.fileCount, 1);
  assert.equal(
    status.localDocuments.bytes,
    Buffer.byteLength(jsonContent) + Buffer.byteLength(markdownContent),
  );
  assert.equal(status.localDocuments.fileCount, 2);
});

test("StorageManager applies retention and preserves an active meeting", async (t) => {
  const now = new Date("2026-08-25T12:00:00.000Z").getTime();
  const fixture = await createFixture(t, now);
  await fixture.settingsStore.save(
    {
      saveRawAudio: true,
      audioRetention: "1_day",
    },
    { confirmCleanup: true },
  );
  const oldTime = new Date(now - 2 * 24 * 60 * 60 * 1000);
  const freshTime = new Date(now - 60 * 60 * 1000);
  await writeAudioSession(fixture.audioCacheDirectory, "old", 10, oldTime);
  await writeAudioSession(fixture.audioCacheDirectory, "fresh", 20, freshTime);
  await writeAudioSession(fixture.audioCacheDirectory, "active", 30, oldTime);

  const result = await fixture.manager.cleanupExpiredAudio({
    protectedMeetingIds: ["active"],
  });

  await assert.rejects(fs.access(path.join(fixture.audioCacheDirectory, "old")));
  await fs.access(path.join(fixture.audioCacheDirectory, "fresh"));
  await fs.access(path.join(fixture.audioCacheDirectory, "active"));
  assert.equal(result.bytesFreed, 10);
  assert.equal(result.deletedEntries, 1);
});

test("StorageManager does not auto-delete old cache before settings are initialized", async (t) => {
  const fixture = await createFixture(t);
  const cachePath = await writeAudioSession(
    fixture.audioCacheDirectory,
    "legacy-cache",
    16,
    new Date(0),
  );

  const result = await fixture.manager.cleanupExpiredAudio();

  assert.equal(result.skipped, true);
  await fs.access(cachePath);
});

test("StorageManager keeps old cache after a corrupt setting and audio-only save", async (t) => {
  const fixture = await createFixture(t);
  const cachePath = await writeAudioSession(
    fixture.audioCacheDirectory,
    "cache-before-recovery",
    18,
    new Date(0),
  );
  await fs.writeFile(
    path.join(fixture.root, "storage-settings.json"),
    "{not-json",
    "utf8",
  );

  await fixture.settingsStore.save({ saveRawAudio: true });
  const result = await fixture.manager.cleanupExpiredAudio();

  assert.equal(result.skipped, true);
  assert.equal((await fixture.settingsStore.getSettings()).initialized, false);
  await fs.access(cachePath);
});

test("StorageManager removes after-meeting cache but preserves a protected meeting", async (t) => {
  const fixture = await createFixture(t);
  await fixture.settingsStore.save(
    {
      saveRawAudio: true,
      audioRetention: "after_meeting",
    },
    { confirmCleanup: true },
  );
  await writeAudioSession(
    fixture.audioCacheDirectory,
    "finished",
    12,
    new Date(),
  );
  await writeAudioSession(
    fixture.audioCacheDirectory,
    "active",
    24,
    new Date(),
  );

  await fixture.manager.cleanupExpiredAudio({
    protectedMeetingIds: ["active"],
  });

  await assert.rejects(
    fs.access(path.join(fixture.audioCacheDirectory, "finished")),
  );
  await fs.access(path.join(fixture.audioCacheDirectory, "active"));
});

test("StorageManager clears only its managed files and never touches models", async (t) => {
  const fixture = await createFixture(t);
  await writeAudioSession(
    fixture.audioCacheDirectory,
    "meeting-a",
    64,
    new Date(),
  );
  const modelDirectory = path.join(fixture.root, "models", "whisper");
  const modelPath = path.join(modelDirectory, "ggml-medium.bin");
  await fs.mkdir(modelDirectory, { recursive: true });
  await fs.writeFile(modelPath, Buffer.alloc(32, 2));

  await fs.mkdir(fixture.localDocumentsDirectory, { recursive: true });
  const managedBase = path.join(fixture.localDocumentsDirectory, "managed");
  await fs.writeFile(
    `${managedBase}.json`,
    JSON.stringify({
      recordType: "meeting-assistant-local-record",
      schemaVersion: 1,
      meeting: { meetingId: "managed-meeting" },
      notes: {},
      transcript: "Nội dung",
      savedAt: new Date().toISOString(),
    }),
  );
  await fs.writeFile(`${managedBase}.md`, "# Managed");
  const unrelatedPath = path.join(fixture.localDocumentsDirectory, "personal.md");
  await fs.writeFile(unrelatedPath, "Personal");
  const lookalikeJsonPath = path.join(
    fixture.localDocumentsDirectory,
    "personal-record.json",
  );
  await fs.writeFile(
    lookalikeJsonPath,
    JSON.stringify({
      meeting: { meetingId: "personal-record" },
      notes: {},
      transcript: "Dữ liệu cá nhân",
      savedAt: new Date().toISOString(),
    }),
  );

  await fixture.manager.clearAudioCache();
  await fixture.manager.clearLocalDocuments();

  await fs.access(modelPath);
  await fs.access(unrelatedPath);
  await fs.access(lookalikeJsonPath);
  await assert.rejects(fs.access(`${managedBase}.json`));
  await assert.rejects(fs.access(`${managedBase}.md`));
  assert.equal((await fixture.manager.getStatus()).audioCache.bytes, 0);
});
