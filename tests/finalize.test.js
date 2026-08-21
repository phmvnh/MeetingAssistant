const test = require("node:test");
const assert = require("node:assert/strict");

const { createFallbackNotes } = require("../src/meeting/finalize");

test("createFallbackNotes preserves a usable document when summarization fails", () => {
  const notes = createFallbackNotes({ title: "Họp dự án" });

  assert.equal(notes.title, "Họp dự án");
  assert.match(notes.summary, /Transcript đầy đủ vẫn được lưu/);
  assert.deepEqual(notes.actionItems, []);
});
