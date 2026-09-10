const test = require("node:test");
const assert = require("node:assert/strict");

const { MeetingSession, STATES } = require("../src/meeting/meetingSession");

test("MeetingSession requires recording consent", () => {
  assert.throws(
    () => new MeetingSession({ title: "Test" }),
    /xác nhận người tham dự/i,
  );
});

test("MeetingSession follows the happy-path state machine", () => {
  const session = new MeetingSession({
    title: "  Sprint planning  ",
    source: "meet",
    consentConfirmed: true,
  });

  assert.equal(session.state, STATES.IDLE);
  session.transition(STATES.CONNECTING);
  session.transition(STATES.LISTENING);
  assert.ok(session.startedAt);
  session.transition(STATES.PAUSED);
  session.transition(STATES.LISTENING);
  session.transition(STATES.FINALIZING);
  assert.ok(session.endedAt);
  session.transition(STATES.COMPLETED);
  assert.equal(session.metadata.title, "Sprint planning");
});

test("MeetingSession keeps an empty title for AI generation", () => {
  const session = new MeetingSession({ consentConfirmed: true });

  assert.equal(session.metadata.title, "");
});

test("MeetingSession rejects invalid transitions", () => {
  const session = new MeetingSession({ consentConfirmed: true });
  assert.throws(() => session.transition(STATES.COMPLETED), /Không thể chuyển/);
});

test("MeetingSession rejects a meeting ID containing a path", () => {
  assert.throws(
    () =>
      new MeetingSession({
        consentConfirmed: true,
        meetingId: "..\\outside",
      }),
    /Meeting ID không hợp lệ/i,
  );
});
