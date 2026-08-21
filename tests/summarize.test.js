const test = require("node:test");
const assert = require("node:assert/strict");

const { summarizeMeeting } = require("../src/meeting/summarize");

test("summarizeMeeting sends structured-output request and parses result", async () => {
  const apiNotes = {
    title: "Họp sprint - Kế hoạch phát triển sản phẩm",
    summary: "Tóm tắt",
    keyPoints: ["A"],
    decisions: [],
    actionItems: [],
    openQuestions: [],
  };
  const expected = {
    ...apiNotes,
    title: "Họp sprint",
  };
  let requestBody;
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify(apiNotes) }],
            },
          },
        ],
      }),
    };
  };

  const result = await summarizeMeeting({
    apiKey: "test-key",
    model: "test-model",
    transcript: "Mọi người thống nhất công việc A.",
    metadata: { title: "Họp sprint" },
    fetchImpl,
  });

  assert.deepEqual(result, expected);
  assert.equal(
    requestBody.generationConfig.responseMimeType,
    "application/json",
  );
  assert.equal(requestBody.generationConfig.responseJsonSchema.type, "object");
  assert.equal(requestBody.contents[0].role, "user");
});

test("summarizeMeeting rejects an empty transcript", async () => {
  await assert.rejects(
    summarizeMeeting({ apiKey: "test", transcript: "  " }),
    /Không có transcript/,
  );
});
