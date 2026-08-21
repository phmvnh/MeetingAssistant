# AGENTS.md — Meeting Assistant Desktop

Hướng dẫn dành cho Codex và các AI coding agent khi làm việc trong repo này.
File này mô tả **code đang tồn tại và đang được chạy**; không dùng các file kế
hoạch làm nguồn sự thật về kiến trúc hiện tại.

## 1. Tổng quan dự án

`meeting-assistant-desktop` v2.1.0 là ứng dụng Electron desktop có các chức năng:

- Thu âm thanh trực tiếp từ microphone và, trên Windows, có thể trộn thêm âm
  thanh hệ thống.
- Chép lời gần realtime bằng Gemini Live API qua WebSocket.
- Khi người dùng bấm **Done**, chốt transcript rồi gọi Gemini một lần để tạo
  biên bản/tóm tắt có cấu trúc.
- Sau khi vào `finalizeMeeting()`, lưu bản Markdown và JSON cục bộ trước khi
  thử đồng bộ Google.
- Có thể tạo Google Docs, cập nhật Google Calendar và ghi liên kết vào Google
  Sheets.

Luồng chính hiện tại:

`Xác nhận đã thông báo và có sự đồng ý` → `chọn mic/system audio` → `Start` →
`capture và chép lời` → `Pause/Resume nếu cần` → `Done` → `tóm tắt` →
`lưu local` → `Docs` → `Calendar` → `Sheets`.

Google hỗ trợ hai chế độ xác thực:

- `oauth`: người dùng đăng nhập tài khoản Google của họ. `.env.example` đang
  hướng dẫn theo chế độ này.
- `service_account`: không có bước đăng nhập người dùng; tài nguyên đích phải
  được cấu hình/chia sẻ đúng cho service account.

Trong `finalizeMeeting()`, lỗi đăng nhập hoặc API Google được xử lý best-effort,
trả về dưới dạng cảnh báo và không xóa kết quả local đã lưu. Tuy nhiên lỗi khi
đọc/validate cấu hình có thể xảy ra trước khi hàm này được gọi; không mô tả mọi
cấu hình sai là chắc chắn vẫn tạo được bản local.

## 2. Kiến trúc đang hoạt động

Entry point được khai báo trong `package.json` là `src/desktop/main.js`.

```text
src/
  config.js                         # Đọc và chuẩn hóa cấu hình môi trường
  desktop/
    main.js                         # Electron main, state/orchestration, IPC
    preload.js                      # API IPC tối thiểu cho renderer
  ui/
    index.html                      # Giao diện ứng dụng
    renderer.js                     # Capture/mix audio, UI và transcript realtime
    styles.css
  transcription/
    geminiLiveClient.js             # Gemini Live WebSocket realtime STT
    transcriptAssembler.js          # Ghép partial/final transcript
  meeting/
    meetingSession.js               # State machine và yêu cầu consent
    summarize.js                    # Một request Gemini REST sau Done
    finalize.js                     # Local save và đồng bộ Google theo thứ tự
    localStore.js                   # Lưu Markdown/JSON cục bộ
    formatDocument.js               # Định dạng nội dung biên bản
  google/
    auth.js                         # OAuth/service account và scopes
    docs.js                         # Tạo Google Docs
    calendarMeeting.js              # Tìm/tạo/cập nhật Calendar event
    sheetsMeeting.js                # Tạo/tìm spreadsheet và upsert meeting row
  mapper/                           # Mapping dùng bởi luồng cũ/phụ trợ
  sync/                             # Luồng đồng bộ cũ/phụ trợ
  calendar.js                       # Module cũ/phụ trợ
  sheets.js                         # Module cũ/phụ trợ
  scraper.js                        # Module scraping cũ/phụ trợ

scripts/
  start-electron.js
  check.js
  run-tests.js
  format-env.js

tests/
  *.test.js                         # Unit tests được chạy bởi npm test
  test_*.js                         # Script manual/integration cũ, không tự chạy
```

Không có `src/audio/` hoặc `src/gemini/`. Không tạo hai thư mục này chỉ vì tài
liệu hoặc kế hoạch cũ nhắc đến chúng. Nếu thay engine chép lời, mặc định đặt
adapter/engine mới trong `src/transcription/`; capture audio hiện thuộc
`src/ui/renderer.js`. Chỉ thay đổi ranh giới module khi task yêu cầu rõ ràng.

`run.js`, `login.js`, `src/sync/`, `src/mapper/`, `src/calendar.js`,
`src/sheets.js` và `src/scraper.js` không nằm trong luồng `npm start` hiện tại.
Hãy trace entry point/import trước khi sửa; không xóa hoặc hồi sinh luồng cũ nếu
người dùng không yêu cầu.

## 3. Các contract phải giữ ổn định

### Audio và transcription

- Renderer lấy mic bằng `getUserMedia()` và system audio bằng
  `getDisplayMedia()`.
- Main process cấp display capture với `audio: "loopback"` trên Windows. Code
  hiện không gọi trực tiếp native WASAPI.
- Video track chỉ phục vụ yêu cầu display capture và phải được dừng ngay; ứng
  dụng không xử lý hoặc lưu video.
- Các nguồn audio được trộn rồi chuyển thành mono PCM16, 16 kHz trước khi gửi
  qua IPC `meeting:audio`.
- Main process là nơi giữ transcription client và secret. Không chuyển
  `GEMINI_API_KEY` hoặc Google token sang renderer.
- Main/client hiện phát hoặc forward các event `ready`, `delta`, `completed`,
  `speech-started`, `speech-stopped`, `reconnecting`, `reconnected` và
  `error`. Renderer hiện chỉ xử lý `delta`, `completed`, `error`,
  `reconnecting` và `reconnected`; các event còn lại chưa có hành vi UI. Khi
  thay engine STT phải giữ contract IPC cần thiết hoặc cập nhật đồng bộ main,
  preload, renderer và tests.
- Hiện tại app không lưu file raw audio. Không thêm việc lưu âm thanh/video nếu
  người dùng chưa yêu cầu và chưa xác định rõ consent, vị trí lưu và vòng đời dữ
  liệu.

### Meeting lifecycle

- `consentConfirmed` là bắt buộc trước khi tạo `MeetingSession`.
- Giữ các transition hợp lệ trong `meetingSession.js`; không bỏ qua state machine
  bằng cách gán state trực tiếp.
- Khi bấm Done, phải chốt transcript trước rồi mới finalize.
- Gemini dùng cho tóm tắt chỉ được gọi một lần mỗi lần finalize cuộc họp, không
  gọi liên tục theo chunk audio.
- Nếu tóm tắt thất bại, dùng fallback notes và vẫn lưu transcript local.
- `finalize.js` phải lưu local trước khi gọi Google. Lỗi Docs/Calendar/Sheets
  không được làm mất kết quả local.

### Google Workspace

- Giữ hỗ trợ cả `oauth` và `service_account` trong `src/google/auth.js` và
  `src/config.js`, trừ khi task yêu cầu thay đổi rõ ràng.
- OAuth sử dụng quyền identity cùng Drive, Docs, Sheets và Calendar; không mở
  rộng scope nếu chưa có lý do và chưa thông báo cho người dùng.
- Trong OAuth mode, Calendar dùng `primary`; Sheets có thể tìm hoặc tạo
  spreadsheet theo cấu hình hiện tại. Service account cần ID/quyền chia sẻ phù
  hợp.
- Các thao tác Google có thể tạo hoặc sửa dữ liệu thật. Unit test phải mock API;
  không chạy script integration/manual hoặc ghi dữ liệu thật khi chưa được người
  dùng cho phép.

### Electron security

- Giữ `contextIsolation: true`, `nodeIntegration: false` và `sandbox: true`.
- Renderer không được truy cập trực tiếp Node.js, filesystem, secret hoặc Google
  client.
- Mọi quyền đặc biệt phải đi qua API hẹp trong `src/desktop/preload.js` và IPC
  handler tương ứng trong main process.
- Không mở navigation/window ngoài tùy ý. Link bên ngoài phải được kiểm soát và
  mở qua main process.

## 4. Quy tắc dependency

Không tự ý thêm dependency hoặc devDependency mới.

Nếu task cần package chưa có trong `package.json`:

1. Dừng trước bước cài đặt.
2. Nêu tên package, lý do cần và version dự kiến.
3. Chỉ chạy lệnh cài sau khi người dùng xác nhận.
4. Sau khi được phép, cập nhật nhất quán cả `package.json` và
   `package-lock.json`.

Khôi phục đúng dependency đã khóa bằng lockfile không được xem là đề xuất thêm
package mới, nhưng vẫn phải tuân theo quyền thực thi của môi trường.

Repo hiện không có script `build`, `pack` hoặc cấu hình đóng gói installer.
Không tuyên bố đã kiểm tra installer nếu chưa bổ sung và chạy quy trình build
thực tế.

## 5. File và dữ liệu nhạy cảm

Ưu tiên đọc `.env.example` và `src/config.js` để hiểu cấu hình. Các mục sau phải
được coi là nhạy cảm:

- `.env`
- `credentials.json`
- `credentials.json.json`
- `oauth_credentials.json`
- `.google-oauth-token.json`
- `.google-oauth-token.json.*.tmp`
- `cookies.json`
- `session/`
- Mọi file được trỏ bởi `GOOGLE_SERVICE_ACCOUNT_PATH`,
  `GOOGLE_OAUTH_CREDENTIALS_PATH` hoặc `GOOGLE_TOKEN_PATH`
- Transcript/biên bản cuộc họp trong `meeting-docs/`, `LOCAL_DOCS_DIR` hoặc thư
  mục Documents của người dùng

Quy tắc bắt buộc:

- Chỉ đọc giá trị secret/token khi thực sự cần cho task; không cần xin phép chỉ
  để đọc, nhưng không đọc tràn lan.
- Không in key, token, client secret, refresh token hoặc toàn bộ nội dung file
  nhạy cảm ra output/log.
- Không tự ý sửa, ghi đè, di chuyển hoặc xóa file xác thực. Nếu cần thay đổi,
  phải mô tả chính xác và xin phép trước.
- Không commit file bí mật hoặc dữ liệu cuộc họp. Giữ các pattern tương ứng
  trong `.gitignore`.
- Khi báo cấu hình, chỉ nêu tên biến/field và trạng thái có/thiếu; không nêu giá
  trị bí mật.

## 6. Kiểm tra và test

Sau khi sửa JavaScript hoặc hành vi runtime, chạy:

```powershell
npm run check
npm test
```

Hiểu đúng phạm vi hai lệnh:

- `npm run check` chỉ chạy `node --check` để kiểm tra cú pháp các file `.js`; đây
  không phải ESLint, type-check hoặc kiểm thử import/runtime.
- `npm test` chỉ chạy các file `tests/*.test.js` bằng `node --test`.
- `tests/test_*.js` là script manual/integration cũ, không thuộc `npm test` và có
  thể truy cập Google/dữ liệu thật. Không chạy chúng nếu chưa kiểm tra nội dung
  và chưa được phép thực hiện tác động bên ngoài.

Nếu sửa UI, audio, OAuth browser flow hoặc IPC, cần nêu rõ phần nào đã được smoke
test thủ công trên Windows và phần nào chưa thể kiểm chứng tự động. Không coi hai
lệnh trên là bằng chứng cho Electron UI/audio end-to-end.

Với thay đổi chỉ ở tài liệu như `AGENTS.md`, không bắt buộc chạy test ứng dụng;
phải tự rà soát link, tên file, lệnh và mô tả kiến trúc.

## 7. Quy ước khi sửa code

- Dự án dùng CommonJS (`require`, `module.exports`), JavaScript, indent 2 spaces
  và dấu chấm phẩy. Theo style của file lân cận.
- Thông báo hiển thị cho người dùng dùng tiếng Việt rõ ràng; giữ thuật ngữ API
  khi cần thiết.
- Ưu tiên thay đổi nhỏ, đúng module; không refactor rộng hoặc đổi tên public
  contract ngoài phạm vi task.
- Giữ khả năng dependency injection/mocking ở các module gọi network hoặc
  filesystem để unit test không phụ thuộc dịch vụ thật.
- Không sửa/xóa thay đổi đang có của người dùng và không dùng thao tác git phá
  hủy để làm sạch worktree.
- Windows là nền tảng đang được kiểm thử chính. Tách logic chung khỏi chi tiết
  loopback Windows để còn khả năng mở rộng macOS sau này.

## 8. Checklist trước khi báo hoàn thành

1. Thay đổi nằm đúng module của kiến trúc hiện tại; không tạo nhầm
   `src/audio/` hoặc `src/gemini/`.
2. Không có dependency mới được thêm khi chưa được xác nhận.
3. Không làm lộ hoặc tự ý sửa file/dữ liệu nhạy cảm.
4. Giữ consent, Electron security boundary, local fallback và contract IPC/audio.
5. Với code runtime: `npm run check` và `npm test` đã chạy, hoặc nêu rõ lý do
   không thể chạy và baseline lỗi nếu có.
6. Không chạy integration script hoặc tạo/sửa dữ liệu Google thật khi chưa được
   cho phép.
7. Không tuyên bố đã kiểm thử UI/audio/installer nếu chỉ mới chạy unit test và
   syntax check.
