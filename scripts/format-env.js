const fs = require("node:fs");
const path = require("node:path");

const envPath = path.join(__dirname, "..", ".env");
const source = fs.readFileSync(envPath, "utf8");
const entries = new Map();

for (const rawLine of source.split(/\r?\n/)) {
  const line = rawLine.trim();

  if (!line || line.startsWith("#")) {
    continue;
  }

  const separatorIndex = rawLine.indexOf("=");

  if (separatorIndex <= 0) {
    continue;
  }

  const key = rawLine.slice(0, separatorIndex).trim();
  const value = rawLine.slice(separatorIndex + 1);
  entries.set(key, value);
}

const groups = [
  {
    title: "AI - Gemini (nhà cung cấp đang được ứng dụng sử dụng)",
    keys: ["GEMINI_API_KEY", "GEMINI_LIVE_MODEL", "GEMINI_SUMMARY_MODEL"],
  },
  {
    title: "AI - OpenAI (không còn được ứng dụng sử dụng; chỉ giữ làm dự phòng)",
    keys: [
      "OPENAI_API_KEY",
      "OPENAI_REALTIME_MODEL",
      "OPENAI_TRANSCRIBE_MODEL",
      "OPENAI_SUMMARY_MODEL",
      "TRANSCRIPTION_DELAY",
    ],
  },
  {
    title: "Nhận dạng giọng nói",
    keys: [
      "TRANSCRIPTION_LANGUAGES",
      "TRANSCRIPTION_PROMPT",
    ],
  },
  {
    title: "Google - Xác thực",
    keys: [
      "GOOGLE_AUTH_MODE",
      "GOOGLE_SERVICE_ACCOUNT_PATH",
      "GOOGLE_OAUTH_CREDENTIALS_PATH",
      "GOOGLE_TOKEN_PATH",
    ],
  },
  {
    title: "Google Docs",
    keys: ["GOOGLE_DOCS_ENABLED", "GOOGLE_DRIVE_FOLDER_ID"],
  },
  {
    title: "Google Sheets",
    keys: ["SPREADSHEET_ID", "SHEET_NAME"],
  },
  {
    title: "Google Calendar",
    keys: ["CALENDAR_ID", "CALENDAR_TIME_ZONE"],
  },
  {
    title: "Lưu trữ cục bộ",
    keys: ["LOCAL_DOCS_DIR"],
  },
  {
    title: "Genspark v1 - Không còn được code v2 sử dụng",
    keys: ["GENSPARK_EMAIL", "GENSPARK_PASSWORD"],
  },
];

const output = [
  "# Meeting Assistant v2.1",
  "# Không commit file này vì chứa API key và thông tin xác thực.",
];

for (const group of groups) {
  const presentKeys = group.keys.filter((key) => entries.has(key));

  if (!presentKeys.length) {
    continue;
  }

  output.push("", `# -----------------------------------------------------------------------------`, `# ${group.title}`);

  for (const key of presentKeys) {
    output.push(`${key}=${entries.get(key)}`);
    entries.delete(key);
  }
}

if (entries.size) {
  output.push("", "# -----------------------------------------------------------------------------", "# Biến bổ sung");

  for (const [key, value] of entries) {
    output.push(`${key}=${value}`);
  }
}

fs.writeFileSync(envPath, `${output.join("\r\n")}\r\n`, "utf8");
console.log("Đã sắp xếp .env theo nhóm; không thay đổi giá trị.");
