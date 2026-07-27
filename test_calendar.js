require("dotenv").config();

const {
  getCalendarClient,
} = require("./src/calendar");

const {
  getCalendarConfig,
} = require("./src/config");

async function main() {
  const { calendarId } =
    getCalendarConfig();

  const calendar =
    await getCalendarClient();

  const response =
    await calendar.calendarList.list();

  console.log("Kết nối Calendar thành công.");

  console.table(
    (response.data.items || []).map(
      (item) => ({
        id: item.id,
        summary: item.summary,
        accessRole: item.accessRole,
        selected: item.selected,
      })
    )
  );

  console.log(
    "CALENDAR_ID đang cấu hình:",
    calendarId
  );
}

main().catch((error) => {
  console.error(
    "Lỗi kết nối Calendar:",
    error.message
  );

  process.exitCode = 1;
});