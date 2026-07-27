const {
  DEFAULT_EVENT_DURATION_MINUTES,
  DEFAULT_TIME_ZONE,
  parseMeetingDate,
  mapMeetingToCalendarEvent,
} = require("./src/mapper/meetingMapper");

function testValidMeeting() {
  const meeting = {
    meetingId:
      "d9fbec5b-58a0-49cf-af50-57dd0d7cfcdd",
    title:
      "Tổng Hợp Kế Hoạch Phát Triển Cá Nhân Trong Ngày",
    meetingDate:
      "10:37 Thứ 4, 22 thg 7",
    meetingUrl:
      "https://www.genspark.ai/agents?id=e484ccbe-6b5f-4d00-81b1-29273c5bc24b",
  };

  const result =
    mapMeetingToCalendarEvent(
      meeting,
      {
        referenceYear: 2026,
      }
    );

  console.log(
    "\nPayload Calendar:"
  );

  console.dir(result, {
    depth: null,
  });

  const start =
    new Date(result.start.dateTime);

  const end =
    new Date(result.end.dateTime);

  const durationMinutes =
    (end.getTime() - start.getTime()) /
    60000;

  console.log(
    "\nKiểm tra:"
  );

  console.log(
    "Summary:",
    result.summary
  );

  console.log(
    "Time zone:",
    result.start.timeZone
  );

  console.log(
    "Duration:",
    durationMinutes,
    "phút"
  );

  console.log(
    "Meeting ID:",
    result.extendedProperties
      .private.meetingId
  );

  if (
    result.summary !== meeting.title
  ) {
    throw new Error(
      "Mapper sai summary."
    );
  }

  if (
    result.start.timeZone !==
    DEFAULT_TIME_ZONE
  ) {
    throw new Error(
      "Mapper sai timezone."
    );
  }

  if (
    durationMinutes !==
    DEFAULT_EVENT_DURATION_MINUTES
  ) {
    throw new Error(
      "Mapper sai duration."
    );
  }

  if (
    result.extendedProperties
      .private.meetingId !==
    meeting.meetingId
  ) {
    throw new Error(
      "Mapper sai meetingId."
    );
  }

  console.log(
    "\nTest meeting hợp lệ: PASS"
  );
}

function testInvalidDateFormat() {
  try {
    parseMeetingDate(
      "22/07/2026 10:37",
      2026
    );

    throw new Error(
      "Test thất bại: format sai nhưng không throw."
    );
  } catch (error) {
    if (
      error.message.startsWith(
        "Test thất bại:"
      )
    ) {
      throw error;
    }

    console.log(
      "Test sai định dạng ngày: PASS"
    );
  }
}

function testInvalidCalendarDate() {
  try {
    parseMeetingDate(
      "10:37 Thứ 4, 31 thg 2",
      2026
    );

    throw new Error(
      "Test thất bại: ngày không tồn tại nhưng không throw."
    );
  } catch (error) {
    if (
      error.message.startsWith(
        "Test thất bại:"
      )
    ) {
      throw error;
    }

    console.log(
      "Test ngày không tồn tại: PASS"
    );
  }
}

function testMissingMeetingId() {
  try {
    mapMeetingToCalendarEvent(
      {
        meetingId: "",
        title: "Meeting test",
        meetingDate:
          "10:37 Thứ 4, 22 thg 7",
        meetingUrl:
          "https://example.com",
      },
      {
        referenceYear: 2026,
      }
    );

    throw new Error(
      "Test thất bại: thiếu meetingId nhưng không throw."
    );
  } catch (error) {
    if (
      error.message.startsWith(
        "Test thất bại:"
      )
    ) {
      throw error;
    }

    console.log(
      "Test thiếu meetingId: PASS"
    );
  }
}

function main() {
  testValidMeeting();
  testInvalidDateFormat();
  testInvalidCalendarDate();
  testMissingMeetingId();

  console.log(
    "\nTất cả test mapper: PASS"
  );
}

try {
  main();
} catch (error) {
  console.error(
    "\nTest mapper thất bại:",
    error.message
  );

  process.exitCode = 1;
}
