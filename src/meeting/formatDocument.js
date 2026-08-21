const { resolveMeetingTitle } = require("./meetingTitle");

const SOURCE_LABELS = Object.freeze({
  room: "Phòng họp",
  meet: "Google Meet",
  teams: "Microsoft Teams",
  other: "Nguồn khác",
});

function formatDateTime(value) {
  if (!value) {
    return "Không rõ";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "full",
    timeStyle: "medium",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(date);
}

function renderBulletList(items, emptyText = "Không có thông tin.") {
  if (!Array.isArray(items) || items.length === 0) {
    return emptyText;
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function renderActionItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return "Không có công việc được xác định.";
  }

  return items
    .map((item, index) => {
      const owner = item.owner?.trim() || "Chưa xác định";
      const dueDate = item.dueDate?.trim() || "Chưa xác định";

      return `${index + 1}. ${item.task}\n   - Phụ trách: ${owner}\n   - Hạn: ${dueDate}`;
    })
    .join("\n");
}

function renderMeetingMarkdown({ meeting, notes, transcript }) {
  return [
    `# ${resolveMeetingTitle(meeting, notes)}`,
    "",
    `- **Mã cuộc họp:** ${meeting.meetingId}`,
    `- **Nguồn:** ${SOURCE_LABELS[meeting.source] || meeting.source || "Không rõ"}`,
    `- **Bắt đầu:** ${formatDateTime(meeting.startedAt)}`,
    `- **Kết thúc:** ${formatDateTime(meeting.endedAt)}`,
    "",
    "## Tóm tắt",
    "",
    notes.summary || "Không có tóm tắt.",
    "",
    "## Nội dung chính",
    "",
    renderBulletList(notes.keyPoints),
    "",
    "## Quyết định",
    "",
    renderBulletList(notes.decisions, "Không có quyết định được xác định."),
    "",
    "## Công việc cần thực hiện",
    "",
    renderActionItems(notes.actionItems),
    "",
    "## Vấn đề chưa giải quyết",
    "",
    renderBulletList(notes.openQuestions),
    "",
    "## Transcript",
    "",
    transcript.trim(),
    "",
  ].join("\n");
}

function renderMeetingPlainText(input) {
  return renderMeetingMarkdown(input)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*/g, "");
}

function sanitizeFileName(value) {
  const sanitized = String(value || "meeting")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 100);

  return sanitized || "meeting";
}

module.exports = {
  SOURCE_LABELS,
  formatDateTime,
  renderMeetingMarkdown,
  renderMeetingPlainText,
  sanitizeFileName,
};
