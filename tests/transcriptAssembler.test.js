const test = require("node:test");
const assert = require("node:assert/strict");

const { TranscriptAssembler } = require("../src/transcription/transcriptAssembler");

test("TranscriptAssembler replaces partial text with final transcript", () => {
  const assembler = new TranscriptAssembler();
  assembler.addDelta("item-1", "Xin ");
  assembler.addDelta("item-1", "chào");
  assert.equal(assembler.getTranscript(), "Xin chào");

  assembler.complete("item-1", "Xin chào mọi người.");
  assert.equal(assembler.getTranscript(), "Xin chào mọi người.");
});

test("TranscriptAssembler preserves first-seen order", () => {
  const assembler = new TranscriptAssembler();
  assembler.addDelta("item-2", "Hai");
  assembler.addDelta("item-1", "Một");
  assembler.complete("item-1", "Một hoàn tất");
  assembler.complete("item-2", "Hai hoàn tất");

  assert.equal(assembler.getTranscript(), "Hai hoàn tất\nMột hoàn tất");
});

test("TranscriptAssembler joins Gemini chunks without duplicating cumulative text", () => {
  const assembler = new TranscriptAssembler();
  assembler.addChunk("item-1", "Xin chào");
  assembler.addChunk("item-1", "Xin chào mọi người");
  assembler.addChunk("item-1", ".");

  assert.equal(assembler.getTranscript(), "Xin chào mọi người.");
});
