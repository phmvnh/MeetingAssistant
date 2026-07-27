const { google } = require("googleapis");
const path = require("node:path");

const auth = new google.auth.GoogleAuth({
  keyFile: path.join(__dirname, "..", "credentials.json"),
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
  ],
});

async function getSheetsClient() {
  const authClient = await auth.getClient();

  return google.sheets({
    version: "v4",
    auth: authClient,
  });
}

async function getExistingMeetingIds(
  spreadsheetId,
  sheetName
)
    {
  if (!spreadsheetId?.trim()) {
    throw new Error(
      "spreadsheetId là bắt buộc."
    );
  }

  if (!sheetName?.trim()) {
    throw new Error(
      "sheetName là bắt buộc."
    );
  }

  const sheets = await getSheetsClient();

  const response =
    await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId.trim(),
      range: `'${sheetName}'!A2:A`,
    });

  const rows = response.data.values || [];

  return new Set(
    rows
      .map((row) => row[0]?.trim())
      .filter(Boolean)
  );
}

async function appendMeetings(
  meetings,
  spreadsheetId,
  sheetName
) {
  if (!Array.isArray(meetings)) {
    throw new TypeError(
      "meetings phải là một mảng"
    );
  }

  if (meetings.length === 0) {
    return 0;
  }

  const sheets = await getSheetsClient();

  const syncedAt = new Date().toISOString();

  const rows = meetings.map((meeting) => [
    meeting.meetingId || "",
    meeting.title || "",
    meeting.meetingDate || "",
    meeting.meetingUrl || "",
    "",
    syncedAt,
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${sheetName}'!A:F`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: rows,
    },
  });

  return rows.length;
}

async function syncMeetings(
  meetings,
  spreadsheetId,
  sheetName
) {
  if (!Array.isArray(meetings)) {
    throw new TypeError(
      "meetings phải là một mảng"
    );
  }

  if (meetings.length === 0) {
    console.log("Scraper không trả về meeting nào.");

    return {
      total: 0,
      added: 0,
      skipped: 0,
      newMeetings: [],
    };
  }

  const existingIds =
    await getExistingMeetingIds(
      spreadsheetId,
      sheetName
    );

  const seenInCurrentBatch = new Set();

  const newMeetings = meetings.filter(
    (meeting) => {
      const meetingId =
        meeting.meetingId?.trim();

      if (!meetingId) {
        console.warn(
          "Bỏ qua meeting không có meetingId:",
          meeting.title || "Không có tiêu đề"
        );

        return false;
      }

      if (
        existingIds.has(meetingId) ||
        seenInCurrentBatch.has(meetingId)
      ) {
        return false;
      }

      seenInCurrentBatch.add(meetingId);

      return true;
    }
  );

  if (newMeetings.length === 0) {
    console.log("Không có meeting mới.");

    return {
      total: meetings.length,
      added: 0,
      skipped: meetings.length,
      newMeetings: [],
    };
  }

  const added = await appendMeetings(
    newMeetings,
    spreadsheetId,
    sheetName
  );

  console.log(
    `Đã thêm ${added} meeting mới vào Google Sheet.`
  );

  return {
    total: meetings.length,
    added,
    skipped: meetings.length - added,
    newMeetings,
  };
}
async function getMeetingsWithoutCalendarEvent(
  spreadsheetId,
  sheetName
) {
  if (!spreadsheetId?.trim()) {
    throw new Error(
      "spreadsheetId là bắt buộc."
    );
  }

  if (!sheetName?.trim()) {
    throw new Error(
      "sheetName là bắt buộc."
    );
  }

  const sheets = await getSheetsClient();

  const response =
    await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId.trim(),
      range: `${sheetName.trim()}!A2:G`,
    });

  const rows = response.data.values || [];

  return rows
    .map((row, index) => {
      const [
        meetingId = "",
        title = "",
        meetingDate = "",
        meetingUrl = "",
        calendarEventId = "",
        calendarHtmlLink = "",
        syncedAt = "",
      ] = row;

      return {
        rowNumber: index + 2,
        meetingId: meetingId.trim(),
        title: title.trim(),
        meetingDate: meetingDate.trim(),
        meetingUrl: meetingUrl.trim(),
        calendarEventId:
          calendarEventId.trim(),
        calendarHtmlLink:
          calendarHtmlLink.trim(),
        syncedAt: syncedAt.trim(),
      };
    })
    .filter((meeting) => {
      return (
        meeting.meetingId &&
        !meeting.calendarEventId
      );
    });
}
async function updateMeetingCalendarSync(
  spreadsheetId,
  sheetName,
  rowNumber,
  calendarEvent
) {
  if (!spreadsheetId?.trim()) {
    throw new Error(
      "spreadsheetId là bắt buộc."
    );
  }

  if (!sheetName?.trim()) {
    throw new Error(
      "sheetName là bắt buộc."
    );
  }

  if (
    !Number.isInteger(rowNumber) ||
    rowNumber < 2
  ) {
    throw new Error(
      "rowNumber phải là số nguyên từ 2 trở lên."
    );
  }

  if (
    !calendarEvent ||
    typeof calendarEvent !== "object"
  ) {
    throw new Error(
      "calendarEvent phải là một object."
    );
  }

  const eventId =
    typeof calendarEvent.eventId === "string"
      ? calendarEvent.eventId.trim()
      : "";

  const htmlLink =
    typeof calendarEvent.htmlLink === "string"
      ? calendarEvent.htmlLink.trim()
      : "";

  if (!eventId) {
    throw new Error(
      "calendarEvent.eventId là bắt buộc."
    );
  }

  const sheets = await getSheetsClient();

  const syncedAt =
    new Date().toISOString();

  await sheets.spreadsheets.values.update({
    spreadsheetId:
      spreadsheetId.trim(),

    range:
      `${sheetName.trim()}!E${rowNumber}:G${rowNumber}`,

    valueInputOption: "RAW",

    requestBody: {
      values: [
        [
          eventId,
          htmlLink,
          syncedAt,
        ],
      ],
    },
  });

  return {
    rowNumber,
    calendarEventId: eventId,
    calendarHtmlLink: htmlLink,
    syncedAt,
  };
}

module.exports = {
  getSheetsClient,
  getExistingMeetingIds,
  appendMeetings,
  syncMeetings,
  getMeetingsWithoutCalendarEvent,
  updateMeetingCalendarSync,
};