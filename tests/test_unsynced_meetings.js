require("dotenv").config();

const {
  getMeetingsWithoutCalendarEvent,
} = require("../src/sheets");

const {
  getSheetConfig,
} = require("../src/config");

async function main() {
  const {
    spreadsheetId,
    sheetName,
  } = getSheetConfig();

  const meetings =
    await getMeetingsWithoutCalendarEvent(
      spreadsheetId,
      sheetName
    );

  console.log(
    "Số meeting chưa sync Calendar:",
    meetings.length
  );

  console.dir(meetings, {
    depth: null,
  });

  for (const meeting of meetings) {
    if (!meeting.rowNumber) {
      throw new Error(
        "Meeting thiếu rowNumber."
      );
    }

    if (!meeting.meetingId) {
      throw new Error(
        `Dòng ${meeting.rowNumber} thiếu meetingId.`
      );
    }

    if (meeting.calendarEventId) {
      throw new Error(
        `Dòng ${meeting.rowNumber} đã có calendarEventId nhưng vẫn được trả về.`
      );
    }
  }

  console.log(
    "\nTest đọc meeting chưa sync: PASS"
  );
}

main().catch((error) => {
  console.error(
    "\nTest đọc meeting chưa sync thất bại:",
    error.message
  );

  process.exitCode = 1;
});
