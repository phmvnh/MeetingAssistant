function getRequiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `Thiếu biến môi trường bắt buộc: ${name}`
    );
  }

  return value;
}

function getSheetConfig() {
  return {
    spreadsheetId: getRequiredEnv(
      "SPREADSHEET_ID"
    ),
    sheetName: getRequiredEnv(
      "SHEET_NAME"
    ),
  };
}

function getCalendarConfig() {
  return {
    calendarId: getRequiredEnv(
      "CALENDAR_ID"
    ),
  };
}

module.exports = {
  getRequiredEnv,
  getSheetConfig,
  getCalendarConfig,
};