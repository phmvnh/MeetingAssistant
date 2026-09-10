const test = require("node:test");
const assert = require("node:assert/strict");

const { getGoogleWorkspaceConfig } = require("../src/config");

const ENV_NAMES = [
  "GOOGLE_AUTH_MODE",
  "MEETING_CALENDAR_ID",
  "MEETING_CALENDAR_NAME",
  "GOOGLE_SPREADSHEET_TITLE",
  "SHEET_NAME",
];

function withEnvironment(values, callback) {
  const previous = Object.fromEntries(
    ENV_NAMES.map((name) => [name, process.env[name]]),
  );

  for (const name of ENV_NAMES) {
    if (Object.hasOwn(values, name)) {
      process.env[name] = values[name];
    } else {
      delete process.env[name];
    }
  }

  try {
    callback();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

test("Calendar configuration targets the dedicated Meeting Assistant calendar", () => {
  withEnvironment(
    {
      GOOGLE_AUTH_MODE: "oauth",
      MEETING_CALENDAR_ID: "a-fixed-calendar@example.com",
      MEETING_CALENDAR_NAME: "Meeting Assistant",
    },
    () => {
      const config = getGoogleWorkspaceConfig();

      assert.equal(config.calendarId, "a-fixed-calendar@example.com");
      assert.equal(config.calendarName, "Meeting Assistant");
      assert.equal(config.sheetName, "meeting_assistant");
      assert.equal(config.spreadsheetTitle, "Meeting Log");
    },
  );
});

test("Dedicated calendar ID is optional so the app can find or create it", () => {
  withEnvironment(
    {
      GOOGLE_AUTH_MODE: "oauth",
      MEETING_CALENDAR_ID: "",
    },
    () => {
      assert.equal(getGoogleWorkspaceConfig().calendarId, "");
      assert.equal(
        getGoogleWorkspaceConfig().calendarName,
        "Meeting Assistant",
      );
    },
  );
});

test("service account can use a pre-created dedicated Calendar ID", () => {
  withEnvironment(
    {
      GOOGLE_AUTH_MODE: "service_account",
      MEETING_CALENDAR_ID: "shared-calendar@example.com",
    },
    () => {
      assert.equal(
        getGoogleWorkspaceConfig().calendarId,
        "shared-calendar@example.com",
      );
    },
  );
});
