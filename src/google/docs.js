const { google } = require("googleapis");

const {
  renderMeetingMarkdown,
  renderMeetingPlainText,
} = require("../meeting/formatDocument");
const { resolveMeetingTitle } = require("../meeting/meetingTitle");

const GOOGLE_DOC_MIME_TYPE = "application/vnd.google-apps.document";
const DOCUMENT_START_INDEX = 1;
const DOCUMENT_TITLE_FONT_SIZE = 20;
const SECTION_HEADING_FONT_SIZE = 14;

function createTextStyleRequest(startIndex, text, fontSize) {
  return {
    updateTextStyle: {
      range: {
        startIndex,
        endIndex: startIndex + text.length,
      },
      textStyle: {
        bold: true,
        fontSize: {
          magnitude: fontSize,
          unit: "PT",
        },
      },
      fields: "bold,fontSize",
    },
  };
}

function toPlainTextLine(markdownLine) {
  return markdownLine
    .replace(/^#{1,6}\s+/, "")
    .replace(/\*\*/g, "");
}

function buildDocumentFormattingRequests(markdown) {
  const requests = [];
  const lines = markdown.split("\n");
  let offset = 0;

  lines.forEach((markdownLine) => {
    const plainTextLine = toPlainTextLine(markdownLine);

    if (plainTextLine) {
      const startIndex = DOCUMENT_START_INDEX + offset;

      if (/^#\s+/.test(markdownLine)) {
        requests.push(
          createTextStyleRequest(
            startIndex,
            plainTextLine,
            DOCUMENT_TITLE_FONT_SIZE,
          ),
        );
      } else if (/^##\s+/.test(markdownLine)) {
        requests.push(
          createTextStyleRequest(
            startIndex,
            plainTextLine,
            SECTION_HEADING_FONT_SIZE,
          ),
        );
      }
    }

    offset += plainTextLine.length + 1;
  });

  return requests;
}

async function createMeetingDocument(options) {
  const {
    auth,
    authMode,
    folderId,
    meeting,
    notes,
    transcript,
    googleApi = google,
  } = options;

  if (authMode === "service_account" && !folderId) {
    const error = new Error(
      "Service account cần GOOGLE_DRIVE_FOLDER_ID thuộc Shared Drive để tạo Google Docs.",
    );
    error.code = "SHARED_DRIVE_FOLDER_REQUIRED";
    throw error;
  }

  const docs = googleApi.docs({ version: "v1", auth });
  const drive = googleApi.drive({ version: "v3", auth });
  const documentTitle = `Summary - ${resolveMeetingTitle(meeting, notes)}`;
  let documentId;

  if (folderId) {
    const createdFile = await drive.files.create({
      supportsAllDrives: true,
      fields: "id,webViewLink",
      requestBody: {
        name: documentTitle,
        mimeType: GOOGLE_DOC_MIME_TYPE,
        parents: [folderId],
      },
    });
    documentId = createdFile.data.id;
  } else {
    const createdDocument = await docs.documents.create({
      requestBody: {
        title: documentTitle,
      },
    });
    documentId = createdDocument.data.documentId;
  }

  if (!documentId) {
    throw new Error("Google không trả về documentId.");
  }

  const documentInput = { meeting, notes, transcript };
  const markdown = renderMeetingMarkdown(documentInput);
  const text = renderMeetingPlainText(documentInput);
  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [
        {
          insertText: {
            location: { index: 1 },
            text,
          },
        },
        ...buildDocumentFormattingRequests(markdown),
      ],
    },
  });

  return {
    documentId,
    documentUrl: `https://docs.google.com/document/d/${documentId}/edit`,
  };
}

module.exports = {
  buildDocumentFormattingRequests,
  createMeetingDocument,
};
