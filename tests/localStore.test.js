const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { saveMeetingLocally } = require("../src/meeting/localStore");

test("saveMeetingLocally keeps meetings with the same title in separate files", async (t) => {
  const outputDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "meeting-assistant-test-"),
  );
  t.after(() => fs.rm(outputDirectory, { recursive: true, force: true }));

  const input = {
    outputDirectory,
    notes: {
      title: "Họp tuần - Tiêu đề dài do AI tạo",
      summary: "Tóm tắt",
      keyPoints: [],
      decisions: [],
      actionItems: [],
      openQuestions: [],
    },
    transcript: "Nội dung cuộc họp.",
  };
  const first = await saveMeetingLocally({
    ...input,
    meeting: {
      meetingId: "11111111-aaaa",
      title: "Họp tuần",
      startedAt: "2026-08-12T02:00:00.000Z",
      source: "room",
    },
  });
  const second = await saveMeetingLocally({
    ...input,
    meeting: {
      meetingId: "22222222-bbbb",
      title: "Họp tuần",
      startedAt: "2026-08-12T03:00:00.000Z",
      source: "room",
    },
  });

  assert.notEqual(first.markdownPath, second.markdownPath);
  assert.match(path.basename(first.markdownPath), /Họp tuần/);
  assert.doesNotMatch(path.basename(first.markdownPath), /Tiêu đề dài/);
  assert.match(path.basename(first.markdownPath), /11111111\.md$/);
  assert.match(path.basename(second.markdownPath), /22222222\.md$/);
  const storedRecord = JSON.parse(await fs.readFile(first.jsonPath, "utf8"));
  assert.equal(storedRecord.recordType, "meeting-assistant-local-record");
  assert.equal(storedRecord.schemaVersion, 1);
});
