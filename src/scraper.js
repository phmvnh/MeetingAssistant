const puppeteer = require("puppeteer");
const fs = require("node:fs");
const path = require("node:path");

async function scrapeMeetings(existingMeetingIds = new Set(), options = {}) {
  if (!(existingMeetingIds instanceof Set)) {
    throw new Error("existingMeetingIds phải là một Set.");
  }

  const maxMeetingsPerRun = options.maxMeetingsPerRun ?? 20;

  if (!Number.isInteger(maxMeetingsPerRun) || maxMeetingsPerRun < 1) {
    throw new Error("maxMeetingsPerRun phải là số nguyên lớn hơn 0.");
  }

  const cookiesPath = path.join(__dirname, "..", "session", "cookies.json");

  const localStoragePath = path.join(
    __dirname,
    "..",
    "session",
    "localStorage.json",
  );

  if (!fs.existsSync(cookiesPath)) {
    throw new Error("Không tìm thấy session/cookies.json");
  }

  if (!fs.existsSync(localStoragePath)) {
    throw new Error("Không tìm thấy session/localStorage.json");
  }

  const cookies = JSON.parse(fs.readFileSync(cookiesPath, "utf8"));

  const localStorageData = JSON.parse(
    fs.readFileSync(localStoragePath, "utf8"),
  );

  console.log(`Đang nạp ${cookies.length} cookies.`);
  console.log(
    `Đang nạp ${Object.keys(localStorageData).length} localStorage entries.`,
  );

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ["--start-maximized"],
  });

  try {
    const page = await browser.newPage();

    // Khôi phục localStorage trước khi mã JavaScript của Genspark chạy
    await page.evaluateOnNewDocument((storage) => {
      for (const [key, value] of Object.entries(storage)) {
        if (value !== null) {
          localStorage.setItem(key, value);
        }
      }
    }, localStorageData);

    // Khôi phục cookie vào browser
    await browser.setCookie(...cookies);

    await page.goto("https://www.genspark.ai/meetingnotes/home", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Reload một lần để Genspark ổn định trạng thái giao diện
    await page.reload({
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    await new Promise((resolve) => setTimeout(resolve, 3000));

    const meetings = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("article.note-row"));

      return rows.map((row) => {
        const meetingId = row.getAttribute("data-note-row-id")?.trim() || null;

        const title =
          row
            .querySelector("h3.row-title")
            ?.textContent?.replace(/\s+/g, " ")
            .trim() || null;

        const displayedTime =
          row
            .querySelector(".row-time-group")
            ?.textContent?.replace(/\s+/g, " ")
            .trim() || null;

        const section = row.closest("section");

        const dateLabel =
          section
            ?.querySelector(".bucket-label")
            ?.textContent?.replace(/\s+/g, " ")
            .trim() || null;

        return {
          meetingId,
          title,
          displayedTime,
          dateLabel,
        };
      });
    });
    console.log(`Đã tìm thấy ${meetings.length} meeting:`);

    meetings.forEach((meeting, index) => {
      console.log(`\n${index + 1}. ${meeting.title}`);
      console.log(`Meeting ID: ${meeting.meetingId}`);
      console.log(`Ngày hiển thị: ${meeting.dateLabel}`);
      console.log(`Giờ hiển thị: ${meeting.displayedTime}`);
    });

    if (meetings.length === 0) {
      throw new Error(
        [
          "Scraper không tìm thấy meeting nào.",
          "Có thể session đã hết hạn, trang Genspark chưa tải đúng,",
          "hoặc selector article.note-row đã thay đổi.",
        ].join(" "),
      );
    }

    const meetingResults = [];
    let stopReason = "completed";
    let inspectedCount = 0;
    for (const meeting of meetings) {
      const meetingId = meeting.meetingId?.trim();

      if (!meetingId) {
        console.warn("Bỏ qua meeting không có meetingId.");

        continue;
      }

      inspectedCount += 1;

      if (existingMeetingIds.has(meetingId)) {
        console.log(`Đã gặp meeting cũ: ${meetingId}. Dừng scrape.`);

        stopReason = "existing-meeting-reached";

        break;
      }

      if (meetingResults.length >= maxMeetingsPerRun) {
        console.warn(
          `Đã đạt giới hạn ${maxMeetingsPerRun} meeting mới mỗi lần chạy.`,
        );

        stopReason = "max-limit-reached";

        break;
      }

      console.log(`\nĐang mở: ${meeting.title}`);

      const rowSelector = `article.note-row[data-note-row-id="${meetingId}"]`;

      const row = await page.$(rowSelector);

      if (!row) {
        console.log(`Không tìm thấy row của meeting: ${meeting.meetingId}`);
        continue;
      }

      await row.evaluate((element) => {
        element.scrollIntoView({
          behavior: "instant",
          block: "center",
        });
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      const box = await row.boundingBox();

      if (!box) {
        console.log(`Không lấy được vị trí meeting: ${meeting.meetingId}`);
        continue;
      }

      const newPagePromise = new Promise((resolve, reject) => {
        const handler = async (target) => {
          try {
            const newPage = await target.page();

            if (!newPage) {
              return;
            }

            clearTimeout(timeout);
            browser.off("targetcreated", handler);
            resolve(newPage);
          } catch (error) {
            clearTimeout(timeout);
            browser.off("targetcreated", handler);
            reject(error);
          }
        };

        const timeout = setTimeout(() => {
          browser.off("targetcreated", handler);

          reject(new Error("Không thấy tab chi tiết được mở."));
        }, 30000);

        browser.on("targetcreated", handler);
      });

      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

      const detailPage = await newPagePromise;

      try {
        await detailPage.bringToFront();

        await new Promise((resolve) => setTimeout(resolve, 3000));

        const meetingNotesOpened = await detailPage.evaluate(() => {
          return Boolean(
            document.querySelector(".meeting-date") ||
            document.querySelector("textarea.meeting-title"),
          );
        });

        if (!meetingNotesOpened) {
          await detailPage.evaluate(() => {
            const elements = Array.from(
              document.querySelectorAll("button, article, div, span, p"),
            );

            const target = elements.find((element) => {
              const text = element.textContent?.replace(/\s+/g, " ").trim();

              return (
                text === "Meeting Notes Click to open" ||
                text === "Meeting Notes"
              );
            });

            target?.click();
          });
        }

        await detailPage.waitForSelector(
          "textarea.meeting-title, .meeting-date",
          {
            timeout: 30000,
          },
        );

        const detail = await detailPage.evaluate(() => {
          const normalize = (value) =>
            value?.replace(/\s+/g, " ").trim() || null;

          const titleElement =
            document.querySelector("textarea.meeting-title") ||
            document.querySelector("textarea");

          const dateElement =
            document.querySelector(".meeting-date") ||
            document.querySelector("[class*='meeting-date']");

          return {
            title:
              normalize(titleElement?.value) ||
              normalize(titleElement?.textContent),

            meetingDate: normalize(dateElement?.textContent),

            meetingUrl: window.location.href,
          };
        });

        meetingResults.push({
          meetingId,
          title: detail.title || meeting.title,
          meetingDate: detail.meetingDate,
          meetingUrl: detail.meetingUrl,
        });

        console.log("Đã lấy:", meetingResults.at(-1));
      } finally {
        if (!detailPage.isClosed()) {
          await detailPage.close();
        }

        await page.bringToFront();
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log("\nToàn bộ meeting:");
    console.log(JSON.stringify(meetingResults, null, 2));

    await new Promise((resolve) => setTimeout(resolve, 3000));

    await new Promise((resolve) => setTimeout(resolve, 5000));

    const currentUrl = page.url();

    console.log("URL hiện tại:", currentUrl);

    await page.screenshot({
      path: "meeting_home.png",
      fullPage: true,
    });

    console.log("Đã lưu ảnh meeting_home.png");

    const isLoginPage =
      currentUrl.includes("login.genspark.ai") || currentUrl.includes("/login");

    if (isLoginPage) {
      throw new Error(
        "Session không hoạt động: Genspark đã chuyển về trang đăng nhập.",
      );
    }

    console.log("Session hoạt động: không bị chuyển về trang đăng nhập.");

    // Giữ trình duyệt mở để kiểm tra bằng mắt
    return {
      status: "success",
      meetings: meetingResults,
      inspectedCount,
      stopReason,
      scrapedAt: new Date().toISOString(),
    };
  } finally {
    await browser.close();
  }
}
module.exports = {
  scrapeMeetings,
};
