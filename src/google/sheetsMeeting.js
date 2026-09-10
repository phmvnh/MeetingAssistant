const { google } = require("googleapis");

const { resolveMeetingTitle } = require("../meeting/meetingTitle");

const APP_SPREADSHEET_NAME = "Meeting Log Assistant";
const APP_SPREADSHEET_PROPERTY_KEY = "meetingAssistant";
const APP_SPREADSHEET_PROPERTY_VALUE = "meeting-log-v1";
const GOOGLE_SPREADSHEET_MIME_TYPE =
  "application/vnd.google-apps.spreadsheet";
const VIETNAM_TIME_ZONE = "Asia/Ho_Chi_Minh";
const VIETNAM_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: VIETNAM_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const MEETING_HEADERS = Object.freeze([
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

const INTERNAL_MEETING_ID_HEADER = "Internal Meeting ID";
const MEETING_STORAGE_HEADERS = Object.freeze([
  ...MEETING_HEADERS,
  INTERNAL_MEETING_ID_HEADER,
]);

const PREVIOUS_CURRENT_HEADERS = Object.freeze([
  "Meeting ID",
  "Title",
  "Date",
  "Started At",
  "Ended At",
  "Source",
  "Document",
  "Calendar Event ID",
  "Status",
]);

const PREVIOUS_COMPACT_HEADERS = Object.freeze([
  "Meeting ID",
  "Title",
  "Started At",
  "Ended At",
  "Source",
  "Document",
  "Calendar Event ID",
  "Status",
  "Processed At",
]);

const LEGACY_MEETING_HEADERS = Object.freeze([
  "Meeting ID",
  "Title",
  "Started At",
  "Ended At",
  "Source",
  "Document",
  "Summary",
  "Công việc cần thực hiện",
  "Calendar Event ID",
  "Status",
  "Processed At",
]);

const SHEET_SCHEMA = Object.freeze({
  CURRENT: "current",
  LEGACY: "legacy",
});

function getVietnamDateTimeParts(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return Object.fromEntries(
    VIETNAM_DATE_TIME_FORMATTER.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function formatVietnamDate(value) {
  const parts = getVietnamDateTimeParts(value);
  return parts ? `${parts.day}/${parts.month}/${parts.year}` : "";
}

function formatVietnamTime(value) {
  const parts = getVietnamDateTimeParts(value);
  return parts ? `${parts.hour}:${parts.minute}` : "";
}

function quoteSheetName(sheetName) {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

function spreadsheetUrl(spreadsheetId) {
  const normalizedSpreadsheetId = spreadsheetId?.trim();

  if (
    !normalizedSpreadsheetId ||
    !/^[A-Za-z0-9_-]+$/.test(normalizedSpreadsheetId)
  ) {
    throw new Error("spreadsheetId không hợp lệ.");
  }

  return `https://docs.google.com/spreadsheets/d/${normalizedSpreadsheetId}/edit`;
}

function quoteDriveQueryValue(value) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function getSheetsClient(auth, sheets) {
  return sheets || google.sheets({ version: "v4", auth });
}

function getDriveClient(auth, drive) {
  return drive || google.drive({ version: "v3", auth });
}

async function resolveExistingMeetingSpreadsheetUrl(options = {}) {
  const configuredSpreadsheetId = options.spreadsheetId?.trim();

  if (configuredSpreadsheetId) {
    return spreadsheetUrl(configuredSpreadsheetId);
  }

  const drive = getDriveClient(options.auth, options.drive);
  const propertyKey = quoteDriveQueryValue(APP_SPREADSHEET_PROPERTY_KEY);
  const propertyValue = quoteDriveQueryValue(APP_SPREADSHEET_PROPERTY_VALUE);
  const mimeType = quoteDriveQueryValue(GOOGLE_SPREADSHEET_MIME_TYPE);
  const response = await drive.files.list({
    spaces: "drive",
    pageSize: 1,
    orderBy: "createdTime",
    fields: "files(id)",
    q: [
      `mimeType = '${mimeType}'`,
      "trashed = false",
      `appProperties has { key='${propertyKey}' and value='${propertyValue}' }`,
    ].join(" and "),
  });
  const existingFile = response.data.files?.find((file) => file.id);

  return existingFile ? spreadsheetUrl(existingFile.id) : null;
}

async function resolveMeetingSpreadsheet(options) {
  const { auth, sheetName } = options;
  const configuredSpreadsheetId = options.spreadsheetId?.trim();
  const spreadsheetTitle =
    options.spreadsheetTitle?.trim() || APP_SPREADSHEET_NAME;

  if (!sheetName) {
    throw new Error("Thiếu SHEET_NAME.");
  }

  if (configuredSpreadsheetId) {
    return {
      spreadsheetId: configuredSpreadsheetId,
      spreadsheetUrl: spreadsheetUrl(configuredSpreadsheetId),
      autoCreated: false,
    };
  }

  const drive = getDriveClient(auth, options.drive);
  const propertyKey = quoteDriveQueryValue(APP_SPREADSHEET_PROPERTY_KEY);
  const propertyValue = quoteDriveQueryValue(APP_SPREADSHEET_PROPERTY_VALUE);
  const mimeType = quoteDriveQueryValue(GOOGLE_SPREADSHEET_MIME_TYPE);
  const response = await drive.files.list({
    spaces: "drive",
    pageSize: 1,
    orderBy: "createdTime",
    fields: "files(id,name,webViewLink)",
    q: [
      `mimeType = '${mimeType}'`,
      "trashed = false",
      `appProperties has { key='${propertyKey}' and value='${propertyValue}' }`,
    ].join(" and "),
  });
  const existingFile = response.data.files?.find((file) => file.id);

  if (existingFile) {
    let resolvedFile = existingFile;

    if (existingFile.name !== spreadsheetTitle) {
      const renamedFile = await drive.files.update({
        fileId: existingFile.id,
        fields: "id,name,webViewLink",
        requestBody: { name: spreadsheetTitle },
      });
      resolvedFile = { ...existingFile, ...renamedFile.data };
    }

    return {
      spreadsheetId: resolvedFile.id,
      spreadsheetUrl:
        resolvedFile.webViewLink || spreadsheetUrl(resolvedFile.id),
      autoCreated: false,
    };
  }

  const sheets = getSheetsClient(auth, options.sheets);
  const createdSpreadsheet = await sheets.spreadsheets.create({
    fields: "spreadsheetId,spreadsheetUrl",
    requestBody: {
      properties: { title: spreadsheetTitle },
      sheets: [{ properties: { title: sheetName } }],
    },
  });
  const createdSpreadsheetId = createdSpreadsheet.data.spreadsheetId;

  if (!createdSpreadsheetId) {
    throw new Error("Google không trả về spreadsheetId.");
  }

  const taggedFile = await drive.files.update({
    fileId: createdSpreadsheetId,
    fields: "id,webViewLink",
    requestBody: {
      appProperties: {
        [APP_SPREADSHEET_PROPERTY_KEY]: APP_SPREADSHEET_PROPERTY_VALUE,
      },
    },
  });

  return {
    spreadsheetId: createdSpreadsheetId,
    spreadsheetUrl:
      createdSpreadsheet.data.spreadsheetUrl ||
      taggedFile.data.webViewLink ||
      spreadsheetUrl(createdSpreadsheetId),
    autoCreated: true,
  };
}

function headersMatch(actualHeaders, expectedHeaders) {
  return (
    actualHeaders.length === expectedHeaders.length &&
    expectedHeaders.every(
      (header, index) => actualHeaders[index] === header,
    )
  );
}

function rowHasData(row) {
  return row.some(
    (value) => value !== undefined && value !== null && value !== "",
  );
}

function parseMeetingNumber(value) {
  let normalized = value;

  if (typeof value === "string") {
    const trimmedValue = value.trim();

    if (!/^\d+$/.test(trimmedValue)) {
      return null;
    }

    normalized = Number(trimmedValue);
  }

  return Number.isSafeInteger(normalized) && normalized > 0
    ? normalized
    : null;
}

function getNextMeetingNumber(rows) {
  const largestMeetingNumber = rows.reduce((largest, row) => {
    const meetingNumber = parseMeetingNumber(row[0]);
    return meetingNumber === null ? largest : Math.max(largest, meetingNumber);
  }, 0);

  if (largestMeetingNumber === Number.MAX_SAFE_INTEGER) {
    throw new Error("Meeting ID đã đạt giới hạn số an toàn.");
  }

  return largestMeetingNumber + 1;
}

async function hideInternalMeetingIdColumn({
  spreadsheetId,
  sheetName,
  sheets,
}) {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title,gridProperties(columnCount)))",
  });
  const sheetProperties = spreadsheet.data.sheets
    ?.map((sheet) => sheet.properties)
    .find((properties) => properties?.title === sheetName);

  if (!sheetProperties || !Number.isInteger(sheetProperties.sheetId)) {
    throw new Error(`Không tìm thấy tab “${sheetName}” để cấu hình cột ID.`);
  }

  const requests = [];
  const columnCount = sheetProperties.gridProperties?.columnCount || 0;

  if (columnCount < MEETING_STORAGE_HEADERS.length) {
    requests.push({
      appendDimension: {
        sheetId: sheetProperties.sheetId,
        dimension: "COLUMNS",
        length: MEETING_STORAGE_HEADERS.length - columnCount,
      },
    });
  }

  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId: sheetProperties.sheetId,
        dimension: "COLUMNS",
        startIndex: MEETING_HEADERS.length,
        endIndex: MEETING_STORAGE_HEADERS.length,
      },
      properties: { hiddenByUser: true },
      fields: "hiddenByUser",
    },
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}

function migratePreviousCurrentRows(rows) {
  let meetingNumber = 1;

  return rows.map((row) => {
    if (!rowHasData(row)) {
      return [];
    }

    const [
      internalMeetingId = "",
      title = "",
      date = "",
      startedAt = "",
      endedAt = "",
      source = "",
      documentReference = "",
      calendarEventId = "",
      status = "",
    ] = row;
    const migratedRow = [
      meetingNumber,
      date,
      startedAt,
      endedAt,
      title,
      documentReference,
      source,
      calendarEventId,
      status,
      internalMeetingId,
    ];
    meetingNumber += 1;
    return migratedRow;
  });
}

function migratePreviousCompactRows(rows) {
  let meetingNumber = 1;

  return rows.map((row) => {
    if (!rowHasData(row)) {
      return [];
    }

    const [
      internalMeetingId = "",
      title = "",
      startedAt = "",
      endedAt = "",
      source = "",
      documentReference = "",
      calendarEventId = "",
      status = "",
      processedAt = "",
    ] = row;
    const migratedRow = [
      meetingNumber,
      formatVietnamDate(startedAt) ||
        formatVietnamDate(endedAt) ||
        formatVietnamDate(processedAt),
      formatVietnamTime(startedAt) || startedAt,
      formatVietnamTime(endedAt) || endedAt,
      title,
      documentReference,
      source,
      calendarEventId,
      status,
      internalMeetingId,
    ];
    meetingNumber += 1;
    return migratedRow;
  });
}

async function migrateToCurrentSheet({
  spreadsheetId,
  sheetName,
  quotedName,
  sheets,
  migrateRows,
}) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quotedName}!A2:I`,
  });
  const migratedRows = migrateRows(response.data.values || []);

  await hideInternalMeetingIdColumn({ spreadsheetId, sheetName, sheets });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${quotedName}!A1:J`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[...MEETING_STORAGE_HEADERS], ...migratedRows],
    },
  });
}

async function ensureMeetingSheet({
  auth,
  spreadsheetId,
  sheetName,
  sheets: injectedSheets,
}) {
  if (!spreadsheetId || !sheetName) {
    throw new Error("Thiếu SPREADSHEET_ID hoặc SHEET_NAME.");
  }

  const sheets = getSheetsClient(auth, injectedSheets);
  const quotedName = quoteSheetName(sheetName);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quotedName}!A1:K1`,
  });
  const currentHeaders = response.data.values?.[0] || [];

  if (currentHeaders.length === 0) {
    await hideInternalMeetingIdColumn({ spreadsheetId, sheetName, sheets });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${quotedName}!A1:J1`,
      valueInputOption: "RAW",
      requestBody: { values: [[...MEETING_STORAGE_HEADERS]] },
    });
    return SHEET_SCHEMA.CURRENT;
  }

  if (headersMatch(currentHeaders, MEETING_STORAGE_HEADERS)) {
    await hideInternalMeetingIdColumn({ spreadsheetId, sheetName, sheets });
    return SHEET_SCHEMA.CURRENT;
  }

  if (headersMatch(currentHeaders, MEETING_HEADERS)) {
    const rowsResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${quotedName}!A2:I`,
    });

    if ((rowsResponse.data.values || []).some(rowHasData)) {
      throw new Error(
        `Tab “${sheetName}” đã có dữ liệu nhưng thiếu ID nội bộ. Hãy dùng một tab trống để ứng dụng khởi tạo.`,
      );
    }

    await hideInternalMeetingIdColumn({ spreadsheetId, sheetName, sheets });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${quotedName}!J1`,
      valueInputOption: "RAW",
      requestBody: { values: [[INTERNAL_MEETING_ID_HEADER]] },
    });
    return SHEET_SCHEMA.CURRENT;
  }

  if (headersMatch(currentHeaders, PREVIOUS_CURRENT_HEADERS)) {
    await migrateToCurrentSheet({
      spreadsheetId,
      sheetName,
      quotedName,
      sheets,
      migrateRows: migratePreviousCurrentRows,
    });
    return SHEET_SCHEMA.CURRENT;
  }

  if (headersMatch(currentHeaders, PREVIOUS_COMPACT_HEADERS)) {
    await migrateToCurrentSheet({
      spreadsheetId,
      sheetName,
      quotedName,
      sheets,
      migrateRows: migratePreviousCompactRows,
    });
    return SHEET_SCHEMA.CURRENT;
  }

  const normalizedHeaders = currentHeaders.map((header, index) =>
    index === 7 && header === "Action Items"
      ? LEGACY_MEETING_HEADERS[index]
      : header,
  );
  const matchesLegacy = headersMatch(
    normalizedHeaders,
    LEGACY_MEETING_HEADERS,
  );

  if (!matchesLegacy) {
    throw new Error(
      `Tab “${sheetName}” đã có cấu trúc khác. Sheet mới cần đúng 9 tiêu đề A:I.`,
    );
  }

  if (currentHeaders[7] === "Action Items") {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${quotedName}!H1`,
      valueInputOption: "RAW",
      requestBody: { values: [[LEGACY_MEETING_HEADERS[7]]] },
    });
  }

  return SHEET_SCHEMA.LEGACY;
}

function createCurrentMeetingRow({
  meetingNumber,
  internalMeetingId,
  meeting,
  notes,
  documentReference,
  calendarEventId,
  status,
}) {
  return [
    meetingNumber,
    formatVietnamDate(meeting.startedAt || meeting.endedAt),
    formatVietnamTime(meeting.startedAt),
    formatVietnamTime(meeting.endedAt),
    resolveMeetingTitle(meeting, notes),
    documentReference || "",
    meeting.source || "",
    calendarEventId || "",
    status || "completed",
    internalMeetingId,
  ];
}

function createLegacyMeetingRow({
  meeting,
  notes,
  documentReference,
  calendarEventId,
  status,
}) {
  return [
    meeting.meetingId,
    resolveMeetingTitle(meeting, notes),
    formatVietnamTime(meeting.startedAt),
    formatVietnamTime(meeting.endedAt),
    meeting.source || "",
    documentReference || "",
    "",
    "",
    calendarEventId || "",
    status || "completed",
    "",
  ];
}

async function upsertMeetingRowUnlocked(options) {
  const {
    auth,
    sheetName,
    meeting,
    notes,
    documentReference,
    calendarEventId,
    status,
  } = options;

  const sheets = getSheetsClient(auth, options.sheets);
  const target = await resolveMeetingSpreadsheet({
    auth,
    spreadsheetId: options.spreadsheetId,
    spreadsheetTitle: options.spreadsheetTitle,
    sheetName,
    sheets,
    drive: options.drive,
  });
  const { spreadsheetId } = target;

  const sheetSchema = await ensureMeetingSheet({
    auth,
    spreadsheetId,
    sheetName,
    sheets,
  });

  const internalMeetingId = String(meeting.meetingId || "").trim();

  if (!internalMeetingId) {
    throw new Error("Thiếu Meeting ID nội bộ.");
  }

  const quotedName = quoteSheetName(sheetName);

  if (sheetSchema === SHEET_SCHEMA.LEGACY) {
    const idsResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${quotedName}!A2:A`,
    });
    const rows = idsResponse.data.values || [];
    const foundIndex = rows.findIndex((row) => row[0] === internalMeetingId);
    const rowNumber = foundIndex >= 0 ? foundIndex + 2 : null;
    const legacyRow = createLegacyMeetingRow({
      meeting,
      notes,
      documentReference,
      calendarEventId,
      status,
    });

    if (rowNumber) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${quotedName}!A${rowNumber}:F${rowNumber}`,
        valueInputOption: "RAW",
        requestBody: { values: [legacyRow.slice(0, 6)] },
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${quotedName}!I${rowNumber}:J${rowNumber}`,
        valueInputOption: "RAW",
        requestBody: { values: [legacyRow.slice(8, 10)] },
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${quotedName}!A:K`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [legacyRow] },
      });
    }

    return {
      action: rowNumber ? "updated" : "created",
      rowNumber,
      spreadsheetId,
      spreadsheetUrl: target.spreadsheetUrl,
    };
  }

  const rowsResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quotedName}!A2:J`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const rows = rowsResponse.data.values || [];
  const foundIndex = rows.findIndex(
    (row) => String(row[9] || "").trim() === internalMeetingId,
  );
  const rowNumber = foundIndex >= 0 ? foundIndex + 2 : null;
  const existingMeetingNumber =
    foundIndex >= 0 ? parseMeetingNumber(rows[foundIndex][0]) : null;
  const meetingNumber =
    existingMeetingNumber || getNextMeetingNumber(rows);
  const currentRow = createCurrentMeetingRow({
    meetingNumber,
    internalMeetingId,
    meeting,
    notes,
    documentReference,
    calendarEventId,
    status,
  });

  if (rowNumber) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${quotedName}!A${rowNumber}:J${rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [currentRow] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${quotedName}!A:J`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [currentRow] },
    });
  }

  return {
    action: rowNumber ? "updated" : "created",
    rowNumber,
    spreadsheetId,
    spreadsheetUrl: target.spreadsheetUrl,
  };
}

let meetingSheetWriteQueue = Promise.resolve();

function upsertMeetingRow(options) {
  const operation = meetingSheetWriteQueue
    .catch(() => {})
    .then(() => upsertMeetingRowUnlocked(options));
  meetingSheetWriteQueue = operation.catch(() => {});
  return operation;
}

module.exports = {
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
  formatVietnamDate,
  formatVietnamTime,
  getNextMeetingNumber,
  ensureMeetingSheet,
  resolveExistingMeetingSpreadsheetUrl,
  resolveMeetingSpreadsheet,
  upsertMeetingRow,
};
