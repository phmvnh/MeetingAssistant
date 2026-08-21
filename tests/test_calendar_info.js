require("dotenv").config();

const {
  getCalendarInfo,
} = require("../src/calendar");

const {
  getCalendarConfig,
} = require("../src/config");

async function main() {
  const { calendarId } =
    getCalendarConfig();

  const calendarInfo =
    await getCalendarInfo(calendarId);

  console.log(
    "Đọc Calendar đích thành công:"
  );

  console.table([calendarInfo]);
}

main().catch((error) => {
  console.error(
    "Không thể đọc Calendar đích:",
    error.message
  );

  process.exitCode = 1;
});
