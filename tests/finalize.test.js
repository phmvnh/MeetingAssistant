const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createFallbackNotes,
  resolveSummaryConfig,
} = require("../src/meeting/finalize");

test("createFallbackNotes preserves a usable document when summarization fails", () => {
  const notes = createFallbackNotes({ title: "Họp dự án" });

  assert.equal(notes.title, "Họp dự án");
  assert.match(notes.summary, /Transcript đầy đủ vẫn được lưu/);
  assert.deepEqual(notes.actionItems, []);
});

test("resolveSummaryConfig prefers the selected UI provider", () => {
  const summaryConfig = {
    provider: "anthropic",
    apiKey: "claude-key",
    model: "claude-sonnet-5",
  };

  assert.equal(
    resolveSummaryConfig(summaryConfig, {
      apiKey: "gemini-key",
      summaryModel: "gemini-model",
    }),
    summaryConfig,
  );
});

test("resolveSummaryConfig keeps compatibility with legacy Gemini config", () => {
  assert.deepEqual(
    resolveSummaryConfig(null, {
      apiKey: "gemini-key",
      summaryModel: "gemini-model",
    }),
    {
      provider: "gemini",
      apiKey: "gemini-key",
      model: "gemini-model",
    },
  );
});
