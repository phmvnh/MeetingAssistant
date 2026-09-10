const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildAssistantDescription,
  normalizeTitle,
  resolveMeetingCalendar,
  scoreCalendarEvent,
  syncMeetingCalendar,
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

test("buildAssistantDescription includes the AI title and Docs link", () => {
  const description = buildAssistantDescription({
    existingDescription: "",
    meeting: { title: "" },
    notes: {
      title: "Kế hoạch phát hành phiên bản mới",
      summary: "Thống nhất kế hoạch phát hành.",
      actionItems: [],
    },
    documentUrl: "https://docs.google.com/document/d/summary/edit",
  });

  assert.match(description, /Tiêu đề: Kế hoạch phát hành phiên bản mới/);
  assert.match(
    description,
    /Biên bản: https:\/\/docs\.google\.com\/document\/d\/summary\/edit/,
  );
});

test("resolveMeetingCalendar reuses the dedicated calendar by name", async () => {
  let created = false;
  const calendar = {
    calendarList: {
      list: async () => ({
        data: { items: [{ id: "meeting-calendar-id", summary: "Meeting Assistant" }] },
      }),
    },
    calendars: {
      insert: async () => {
        created = true;
        return { data: { id: "new-calendar-id" } };
      },
    },
  };

  const calendarId = await resolveMeetingCalendar({
    calendar,
    calendarName: "Meeting Assistant",
  });

  assert.equal(calendarId, "meeting-calendar-id");
  assert.equal(created, false);
});

test("resolveMeetingCalendar creates the dedicated calendar when missing", async () => {
  let requestBody;
  const calendar = {
    calendarList: {
      list: async () => ({ data: { items: [] } }),
    },
    calendars: {
      insert: async (request) => {
        requestBody = request.requestBody;
        return { data: { id: "new-calendar-id" } };
      },
    },
  };

  const calendarId = await resolveMeetingCalendar({
    calendar,
    calendarName: "Meeting Assistant",
  });

  assert.equal(calendarId, "new-calendar-id");
  assert.equal(requestBody.summary, "Meeting Assistant");
});

test("resolveMeetingCalendar rejects the personal primary calendar", async () => {
  await assert.rejects(
    resolveMeetingCalendar({
      calendar: {},
      calendarId: "primary",
      calendarName: "Meeting Assistant",
    }),
    /không được là primary/,
  );
});

test("syncMeetingCalendar creates events only in the dedicated calendar", async () => {
  const insertedCalendarIds = [];
  let createdCalendarBody;
  const calendar = {
    calendarList: {
      list: async () => ({ data: { items: [] } }),
    },
    calendars: {
      insert: async ({ requestBody }) => {
        createdCalendarBody = requestBody;
        return { data: { id: "dedicated-calendar-id" } };
      },
    },
    events: {
      list: async ({ calendarId }) => {
        assert.equal(calendarId, "dedicated-calendar-id");
        return { data: { items: [] } };
      },
      insert: async ({ calendarId }) => {
        insertedCalendarIds.push(calendarId);
        return {
          data: {
            id: "meeting-event-id",
            htmlLink: "https://calendar.google.com/event?eid=meeting-event-id",
          },
        };
      },
    },
  };
  const googleApi = {
    calendar: () => calendar,
  };

  const result = await syncMeetingCalendar({
    auth: {},
    calendarId: "",
    calendarName: "Meeting Assistant",
    timeZone: "Asia/Ho_Chi_Minh",
    meeting: {
      meetingId: "meeting-1",
      title: "Họp dự án",
      startedAt: "2026-09-09T02:00:00.000Z",
      endedAt: "2026-09-09T03:00:00.000Z",
    },
    notes: {
      title: "Họp dự án",
      summary: "Tóm tắt",
      actionItems: [],
    },
    documentUrl: "",
    createIfMissing: true,
    googleApi,
  });

  assert.equal(createdCalendarBody.summary, "Meeting Assistant");
  assert.deepEqual(insertedCalendarIds, ["dedicated-calendar-id"]);
  assert.equal(result.calendarId, "dedicated-calendar-id");
  assert.equal(result.action, "created");
});
