const { summarizeMeeting } = require("./summarize");
const { saveMeetingLocally } = require("./localStore");
const {
  GOOGLE_REAUTH_REQUIRED_MESSAGE,
  getGoogleAuthClient,
  isGoogleReauthFailure,
} = require("../google/auth");
const { createMeetingDocument } = require("../google/docs");
const { syncMeetingCalendar } = require("../google/calendarMeeting");
const { upsertMeetingRow } = require("../google/sheetsMeeting");

function createFallbackNotes(meeting) {
  return {
    title: meeting.title || "Biên bản cuộc họp",
    summary:
      "Không thể tạo tóm tắt tự động. Transcript đầy đủ vẫn được lưu bên dưới.",
    keyPoints: [],
    decisions: [],
    actionItems: [],
    openQuestions: [],
  };
}

async function finalizeMeeting(options) {
  const {
    meeting,
    transcript,
    geminiConfig,
    googleConfig,
    outputDirectory,
    openExternal,
    onProgress = () => {},
  } = options;
  const warnings = [];

  onProgress("summarizing", "Đang tạo tóm tắt và công việc cần thực hiện…");
  let notes;

  try {
    notes = await summarizeMeeting({
      apiKey: geminiConfig.apiKey,
      model: geminiConfig.summaryModel,
      transcript,
      metadata: meeting,
    });
  } catch (error) {
    warnings.push(`Tóm tắt tự động: ${error.message}`);
    notes = createFallbackNotes(meeting);
  }

  onProgress("saving-local", "Đang lưu bản biên bản dự phòng…");
  const local = await saveMeetingLocally({
    outputDirectory,
    meeting,
    notes,
    transcript,
  });

  const result = {
    meeting,
    notes,
    transcript,
    local,
    googleDocument: null,
    calendar: null,
    sheet: null,
    warnings,
  };

  let auth;
  let googleConnectionLost = false;

  try {
    onProgress("google-auth", "Đang xác thực Google…");
    auth = await getGoogleAuthClient(googleConfig, {
      interactive: false,
      openExternal,
    });
  } catch (error) {
    warnings.push(`Google chưa đồng bộ: ${error.message}`);
    return result;
  }

  if (googleConfig.docsEnabled) {
    try {
      onProgress("google-docs", "Đang tạo Google Docs…");
      result.googleDocument = await createMeetingDocument({
        auth,
        authMode: googleConfig.authMode,
        folderId: googleConfig.driveFolderId,
        meeting,
        notes,
        transcript,
      });
    } catch (error) {
      if (isGoogleReauthFailure(error)) {
        googleConnectionLost = true;
        warnings.push(`Google chưa đồng bộ: ${GOOGLE_REAUTH_REQUIRED_MESSAGE}`);
      } else {
        warnings.push(`Google Docs: ${error.message}`);
      }
    }
  }

  if (!googleConnectionLost && googleConfig.calendarId) {
    try {
      onProgress("google-calendar", "Đang cập nhật Google Calendar…");
      result.calendar = await syncMeetingCalendar({
        auth,
        calendarId: googleConfig.calendarId,
        timeZone: googleConfig.timeZone,
        meeting,
        notes,
        documentUrl: result.googleDocument?.documentUrl || "",
        createIfMissing: meeting.createCalendarIfMissing,
      });
    } catch (error) {
      if (isGoogleReauthFailure(error)) {
        googleConnectionLost = true;
        warnings.push(`Google chưa đồng bộ: ${GOOGLE_REAUTH_REQUIRED_MESSAGE}`);
      } else {
        warnings.push(`Google Calendar: ${error.message}`);
      }
    }
  }

  if (
    !googleConnectionLost &&
    (googleConfig.spreadsheetId || googleConfig.authMode === "oauth")
  ) {
    try {
      onProgress("google-sheets", "Đang cập nhật Google Sheets…");
      result.sheet = await upsertMeetingRow({
        auth,
        spreadsheetId: googleConfig.spreadsheetId,
        spreadsheetTitle: googleConfig.spreadsheetTitle,
        sheetName: googleConfig.sheetName,
        meeting,
        notes,
        documentReference:
          result.googleDocument?.documentUrl || local.markdownPath,
        calendarEventId: result.calendar?.eventId || "",
        status: warnings.length ? "completed_with_warnings" : "completed",
      });
    } catch (error) {
      if (isGoogleReauthFailure(error)) {
        warnings.push(`Google chưa đồng bộ: ${GOOGLE_REAUTH_REQUIRED_MESSAGE}`);
      } else {
        warnings.push(`Google Sheets: ${error.message}`);
      }
    }
  }

  return result;
}

module.exports = {
  createFallbackNotes,
  finalizeMeeting,
};
