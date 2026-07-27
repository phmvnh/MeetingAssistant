require("dotenv").config();

const puppeteer = require("puppeteer");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const email = process.env.GENSPARK_EMAIL;
  const password = process.env.GENSPARK_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "Thiếu GENSPARK_EMAIL hoặc GENSPARK_PASSWORD trong file .env"
    );
  }

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
  });

  try {
    const page = await browser.newPage();

    await page.goto("https://login.genspark.ai", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    await page
      .locator("::-p-text(Login with email)")
      .click({ timeout: 30000 });

    const emailSelector =
      'input[type="email"], input[placeholder*="Email"]';

    const passwordSelector =
      'input[type="password"], input[placeholder*="Password"]';

    await page.waitForSelector(emailSelector, {
      visible: true,
      timeout: 30000,
    });

    await page.waitForSelector(passwordSelector, {
      visible: true,
      timeout: 30000,
    });

    await page.type(emailSelector, email, {
      delay: 40,
    });

    await page.type(passwordSelector, password, {
      delay: 40,
    });

    console.log("Đã điền email và mật khẩu.");

    const buttonInfo = await page.evaluate(() => {
      return [...document.querySelectorAll("button")].map((button, index) => ({
        index,
        text: button.innerText.trim(),
        type: button.getAttribute("type"),
        disabled: button.disabled,
      }));
    });

    console.log("Các button tìm thấy:", buttonInfo);

    const clicked = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("button")];

      const target = buttons.find(
        (button) =>
          button.innerText.trim().toLowerCase() === "sign in" &&
          !button.disabled
      );

      if (!target) {
        return false;
      }

      target.scrollIntoView({
        block: "center",
      });

      target.click();
      return true;
    });

    if (!clicked) {
      throw new Error('Không tìm thấy nút "Sign in" có thể bấm.');
    }

    console.log("Đã bấm Sign in.");

    await Promise.race([
      page.waitForFunction(
        () => !location.hostname.startsWith("login."),
        { timeout: 60000 }
      ),

      page.waitForNavigation({
        waitUntil: "domcontentloaded",
        timeout: 60000,
      }),
    ]).catch(() => {
      // Có thể ứng dụng chuyển trạng thái mà không tạo navigation truyền thống.
    });

    await new Promise((resolve) => setTimeout(resolve, 5000));

    console.log("URL sau khi bấm:", page.url());

    const errorMessage = await page.evaluate(() => {
      const text = document.body.innerText;

      const lines = text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      return lines.find((line) =>
        /incorrect|invalid|failed|error|wrong password/i.test(line)
      );
    });

    if (errorMessage) {
      throw new Error(`Genspark báo lỗi: ${errorMessage}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 30000));
    if (errorMessage) {
  throw new Error(`Genspark báo lỗi: ${errorMessage}`);
}

console.log("URL sau khi đăng nhập:", page.url());

const sessionDir = path.join(__dirname, "session");

fs.mkdirSync(sessionDir, {
  recursive: true,
});

// Lưu cookie
const cookies = await browser.cookies();

fs.writeFileSync(
  path.join(sessionDir, "cookies.json"),
  JSON.stringify(cookies, null, 2),
  "utf8"
);

// Lưu localStorage của origin hiện tại
const localStorageData = await page.evaluate(() => {
  const data = {};

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);

    if (key !== null) {
      data[key] = localStorage.getItem(key);
    }
  }

  return data;
});

fs.writeFileSync(
  path.join(sessionDir, "localStorage.json"),
  JSON.stringify(localStorageData, null, 2),
  "utf8"
);

console.log(`Đã lưu ${cookies.length} cookies.`);
console.log(
  `Đã lưu ${Object.keys(localStorageData).length} localStorage entries.`
);
  } finally {
    await browser.close();
  }
}


main().catch((error) => {
  console.error("Lỗi:", error);
  process.exit(1);
});