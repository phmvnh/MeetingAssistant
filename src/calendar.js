const { google } = require("googleapis");
const path = require("node:path");

const auth = new google.auth.GoogleAuth({
  keyFile: path.join(
    __dirname,
    "..",
    "credentials.json"
  ),
  scopes: [
    "https://www.googleapis.com/auth/calendar",
  ],
});

async function getCalendarClient() {
  const authClient = await auth.getClient();

  return google.calendar({
    version: "v3",
    auth: authClient,
  });
}
async function getCalendarInfo(calendarId) {
  if (!calendarId?.trim()) {
    throw new Error(
      "calendarId là bắt buộc khi đọc thông tin Calendar."
    );
  }

  const calendar = await getCalendarClient();

  const response = await calendar.calendars.get({
    calendarId,
  });

  return {
    id: response.data.id,
    summary: response.data.summary,
    description: response.data.description || "",
    timeZone: response.data.timeZone,
  };
}
async function createCalendarEvent(
  calendarId,
  event
) {
  if (!calendarId?.trim()) {
    throw new Error(
      "calendarId là bắt buộc khi tạo event."
    );
  }

  if (!event?.summary?.trim()) {
    throw new Error(
      "Event phải có summary."
    );
  }

  if (!event.start || !event.end) {
    throw new Error(
      "Event phải có start và end."
    );
  }

  const calendar = await getCalendarClient();

  const response =
    await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: event.summary.trim(),
        description:
          event.description || "",
        location:
          event.location || "",
        start: event.start,
        end: event.end,
        extendedProperties:
          event.extendedProperties,
      },
    });

  return {
    eventId: response.data.id,
    htmlLink: response.data.htmlLink,
    status: response.data.status,
    summary: response.data.summary,
    start: response.data.start,
    end: response.data.end,
  };
}
async function findEventByMeetingId(
  calendarId,
  meetingId
) {
  if (!calendarId?.trim()) {
    throw new Error(
      "calendarId là bắt buộc khi tìm event."
    );
  }

  if (!meetingId?.trim()) {
    throw new Error(
      "meetingId là bắt buộc khi tìm event."
    );
  }

  const calendar =
    await getCalendarClient();

  const response =
    await calendar.events.list({
      calendarId: calendarId.trim(),

      privateExtendedProperty: [
        `meetingId=${meetingId.trim()}`,
      ],

      maxResults: 1,

      singleEvents: true,

      showDeleted: false,
    });

  const events =
    response.data.items || [];

  if (events.length === 0) {
    return null;
  }

  const event = events[0];

  return {
    eventId: event.id,
    htmlLink: event.htmlLink,
    status: event.status,
    summary: event.summary,
    start: event.start,
    end: event.end,
  };
}

module.exports = {
  getCalendarClient,
  getCalendarInfo,
  createCalendarEvent,
  findEventByMeetingId
};