const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveMeetingTitle } = require("../src/meeting/meetingTitle");

test("resolveMeetingTitle always prefers the user-entered meeting title", () => {
  assert.equal(
    resolveMeetingTitle(
      { title: "  Tết  " },
      { title: "Tết - Tiêu đề dài do AI tạo" },
    ),
    "Tết",
  );
});

test("resolveMeetingTitle falls back safely when the meeting title is missing", () => {
  assert.equal(
    resolveMeetingTitle({}, { title: "Tiêu đề tóm tắt" }),
    "Tiêu đề tóm tắt",
  );
  assert.equal(resolveMeetingTitle(), "Biên bản cuộc họp");
});
