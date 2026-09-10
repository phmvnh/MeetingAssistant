const test = require("node:test");
const assert = require("node:assert/strict");

const {
  APP_SPREADSHEET_NAME,
  APP_SPREADSHEET_PROPERTY_KEY,
  APP_SPREADSHEET_PROPERTY_VALUE,
  INTERNAL_MEETING_ID_HEADER,
  LEGACY_MEETING_HEADERS,
  MEETING_HEADERS,
  MEETING_STORAGE_HEADERS,
  PREVIOUS_COMPACT_HEADERS,
  PREVIOUS_CURRENT_HEADERS,
  SHEET_SCHEMA,
  ensureMeetingSheet,
  formatVietnamDate,
  formatVietnamTime,
  getNextMeetingNumber,
  resolveExistingMeetingSpreadsheetUrl,
  upsertMeetingRow,
} = require("../src/google/sheetsMeeting");

function createMeeting(overrides = {}) {
  return {
    meetingId: "meeting-123",
    title: "Họp dự án",
    startedAt: "2026-08-20T02:00:00.000Z",
    endedAt: "2026-08-20T03:00:00.000Z",
    source: "microphone",
    ...overrides,
  };
}

function createNotes() {
  return {
    title: "Họp dự án tuần này",
    summary: "Đã thống nhất kế hoạch.",
    actionItems: [
      { task: "Gửi báo cáo", owner: "An", dueDate: "2026-08-21" },
    ],
  };
}

function createSheetProperties() {
  return {
    data: {
      sheets: [
        {
          properties: {
            sheetId: 123,
            title: "meeting_assistant",
            gridProperties: { columnCount: 26 },
          },
        },
      ],
    },
  };
}

test("resolves a configured spreadsheet URL without calling Google APIs", async () => {
  const rejectApiCall = async () => {
    throw new Error("must not call a Google API");
  };
  const drive = {
    files: {
      list: rejectApiCall,
      create: rejectApiCall,
      update: rejectApiCall,
    },
  };
  const sheets = {
    spreadsheets: {
      create: rejectApiCall,
      update: rejectApiCall,
    },
  };

  const url = await resolveExistingMeetingSpreadsheetUrl({
    auth: {},
    spreadsheetId: " configured-sheet-id ",
    drive,
    sheets,
  });

  assert.equal(
    url,
    "https://docs.google.com/spreadsheets/d/configured-sheet-id/edit",
  );
});

test("finds only the existing app-tagged spreadsheet without mutating it", async () => {
  let listRequest;
  const rejectWrite = async () => {
    throw new Error("must not mutate Google Drive or Sheets");
  };
  const drive = {
    files: {
      list: async (request) => {
        listRequest = request;
        return { data: { files: [{ id: "tagged-sheet-id" }] } };
      },
      create: rejectWrite,
      update: rejectWrite,
    },
  };
  const sheets = {
    spreadsheets: {
      create: rejectWrite,
      update: rejectWrite,
    },
  };

  const url = await resolveExistingMeetingSpreadsheetUrl({
    auth: {},
    drive,
    sheets,
  });

  assert.equal(
    url,
    "https://docs.google.com/spreadsheets/d/tagged-sheet-id/edit",
  );
  assert.equal(listRequest.spaces, "drive");
  assert.equal(listRequest.pageSize, 1);
  assert.equal(listRequest.fields, "files(id)");
  assert.match(listRequest.q, /mimeType = 'application\/vnd\.google-apps\.spreadsheet'/);
  assert.match(listRequest.q, /trashed = false/);
  assert.match(listRequest.q, /appProperties has/);
  assert.match(listRequest.q, new RegExp(APP_SPREADSHEET_PROPERTY_KEY));
  assert.match(listRequest.q, new RegExp(APP_SPREADSHEET_PROPERTY_VALUE));
});

test("returns null when no tagged spreadsheet exists and performs no writes", async () => {
  let listCount = 0;
  const rejectWrite = async () => {
    throw new Error("must not create or update a spreadsheet");
  };
  const drive = {
    files: {
      list: async () => {
        listCount += 1;
        return { data: { files: [] } };
      },
      create: rejectWrite,
      update: rejectWrite,
    },
  };
  const sheets = {
    spreadsheets: {
      create: rejectWrite,
      update: rejectWrite,
    },
  };

  const url = await resolveExistingMeetingSpreadsheetUrl({
    auth: {},
    drive,
    sheets,
  });

  assert.equal(url, null);
  assert.equal(listCount, 1);
});

test("migrates the legacy Action Items header to Vietnamese", async () => {
  const legacyHeaders = [...LEGACY_MEETING_HEADERS];
  legacyHeaders[7] = "Action Items";
  let updateRequest;
  const sheets = {
    spreadsheets: {
      values: {
        get: async () => ({ data: { values: [legacyHeaders] } }),
        update: async (request) => {
          updateRequest = request;
        },
      },
    },
  };

  await ensureMeetingSheet({
    auth: {},
    spreadsheetId: "existing-sheet-id",
    sheetName: "meeting_assistant",
    sheets,
  });

  assert.equal(updateRequest.range, "'meeting_assistant'!H1");
  assert.deepEqual(updateRequest.requestBody.values, [
    ["Công việc cần thực hiện"],
  ]);
});

test("new Sheet exposes the requested columns in the requested order", () => {
  assert.deepEqual(MEETING_HEADERS, [
    "Meeting ID",
    "Date",
    "Started At",
    "Ended At",
    "Title",
    "Document",
    "Source",
    "Calendar Event ID",
    "Status",
  ]);
  assert.deepEqual(MEETING_STORAGE_HEADERS, [
    ...MEETING_HEADERS,
    INTERNAL_MEETING_ID_HEADER,
  ]);
  assert.equal(MEETING_HEADERS.includes("Summary"), false);
  assert.equal(MEETING_HEADERS.includes("Công việc cần thực hiện"), false);
  assert.equal(MEETING_HEADERS.includes("Processed At"), false);
});

test("calculates the next numeric Meeting ID from the largest valid ID", () => {
  assert.equal(getNextMeetingNumber([]), 1);
  assert.equal(
    getNextMeetingNumber([
      ["2"],
      [10],
      ["7"],
      ["old-uuid"],
      [""],
      [0],
      [-1],
      ["1.5"],
      ["1e3"],
    ]),
    11,
  );
});

test("formats meeting date and time in the Vietnam time zone", () => {
  assert.equal(formatVietnamDate("2026-08-20T02:00:00.000Z"), "20/08/2026");
  assert.equal(formatVietnamTime("2026-08-20T02:00:00.000Z"), "09:00");
  assert.equal(formatVietnamDate("2026-08-19T18:30:00.000Z"), "20/08/2026");
  assert.equal(formatVietnamTime("2026-08-19T18:30:00.000Z"), "01:30");
  assert.equal(formatVietnamDate("not-a-date"), "");
  assert.equal(formatVietnamTime(null), "");
});

test("adds and hides the internal ID column for an empty visible schema", async () => {
  let getCount = 0;
  let headerUpdate;
  let hideRequest;
  const sheets = {
    spreadsheets: {
      get: async () => createSheetProperties(),
      batchUpdate: async (request) => {
        hideRequest = request;
      },
      values: {
        get: async () => {
          getCount += 1;
          return getCount === 1
            ? { data: { values: [[...MEETING_HEADERS]] } }
            : { data: { values: [] } };
        },
        update: async (request) => {
          headerUpdate = request;
        },
      },
    },
  };

  const schema = await ensureMeetingSheet({
    auth: {},
    spreadsheetId: "existing-sheet-id",
    sheetName: "meeting_assistant",
    sheets,
  });

  assert.equal(schema, SHEET_SCHEMA.CURRENT);
  assert.equal(headerUpdate.range, "'meeting_assistant'!J1");
  assert.deepEqual(headerUpdate.requestBody.values, [
    [INTERNAL_MEETING_ID_HEADER],
  ]);
  assert.equal(
    hideRequest.requestBody.requests.at(-1).updateDimensionProperties
      .properties.hiddenByUser,
    true,
  );
});

test("uses ID 1 and the requested column order for an empty configured Sheet", async () => {
  const calls = [];
  let getCount = 0;
  const sheets = {
    spreadsheets: {
      create: async () => {
        throw new Error("must not create a spreadsheet");
      },
      get: async () => createSheetProperties(),
      batchUpdate: async () => {},
      values: {
        get: async (request) => {
          calls.push(["get", request]);
          getCount += 1;
          return getCount === 1
            ? { data: { values: [[...MEETING_STORAGE_HEADERS]] } }
            : { data: { values: [] } };
        },
        update: async (request) => calls.push(["update", request]),
        append: async (request) => calls.push(["append", request]),
      },
    },
  };
  const drive = {
    files: {
      list: async () => {
        throw new Error("must not search Drive");
      },
      update: async () => {
        throw new Error("must not tag a Drive file");
      },
    },
  };

  const result = await upsertMeetingRow({
    auth: {},
    spreadsheetId: "configured-sheet-id",
    sheetName: "meeting_assistant",
    meeting: createMeeting(),
    notes: createNotes(),
    documentReference: "https://docs.google.com/document/d/doc-id/edit",
    calendarEventId: "event-id",
    status: "completed",
    sheets,
    drive,
  });

  assert.deepEqual(result, {
    action: "created",
    rowNumber: null,
    spreadsheetId: "configured-sheet-id",
    spreadsheetUrl:
      "https://docs.google.com/spreadsheets/d/configured-sheet-id/edit",
  });
  const appendRequest = calls.find(([method]) => method === "append")[1];
  assert.equal(appendRequest.range, "'meeting_assistant'!A:J");
  assert.deepEqual(appendRequest.requestBody.values[0], [
    1,
    "20/08/2026",
    "09:00",
    "10:00",
    "Họp dự án",
    "https://docs.google.com/document/d/doc-id/edit",
    "microphone",
    "event-id",
    "completed",
    "meeting-123",
  ]);
});

test("appends max Meeting ID plus one for a new internal meeting", async () => {
  let getCount = 0;
  let appendedRow;
  const existingRows = [
    [2, "", "", "", "", "", "", "", "", "meeting-a"],
    [10, "", "", "", "", "", "", "", "", "meeting-b"],
    [7, "", "", "", "", "", "", "", "", "meeting-c"],
  ];
  const sheets = {
    spreadsheets: {
      get: async () => createSheetProperties(),
      batchUpdate: async () => {},
      values: {
        get: async () => {
          getCount += 1;
          return getCount === 1
            ? { data: { values: [[...MEETING_STORAGE_HEADERS]] } }
            : { data: { values: existingRows } };
        },
        update: async () => {
          throw new Error("must append a new meeting");
        },
        append: async (request) => {
          appendedRow = request.requestBody.values[0];
        },
      },
    },
  };

  await upsertMeetingRow({
    auth: {},
    spreadsheetId: "configured-sheet-id",
    sheetName: "meeting_assistant",
    meeting: createMeeting({ meetingId: "meeting-new" }),
    notes: createNotes(),
    sheets,
  });

  assert.equal(appendedRow[0], 11);
  assert.equal(appendedRow[9], "meeting-new");
});

test("legacy Sheet remains usable without overwriting its old content columns", async () => {
  let getCount = 0;
  const updates = [];
  const sheets = {
    spreadsheets: {
      values: {
        get: async () => {
          getCount += 1;
          return getCount === 1
            ? { data: { values: [[...LEGACY_MEETING_HEADERS]] } }
            : { data: { values: [["meeting-123"]] } };
        },
        update: async (request) => updates.push(request),
        append: async () => {
          throw new Error("must update the existing meeting row");
        },
      },
    },
  };

  await upsertMeetingRow({
    auth: {},
    spreadsheetId: "legacy-sheet-id",
    sheetName: "meeting_assistant",
    meeting: createMeeting(),
    notes: createNotes(),
    documentReference: "https://docs.google.com/document/d/doc-id/edit",
    calendarEventId: "event-id",
    sheets,
  });

  assert.deepEqual(
    updates.map((request) => request.range),
    ["'meeting_assistant'!A2:F2", "'meeting_assistant'!I2:J2"],
  );
  assert.deepEqual(updates[0].requestBody.values[0], [
    "meeting-123",
    "Họp dự án",
    "09:00",
    "10:00",
    "microphone",
    "https://docs.google.com/document/d/doc-id/edit",
  ]);
  assert.deepEqual(updates[1].requestBody.values[0], [
    "event-id",
    "completed",
  ]);
});

test("migrates the current 9-column layout to numeric IDs and the new order", async () => {
  let getCount = 0;
  let migrationUpdate;
  let batchUpdate;
  const sheets = {
    spreadsheets: {
      get: async () => createSheetProperties(),
      batchUpdate: async (request) => {
        batchUpdate = request;
      },
      values: {
        get: async () => {
          getCount += 1;
          return getCount === 1
            ? { data: { values: [[...PREVIOUS_CURRENT_HEADERS]] } }
            : {
                data: {
                  values: [
                    [
                      "uuid-a",
                      "Cuộc họp A",
                      "20/08/2026",
                      "09:00",
                      "10:00",
                      "microphone",
                      "doc-a",
                      "event-a",
                      "completed",
                    ],
                    [
                      "uuid-b",
                      "Cuộc họp B",
                      "21/08/2026",
                      "11:00",
                      "12:00",
                      "room",
                      "doc-b",
                      "event-b",
                      "completed",
                    ],
                  ],
                },
              };
        },
        update: async (request) => {
          migrationUpdate = request;
        },
      },
    },
  };

  const schema = await ensureMeetingSheet({
    auth: {},
    spreadsheetId: "existing-sheet-id",
    sheetName: "meeting_assistant",
    sheets,
  });

  assert.equal(schema, SHEET_SCHEMA.CURRENT);
  assert.equal(migrationUpdate.range, "'meeting_assistant'!A1:J");
  assert.deepEqual(migrationUpdate.requestBody.values, [
    [...MEETING_STORAGE_HEADERS],
    [
      1,
      "20/08/2026",
      "09:00",
      "10:00",
      "Cuộc họp A",
      "doc-a",
      "microphone",
      "event-a",
      "completed",
      "uuid-a",
    ],
    [
      2,
      "21/08/2026",
      "11:00",
      "12:00",
      "Cuộc họp B",
      "doc-b",
      "room",
      "event-b",
      "completed",
      "uuid-b",
    ],
  ]);
  const hideRequest = batchUpdate.requestBody.requests.at(-1);
  assert.deepEqual(hideRequest.updateDimensionProperties.range, {
    sheetId: 123,
    dimension: "COLUMNS",
    startIndex: 9,
    endIndex: 10,
  });
  assert.equal(
    hideRequest.updateDimensionProperties.properties.hiddenByUser,
    true,
  );
});

test("migrates Processed At away from the previous compact layout", async () => {
  let getCount = 0;
  let migrationUpdate;
  const sheets = {
    spreadsheets: {
      get: async () => createSheetProperties(),
      batchUpdate: async () => {},
      values: {
        get: async () => {
          getCount += 1;
          return getCount === 1
            ? { data: { values: [[...PREVIOUS_COMPACT_HEADERS]] } }
            : {
                data: {
                  values: [
                    [
                      "uuid-a",
                      "Cuộc họp A",
                      "2026-08-20T02:00:00.000Z",
                      "2026-08-20T03:00:00.000Z",
                      "microphone",
                      "doc-a",
                      "event-a",
                      "completed",
                      "2026-08-20T03:01:00.000Z",
                    ],
                  ],
                },
              };
        },
        update: async (request) => {
          migrationUpdate = request;
        },
      },
    },
  };

  await ensureMeetingSheet({
    auth: {},
    spreadsheetId: "existing-sheet-id",
    sheetName: "meeting_assistant",
    sheets,
  });

  assert.deepEqual(migrationUpdate.requestBody.values, [
    [...MEETING_STORAGE_HEADERS],
    [
      1,
      "20/08/2026",
      "09:00",
      "10:00",
      "Cuộc họp A",
      "doc-a",
      "microphone",
      "event-a",
      "completed",
      "uuid-a",
    ],
  ]);
});

test("renames and reuses an app-created spreadsheet, then updates by internal ID", async () => {
  let listRequest;
  let renameRequest;
  const drive = {
    files: {
      list: async (request) => {
        listRequest = request;
        return {
          data: {
            files: [
              {
                id: "account-sheet-id",
                name: "Meeting Assistant",
                webViewLink: "https://drive.google.com/account-sheet",
              },
            ],
          },
        };
      },
      update: async (request) => {
        renameRequest = request;
        return {
          data: {
            id: request.fileId,
            name: request.requestBody.name,
            webViewLink: "https://drive.google.com/account-sheet",
          },
        };
      },
    },
  };
  let getCount = 0;
  let rowUpdate;
  const sheets = {
    spreadsheets: {
      create: async () => {
        throw new Error("must not create a spreadsheet");
      },
      get: async () => createSheetProperties(),
      batchUpdate: async () => {},
      values: {
        get: async () => {
          getCount += 1;
          return getCount === 1
            ? { data: { values: [[...MEETING_STORAGE_HEADERS]] } }
            : {
                data: {
                  values: [
                    [1, "", "", "", "", "", "", "", "", "other"],
                    [7, "", "", "", "", "", "", "", "", "meeting-123"],
                  ],
                },
              };
        },
        update: async (request) => {
          rowUpdate = request;
        },
        append: async () => {
          throw new Error("must update the existing meeting row");
        },
      },
    },
  };

  const result = await upsertMeetingRow({
    auth: {},
    sheetName: "meeting_assistant",
    meeting: createMeeting(),
    notes: createNotes(),
    sheets,
    drive,
  });

  assert.match(listRequest.q, /appProperties has/);
  assert.match(listRequest.q, new RegExp(APP_SPREADSHEET_PROPERTY_KEY));
  assert.match(listRequest.q, new RegExp(APP_SPREADSHEET_PROPERTY_VALUE));
  assert.equal(APP_SPREADSHEET_NAME, "Meeting Log");
  assert.deepEqual(renameRequest, {
    fileId: "account-sheet-id",
    fields: "id,name,webViewLink",
    requestBody: { name: "Meeting Log" },
  });
  assert.equal(rowUpdate.spreadsheetId, "account-sheet-id");
  assert.equal(rowUpdate.range, "'meeting_assistant'!A3:J3");
  assert.equal(rowUpdate.requestBody.values[0][0], 7);
  assert.equal(rowUpdate.requestBody.values[0][9], "meeting-123");
  assert.deepEqual(result, {
    action: "updated",
    rowNumber: 3,
    spreadsheetId: "account-sheet-id",
    spreadsheetUrl: "https://drive.google.com/account-sheet",
  });
});

test("creates, tags and configures a per-account spreadsheet when none exists", async () => {
  let createRequest;
  let tagRequest;
  let hideRequest;
  const drive = {
    files: {
      list: async () => ({ data: { files: [] } }),
      update: async (request) => {
        tagRequest = request;
        return { data: { id: request.fileId } };
      },
    },
  };
  let getCount = 0;
  const valueUpdates = [];
  let appendedRow;
  const sheets = {
    spreadsheets: {
      create: async (request) => {
        createRequest = request;
        return {
          data: {
            spreadsheetId: "new-sheet-id",
            spreadsheetUrl: "https://docs.google.com/spreadsheets/d/new-sheet-id/edit",
          },
        };
      },
      get: async () => createSheetProperties(),
      batchUpdate: async (request) => {
        hideRequest = request;
      },
      values: {
        get: async () => {
          getCount += 1;
          return getCount === 1
            ? { data: { values: [] } }
            : { data: { values: [] } };
        },
        update: async (request) => valueUpdates.push(request),
        append: async (request) => {
          appendedRow = request;
        },
      },
    },
  };

  const result = await upsertMeetingRow({
    auth: {},
    spreadsheetId: "",
    spreadsheetTitle: "Biên bản của tôi",
    sheetName: "meeting_assistant",
    meeting: createMeeting(),
    notes: createNotes(),
    documentReference: "local.md",
    sheets,
    drive,
  });

  assert.deepEqual(createRequest.requestBody, {
    properties: { title: "Biên bản của tôi" },
    sheets: [{ properties: { title: "meeting_assistant" } }],
  });
  assert.deepEqual(tagRequest, {
    fileId: "new-sheet-id",
    fields: "id,webViewLink",
    requestBody: {
      appProperties: {
        [APP_SPREADSHEET_PROPERTY_KEY]: APP_SPREADSHEET_PROPERTY_VALUE,
      },
    },
  });
  assert.deepEqual(valueUpdates[0].requestBody.values, [
    [...MEETING_STORAGE_HEADERS],
  ]);
  assert.equal(valueUpdates[0].range, "'meeting_assistant'!A1:J1");
  assert.equal(
    hideRequest.requestBody.requests.at(-1).updateDimensionProperties
      .properties.hiddenByUser,
    true,
  );
  assert.equal(appendedRow.spreadsheetId, "new-sheet-id");
  assert.equal(appendedRow.range, "'meeting_assistant'!A:J");
  assert.deepEqual(appendedRow.requestBody.values[0], [
    1,
    "20/08/2026",
    "09:00",
    "10:00",
    "Họp dự án",
    "local.md",
    "microphone",
    "",
    "completed",
    "meeting-123",
  ]);
  assert.deepEqual(result, {
    action: "created",
    rowNumber: null,
    spreadsheetId: "new-sheet-id",
    spreadsheetUrl:
      "https://docs.google.com/spreadsheets/d/new-sheet-id/edit",
  });
});

test("serializes simultaneous writes so auto-increment IDs stay unique", async () => {
  const rows = [];
  const appendedMeetingNumbers = [];
  const sheets = {
    spreadsheets: {
      create: async () => {
        throw new Error("must not create a spreadsheet");
      },
      get: async () => createSheetProperties(),
      batchUpdate: async () => {},
      values: {
        get: async (request) => {
          if (request.range.endsWith("A1:K1")) {
            return { data: { values: [[...MEETING_STORAGE_HEADERS]] } };
          }

          return { data: { values: rows.map((row) => [...row]) } };
        },
        update: async () => {
          throw new Error("must append new meetings");
        },
        append: async (request) => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          const row = request.requestBody.values[0];
          rows.push(row);
          appendedMeetingNumbers.push(row[0]);
        },
      },
    },
  };

  await Promise.all([
    upsertMeetingRow({
      auth: {},
      spreadsheetId: "configured-sheet-id",
      sheetName: "meeting_assistant",
      meeting: createMeeting({ meetingId: "meeting-a" }),
      notes: createNotes(),
      sheets,
    }),
    upsertMeetingRow({
      auth: {},
      spreadsheetId: "configured-sheet-id",
      sheetName: "meeting_assistant",
      meeting: createMeeting({ meetingId: "meeting-b" }),
      notes: createNotes(),
      sheets,
    }),
  ]);

  assert.deepEqual(appendedMeetingNumbers, [1, 2]);
});
