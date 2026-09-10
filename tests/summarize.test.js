const test = require("node:test");
const assert = require("node:assert/strict");

const {
  summarizeMeeting,
  testSummaryConnection,
} = require("../src/meeting/summarize");

const API_NOTES = {
  title: "Tiêu đề do AI viết lại",
  summary: "Tóm tắt",
  keyPoints: ["A"],
  decisions: [],
  actionItems: [],
  openQuestions: [],
};

function jsonResponse(body, overrides = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    ...overrides,
  };
}

test("Gemini sends current structured-output request and parses result", async () => {
  let requestUrl;
  let requestOptions;
  const fetchImpl = async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return jsonResponse({
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify(API_NOTES) }],
          },
        },
      ],
    });
  };

  const result = await summarizeMeeting({
    apiKey: "test-key",
    model: "test-model",
    transcript: "Mọi người thống nhất công việc A.",
    metadata: { title: "Họp sprint" },
    fetchImpl,
  });
  const requestBody = JSON.parse(requestOptions.body);

  assert.equal(result.title, "Họp sprint");
  assert.match(requestUrl, /generativelanguage\.googleapis\.com/);
  assert.equal(requestOptions.headers["x-goog-api-key"], "test-key");
  assert.equal(
    requestBody.generationConfig.responseMimeType,
    "application/json",
  );
  assert.equal(
    requestBody.generationConfig.responseSchema.type,
    "object",
  );
  assert.equal(
    "additionalProperties" in requestBody.generationConfig.responseSchema,
    false,
  );
  assert.equal(
    "additionalProperties" in
      requestBody.generationConfig.responseSchema.properties.actionItems.items,
    false,
  );
  assert.equal(requestBody.contents[0].role, "user");
});

test("summarizeMeeting uses the AI title when the user leaves it empty", async () => {
  const fetchImpl = async () =>
    jsonResponse({
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify(API_NOTES) }],
          },
        },
      ],
    });

  const result = await summarizeMeeting({
    apiKey: "test-key",
    model: "test-model",
    transcript: "Mọi người thống nhất kế hoạch phát hành phiên bản mới.",
    metadata: {},
    fetchImpl,
  });

  assert.equal(result.title, API_NOTES.title);
});

test("OpenAI uses Responses API without storing the meeting response", async () => {
  let requestUrl;
  let requestOptions;
  const fetchImpl = async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return jsonResponse({
      status: "completed",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify(API_NOTES),
            },
          ],
        },
      ],
    });
  };

  const result = await summarizeMeeting({
    provider: "openai",
    apiKey: "openai-test-key",
    model: "gpt-test",
    transcript: "Nội dung cuộc họp.",
    metadata: { title: "Họp OpenAI" },
    fetchImpl,
  });
  const requestBody = JSON.parse(requestOptions.body);

  assert.equal(result.title, "Họp OpenAI");
  assert.equal(requestUrl, "https://api.openai.com/v1/responses");
  assert.equal(
    requestOptions.headers.Authorization,
    "Bearer openai-test-key",
  );
  assert.equal(requestBody.store, false);
  assert.equal(requestBody.reasoning.effort, "low");
  assert.equal(requestBody.text.format.type, "json_schema");
  assert.equal(requestBody.text.format.strict, true);
});

test("Anthropic uses Messages API structured outputs", async () => {
  let requestUrl;
  let requestOptions;
  const fetchImpl = async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return jsonResponse({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify(API_NOTES) }],
    });
  };

  const result = await summarizeMeeting({
    provider: "anthropic",
    apiKey: "claude-test-key",
    model: "claude-test",
    transcript: "Nội dung cuộc họp.",
    metadata: { title: "Họp Claude" },
    fetchImpl,
  });
  const requestBody = JSON.parse(requestOptions.body);

  assert.equal(result.title, "Họp Claude");
  assert.equal(requestUrl, "https://api.anthropic.com/v1/messages");
  assert.equal(requestOptions.headers["x-api-key"], "claude-test-key");
  assert.equal(requestOptions.headers["anthropic-version"], "2023-06-01");
  assert.equal(requestBody.output_config.format.type, "json_schema");
  assert.equal("temperature" in requestBody, false);
});

test("xAI uses Grok Responses API structured outputs", async () => {
  let requestUrl;
  let requestOptions;
  const fetchImpl = async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return jsonResponse({
      status: "completed",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify(API_NOTES),
            },
          ],
        },
      ],
    });
  };

  const result = await summarizeMeeting({
    provider: "xai",
    apiKey: "xai-test-key",
    model: "grok-test",
    transcript: "Nội dung cuộc họp.",
    metadata: { title: "Họp Grok" },
    fetchImpl,
  });
  const requestBody = JSON.parse(requestOptions.body);

  assert.equal(result.title, "Họp Grok");
  assert.equal(requestUrl, "https://api.x.ai/v1/responses");
  assert.equal(requestOptions.headers.Authorization, "Bearer xai-test-key");
  assert.equal(requestBody.text.format.type, "json_schema");
  assert.equal("store" in requestBody, false);
});

test("connection test sends one small request and returns public metadata", async () => {
  let callCount = 0;
  const fetchImpl = async () => {
    callCount += 1;
    return jsonResponse({
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify(API_NOTES) }],
          },
        },
      ],
    });
  };

  const result = await testSummaryConnection({
    provider: "gemini",
    apiKey: "test-key",
    model: "gemini-test",
    fetchImpl,
  });

  assert.equal(callCount, 1);
  assert.deepEqual(result, {
    ok: true,
    provider: "gemini",
    providerLabel: "Google Gemini",
    model: "gemini-test",
  });
});

test("Gemini high-demand errors are displayed in Vietnamese", async () => {
  const fetchImpl = async () =>
    jsonResponse(
      {
        error: {
          message:
            "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.",
        },
      },
      { ok: false, status: 503 },
    );

  await assert.rejects(
    testSummaryConnection({
      provider: "gemini",
      apiKey: "test-key",
      model: "gemini-test",
      fetchImpl,
    }),
    (error) => {
      assert.match(error.message, /đang có lượng truy cập cao/);
      assert.match(error.message, /vui lòng thử lại sau ít phút/);
      assert.doesNotMatch(error.message, /high demand|try again later/i);
      return true;
    },
  );
});

test("summarizeMeeting hides API keys returned inside provider errors", async () => {
  const apiKey = "sk-secret-value-that-must-stay-hidden";
  const fetchImpl = async () =>
    jsonResponse(
      {
        error: {
          message: `Invalid key: ${apiKey}`,
        },
      },
      { ok: false, status: 401 },
    );

  await assert.rejects(
    summarizeMeeting({
      provider: "openai",
      apiKey,
      transcript: "Nội dung.",
      fetchImpl,
    }),
    (error) => {
      assert.doesNotMatch(error.message, new RegExp(apiKey));
      assert.match(error.message, /API key.*không hợp lệ/);
      assert.doesNotMatch(error.message, /Invalid key/i);
      return true;
    },
  );
});

test("summarizeMeeting rejects an empty transcript", async () => {
  await assert.rejects(
    summarizeMeeting({ apiKey: "test", transcript: "  " }),
    /Không có transcript/,
  );
});

test("summarizeMeeting rejects unsupported providers", async () => {
  await assert.rejects(
    summarizeMeeting({
      provider: "unknown",
      apiKey: "test",
      transcript: "Nội dung.",
    }),
    /không được hỗ trợ/,
  );
});
