const DEFAULT_EVENT_DURATION_MINUTES = 30;
const DEFAULT_TIME_ZONE = "Asia/Ho_Chi_Minh";

/**
 * Parse chuỗi ngày giờ của Genspark.
 *
 * Format hiện tại:
 * "10:37 Thứ 4, 22 thg 7"
 *
 * Vì chuỗi không có năm, hàm dùng năm hiện tại.
 *
 * @param {string} meetingDate
 * @param {number} [referenceYear]
 * @returns {{ start: Date, end: Date }}
 */
function parseMeetingDate(
  meetingDate,
  referenceYear = new Date().getFullYear()
) {
  if (
    typeof meetingDate !== "string" ||
    !meetingDate.trim()
  ) {
    throw new Error(
      "meetingDate phải là chuỗi không rỗng."
    );
  }

  if (
    !Number.isInteger(referenceYear) ||
    referenceYear < 1970
  ) {
    throw new Error(
      "referenceYear phải là một năm hợp lệ."
    );
  }

  const normalizedDate = meetingDate.trim();

  const match = normalizedDate.match(
    /^(\d{1,2}):(\d{2})\s+Thứ\s+\d,\s+(\d{1,2})\s+thg\s+(\d{1,2})$/i
  );

  if (!match) {
    throw new Error(
      `meetingDate không đúng định dạng mong đợi: "${meetingDate}"`
    );
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const day = Number(match[3]);
  const month = Number(match[4]);

  if (hour < 0 || hour > 23) {
    throw new Error(
      `Giờ không hợp lệ trong meetingDate: ${hour}`
    );
  }

  if (minute < 0 || minute > 59) {
    throw new Error(
      `Phút không hợp lệ trong meetingDate: ${minute}`
    );
  }

  if (month < 1 || month > 12) {
    throw new Error(
      `Tháng không hợp lệ trong meetingDate: ${month}`
    );
  }

  if (day < 1 || day > 31) {
    throw new Error(
      `Ngày không hợp lệ trong meetingDate: ${day}`
    );
  }

  const start = new Date(
    referenceYear,
    month - 1,
    day,
    hour,
    minute,
    0,
    0
  );

  const isValidCalendarDate =
    start.getFullYear() === referenceYear &&
    start.getMonth() === month - 1 &&
    start.getDate() === day &&
    start.getHours() === hour &&
    start.getMinutes() === minute;

  if (!isValidCalendarDate) {
    throw new Error(
      `Ngày giờ không tồn tại trong lịch: "${meetingDate}"`
    );
  }

  const end = new Date(
    start.getTime() +
      DEFAULT_EVENT_DURATION_MINUTES *
        60 *
        1000
  );

  return {
    start,
    end,
  };
}

/**
 * Chuyển meeting của Genspark thành payload Google Calendar.
 *
 * @param {{
 *   meetingId: string,
 *   title: string,
 *   meetingDate: string,
 *   meetingUrl: string
 * }} meeting
 * @param {{
 *   referenceYear?: number,
 *   timeZone?: string
 * }} [options]
 * @returns {{
 *   summary: string,
 *   description: string,
 *   start: {
 *     dateTime: string,
 *     timeZone: string
 *   },
 *   end: {
 *     dateTime: string,
 *     timeZone: string
 *   },
 *   extendedProperties: {
 *     private: {
 *       source: string,
 *       meetingId: string
 *     }
 *   }
 * }}
 */
function mapMeetingToCalendarEvent(
  meeting,
  options = {}
) {
  if (!meeting || typeof meeting !== "object") {
    throw new Error(
      "meeting phải là một object."
    );
  }

  const meetingId =
    typeof meeting.meetingId === "string"
      ? meeting.meetingId.trim()
      : "";

  const title =
    typeof meeting.title === "string"
      ? meeting.title.trim()
      : "";

  const meetingUrl =
    typeof meeting.meetingUrl === "string"
      ? meeting.meetingUrl.trim()
      : "";

  if (!meetingId) {
    throw new Error(
      "meeting.meetingId là bắt buộc."
    );
  }

  if (!title) {
    throw new Error(
      "meeting.title là bắt buộc."
    );
  }

  if (!meetingUrl) {
    throw new Error(
      "meeting.meetingUrl là bắt buộc."
    );
  }

  const referenceYear =
    options.referenceYear ??
    new Date().getFullYear();

  const timeZone =
    typeof options.timeZone === "string" &&
    options.timeZone.trim()
      ? options.timeZone.trim()
      : DEFAULT_TIME_ZONE;

  const { start, end } =
    parseMeetingDate(
      meeting.meetingDate,
      referenceYear
    );

  return {
    summary: title,

    description: [
      "Nguồn: Genspark Meeting Notes",
      `Meeting ID: ${meetingId}`,
      `Link: ${meetingUrl}`,
    ].join("\n"),

    start: {
      dateTime: start.toISOString(),
      timeZone,
    },

    end: {
      dateTime: end.toISOString(),
      timeZone,
    },

    extendedProperties: {
      private: {
        source: "genspark-automation",
        meetingId,
      },
    },
  };
}

// TODO(v2):
// Khi Genspark cung cấp duration hoặc endTime,
// thay DEFAULT_EVENT_DURATION_MINUTES bằng dữ liệu thật.
//
// TODO(v2):
// Chuỗi meetingDate hiện không chứa năm.
// Phiên bản hiện tại dùng năm hiện tại làm referenceYear.
// Cần xử lý rõ trường hợp đồng bộ meeting thuộc năm trước
// hoặc năm sau.

module.exports = {
  DEFAULT_EVENT_DURATION_MINUTES,
  DEFAULT_TIME_ZONE,
  parseMeetingDate,
  mapMeetingToCalendarEvent,
};