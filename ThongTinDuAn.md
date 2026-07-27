# Genspark Automation — Hướng dẫn bàn giao

## 1. Tổng quan dự án

Tool tự động scrape dữ liệu meeting notes từ **Genspark.ai**, sau đó đồng bộ lên **Google Sheets** và **Google Calendar**.

**Luồng xử lý chính:**

```
Scrape Genspark → Ghi vào Google Sheets → Tạo sự kiện Google Calendar
```

## 2. Cấu trúc thư mục

```
.
├── .env                    # Biến môi trường (cần replace)
├── credentials.json        # Google Service Account key (cần replace)
├── login.js                # Login Genspark thủ công, lưu session
├── run.js                  # Script chạy chính: scrape + sync
├── session/
│   ├── cookies.json        # Session cookies Genspark (cần xoá, tạo lại)
│   └── localStorage.json   # LocalStorage Genspark (cần xoá, tạo lại)
├── src/
│   ├── config.js           # Config đọc từ .env
│   ├── scraper.js          # Dùng Puppeteer scrape Genspark
│   ├── calendar.js         # Google Calendar API
│   ├── sheets.js           # Google Sheets API
│   ├── mapper/
│   │   └── meetingMapper.js
│   └── sync/
│       ├── syncAll.js
│       ├── syncToCalendar.js
│       └── syncToSheet.js
└── test_*.js               # File test từng module
```

## 3. Các tài khoản / API đang dùng — cần thay thế

### 3.1 Genspark Account (file `.env`)

| Biến | Giá trị hiện tại | Mô tả |
|---|---|---|
| `GENSPARK_EMAIL` | `hao14042004@gmail.com` | Email đăng nhập Genspark — **cần tài khoản khác** |
| `GENSPARK_PASSWORD` | `Hoanghao1404@` | Mật khẩu Genspark — **cần đổi password ngay** |
| `SPREADSHEET_ID` | `1iodjFRf6VtOXX4OsciWh9s64WwcKHCUzMpz4YB0Cu1k` | Google Sheet ID — **tạo sheet mới, thay ID** |
| `SHEET_NAME` | `Trang tính2` | Tên sheet tab — có thể giữ hoặc đổi |
| `CALENDAR_ID` | `hao14042004@gmail.com` | Google Calendar ID — **dùng calendar khác** |

### 3.2 Google Service Account (file `credentials.json`)

Service account hiện tại:

- **Project ID:** `mimetic-wharf-478916-q1`
- **Client email:** `genspark-sync-bot@mimetic-wharf-478916-q1.iam.gserviceaccount.com`
- **Private key:** RSA key đầy đủ trong file

**Cần làm:** Tạo service account mới trên Google Cloud Console, tải key JSON về, thay thế file `credentials.json`. Cấp quyền cho service account vào Google Sheet và Google Calendar tương ứng.

### 3.3 Session Genspark (thư mục `session/`)

- `session/cookies.json` — session cookies của tài khoản `hao14042004@gmail.com`
- `session/localStorage.json` — localStorage data

**Cần làm:** Xoá 2 file này, chạy `node login.js` để đăng nhập tài khoản Genspark mới.

## 4. Các API / Service sử dụng

| Service | Scope / Endpoint | Mục đích |
|---|---|---|
| Genspark.ai | `https://www.genspark.ai/meetingnotes/home` | Scrape dữ liệu meeting |
| Google Calendar API | `https://www.googleapis.com/auth/calendar` | Tạo/find event |
| Google Sheets API | `https://www.googleapis.com/auth/spreadsheets` | Đọc/ghi dữ liệu |
| Google Cloud IAM | Service Account auth | Xác thực Google APIs |
| Microsoft Azure AD B2C | `gensparkad.onmicrosoft.com` | Identity provider của Genspark (login) |

## 5. Hướng dẫn chạy

### 5.1 Cài đặt

```bash
npm install
```

### 5.2 Thiết lập credentials

1. Tạo **Google Cloud Project** mới (hoặc dùng project khác)
2. Bật **Google Sheets API** và **Google Calendar API**
3. Tạo **Service Account**, tải file JSON key → lưu thành `credentials.json`
4. Share **Google Sheet** và **Google Calendar** với email của service account (role Editor)
5. Copy `.env.example` thành `.env` và điền thông tin mới

### 5.3 Login Genspark

```bash
node login.js
```

Sẽ mở trình duyệt, đăng nhập thủ công, sau đó tự lưu session.

### 5.4 Chạy đồng bộ

```bash
node run.js
```

## 6. File cần thay thế khi bàn giao

| File | Hành động | Ghi chú |
|---|---|---|
| `.env` | Tạo mới với thông tin người nhận | Email, password Genspark + Sheet ID + Calendar ID mới |
| `credentials.json` | Tạo service account mới, thay file | Project + key mới |
| `session/cookies.json` | Xoá, chạy `login.js` để tạo lại | Session cũ sẽ hết hạn |
| `session/localStorage.json` | Xoá, chạy `login.js` để tạo lại | |

## 7. Lưu ý bảo mật

- Tất cả file nhạy cảm (`.env`, `credentials.json`, `session/`) đã được thêm vào `.gitignore` — không thể commit lên git.
- **Password Genspark hiện tại nên đổi ngay** sau khi bàn giao xong.
- **Service account key** nên revoke trên Google Cloud Console sau khi chuyển giao.
- Nếu dùng chung máy, xoá `session/` để người khác không dùng được session cũ.

## 8. Kiến trúc chi tiết

### `src/scraper.js`
Dùng **Puppeteer** mở `https://www.genspark.ai/meetingnotes/home`, đợi API trả về danh sách meeting, parse dữ liệu JSON từ response. Dùng session đã lưu để không cần login lại.

### `src/sheets.js`
Dùng `googleapis` với service account để đọc dữ liệu hiện có (check duplicate theo `meetingId`), append dòng mới, cập nhật cột calendar sync status.

### `src/calendar.js`
Dùng `googleapis` để tạo event trên Google Calendar, gán `privateExtendedProperty` với `meetingId` để sau này lookup. Cũng có thể search event theo `meetingId` để "recover" (tránh tạo trùng).

### `src/sync/syncAll.js`
Điều phối luồng: `scrape → syncToSheet → syncToCalendar`.

### `src/mapper/meetingMapper.js`
Map dữ liệu thô từ Genspark sang format chuẩn để ghi vào Sheet.

## 9. Các tài khoản Genspark test

Hiện tại dùng tài khoản cá nhân `hao14042004@gmail.com`. Cần tạo tài khoản Genspark mới cho người nhận bàn giao, hoặc dùng tài khoản team riêng.
