const {
  scrapeMeetings,
} = require("../scraper");

const {
  syncToSheet,
} = require("./syncToSheet");

const {
  syncToCalendar,
} = require("./syncToCalendar");

async function syncAll() {
  const scrapeResult =
    await scrapeMeetings();

  if (
    !scrapeResult ||
    scrapeResult.status !== "success" ||
    !Array.isArray(scrapeResult.meetings)
  ) {
    throw new Error(
      "Scraper trả về dữ liệu không hợp lệ."
    );
  }

  const sheetResult =
    await syncToSheet(
      scrapeResult.meetings
    );

  const calendarResult =
    await syncToCalendar();

  return {
    scrape: {
      total:
        scrapeResult.meetings.length,
      scrapedAt:
        scrapeResult.scrapedAt,
    },

    sheet: sheetResult,

    calendar: calendarResult,
  };
}

module.exports = {
  syncAll,
};