require("dotenv").config();

const {
  scrapeMeetings,
} = require("./src/scraper");

async function main() {
  const result = await scrapeMeetings();

  if (
    !result ||
    result.status !== "success" ||
    !Array.isArray(result.meetings)
  ) {
    throw new Error(
      "Scraper trả về dữ liệu không hợp lệ."
    );
  }

  console.log(
    "Số meeting:",
    result.meetings.length
  );

  if (result.meetings.length === 0) {
    throw new Error(
      "Không có meeting để kiểm tra dữ liệu."
    );
  }

  console.log(
    "\nMeeting đầu tiên:"
  );

  console.dir(
    result.meetings[0],
    {
      depth: null,
    }
  );

  console.log(
    "\nKiểu dữ liệu meetingDate:",
    typeof result.meetings[0].meetingDate
  );

  console.log(
    "Giá trị meetingDate:",
    result.meetings[0].meetingDate
  );
}

main().catch((error) => {
  console.error(
    "Kiểm tra dữ liệu thất bại:",
    error.message
  );

  process.exitCode = 1;
});