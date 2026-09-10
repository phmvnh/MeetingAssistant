const SUMMARY_PROVIDERS = Object.freeze({
  gemini: Object.freeze({
    id: "gemini",
    label: "Google Gemini",
    defaultModel: "gemini-3.7-flash",
    models: Object.freeze([
      "gemini-3.7-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
    ]),
  }),
  openai: Object.freeze({
    id: "openai",
    label: "OpenAI (ChatGPT)",
    defaultModel: "gpt-5.6-luna",
    models: Object.freeze([
      "gpt-5.6-luna",
      "gpt-5.6-terra",
      "gpt-5.6-sol",
    ]),
  }),
  anthropic: Object.freeze({
    id: "anthropic",
    label: "Anthropic Claude",
    defaultModel: "claude-sonnet-5",
    models: Object.freeze([
      "claude-sonnet-5",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
    ]),
  }),
  xai: Object.freeze({
    id: "xai",
    label: "xAI Grok",
    defaultModel: "grok-4.6",
    models: Object.freeze(["grok-4.6", "grok-4.3", "grok-latest"]),
  }),
});

function listSummaryProviders() {
  return Object.values(SUMMARY_PROVIDERS).map((provider) => ({
    id: provider.id,
    label: provider.label,
    defaultModel: provider.defaultModel,
    models: [...provider.models],
  }));
}

function getSummaryProvider(providerId = "gemini") {
  const provider = SUMMARY_PROVIDERS[providerId];

  if (!provider) {
    throw new Error("Nhà cung cấp AI tóm tắt không được hỗ trợ.");
  }

  return provider;
}

function extractApiMessage(responseBody, status) {
  return (
    responseBody?.error?.message ||
    responseBody?.error?.type ||
    responseBody?.message ||
    `HTTP ${status || "không xác định"}`
  );
}

function hideApiKey(message, apiKey) {
  const value = String(message || "");
  const secret = apiKey?.trim();

  return secret ? value.split(secret).join("[API key đã ẩn]") : value;
}

function localizeProviderError(provider, message, status = 0) {
  const label = provider.label;
  const normalized = String(message || "").toLowerCase();

  if (
    /high demand|spikes? in demand|overloaded|server is busy|at capacity/.test(
      normalized,
    )
  ) {
    return (
      `${label} hiện đang có lượng truy cập cao nên chưa thể xử lý yêu cầu. ` +
      "Đây thường là tình trạng tạm thời; vui lòng thử lại sau ít phút hoặc chọn model khác."
    );
  }

  if (
    /quota|insufficient_quota|billing|credit balance|usage limit/.test(
      normalized,
    )
  ) {
    return (
      `${label} đã hết hạn mức sử dụng hoặc quota của tài khoản. ` +
      "Vui lòng kiểm tra quota và thông tin thanh toán của nhà cung cấp."
    );
  }

  if (
    status === 429 ||
    /rate limit|too many requests|resource_exhausted/.test(normalized)
  ) {
    return (
      `${label} đang giới hạn tần suất yêu cầu. ` +
      "Vui lòng chờ một lát rồi thử lại."
    );
  }

  if (
    status === 401 ||
    /invalid.*api.?key|api.?key.*invalid|unauthenticated|invalid credentials/.test(
      normalized,
    )
  ) {
    return (
      `API key của ${label} không hợp lệ hoặc đã hết hiệu lực. ` +
      "Vui lòng kiểm tra và lưu lại API key."
    );
  }

  if (
    status === 403 ||
    /permission denied|forbidden|not authorized|access denied/.test(normalized)
  ) {
    return (
      `Tài khoản hoặc API key chưa có quyền sử dụng ${label}. ` +
      "Vui lòng kiểm tra quyền truy cập API của dự án."
    );
  }

  if (
    status === 404 ||
    /model.*(?:not found|not available|unsupported|does not exist)/.test(
      normalized,
    )
  ) {
    return (
      `Không tìm thấy model đã chọn trên ${label}, hoặc model này không còn khả dụng. ` +
      "Vui lòng chọn model khác."
    );
  }

  if (
    status === 408 ||
    status === 504 ||
    /timeout|timed out|deadline exceeded/.test(normalized)
  ) {
    return (
      `Yêu cầu tới ${label} đã quá thời gian chờ. ` +
      "Vui lòng kiểm tra kết nối mạng rồi thử lại."
    );
  }

  if (
    status === 503 ||
    /temporarily unavailable|service unavailable|try again later/.test(
      normalized,
    )
  ) {
    return (
      `${label} đang tạm thời không khả dụng. ` +
      "Vui lòng thử lại sau ít phút."
    );
  }

  if (status === 400) {
    return (
      `${label} không chấp nhận cấu hình yêu cầu hiện tại. ` +
      "Vui lòng kiểm tra model đã chọn và cấu hình API."
    );
  }

  if (status >= 500) {
    return (
      `${label} đang tạm thời gặp sự cố. ` +
      "Vui lòng thử lại sau ít phút."
    );
  }

  const statusText = status ? ` (mã HTTP ${status})` : "";
  return (
    `${label} không thể xử lý yêu cầu${statusText}. ` +
    "Vui lòng thử lại hoặc kiểm tra cấu hình API."
  );
}

function localizeConnectionError(provider, error) {
  const message = String(error?.message || "");

  if (
    error?.name === "AbortError" ||
    /timeout|timed out|deadline exceeded/i.test(message)
  ) {
    return (
      `Kết nối tới ${provider.label} đã quá thời gian chờ. ` +
      "Vui lòng kiểm tra mạng rồi thử lại."
    );
  }

  return (
    `Không thể kết nối tới ${provider.label}. ` +
    "Vui lòng kiểm tra kết nối Internet rồi thử lại."
  );
}

function removeUnsupportedGeminiSchemaFields(schema) {
  if (Array.isArray(schema)) {
    return schema.map(removeUnsupportedGeminiSchemaFields);
  }

  if (!schema || typeof schema !== "object") {
    return schema;
  }

  const result = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key !== "additionalProperties") {
      result[key] = removeUnsupportedGeminiSchemaFields(value);
    }
  }
  return result;
}

async function requestJson({
  fetchImpl,
  url,
  request,
  provider,
  apiKey,
}) {
  let response;

  try {
    response = await fetchImpl(url, request);
  } catch (error) {
    throw new Error(localizeConnectionError(provider, error));
  }

  const responseBody = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      localizeProviderError(
        provider,
        hideApiKey(
          extractApiMessage(responseBody, response.status),
          apiKey,
        ),
        response.status,
      ),
    );
  }

  return responseBody;
}

function extractGeminiText(response) {
  return (response.candidates || [])
    .flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

async function requestGeminiSummary(options) {
  const { apiKey, fetchImpl, model, schema, systemPrompt, userContent } =
    options;
  const provider = SUMMARY_PROVIDERS.gemini;
  const endpoint =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    `${encodeURIComponent(model)}:generateContent`;
  const responseBody = await requestJson({
    fetchImpl,
    url: endpoint,
    provider,
    apiKey,
    request: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: userContent }],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: removeUnsupportedGeminiSchemaFields(schema),
        },
      }),
    },
  });
  const outputText = extractGeminiText(responseBody);

  if (!outputText) {
    const blockReason = responseBody.promptFeedback?.blockReason;
    const finishReason = responseBody.candidates?.[0]?.finishReason;
    throw new Error(
      blockReason
        ? `Gemini từ chối tạo biên bản: ${blockReason}`
        : finishReason
          ? `Gemini không hoàn tất biên bản: ${finishReason}`
          : "Gemini không trả về nội dung biên bản.",
    );
  }

  return outputText;
}

function extractResponsesText(responseBody, provider) {
  if (responseBody.status === "failed") {
    throw new Error(
      `${provider.label}: ${responseBody.error?.message || "yêu cầu thất bại."}`,
    );
  }

  if (responseBody.status === "incomplete") {
    throw new Error(
      `${provider.label}: phản hồi chưa hoàn tất (${
        responseBody.incomplete_details?.reason || "không rõ lý do"
      }).`,
    );
  }

  let refusal = "";
  const texts = [];

  for (const output of responseBody.output || []) {
    for (const content of output.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        texts.push(content.text);
      } else if (content.type === "refusal") {
        refusal = content.refusal || content.text || "Yêu cầu bị từ chối.";
      }
    }
  }

  const outputText = texts.join("").trim();

  if (!outputText) {
    throw new Error(
      refusal
        ? `${provider.label} từ chối tạo biên bản: ${refusal}`
        : `${provider.label} không trả về nội dung biên bản.`,
    );
  }

  return outputText;
}

async function requestResponsesSummary(options) {
  const {
    apiKey,
    fetchImpl,
    model,
    provider,
    schema,
    systemPrompt,
    userContent,
  } = options;
  const isOpenAi = provider.id === "openai";
  const body = {
    model,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "meeting_summary",
        strict: true,
        schema,
      },
    },
  };

  if (isOpenAi) {
    body.store = false;
    body.reasoning = { effort: "low" };
  }

  const responseBody = await requestJson({
    fetchImpl,
    url: isOpenAi
      ? "https://api.openai.com/v1/responses"
      : "https://api.x.ai/v1/responses",
    provider,
    apiKey,
    request: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  });

  return extractResponsesText(responseBody, provider);
}

async function requestAnthropicSummary(options) {
  const { apiKey, fetchImpl, model, schema, systemPrompt, userContent } =
    options;
  const provider = SUMMARY_PROVIDERS.anthropic;
  const responseBody = await requestJson({
    fetchImpl,
    url: "https://api.anthropic.com/v1/messages",
    provider,
    apiKey,
    request: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
        output_config: {
          format: {
            type: "json_schema",
            schema,
          },
        },
      }),
    },
  });

  if (["refusal", "max_tokens"].includes(responseBody.stop_reason)) {
    throw new Error(
      responseBody.stop_reason === "refusal"
        ? "Anthropic Claude từ chối tạo biên bản."
        : "Anthropic Claude đã hết giới hạn output trước khi hoàn tất biên bản.",
    );
  }

  const outputText = (responseBody.content || [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("")
    .trim();

  if (!outputText) {
    throw new Error("Anthropic Claude không trả về nội dung biên bản.");
  }

  return outputText;
}

async function requestSummaryText(options) {
  const provider = getSummaryProvider(options.provider);
  const apiKey = options.apiKey?.trim();
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (!apiKey) {
    throw new Error(`Chưa cấu hình API key cho ${provider.label}.`);
  }

  if (typeof fetchImpl !== "function") {
    throw new Error("Môi trường hiện tại không hỗ trợ fetch.");
  }

  const requestOptions = {
    ...options,
    apiKey,
    fetchImpl,
    model: options.model?.trim() || provider.defaultModel,
    provider,
  };

  if (provider.id === "gemini") {
    return requestGeminiSummary(requestOptions);
  }

  if (provider.id === "anthropic") {
    return requestAnthropicSummary(requestOptions);
  }

  return requestResponsesSummary(requestOptions);
}

module.exports = {
  SUMMARY_PROVIDERS,
  extractGeminiText,
  extractResponsesText,
  getSummaryProvider,
  listSummaryProviders,
  localizeProviderError,
  requestSummaryText,
};
