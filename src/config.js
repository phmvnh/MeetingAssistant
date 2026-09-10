function getRequiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `Thiếu biến môi trường bắt buộc: ${name}`
    );
  }

  return value;
}

function getSheetConfig() {
  return {
    spreadsheetId: getRequiredEnv(
      "SPREADSHEET_ID"
    ),
    sheetName: getRequiredEnv(
      "SHEET_NAME"
    ),
  };
}

function getCalendarConfig() {
  return {
    calendarId: getRequiredEnv(
      "CALENDAR_ID"
    ),
  };
}

function getOptionalEnv(name, fallback = "") {
  const value = process.env[name]?.trim();

  return value || fallback;
}

function getBooleanEnv(name, fallback = false) {
  const value = process.env[name]?.trim().toLowerCase();

  if (!value) {
    return fallback;
  }

  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(value)) {
    return false;
  }

  throw new Error(`${name} phải là true hoặc false.`);
}

function getCsvEnv(name, fallback = []) {
  const value = getOptionalEnv(name);

  if (!value) {
    return [...fallback];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getGeminiConfig() {
  return {
    apiKey: getOptionalEnv("GEMINI_API_KEY"),
    languages: getCsvEnv("TRANSCRIPTION_LANGUAGES", ["vi", "en"]),
    prompt: getOptionalEnv(
      "TRANSCRIPTION_PROMPT",
      "Cuộc họp công việc bằng tiếng Việt, có thể xen thuật ngữ tiếng Anh.",
    ),
  };
}

function getGoogleWorkspaceConfig() {
  const authMode = getOptionalEnv("GOOGLE_AUTH_MODE", "service_account");

  if (!["service_account", "oauth"].includes(authMode)) {
    throw new Error(
      "GOOGLE_AUTH_MODE phải là service_account hoặc oauth.",
    );
  }

  const meetingCalendarId = getOptionalEnv("MEETING_CALENDAR_ID");

  return {
    authMode,
    serviceAccountPath: getOptionalEnv(
      "GOOGLE_SERVICE_ACCOUNT_PATH",
      "credentials.json",
    ),
    oauthCredentialsPath: getOptionalEnv(
      "GOOGLE_OAUTH_CREDENTIALS_PATH",
      "oauth_credentials.json",
    ),
    tokenPath: getOptionalEnv(
      "GOOGLE_TOKEN_PATH",
      ".google-oauth-token.json",
    ),
    docsEnabled: getBooleanEnv("GOOGLE_DOCS_ENABLED", true),
    driveFolderId: getOptionalEnv("GOOGLE_DRIVE_FOLDER_ID"),
    spreadsheetId: getOptionalEnv("SPREADSHEET_ID"),
    spreadsheetTitle: getOptionalEnv(
      "GOOGLE_SPREADSHEET_TITLE",
      "Meeting Log",
    ),
    sheetName: getOptionalEnv("SHEET_NAME", "meeting_assistant"),
    calendarId: meetingCalendarId,
    calendarName: getOptionalEnv("MEETING_CALENDAR_NAME", "Meeting Assistant"),
    timeZone: getOptionalEnv("CALENDAR_TIME_ZONE", "Asia/Ho_Chi_Minh"),
  };
}

function getTranscriptionConfig() {
  return {
    engine: getOptionalEnv("TRANSCRIPTION_ENGINE", "whisper"),
    languages: getCsvEnv("TRANSCRIPTION_LANGUAGES", ["vi", "en"]),
    prompt: getOptionalEnv(
      "TRANSCRIPTION_PROMPT",
      "Cuộc họp công việc bằng tiếng Việt, có thể xen thuật ngữ tiếng Anh.",
    ),
  };
}

module.exports = {
  getRequiredEnv,
  getOptionalEnv,
  getBooleanEnv,
  getCsvEnv,
  getSheetConfig,
  getCalendarConfig,
  getGeminiConfig,
  getTranscriptionConfig,
  getGoogleWorkspaceConfig,
};
