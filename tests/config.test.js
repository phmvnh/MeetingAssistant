const test = require("node:test");
const assert = require("node:assert/strict");

const { getGoogleWorkspaceConfig } = require("../src/config");

const ENV_NAMES = [
  "GOOGLE_AUTH_MODE",
  "CALENDAR_ID",
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

test("OAuth follows the signed-in account's primary Calendar", () => {
  withEnvironment(
    {
      GOOGLE_AUTH_MODE: "oauth",
      CALENDAR_ID: "a-fixed-calendar@example.com",
    },
    () => {
      const config = getGoogleWorkspaceConfig();

      assert.equal(config.calendarId, "primary");
      assert.equal(config.sheetName, "meeting_assistant");
      assert.equal(config.spreadsheetTitle, "Meeting Log");
    },
  );
});

test("service account keeps the explicitly shared Calendar ID", () => {
  withEnvironment(
    {
      GOOGLE_AUTH_MODE: "service_account",
      CALENDAR_ID: "shared-calendar@example.com",
    },
    () => {
      assert.equal(
        getGoogleWorkspaceConfig().calendarId,
        "shared-calendar@example.com",
      );
    },
  );
});
