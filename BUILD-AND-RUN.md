# Hướng dẫn Meeting Assistant Desktop v2.1

Phiên bản 2.0 không còn phụ thuộc Genspark. Ứng dụng nghe âm thanh trực tiếp từ microphone và, trên Windows, có thể nghe thêm âm thanh hệ thống khi họp Google Meet hoặc Microsoft Teams.

```text
Start
  → microphone + system audio tùy chọn
  → Speech-to-Text thời gian thực
  → transcript trực tiếp
  → Done
  → tóm tắt + quyết định + công việc cần thực hiện
  → Markdown/JSON cục bộ
  → Google Docs + Sheets + Calendar
```

Ứng dụng không quay, xử lý hoặc lưu video. Không có file audio toàn cuộc họp được tạo; chỉ có buffer âm thanh PCM 16 kHz ngắn được truyền đến Gemini Live để nhận dạng.

## 1. Tính năng đã triển khai

- Ứng dụng desktop Electron dành cho Windows.
- Nút Start, Pause/Resume, Done và Cancel.
- Chọn microphone.
- Thu microphone phòng họp.
- Thu microphone và Windows system-audio loopback cho Meet/Teams.
- Transcript hiển thị theo thời gian thực.
- Server VAD tự nhận biết lúc bắt đầu/kết thúc lượt nói.
- Khi bấm Done, tạo tóm tắt, nội dung chính, quyết định, công việc cần thực hiện và câu hỏi chưa giải quyết.
- Luôn lưu `.md` và `.json` cục bộ để phục hồi nếu Google hoặc bước tóm tắt lỗi; khi đó tài liệu vẫn chứa transcript và cảnh báo rõ ràng.
- Tạo Google Docs khi cơ chế xác thực cho phép.
- Đăng nhập OAuth bằng tài khoản Google người dùng chọn; hiển thị email, hỗ trợ đổi tài khoản, ngắt kết nối và kết nối lại khi token hết hạn.
- Tìm event Calendar gần thời gian/tiêu đề cuộc họp; cập nhật event đó hoặc tạo mới.
- Ghi một dòng chỉ mục vào Google Sheets và chống trùng bằng ID nội bộ; ở chế độ OAuth có thể tự tạo/tái sử dụng Sheet riêng của tài khoản.
- API key Gemini chỉ nằm ở Electron main process, không được đưa vào renderer/UI.

Gemini Live API nhận raw PCM 16-bit, 16 kHz qua WebSocket và trả input transcription theo thời gian thực: <https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket>.

## 2. Điều kiện chạy

- Windows 10/11 có microphone.
- Node.js từ 22.12 trở lên; máy đang phát triển dùng Node.js 24.
- Gemini API key có quyền dùng Live API và model tóm tắt đã cấu hình.
- Internet truy cập được Gemini và Google Workspace APIs.
- Người tham dự đã được thông báo và đồng ý việc chuyển lời nói thành văn bản.

## 3. Cài dependency

Mở PowerShell tại thư mục dự án:

```powershell
Set-Location "C:\Users\phamv\OneDrive\Máy tính\repo github\genspark\Meeting Assistant v2"
npm install
```

Kiểm tra:

```powershell
npm run check
npm test
```

Kết quả hiện tại phải có 42 test PASS và syntax check PASS.

## 4. Cấu hình Gemini

Tạo Gemini API key tại <https://aistudio.google.com/app/apikey>.

Thêm vào `.env`:

```dotenv
GEMINI_API_KEY="api-key-gemini-cua-ban"
GEMINI_LIVE_MODEL="gemini-3.1-flash-live-preview"
GEMINI_SUMMARY_MODEL="gemini-3.5-flash"
TRANSCRIPTION_LANGUAGES="vi,en"
TRANSCRIPTION_PROMPT="Cuộc họp công việc bằng tiếng Việt, có thể xen thuật ngữ tiếng Anh."
```

Không gửi API key qua chat và không commit `.env`. Model Live và model tóm tắt là hai model khác nhau; không dùng `gemini-3.5-flash` cho WebSocket Live.

Các biến `OPENAI_*` cũ không còn được ứng dụng v2.1 sử dụng. Có thể giữ làm dự phòng hoặc xóa khỏi `.env` sau khi Gemini chạy ổn định.

Hai biến cũ không còn được dùng và có thể xóa khỏi `.env`:

```dotenv
GENSPARK_EMAIL=
GENSPARK_PASSWORD=
```

`login.js`, `src/scraper.js`, `session/` và các test Genspark là mã v1, không nằm trong luồng `npm start`.

## 5. Chọn cách xác thực Google

Ứng dụng hỗ trợ hai chế độ. Với Gmail cá nhân và mong muốn có Google Docs, nên dùng OAuth.

### Phương án A — OAuth, khuyến nghị cho Gmail cá nhân

OAuth cho phép tài liệu được tạo trong Google Drive của chính tài khoản đang đăng nhập.

1. Trong Google Cloud project, bật:
   - Google Docs API
   - Google Drive API
   - Google Sheets API
   - Google Calendar API
2. Vào **Google Auth Platform** và cấu hình consent screen.
3. Tạo **OAuth Client ID → Desktop app**.
4. Tải JSON, đổi tên thành `oauth_credentials.json`, đặt cùng cấp `package.json`.
5. Cấu hình `.env`:

```dotenv
GOOGLE_AUTH_MODE="oauth"
GOOGLE_OAUTH_CREDENTIALS_PATH="oauth_credentials.json"
GOOGLE_TOKEN_PATH=".google-oauth-token.json"
```

6. Nếu ứng dụng phục vụ lâu dài, vào **Google Auth Platform → Audience** và chuyển từ **Testing** sang **In production**. Ở trạng thái Testing, quyền OAuth cho các scope Workspace hết hạn sau khoảng 7 ngày.
7. Chạy ứng dụng. Bấm **Đăng nhập Google** trên góc phải.
8. Trình duyệt mở trang Google; chọn tài khoản và cấp quyền.
9. Ứng dụng hiển thị email đang kết nối. Có thể dùng **Đổi tài khoản** hoặc **Ngắt kết nối** mà không phải xóa token thủ công.
10. Token được lưu cục bộ trong `.google-oauth-token.json` và đã được `.gitignore` bảo vệ.

Ở chế độ OAuth, Sheet và Calendar phải thuộc hoặc được chia sẻ cho tài khoản Google bạn đăng nhập.

### Phương án B — service account

Phù hợp khi dùng Google Workspace/Shared Drive hoặc chỉ cần Sheets/Calendar.

```dotenv
GOOGLE_AUTH_MODE="service_account"
GOOGLE_SERVICE_ACCOUNT_PATH="credentials.json"
```

- Share Spreadsheet cho `client_email` trong `credentials.json` với quyền Editor.
- Share Calendar cho `client_email` với quyền **Make changes to events**.
- Service account không có Drive storage riêng. Muốn tạo Google Docs, cần một thư mục trong Shared Drive và cấu hình:

```dotenv
GOOGLE_DOCS_ENABLED="true"
GOOGLE_DRIVE_FOLDER_ID="id-thu-muc-trong-shared-drive"
```

Nếu không có Shared Drive, ứng dụng vẫn tạo biên bản Markdown/JSON cục bộ và tiếp tục thử Sheets/Calendar.

## 6. Cấu hình Google Sheets

Với OAuth, có thể để `SPREADSHEET_ID` trống. Ứng dụng sẽ tìm hoặc tạo một Spreadsheet riêng tên `Meeting Log` trong tài khoản đang đăng nhập, tạo tab `meeting_assistant` và các tiêu đề cần thiết.

Nếu muốn ghi vào một Spreadsheet có sẵn, cấu hình ID của file và tạo trước tab `meeting_assistant`. Nếu tab trống, ứng dụng tự tạo 9 tiêu đề:

| Cột | Nội dung |
|---|---|
| A | Meeting ID |
| B | Date |
| C | Started At |
| D | Ended At |
| E | Title |
| F | Document |
| G | Source |
| H | Calendar Event ID |
| I | Status |

`Meeting ID` là số thứ tự tự tăng, bắt đầu từ `1` khi Sheet chưa có dữ liệu và lấy số lớn nhất hiện có cộng `1` cho cuộc họp mới. `Date` có định dạng `DD/MM/YYYY`. `Started At` và `Ended At` chỉ chứa giờ `HH:mm`, luôn được chuyển sang múi giờ Việt Nam `Asia/Ho_Chi_Minh`. Sheet không còn cột `Processed At`.

Ứng dụng giữ UUID thật của cuộc họp trong một cột kỹ thuật được ẩn để chống ghi trùng khi đồng bộ lại. Chín cột A:I ở trên là các cột hiển thị cho người dùng.

Cấu hình:

```dotenv
SPREADSHEET_ID=""
GOOGLE_SPREADSHEET_TITLE="Meeting Log"
SHEET_NAME="meeting_assistant"
```

Tab 9 cột do phiên bản trước tạo sẽ được tự động sắp xếp lại theo schema trên ở lần đồng bộ kế tiếp; các dòng hiện có được đánh số `1, 2, 3...` theo thứ tự. Riêng schema 11 cột rất cũ vẫn được giữ nguyên để tránh làm mất nội dung Summary và công việc đã lưu.

## 7. Cấu hình Google Calendar

Với OAuth, dùng `primary` để luôn ghi vào Calendar chính của tài khoản đang đăng nhập:

```dotenv
CALENDAR_ID="primary"
CALENDAR_TIME_ZONE="Asia/Ho_Chi_Minh"
```

Trong chế độ OAuth, ứng dụng luôn dùng Calendar `primary` của tài khoản vừa chọn. `CALENDAR_ID` dạng email chỉ còn cần cho chế độ service account.

Khi Done:

1. Ứng dụng tìm event trong khoảng một giờ trước/sau cuộc họp.
2. So khớp tiêu đề và thời gian.
3. Nếu tìm thấy, thêm link biên bản, tóm tắt và công việc cần thực hiện vào description.
4. Nếu không tìm thấy và tùy chọn **Tạo event nếu chưa có** đang bật, tạo event mới.

## 8. File `.env` mẫu hoàn chỉnh

```dotenv
GEMINI_API_KEY="api-key-gemini-cua-ban"
GEMINI_LIVE_MODEL="gemini-3.1-flash-live-preview"
GEMINI_SUMMARY_MODEL="gemini-3.5-flash"
TRANSCRIPTION_LANGUAGES="vi,en"
TRANSCRIPTION_PROMPT="Cuộc họp công việc bằng tiếng Việt, có thể xen thuật ngữ tiếng Anh."

GOOGLE_AUTH_MODE="oauth"
GOOGLE_OAUTH_CREDENTIALS_PATH="oauth_credentials.json"
GOOGLE_TOKEN_PATH=".google-oauth-token.json"

SPREADSHEET_ID=""
GOOGLE_SPREADSHEET_TITLE="Meeting Log"
SHEET_NAME="meeting_assistant"
CALENDAR_ID="primary"
CALENDAR_TIME_ZONE="Asia/Ho_Chi_Minh"

GOOGLE_DOCS_ENABLED="true"
GOOGLE_DRIVE_FOLDER_ID=""
LOCAL_DOCS_DIR=""
```

Không chép nguyên placeholder. Phải thay bằng dữ liệu của bạn.

## 9. Chạy ứng dụng

```powershell
npm start
```

Trong giao diện:

1. Kiểm tra badge **Gemini đã cấu hình**.
2. Nếu dùng OAuth, bấm **Đăng nhập Google** và kiểm tra đúng email hiển thị. Dùng **Đổi tài khoản** khi muốn đồng bộ sang tài khoản khác.
3. Nhập tên cuộc họp.
4. Chọn `Phòng họp`, `Google Meet` hoặc `Microsoft Teams`.
5. Chọn microphone.
6. Với Meet/Teams, bật **Nghe cả âm thanh máy tính**.
7. Có thể nhập từ khóa chuyên ngành để tăng độ chính xác.
8. Xác nhận đã thông báo và có sự đồng ý.
9. Bấm **Bắt đầu lắng nghe**.
10. Dùng **Tạm dừng/Tiếp tục** khi cần.
11. Bấm **Done · Tạo biên bản** khi họp xong.
12. Chờ ứng dụng chốt transcript, tạo tóm tắt và đồng bộ.
13. Mở bản cục bộ, Google Docs, Google Sheet hoặc Calendar từ panel kết quả.

## 10. Bản cục bộ được lưu ở đâu

Mặc định:

```text
Documents\Meeting Assistant\
```

Mỗi cuộc họp có:

```text
YYYY-MM-DD - Tên cuộc họp - 8-ký-tự-meeting-id.md
YYYY-MM-DD - Tên cuộc họp - 8-ký-tự-meeting-id.json
```

Hậu tố Meeting ID tránh ghi đè khi có nhiều cuộc họp trùng ngày và trùng tên. File JSON chứa transcript và dữ liệu có cấu trúc. Có thể đổi thư mục bằng `LOCAL_DOCS_DIR`.

## 11. Xử lý lỗi

### Badge báo thiếu Gemini key

Thêm `GEMINI_API_KEY` thật vào `.env`, đóng rồi mở lại ứng dụng.

### Gemini báo `invalid authentication credentials`

API key hiện tại không còn hợp lệ, thường do key thuộc Google Cloud project đã bị xóa hoặc key đã bị thu hồi. Mỗi Gemini API key gắn với một Google Cloud project.

1. Mở <https://aistudio.google.com/app/apikey>.
2. Chọn hoặc import Google Cloud project mới còn hoạt động.
3. Tạo API key mới trong AI Studio.
4. Thay giá trị `GEMINI_API_KEY` trong `.env`; không gửi key qua chat.
5. Đóng hoàn toàn ứng dụng rồi chạy lại `npm start`.

### Không thấy microphone hoặc không có chữ

- Cho phép quyền microphone trong Windows Settings → Privacy & security → Microphone.
- Chọn đúng microphone trong ứng dụng.
- Quan sát thanh mức âm thanh; nếu luôn 0%, Windows chưa cung cấp tín hiệu.
- Kiểm tra quota Gemini API và quyền truy cập model Live.

### Meet/Teams chỉ nhận giọng của bạn

Bật **Nghe cả âm thanh máy tính**. Tính năng loopback hiện được Electron hỗ trợ trên Windows. Kiểm tra Meet/Teams đang phát qua thiết bị âm thanh mặc định.

### Google Docs báo cần Shared Drive

Bạn đang dùng service account. Chuyển sang `GOOGLE_AUTH_MODE=oauth` với Gmail cá nhân, hoặc cung cấp folder ID thuộc Shared Drive.

### Google Sheet báo cấu trúc khác

Tạo một tab trống mới tên `meeting_assistant`, sau đó sửa `SHEET_NAME`. Không xóa tab/dữ liệu v1 nếu còn cần.

### Calendar 404/Not Found

Với OAuth, ứng dụng tự dùng Calendar `primary` của tài khoản đăng nhập. Với service account, cấu hình Calendar ID đầy đủ và nhớ share Calendar cho `client_email`.

### Google báo `invalid_grant` hoặc cần đăng nhập lại

Refresh token đã hết hạn hoặc bị thu hồi. Ứng dụng sẽ đánh dấu kết nối hết hạn và hiện nút **Đăng nhập lại**; không cần xóa token thủ công. Nếu OAuth consent screen vẫn ở trạng thái **Testing**, lỗi có thể lặp lại sau khoảng 7 ngày. Chuyển ứng dụng sang **In production** hoặc dùng **Internal** trong cùng Google Workspace nếu phù hợp.

### Lỡ đóng tab chọn tài khoản Google

Quay lại ứng dụng và bấm **Mở lại đăng nhập Google** hoặc **Mở lại trang chọn tài khoản**. Lần bấm mới tự hủy phiên đang chờ và mở một phiên đăng nhập mới; không cần khởi động lại ứng dụng. Phiên không hoàn tất cũng tự hết thời gian chờ sau 5 phút.

### Done nhưng Google lỗi

Kiểm tra `Documents\Meeting Assistant`. Bản cục bộ được lưu trước bước Google và vẫn có thể mở từ giao diện nếu bước tóm tắt đã hoàn tất.

## 12. Giới hạn MVP

- Chưa nhận diện chính xác tên từng người nói; transcript đang chia theo lượt nói, không gắn danh tính.
- System audio loopback chỉ được hỗ trợ chính thức trên Windows trong cấu hình này.
- Thu toàn bộ âm thanh hệ thống, không chỉ riêng tab Meet/Teams.
- Chưa có installer `.exe`; chạy bằng `npm start`.
- Chưa có chế độ offline; audio được truyền tới Gemini Live.
- Ứng dụng tự kết nối lại tối đa ba lần và giữ tạm tối đa khoảng 5 giây audio trong lúc reconnect; mất mạng lâu hơn vẫn có thể làm thiếu transcript.

## 13. Bảo mật và quyền riêng tư

- Không commit `.env`, `credentials.json`, `oauth_credentials.json` hoặc `.google-oauth-token.json`.
- Không gửi API key, private key hoặc OAuth token cho người khác.
- Chỉ bật ghi nhận sau khi người tham dự được thông báo và đồng ý.
- Bản Markdown/JSON chứa nội dung họp; phân quyền thư mục `Documents\Meeting Assistant` phù hợp.
- Nếu key từng xuất hiện trên GitHub/chat, hãy thu hồi và tạo key mới.

## 14. Các lệnh dành cho phát triển

```powershell
npm run check
npm test
npm audit
npm start
```

`npm audit` tại thời điểm hoàn thiện trả về 0 vulnerability.
