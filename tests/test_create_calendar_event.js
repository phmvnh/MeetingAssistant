require("dotenv").config();

const {
  createCalendarEvent,
} = require("../src/calendar");

const {
  getCalendarConfig,
} = require("../src/config");

async function main() {
  const { calendarId } =
    getCalendarConfig();

  const now = new Date();

  const start = new Date(
    now.getTime() + 10 * 60 * 1000
  );

  const end = new Date(
    start.getTime() + 30 * 60 * 1000
  );

  const result =
    await createCalendarEvent(
      calendarId,
      {
        summary:
          "[TEST] Genspark automation",
        description:
          "Event kiểm tra kết nối Google Calendar API.",
        start: {
          dateTime: start.toISOString(),
          timeZone: "Asia/Ho_Chi_Minh",
        },
        end: {
          dateTime: end.toISOString(),
          timeZone: "Asia/Ho_Chi_Minh",
        },
        extendedProperties: {
          private: {
            source: "genspark-automation",
            testEvent: "true",
          },
        },
      }
    );

  console.log(
    "Tạo event thành công:"
  );

  console.dir(result, {
    depth: null,
  });
}

main().catch((error) => {
  console.error(
    "Tạo event thất bại:",
    error.message
  );

  process.exitCode = 1;
});
