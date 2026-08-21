require("dotenv").config();

const {
  createCalendarEvent,
  findEventByMeetingId,
} = require("../src/calendar");

const {
  getCalendarConfig,
} = require("../src/config");

async function testExistingMeetingId() {
  const { calendarId } =
    getCalendarConfig();

  const meetingId =
    `test-meeting-${Date.now()}`;

  const now = new Date();

  const start = new Date(
    now.getTime() + 10 * 60 * 1000
  );

  const end = new Date(
    start.getTime() + 30 * 60 * 1000
  );

  const created =
    await createCalendarEvent(
      calendarId,
      {
        summary:
          "[TEST] Find event by meetingId",

        description:
          "Event dùng để kiểm tra findEventByMeetingId().",

        start: {
          dateTime: start.toISOString(),
          timeZone:
            "Asia/Ho_Chi_Minh",
        },

        end: {
          dateTime: end.toISOString(),
          timeZone:
            "Asia/Ho_Chi_Minh",
        },

        extendedProperties: {
          private: {
            source:
              "genspark-automation",
            meetingId,
          },
        },
      }
    );

  const found =
    await findEventByMeetingId(
      calendarId,
      meetingId
    );

  if (!found) {
    throw new Error(
      "Không tìm thấy event vừa tạo."
    );
  }

  if (
    found.eventId !== created.eventId
  ) {
    throw new Error(
      [
        "Tìm sai event.",
        `Created: ${created.eventId}`,
        `Found: ${found.eventId}`,
      ].join(" ")
    );
  }

  console.log(
    "Test meetingId tồn tại: PASS"
  );

  console.log(
    "Event ID:",
    found.eventId
  );

  return created;
}

async function testMissingMeetingId() {
  const { calendarId } =
    getCalendarConfig();

  const missingMeetingId =
    `not-exist-${Date.now()}`;

  const found =
    await findEventByMeetingId(
      calendarId,
      missingMeetingId
    );

  if (found !== null) {
    throw new Error(
      "MeetingId không tồn tại nhưng hàm không trả về null."
    );
  }

  console.log(
    "Test meetingId không tồn tại: PASS"
  );
}

async function main() {
  await testExistingMeetingId();
  await testMissingMeetingId();

  console.log(
    "\nTất cả test tìm Calendar event: PASS"
  );
}

main().catch((error) => {
  console.error(
    "\nTest tìm Calendar event thất bại:",
    error.message
  );

  process.exitCode = 1;
});
