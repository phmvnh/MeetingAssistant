const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveMeetingTitle,
  shortenGeneratedTitle,
} = require("../src/meeting/meetingTitle");

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

test("shortenGeneratedTitle keeps AI event titles compact", () => {
  const title = shortenGeneratedTitle("Một tiêu đề rất dài ".repeat(20));

  assert.ok(title.length <= 101);
  assert.match(title, /…$/);
});
