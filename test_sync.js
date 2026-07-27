require("dotenv").config();

const {
  syncMeetings,
} = require("./src/sheets");

async function main() {
  const spreadsheetId =
    process.env.SPREADSHEET_ID;

  const sheetName =
    process.env.SHEET_NAME || "Trang tính1";

  if (!spreadsheetId) {
    throw new Error(
      "Thiếu SPREADSHEET_ID trong file .env"
    );
  }

  const meetings = [
    {
      meetingId: "sync-test-001",
      title: "Kiểm tra chống trùng",
      meetingDate: "22/07/2026 13:00",
      meetingUrl: "https://example.com/sync-test-001",
    },
    {
      meetingId: "sync-test-002",
      title: "Kiểm tra meeting mới",
      meetingDate: "22/07/2026 14:00",
      meetingUrl: "https://example.com/sync-test-002",
    },
  ];

  const result = await syncMeetings(
    meetings,
    spreadsheetId,
    sheetName
  );

  console.log("Kết quả đồng bộ:");
  console.table({
    total: result.total,
    added: result.added,
    skipped: result.skipped,
  });
}

main().catch((error) => {
  console.error(
    "Lỗi đồng bộ Google Sheet:",
    error.message
  );

  process.exitCode = 1;
});