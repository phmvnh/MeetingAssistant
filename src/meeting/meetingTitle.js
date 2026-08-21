function normalizeTitle(value) {
  return typeof value === "string" ? value.trim() : "";
}

function resolveMeetingTitle(meeting = {}, notes = {}) {
  return (
    normalizeTitle(meeting.title) ||
    normalizeTitle(notes.title) ||
    "Biên bản cuộc họp"
  );
}

module.exports = {
  resolveMeetingTitle,
};
