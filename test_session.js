const puppeteer = require("puppeteer");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const cookiesPath = path.join(
    __dirname,
    "session",
    "cookies.json"
  );

  const localStoragePath = path.join(
    __dirname,
    "session",
    "localStorage.json"
  );

  if (!fs.existsSync(cookiesPath)) {
    throw new Error("Không tìm thấy session/cookies.json");
  }

  if (!fs.existsSync(localStoragePath)) {
    throw new Error("Không tìm thấy session/localStorage.json");
  }

  const cookies = JSON.parse(
    fs.readFileSync(cookiesPath, "utf8")
  );

  const localStorageData = JSON.parse(
    fs.readFileSync(localStoragePath, "utf8")
  );

  console.log(`Đang nạp ${cookies.length} cookies.`);
  console.log(
    `Đang nạp ${Object.keys(localStorageData).length} localStorage entries.`
  );

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
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

    await page.goto("https://www.genspark.ai/", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    await new Promise((resolve) => setTimeout(resolve, 5000));

    const currentUrl = page.url();

    console.log("URL hiện tại:", currentUrl);

    await page.screenshot({
      path: "test_session.png",
      fullPage: true,
    });

    console.log("Đã lưu ảnh test_session.png");

    const isLoginPage =
      currentUrl.includes("login.genspark.ai") ||
      currentUrl.includes("/login");

    if (isLoginPage) {
      throw new Error(
        "Session không hoạt động: Genspark đã chuyển về trang đăng nhập."
      );
    }

    console.log("Session hoạt động: không bị chuyển về trang đăng nhập.");

    // Giữ trình duyệt mở để kiểm tra bằng mắt
    await new Promise((resolve) => setTimeout(resolve, 30000));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("Lỗi:", error.message);
  process.exit(1);
});