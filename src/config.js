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
    apiKey: getRequiredEnv("GEMINI_API_KEY"),
    liveModel: getOptionalEnv(
      "GEMINI_LIVE_MODEL",
      "gemini-3.1-flash-live-preview",
    ),
    summaryModel: getOptionalEnv(
      "GEMINI_SUMMARY_MODEL",
      "gemini-3.5-flash",
    ),
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

  const configuredCalendarId = getOptionalEnv("CALENDAR_ID");

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
    // OAuth always follows the account selected in the browser. Service-account
    // mode still needs an explicitly shared calendar ID.
    calendarId: authMode === "oauth" ? "primary" : configuredCalendarId,
    timeZone: getOptionalEnv("CALENDAR_TIME_ZONE", "Asia/Ho_Chi_Minh"),
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
  getGoogleWorkspaceConfig,
};
