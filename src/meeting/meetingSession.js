const { randomUUID } = require("node:crypto");

const STATES = Object.freeze({
  IDLE: "IDLE",
  CONNECTING: "CONNECTING",
  LISTENING: "LISTENING",
  PAUSED: "PAUSED",
  FINALIZING: "FINALIZING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
});

const TRANSITIONS = Object.freeze({
  [STATES.IDLE]: [STATES.CONNECTING],
  [STATES.CONNECTING]: [STATES.LISTENING, STATES.FAILED, STATES.CANCELLED],
  [STATES.LISTENING]: [STATES.PAUSED, STATES.FINALIZING, STATES.FAILED, STATES.CANCELLED],
  [STATES.PAUSED]: [STATES.LISTENING, STATES.FINALIZING, STATES.FAILED, STATES.CANCELLED],
  [STATES.FINALIZING]: [STATES.COMPLETED, STATES.FAILED],
  [STATES.COMPLETED]: [],
  [STATES.FAILED]: [],
  [STATES.CANCELLED]: [],
});

function normalizeMeetingId(value) {
  if (value === undefined || value === null || value === "") {
    return randomUUID();
  }

  const meetingId = String(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(meetingId)) {
    throw new Error("Meeting ID không hợp lệ.");
  }

  return meetingId;
}

class MeetingSession {
  constructor(metadata = {}) {
    if (!metadata.consentConfirmed) {
      throw new Error("Cần xác nhận người tham dự đã được thông báo về việc ghi âm.");
    }

    this.meetingId = normalizeMeetingId(metadata.meetingId);
    this.metadata = {
      title: metadata.title?.trim() || "",
      source: metadata.source || "room",
      createCalendarIfMissing: metadata.createCalendarIfMissing !== false,
      consentConfirmed: true,
    };
    this.state = STATES.IDLE;
    this.startedAt = null;
    this.endedAt = null;
  }

  transition(nextState) {
    const allowed = TRANSITIONS[this.state] || [];

    if (!allowed.includes(nextState)) {
      throw new Error(`Không thể chuyển trạng thái ${this.state} → ${nextState}.`);
    }

    this.state = nextState;

    if (nextState === STATES.LISTENING && !this.startedAt) {
      this.startedAt = new Date().toISOString();
    }

    if (nextState === STATES.FINALIZING && !this.endedAt) {
      this.endedAt = new Date().toISOString();
    }

    if ([STATES.COMPLETED, STATES.FAILED, STATES.CANCELLED].includes(nextState)) {
      this.endedAt ||= new Date().toISOString();
    }

    return this.state;
  }

  toJSON() {
    return {
      meetingId: this.meetingId,
      ...this.metadata,
      state: this.state,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
    };
  }
}

module.exports = {
  STATES,
  MeetingSession,
  normalizeMeetingId,
};
