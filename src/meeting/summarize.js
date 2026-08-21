const { resolveMeetingTitle } = require("./meetingTitle");

const MEETING_NOTES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    keyPoints: {
      type: "array",
      items: { type: "string" },
    },
    decisions: {
      type: "array",
      items: { type: "string" },
    },
    actionItems: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          task: { type: "string" },
          owner: { type: "string" },
          dueDate: { type: "string" },
        },
        required: ["task", "owner", "dueDate"],
      },
    },
    openQuestions: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: [
    "title",
    "summary",
    "keyPoints",
    "decisions",
    "actionItems",
    "openQuestions",
  ],
};

const SYSTEM_PROMPT = [
  "Bạn là thư ký cuộc họp chuyên nghiệp.",
  "Hãy tạo biên bản bằng tiếng Việt từ transcript được cung cấp.",
  "Không bịa dữ kiện, tên người, quyết định hoặc thời hạn.",
  "Trường title phải giữ nguyên chính xác tiêu đề người dùng nhập, không viết lại hoặc thêm mô tả.",
  "Nếu không xác định được người phụ trách hoặc hạn hoàn thành, trả chuỗi rỗng.",
  "Giữ nguyên thuật ngữ kỹ thuật, tên sản phẩm và tên riêng khi có thể.",
  "Loại bỏ câu lặp, từ đệm và lỗi nhận dạng rõ ràng nhưng không thay đổi ý nghĩa.",
].join(" ");

function extractGeminiText(response) {
  return (response.candidates || [])
    .flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

async function summarizeMeeting(options = {}) {
  const transcript = options.transcript?.trim();

  if (!transcript) {
    throw new Error("Không có transcript để tạo biên bản.");
  }

  if (!options.apiKey?.trim()) {
    throw new Error("Thiếu GEMINI_API_KEY để tạo biên bản.");
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (typeof fetchImpl !== "function") {
    throw new Error("Môi trường hiện tại không hỗ trợ fetch.");
  }

  const metadata = options.metadata || {};
  const userContent = [
    `Tiêu đề người dùng nhập: ${metadata.title || "Không có"}`,
    `Nguồn cuộc họp: ${metadata.source || "Không rõ"}`,
    `Bắt đầu: ${metadata.startedAt || "Không rõ"}`,
    `Kết thúc: ${metadata.endedAt || "Không rõ"}`,
    "",
    "TRANSCRIPT:",
    transcript,
  ].join("\n");

  const model = options.model || "gemini-3.5-flash";
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:generateContent`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "x-goog-api-key": options.apiKey.trim(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: userContent }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseJsonSchema: MEETING_NOTES_SCHEMA,
      },
    }),
  });

  const responseBody = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = responseBody.error?.message || `HTTP ${response.status}`;
    throw new Error(`Không thể tạo tóm tắt: ${message}`);
  }

  const outputText = extractGeminiText(responseBody);

  if (!outputText) {
    const blockReason = responseBody.promptFeedback?.blockReason;
    throw new Error(
      blockReason
        ? `Gemini không tạo biên bản: ${blockReason}`
        : "Gemini không trả về nội dung biên bản.",
    );
  }

  let notes;

  try {
    notes = JSON.parse(outputText);
  } catch {
    throw new Error("Nội dung biên bản từ Gemini không phải JSON hợp lệ.");
  }

  return {
    ...notes,
    title: resolveMeetingTitle(metadata, notes),
  };
}

module.exports = {
  MEETING_NOTES_SCHEMA,
  extractGeminiText,
  summarizeMeeting,
};
