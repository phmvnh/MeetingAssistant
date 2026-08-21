const test = require("node:test");
const assert = require("node:assert/strict");

const { createMeetingDocument } = require("../src/google/docs");

test("createMeetingDocument formats the title and section headings", async () => {
  let batchUpdateRequest;
  let createDocumentRequest;
  const googleApi = {
    docs: () => ({
      documents: {
        create: async (request) => {
          createDocumentRequest = request;
          return {
            data: { documentId: "doc-123" },
          };
        },
        batchUpdate: async (request) => {
          batchUpdateRequest = request;
          return { data: {} };
        },
      },
    }),
    drive: () => ({
      files: {
        create: async () => {
          throw new Error("Drive không được gọi khi tạo Docs trực tiếp.");
        },
      },
    }),
  };

  const result = await createMeetingDocument({
    auth: {},
    authMode: "oauth",
    meeting: {
      meetingId: "meeting-1",
      title: "Họp tuần",
      source: "room",
      startedAt: "2026-08-21T02:00:00.000Z",
      endedAt: "2026-08-21T03:00:00.000Z",
    },
    notes: {
      title: "Kế hoạch tháng 9",
      summary: "Tóm tắt cuộc họp.",
      keyPoints: ["Nội dung A"],
      decisions: ["Quyết định A"],
      actionItems: [],
      openQuestions: ["Câu hỏi A"],
    },
    transcript: [
      "Nội dung transcript.",
      "Quyết định",
      "Transcript",
    ].join("\n"),
    googleApi,
  });

  assert.equal(result.documentId, "doc-123");
  assert.equal(
    createDocumentRequest.requestBody.title,
    "Summary - Họp tuần",
  );
  const requests = batchUpdateRequest.requestBody.requests;
  const insertedText = requests[0].insertText.text;
  const styleRequests = requests
    .slice(1)
    .map((request) => request.updateTextStyle);

  assert.equal(styleRequests.length, 7);
  assert.deepEqual(styleRequests[0], {
    range: {
      startIndex: 1,
      endIndex: 1 + "Họp tuần".length,
    },
    textStyle: {
      bold: true,
      fontSize: {
        magnitude: 20,
        unit: "PT",
      },
    },
    fields: "bold,fontSize",
  });

  const headings = [
    "Tóm tắt",
    "Nội dung chính",
    "Quyết định",
    "Công việc cần thực hiện",
    "Vấn đề chưa giải quyết",
    "Transcript",
  ];

  headings.forEach((heading, index) => {
    const offset = insertedText.indexOf(`\n${heading}\n`) + 1;
    const style = styleRequests[index + 1];

    assert.ok(offset > 0, `Không tìm thấy tiêu đề "${heading}".`);
    assert.deepEqual(style.range, {
      startIndex: 1 + offset,
      endIndex: 1 + offset + heading.length,
    });
    assert.deepEqual(style.textStyle, {
      bold: true,
      fontSize: {
        magnitude: 14,
        unit: "PT",
      },
    });
    assert.equal(style.fields, "bold,fontSize");
  });
});
