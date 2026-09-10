const { resolveMeetingTitle } = require("./meetingTitle");
const {
  extractGeminiText,
  getSummaryProvider,
  requestSummaryText,
} = require("./summaryProviders");

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
  "Hãy tạo biên bản hoàn toàn bằng tiếng Việt từ transcript được cung cấp.",
  "Giữ nguyên thuật ngữ kỹ thuật, từ viết tắt, tên sản phẩm và tên riêng bằng tiếng Anh (hoặc kèm thuật ngữ tiếng Anh nếu cần thiết).",
  "Tuyệt đối không dùng tiếng Nhật, tiếng Trung hay bất kỳ ngôn ngữ nào khác ngoài tiếng Việt và tiếng Anh.",
  "Tự động loại bỏ các đoạn ký tự lạ, lỗi nhận diện hoặc từ ngữ rác do ảo giác âm thanh nếu có trong transcript.",
  "Không bịa dữ kiện, tên người, quyết định hoặc thời hạn.",
  "Nếu người dùng đã nhập tiêu đề, giữ nguyên chính xác tiêu đề đó, không viết lại hoặc thêm mô tả.",
  "Nếu tiêu đề người dùng nhập là rỗng hoặc không có, hãy tự đặt một tiêu đề ngắn gọn từ 5 đến 12 từ, phản ánh đúng chủ đề chính của cuộc họp.",
  "Nếu không xác định được người phụ trách hoặc hạn hoàn thành, trả chuỗi rỗng.",
  "Loại bỏ câu lặp, từ đệm nhưng không làm thay đổi ý nghĩa cuộc họp.",
].join(" ");

function buildUserContent(metadata, transcript) {
  return [
    `Tiêu đề người dùng nhập: ${metadata.title || "Không có"}`,
    `Nguồn cuộc họp: ${metadata.source || "Không rõ"}`,
    `Bắt đầu: ${metadata.startedAt || "Không rõ"}`,
    `Kết thúc: ${metadata.endedAt || "Không rõ"}`,
    "",
    "TRANSCRIPT:",
    transcript,
  ].join("\n");
}

function assertStringArray(value, fieldName) {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string")
  ) {
    throw new Error(`Trường ${fieldName} không đúng định dạng.`);
  }
}

function validateMeetingNotes(notes) {
  if (!notes || typeof notes !== "object" || Array.isArray(notes)) {
    throw new Error("Biên bản phải là một JSON object.");
  }

  if (typeof notes.title !== "string" || typeof notes.summary !== "string") {
    throw new Error("Biên bản thiếu title hoặc summary hợp lệ.");
  }

  assertStringArray(notes.keyPoints, "keyPoints");
  assertStringArray(notes.decisions, "decisions");
  assertStringArray(notes.openQuestions, "openQuestions");

  if (!Array.isArray(notes.actionItems)) {
    throw new Error("Trường actionItems không đúng định dạng.");
  }

  for (const action of notes.actionItems) {
    if (
      !action ||
      typeof action !== "object" ||
      Array.isArray(action) ||
      typeof action.task !== "string" ||
      typeof action.owner !== "string" ||
      typeof action.dueDate !== "string"
    ) {
      throw new Error("Một mục actionItems không đúng định dạng.");
    }
  }

  return notes;
}

function parseMeetingNotes(outputText, providerLabel) {
  const normalized = outputText
    .trim()
    .replace(/^\`\`\`(?:json)?\s*/i, "")
    .replace(/\s*\`\`\`$/, "");
  let notes;

  try {
    notes = JSON.parse(normalized);
  } catch {
    throw new Error(
      `Nội dung biên bản từ ${providerLabel} không phải JSON hợp lệ.`,
    );
  }

  try {
    return validateMeetingNotes(notes);
  } catch (error) {
    throw new Error(
      `Nội dung biên bản từ ${providerLabel} không hợp lệ: ${error.message}`,
    );
  }
}

async function summarizeMeeting(options = {}) {
  const transcript = options.transcript?.trim();

  if (!transcript) {
    throw new Error("Không có transcript để tạo biên bản.");
  }

  if (options.configurationError) {
    throw new Error(options.configurationError);
  }

  const provider = getSummaryProvider(options.provider || "gemini");
  const metadata = options.metadata || {};
  const outputText = await requestSummaryText({
    apiKey: options.apiKey,
    fetchImpl: options.fetchImpl,
    model: options.model,
    provider: provider.id,
    schema: MEETING_NOTES_SCHEMA,
    systemPrompt: SYSTEM_PROMPT,
    userContent: buildUserContent(metadata, transcript),
  });
  const notes = parseMeetingNotes(outputText, provider.label);

  return {
    ...notes,
    title: resolveMeetingTitle(metadata, notes),
  };
}

async function testSummaryConnection(options = {}) {
  const provider = getSummaryProvider(options.provider || "gemini");
  const model = options.model?.trim() || provider.defaultModel;

  await summarizeMeeting({
    apiKey: options.apiKey,
    fetchImpl: options.fetchImpl,
    model,
    provider: provider.id,
    metadata: {
      title: "Kiểm tra kết nối AI",
      source: "settings",
    },
    transcript:
      "Đây là yêu cầu kiểm tra kết nối. Không có quyết định hoặc công việc cần thực hiện.",
  });

  return {
    ok: true,
    provider: provider.id,
    providerLabel: provider.label,
    model,
  };
}

module.exports = {
  MEETING_NOTES_SCHEMA,
  SYSTEM_PROMPT,
  buildUserContent,
  extractGeminiText,
  parseMeetingNotes,
  summarizeMeeting,
  testSummaryConnection,
  validateMeetingNotes,
};
