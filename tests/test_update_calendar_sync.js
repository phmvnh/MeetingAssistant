require("dotenv").config();

const {
  updateMeetingCalendarSync,
} = require("../src/sheets");

const {
  getSheetConfig,
} = require("../src/config");

async function main() {
  const {
    spreadsheetId,
    sheetName,
  } = getSheetConfig();

  const rowNumber = 2;

  const result =
    await updateMeetingCalendarSync(
      spreadsheetId,
      sheetName,
      rowNumber,
      {
        eventId:
          "test-calendar-event-id",
        htmlLink:
          "https://calendar.google.com/test",
      }
    );

  console.log(
    "Cập nhật Sheet thành công:"
  );

  console.dir(result, {
    depth: null,
  });
}

main().catch((error) => {
  console.error(
    "Cập nhật Sheet thất bại:",
    error.message
  );

  process.exitCode = 1;
});
