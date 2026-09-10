function normalizeTitle(value) {
  return typeof value === "string" ? value.trim() : "";
}

function shortenGeneratedTitle(value) {
  const title = normalizeTitle(value);

  if (title.length <= 100) {
    return title;
  }

  const shortened = title.slice(0, 100).replace(/\s+\S*$/, "").trim();
  return `${shortened || title.slice(0, 100).trim()}…`;
}

function resolveMeetingTitle(meeting = {}, notes = {}) {
  return (
    normalizeTitle(meeting.title) ||
    shortenGeneratedTitle(notes.title) ||
    "Biên bản cuộc họp"
  );
}

module.exports = {
  shortenGeneratedTitle,
  resolveMeetingTitle,
};
