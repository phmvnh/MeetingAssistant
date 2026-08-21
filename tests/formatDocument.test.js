const test = require("node:test");
const assert = require("node:assert/strict");

const {
  renderMeetingMarkdown,
  sanitizeFileName,
} = require("../src/meeting/formatDocument");

test("renderMeetingMarkdown includes summary, actions and transcript", () => {
  const markdown = renderMeetingMarkdown({
    meeting: {
      meetingId: "meeting-1",
      title: "Planning",
      source: "room",
      startedAt: "2026-08-12T02:00:00.000Z",
      endedAt: "2026-08-12T03:00:00.000Z",
    },
    notes: {
      title: "Lập kế hoạch",
      summary: "Nhóm thống nhất kế hoạch.",
      keyPoints: ["Nội dung A"],
      decisions: ["Chọn phương án B"],
      actionItems: [{ task: "Viết tài liệu", owner: "An", dueDate: "15/08" }],
      openQuestions: ["Chi phí?"],
    },
    transcript: "Đây là transcript.",
  });

  assert.match(markdown, /# Planning/);
  assert.doesNotMatch(markdown, /# Lập kế hoạch/);
  assert.match(markdown, /Viết tài liệu/);
  assert.match(markdown, /Đây là transcript/);
});

test("sanitizeFileName removes Windows-invalid characters", () => {
  assert.equal(sanitizeFileName('Kế hoạch: A/B * "test"'), "Kế hoạch- A-B - -test-");
});
