const {
  getMeetingsWithoutCalendarEvent,
  updateMeetingCalendarSync,
} = require("../sheets");

const {
  findEventByMeetingId,
  createCalendarEvent,
} = require("../calendar");

const {
  mapMeetingToCalendarEvent,
} = require("../mapper/meetingMapper");

const {
  getSheetConfig,
  getCalendarConfig,
} = require("../config");

async function syncToCalendar() {
  const {
    spreadsheetId,
    sheetName,
  } = getSheetConfig();

  const {
    calendarId,
  } = getCalendarConfig();

  const meetings =
    await getMeetingsWithoutCalendarEvent(
      spreadsheetId,
      sheetName
    );

  const result = {
    total: meetings.length,
    recovered: 0,
    created: 0,
    failed: 0,
    items: [],
  };

  for (const meeting of meetings) {
    try {
      let calendarEvent =
        await findEventByMeetingId(
          calendarId,
          meeting.meetingId
        );

      let action;

      if (calendarEvent) {
        action = "recovered";
        result.recovered += 1;
      } else {
        const eventPayload =
          mapMeetingToCalendarEvent(
            meeting
          );

        calendarEvent =
          await createCalendarEvent(
            calendarId,
            eventPayload
          );

        action = "created";
        result.created += 1;
      }

      const sheetUpdate =
        await updateMeetingCalendarSync(
          spreadsheetId,
          sheetName,
          meeting.rowNumber,
          calendarEvent
        );

      result.items.push({
        meetingId:
          meeting.meetingId,
        rowNumber:
          meeting.rowNumber,
        action,
        calendarEventId:
          sheetUpdate.calendarEventId,
        calendarHtmlLink:
          sheetUpdate.calendarHtmlLink,
        syncedAt:
          sheetUpdate.syncedAt,
      });

      console.log(
        `[${action}] ${meeting.title}`
      );
    } catch (error) {
      result.failed += 1;

      result.items.push({
        meetingId:
          meeting.meetingId,
        rowNumber:
          meeting.rowNumber,
        action: "failed",
        error: error.message,
      });

      console.error(
        `[failed] Dòng ${meeting.rowNumber} - ${meeting.title}:`,
        error.message
      );
    }
  }

  return result;
}

module.exports = {
  syncToCalendar,
};