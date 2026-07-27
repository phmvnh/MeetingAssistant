const {
  syncMeetings,
} = require("../sheets");

const {
  getSheetConfig,
} = require("../config");

async function syncToSheet(meetings) {
  const {
    spreadsheetId,
    sheetName,
  } = getSheetConfig();

  return syncMeetings(
    meetings,
    spreadsheetId,
    sheetName
  );
}

module.exports = {
  syncToSheet,
};