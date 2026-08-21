const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildAssistantDescription,
  normalizeTitle,
  scoreCalendarEvent,
} = require("../src/google/calendarMeeting");

test("normalizeTitle supports Vietnamese matching", () => {
  assert.equal(normalizeTitle("Họp Kế-Hoạch!"), "hop ke hoach");
});

test("scoreCalendarEvent strongly prefers matching title and time", () => {
  const meeting = {
    title: "Họp kế hoạch",
    startedAt: "2026-08-12T02:00:00.000Z",
  };
  const event = {
    summary: "Họp kế hoạch",
    start: { dateTime: "2026-08-12T02:05:00.000Z" },
  };

  assert.equal(scoreCalendarEvent(event, meeting, meeting.title), 140);
});

test("buildAssistantDescription replaces its own previous block", () => {
  const first = buildAssistantDescription({
    existingDescription: "Ghi chú gốc",
    meeting: {},
    notes: { summary: "Lần một", actionItems: [] },
    documentUrl: "https://docs.google.com/document/d/1/edit",
  });
  const second = buildAssistantDescription({
    existingDescription: first,
    meeting: {},
    notes: { summary: "Lần hai", actionItems: [] },
    documentUrl: "https://docs.google.com/document/d/2/edit",
  });

  assert.match(second, /Ghi chú gốc/);
  assert.match(second, /Lần hai/);
  assert.doesNotMatch(second, /Lần một/);
});
