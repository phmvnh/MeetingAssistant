const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MODEL_CATALOG,
  DEFAULT_MODEL_ID,
  getModelInfo,
  listAvailableModels,
  getDefaultModel,
} = require("../src/transcription/modelCatalog");

test("modelCatalog contains required multilingual models", () => {
  assert.ok(MODEL_CATALOG["medium-q5_0"]);
  assert.ok(MODEL_CATALOG["small-q5_1"]);
  assert.ok(MODEL_CATALOG["medium"]);

  const def = getDefaultModel();
  assert.equal(def.id, DEFAULT_MODEL_ID);
  assert.equal(def.recommended, true);
});

test("getModelInfo returns model metadata", () => {
  const model = getModelInfo("medium-q5_0");
  assert.ok(model);
  assert.equal(model.fileName, "ggml-medium-q5_0.bin");
  assert.ok(model.sizeBytes > 0);
  assert.ok(Array.isArray(model.downloadUrls) && model.downloadUrls.length > 0);
});

test("listAvailableModels returns cloned array", () => {
  const list = listAvailableModels();
  assert.ok(Array.isArray(list));
  assert.ok(list.length >= 3);
});
