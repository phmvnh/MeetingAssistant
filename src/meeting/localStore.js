const fs = require("node:fs/promises");
const path = require("node:path");

const { renderMeetingMarkdown, sanitizeFileName } = require("./formatDocument");
const { resolveMeetingTitle } = require("./meetingTitle");

async function saveMeetingLocally(options) {
  const { outputDirectory, meeting, notes, transcript } = options;

  if (!outputDirectory) {
    throw new Error("Thiếu thư mục lưu biên bản cục bộ.");
  }

  await fs.mkdir(outputDirectory, { recursive: true });

  const startedAt = new Date(meeting.startedAt || Date.now());
  const datePrefix = Number.isNaN(startedAt.getTime())
    ? new Date().toISOString().slice(0, 10)
    : startedAt.toISOString().slice(0, 10);
  const meetingSuffix = String(meeting.meetingId || "meeting").slice(0, 8);
  const baseName = sanitizeFileName(
    `${datePrefix} - ${resolveMeetingTitle(meeting, notes)} - ${meetingSuffix}`,
  );
  const markdownPath = path.join(outputDirectory, `${baseName}.md`);
  const jsonPath = path.join(outputDirectory, `${baseName}.json`);
  const markdown = renderMeetingMarkdown({ meeting, notes, transcript });
  const record = {
    meeting,
    notes,
    transcript,
    savedAt: new Date().toISOString(),
  };

  await fs.writeFile(markdownPath, markdown, "utf8");
  await fs.writeFile(jsonPath, JSON.stringify(record, null, 2), "utf8");

  return {
    markdownPath,
    jsonPath,
  };
}

module.exports = {
  saveMeetingLocally,
};
