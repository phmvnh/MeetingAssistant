const fs = require("node:fs/promises");
const path = require("node:path");
const {
  LOCAL_RECORD_TYPE,
  LOCAL_RECORD_VERSION,
} = require("../meeting/localStore");

const RETENTION_MILLISECONDS = Object.freeze({
  "1_day": 24 * 60 * 60 * 1000,
  "7_days": 7 * 24 * 60 * 60 * 1000,
  "30_days": 30 * 24 * 60 * 60 * 1000,
});
const MAX_MANAGED_RECORD_BYTES = 50 * 1024 * 1024;

function isMissing(error) {
  return error?.code === "ENOENT";
}

function isManagedMeetingRecord(record, fileName = "") {
  const hasRequiredShape = Boolean(
    record &&
      typeof record === "object" &&
      !Array.isArray(record) &&
      record.meeting &&
      typeof record.meeting === "object" &&
      record.notes &&
      typeof record.notes === "object" &&
      typeof record.transcript === "string" &&
      typeof record.savedAt === "string",
  );

  if (!hasRequiredShape) {
    return false;
  }

  const meetingId = String(record.meeting.meetingId || "");
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(meetingId)) {
    return false;
  }

  if (
    record.recordType === LOCAL_RECORD_TYPE &&
    record.schemaVersion === LOCAL_RECORD_VERSION
  ) {
    return true;
  }

  const baseName = path.basename(fileName, path.extname(fileName));
  const meetingSuffix = meetingId.slice(0, 8);
  return (
    /^\d{4}-\d{2}-\d{2} - .+ - [A-Za-z0-9_-]{1,8}$/.test(baseName) &&
    baseName.endsWith(` - ${meetingSuffix}`)
  );
}

class StorageManager {
  constructor(options = {}) {
    if (!options.audioCacheDirectory) {
      throw new Error("Thiếu thư mục cache âm thanh.");
    }

    if (!options.localDocumentsDirectory) {
      throw new Error("Thiếu thư mục biên bản cục bộ.");
    }

    if (!options.settingsStore) {
      throw new Error("Thiếu kho cấu hình lưu trữ.");
    }

    this.audioCacheDirectory = path.resolve(options.audioCacheDirectory);
    this.localDocumentsDirectory = path.resolve(
      options.localDocumentsDirectory,
    );
    this.settingsStore = options.settingsStore;
    this.fs = options.fs || fs;
    this.now = options.now || (() => Date.now());
    this.audioOperationQueue = Promise.resolve();
  }

  _runAudioExclusive(operation) {
    const result = this.audioOperationQueue.then(operation, operation);
    this.audioOperationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async _readDirectory(directory) {
    try {
      return await this.fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) {
        return [];
      }
      throw error;
    }
  }

  async _collectUsage(targetPath) {
    const usage = { bytes: 0, fileCount: 0, latestMtimeMs: 0 };
    const pending = [targetPath];

    while (pending.length) {
      const currentPath = pending.pop();
      let stats;

      try {
        stats = await this.fs.lstat(currentPath);
      } catch (error) {
        if (isMissing(error)) {
          continue;
        }
        throw error;
      }

      usage.latestMtimeMs = Math.max(usage.latestMtimeMs, stats.mtimeMs || 0);

      if (stats.isSymbolicLink()) {
        continue;
      }

      if (stats.isFile()) {
        usage.bytes += stats.size;
        usage.fileCount += 1;
        continue;
      }

      if (!stats.isDirectory()) {
        continue;
      }

      const entries = await this._readDirectory(currentPath);
      entries.forEach((entry) => pending.push(path.join(currentPath, entry.name)));
    }

    return usage;
  }

  async _listManagedLocalDocumentFiles() {
    const entries = await this._readDirectory(this.localDocumentsDirectory);
    const managedPaths = new Set();

    for (const entry of entries) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json") {
        continue;
      }

      const jsonPath = path.join(this.localDocumentsDirectory, entry.name);
      let stats;
      let record;

      try {
        stats = await this.fs.lstat(jsonPath);
        if (
          !stats.isFile() ||
          stats.isSymbolicLink() ||
          stats.size > MAX_MANAGED_RECORD_BYTES
        ) {
          continue;
        }
        record = JSON.parse(await this.fs.readFile(jsonPath, "utf8"));
      } catch {
        continue;
      }

      if (!isManagedMeetingRecord(record, entry.name)) {
        continue;
      }

      managedPaths.add(jsonPath);
      const markdownPath = path.join(
        this.localDocumentsDirectory,
        `${path.basename(entry.name, path.extname(entry.name))}.md`,
      );

      try {
        const markdownStats = await this.fs.lstat(markdownPath);
        if (markdownStats.isFile() && !markdownStats.isSymbolicLink()) {
          managedPaths.add(markdownPath);
        }
      } catch (error) {
        if (!isMissing(error)) {
          throw error;
        }
      }
    }

    return [...managedPaths];
  }

  async _collectManagedLocalDocumentsUsage() {
    const files = await this._listManagedLocalDocumentFiles();
    let bytes = 0;
    let fileCount = 0;

    for (const filePath of files) {
      try {
        const stats = await this.fs.lstat(filePath);
        if (stats.isFile() && !stats.isSymbolicLink()) {
          bytes += stats.size;
          fileCount += 1;
        }
      } catch (error) {
        if (!isMissing(error)) {
          throw error;
        }
      }
    }

    return { bytes, fileCount };
  }

  async getStatus() {
    const [settings, audioUsage, localDocumentsUsage] = await Promise.all([
      this.settingsStore.getSettings(),
      this._collectUsage(this.audioCacheDirectory),
      this._collectManagedLocalDocumentsUsage(),
    ]);

    return {
      settings,
      audioCache: {
        path: this.audioCacheDirectory,
        bytes: audioUsage.bytes,
        fileCount: audioUsage.fileCount,
      },
      localDocuments: {
        path: this.localDocumentsDirectory,
        bytes: localDocumentsUsage.bytes,
        fileCount: localDocumentsUsage.fileCount,
      },
    };
  }

  saveSettings(settings) {
    return this.settingsStore.save(settings);
  }

  async ensureDirectory(kind) {
    if (!["audio", "documents"].includes(kind)) {
      throw new Error("Loại thư mục lưu trữ không hợp lệ.");
    }

    const directory =
      kind === "audio" ? this.audioCacheDirectory : this.localDocumentsDirectory;
    await this.fs.mkdir(directory, { recursive: true });
    return directory;
  }

  _normalizeProtectedMeetingIds(values = []) {
    return new Set(
      values
        .map((value) => String(value || ""))
        .filter((value) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)),
    );
  }

  async _deleteAudioEntries(options = {}) {
    const protectedMeetingIds = this._normalizeProtectedMeetingIds(
      options.protectedMeetingIds,
    );
    const entries = await this._readDirectory(this.audioCacheDirectory);
    const result = {
      bytesBefore: 0,
      bytesFreed: 0,
      deletedEntries: 0,
      failedEntries: [],
    };

    for (const entry of entries) {
      if (protectedMeetingIds.has(entry.name)) {
        continue;
      }

      const entryPath = path.join(this.audioCacheDirectory, entry.name);
      const usage = await this._collectUsage(entryPath);
      result.bytesBefore += usage.bytes;

      if (options.shouldDelete && !options.shouldDelete(entry, usage)) {
        continue;
      }

      try {
        await this.fs.rm(entryPath, { recursive: true, force: true });
        result.bytesFreed += usage.bytes;
        result.deletedEntries += 1;
      } catch (error) {
        result.failedEntries.push({ name: entry.name, message: error.message });
      }
    }

    return result;
  }

  clearAudioCache(options = {}) {
    return this._runAudioExclusive(() =>
      this._deleteAudioEntries({
        protectedMeetingIds: options.protectedMeetingIds,
        shouldDelete: () => true,
      }),
    );
  }

  async cleanupExpiredAudio(options = {}) {
    const settings = await this.settingsStore.getSettings();

    if (!settings.initialized && options.allowUninitialized !== true) {
      return {
        bytesBefore: 0,
        bytesFreed: 0,
        deletedEntries: 0,
        failedEntries: [],
        skipped: true,
      };
    }

    const retention = options.audioRetention || settings.audioRetention;
    const retentionMs = RETENTION_MILLISECONDS[retention];

    return this._runAudioExclusive(() =>
      this._deleteAudioEntries({
        protectedMeetingIds: options.protectedMeetingIds,
        shouldDelete:
          retention === "after_meeting"
            ? () => true
            : (_entry, usage) =>
                Boolean(retentionMs) &&
                usage.latestMtimeMs <= this.now() - retentionMs,
      }),
    );
  }

  removeMeetingAudio(meetingId) {
    const normalized = String(meetingId || "");

    if (
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(normalized)
    ) {
      throw new Error("Meeting ID không hợp lệ.");
    }

    return this._runAudioExclusive(async () => {
      const meetingDirectory = path.join(this.audioCacheDirectory, normalized);
      const usage = await this._collectUsage(meetingDirectory);
      await this.fs.rm(meetingDirectory, { recursive: true, force: true });
      return { bytesFreed: usage.bytes };
    });
  }

  async clearLocalDocuments() {
    const files = (await this._listManagedLocalDocumentFiles()).sort(
      (left, right) =>
        Number(path.extname(left).toLowerCase() === ".json") -
        Number(path.extname(right).toLowerCase() === ".json"),
    );
    const result = {
      bytesBefore: 0,
      bytesFreed: 0,
      deletedFiles: 0,
      failedFiles: [],
    };
    const failedBaseNames = new Set();

    for (const filePath of files) {
      const baseName = path.join(
        path.dirname(filePath),
        path.basename(filePath, path.extname(filePath)),
      );
      const isJson = path.extname(filePath).toLowerCase() === ".json";

      if (isJson && failedBaseNames.has(baseName)) {
        continue;
      }

      let size = 0;

      try {
        size = (await this.fs.lstat(filePath)).size;
        result.bytesBefore += size;
        await this.fs.unlink(filePath);
        result.bytesFreed += size;
        result.deletedFiles += 1;
      } catch (error) {
        if (!isMissing(error)) {
          failedBaseNames.add(baseName);
          result.failedFiles.push({
            name: path.basename(filePath),
            message: error.message,
          });
        }
      }
    }

    return result;
  }
}

module.exports = {
  RETENTION_MILLISECONDS,
  StorageManager,
  isManagedMeetingRecord,
};
