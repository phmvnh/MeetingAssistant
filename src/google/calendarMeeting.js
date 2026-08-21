const { resolveMeetingTitle } = require("../meeting/meetingTitle");

function normalizeTitle(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getEventTime(event, field) {
  const value = event[field]?.dateTime || event[field]?.date;
  const time = value ? new Date(value).getTime() : Number.NaN;

  return Number.isNaN(time) ? null : time;
}

function scoreCalendarEvent(event, meeting, expectedTitle) {
  const eventTitle = normalizeTitle(event.summary);
  const meetingTitle = normalizeTitle(expectedTitle || meeting.title);
  let score = 0;

  if (eventTitle && eventTitle === meetingTitle) {
    score += 100;
  } else if (
    eventTitle &&
    meetingTitle &&
    (eventTitle.includes(meetingTitle) || meetingTitle.includes(eventTitle))
  ) {
    score += 60;
  }

  const eventStart = getEventTime(event, "start");
  const meetingStart = new Date(meeting.startedAt).getTime();

  if (eventStart !== null && !Number.isNaN(meetingStart)) {
    const differenceMinutes = Math.abs(eventStart - meetingStart) / 60000;

    if (differenceMinutes <= 10) {
      score += 40;
    } else if (differenceMinutes <= 30) {
      score += 20;
    } else if (differenceMinutes <= 60) {
      score += 5;
    }
  }

  return score;
}

function buildAssistantDescription({ existingDescription, meeting, notes, documentUrl }) {
  const startMarker = "----- Startmarker -----";
  const endMarker = "----- Endmarker -----";
  const actionItems = (notes.actionItems || [])
    .map((item) => `- ${item.task}${item.owner ? ` — ${item.owner}` : ""}`)
    .join("\n");
  const block = [
    startMarker,
    documentUrl ? `Biên bản: ${documentUrl}` : "Biên bản đã được lưu cục bộ.",
    "",
    "Tóm tắt:",
    notes.summary || "Không có tóm tắt.",
    "",
    "Công việc:",
    actionItems || "Không có công việc được xác định.",
    endMarker,
  ].join("\n");
  const description = existingDescription || "";
  const markerStart = description.indexOf(startMarker);
  const markerEnd = description.indexOf(endMarker);

  if (markerStart >= 0 && markerEnd >= markerStart) {
    return [
      description.slice(0, markerStart).trimEnd(),
      block,
      description.slice(markerEnd + endMarker.length).trimStart(),
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return [description.trim(), block].filter(Boolean).join("\n\n");
}

async function findMatchingEvent({ calendar, calendarId, meeting, title }) {
  const start = new Date(meeting.startedAt);
  const end = new Date(meeting.endedAt || Date.now());
  const timeMin = new Date(start.getTime() - 60 * 60000).toISOString();
  const timeMax = new Date(end.getTime() + 60 * 60000).toISOString();
  const response = await calendar.events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 50,
  });
  const ranked = (response.data.items || [])
    .map((event) => ({
      event,
      score: scoreCalendarEvent(event, meeting, title),
    }))
    .sort((left, right) => right.score - left.score);

  return ranked[0]?.score >= 40 ? ranked[0].event : null;
}

async function syncMeetingCalendar(options) {
  const { google } = require("googleapis");
  const {
    auth,
    calendarId,
    timeZone,
    meeting,
    notes,
    documentUrl,
    createIfMissing,
  } = options;

  if (!calendarId) {
    throw new Error("Thiếu CALENDAR_ID.");
  }

  const calendar = google.calendar({ version: "v3", auth });
  const title = resolveMeetingTitle(meeting, notes);
  const existingEvent = await findMatchingEvent({
    calendar,
    calendarId,
    meeting,
    title,
  });

  if (existingEvent) {
    const description = buildAssistantDescription({
      existingDescription: existingEvent.description,
      meeting,
      notes,
      documentUrl,
    });
    const response = await calendar.events.patch({
      calendarId,
      eventId: existingEvent.id,
      requestBody: {
        description,
        extendedProperties: {
          private: {
            ...(existingEvent.extendedProperties?.private || {}),
            meetingAssistantId: meeting.meetingId,
          },
        },
      },
    });

    return {
      action: "updated",
      eventId: response.data.id,
      htmlLink: response.data.htmlLink,
    };
  }

  if (!createIfMissing) {
    return {
      action: "skipped",
      eventId: "",
      htmlLink: "",
    };
  }

  const description = buildAssistantDescription({
    existingDescription: "",
    meeting,
    notes,
    documentUrl,
  });
  const response = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: title,
      description,
      start: {
        dateTime: meeting.startedAt,
        timeZone,
      },
      end: {
        dateTime: meeting.endedAt,
        timeZone,
      },
      extendedProperties: {
        private: {
          source: "meeting-assistant-desktop",
          meetingAssistantId: meeting.meetingId,
        },
      },
    },
  });

  return {
    action: "created",
    eventId: response.data.id,
    htmlLink: response.data.htmlLink,
  };
}

module.exports = {
  normalizeTitle,
  scoreCalendarEvent,
  buildAssistantDescription,
  syncMeetingCalendar,
};
