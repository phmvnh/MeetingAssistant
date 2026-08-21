require("dotenv").config();

const { appendMeetings } = require("../src/sheets");

async function main() {
  const meetings = [
    {
      meetingId: "test001",
      title: "Meeting test",
      meetingDate: "22/07/2026",
      meetingUrl: "https://example.com",
    },
  ];

  await appendMeetings(
    meetings,
    process.env.SPREADSHEET_ID,
    "Trang tính2" // đổi đúng tên tab của bạn
  );

  console.log("Append thành công.");
}

main().catch(console.error);
