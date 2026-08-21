require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");

const {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  session,
  shell,
} = require("electron");

const { getGeminiConfig, getGoogleWorkspaceConfig } = require("../config");
const {
  GeminiLiveTranscriptionClient,
} = require("../transcription/geminiLiveClient");
const { MeetingSession, STATES } = require("../meeting/meetingSession");
const { finalizeMeeting } = require("../meeting/finalize");
const {
  disconnectGoogleAccount,
  getGoogleAccountProfile,
  getGoogleAuthClient,
  getGoogleAuthStatus,
  resolveProjectPath,
} = require("../google/auth");

let mainWindow = null;
let activeMeeting = null;
let transcriptionClient = null;
let latestResult = null;
let googleAuthorizationController = null;

function emitToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function emitState() {
  emitToRenderer("meeting:state", activeMeeting?.toJSON() || null);
}

function getOutputDirectory() {
  const configured = process.env.LOCAL_DOCS_DIR?.trim();

  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.join(process.cwd(), configured);
  }

  return path.join(app.getPath("documents"), "Meeting Assistant");
}

function isConfigured(value) {
  return Boolean(
    value &&
      !/^(your-|<|\.\.\.)/i.test(value) &&
      !/example\.com|api-key/i.test(value),
  );
}

async function getConfigStatus() {
  let googleConfig;

  try {
    googleConfig = getGoogleWorkspaceConfig();
  } catch {
    googleConfig = null;
  }

  const geminiKey = process.env.GEMINI_API_KEY?.trim() || "";
  const googleCredentialsPath = googleConfig
    ? resolveProjectPath(
        googleConfig.authMode === "oauth"
          ? googleConfig.oauthCredentialsPath
          : googleConfig.serviceAccountPath,
      )
    : "";
  const calendarId = googleConfig?.calendarId || "";
  const calendarIdValid =
    isConfigured(calendarId) &&
    (calendarId.includes("@") ||
      (googleConfig?.authMode === "oauth" && calendarId === "primary"));

  const googleCredentialsPresent = Boolean(
    googleCredentialsPath && fs.existsSync(googleCredentialsPath),
  );
  let googleAuthStatus = {
    authorized: false,
    requiresReauth: false,
    accountEmail: null,
    message: null,
  };

  if (googleConfig?.authMode === "service_account") {
    googleAuthStatus.authorized = googleCredentialsPresent;
  } else if (googleConfig?.authMode === "oauth" && googleCredentialsPresent) {
    googleAuthStatus = await getGoogleAuthStatus(googleConfig);
  }

  return {
    geminiConfigured: isConfigured(geminiKey),
    googleAuthMode: googleConfig?.authMode || "invalid",
    googleCredentialsPresent,
    googleAuthorized: googleAuthStatus.authorized,
    googleNeedsReauth: Boolean(googleAuthStatus.requiresReauth),
    googleAccountEmail: googleAuthStatus.accountEmail || "",
    googleAuthMessage: googleAuthStatus.message || "",
    sheetConfigured:
      googleConfig?.authMode === "oauth" ||
      isConfigured(googleConfig?.spreadsheetId),
    calendarConfigured: calendarIdValid,
    docsEnabled: googleConfig?.docsEnabled ?? false,
    docsNeedsSharedDrive:
      googleConfig?.authMode === "service_account" &&
      googleConfig?.docsEnabled &&
      !googleConfig?.driveFolderId,
    outputDirectory: getOutputDirectory(),
  };
}

function configureMediaPermissions() {
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return ["media", "display-capture"].includes(permission);
  });

  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      callback(["media", "display-capture"].includes(permission));
    },
  );

  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 0, height: 0 },
      });

      if (!sources[0]) {
        callback({});
        return;
      }

      // On Windows, loopback captures system audio. The renderer immediately
      // stops the granted video track; no video frames are processed or saved.
      callback({
        video: sources[0],
        audio: "loopback",
      });
    } catch {
      callback({});
    }
  });
}

function createWindow() {
  const smokeTest = process.env.MEETING_ASSISTANT_SMOKE_TEST === "1";
  mainWindow = new BrowserWindow({
    width: 1260,
    height: 820,
    minWidth: 980,
    minHeight: 700,
    title: "Meeting Assistant",
    backgroundColor: "#f4f2ed",
    show: !smokeTest,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, "..", "ui", "index.html"));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());

  if (smokeTest) {
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(() => app.quit(), 250);
    });
  }
}

function attachTranscriptionEvents(client) {
  client.on("ready", () => {
    emitToRenderer("transcription:event", { type: "ready" });
  });
  client.on("delta", (item) => {
    emitToRenderer("transcription:event", { type: "delta", item });
  });
  client.on("completed", (item) => {
    emitToRenderer("transcription:event", { type: "completed", item });
  });
  client.on("speech-started", () => {
    emitToRenderer("transcription:event", { type: "speech-started" });
  });
  client.on("speech-stopped", () => {
    emitToRenderer("transcription:event", { type: "speech-stopped" });
  });
  client.on("api-error", (error) => {
    emitToRenderer("transcription:event", {
      type: "error",
      message: error.message,
    });
  });
  client.on("client-error", (error) => {
    emitToRenderer("transcription:event", {
      type: "error",
      message: error.message,
    });
  });
  client.on("reconnecting", () => {
    emitToRenderer("transcription:event", {
      type: "reconnecting",
      message: "Gemini Live đang kết nối lại…",
    });
  });
  client.on("reconnected", () => {
    emitToRenderer("transcription:event", {
      type: "reconnected",
      message: "Gemini Live đã kết nối lại.",
    });
  });
}

function registerIpcHandlers() {
  ipcMain.handle("app:config-status", () => getConfigStatus());

  ipcMain.handle("meeting:start", async (_event, metadata) => {
    if (
      activeMeeting &&
      ![STATES.COMPLETED, STATES.FAILED, STATES.CANCELLED].includes(
        activeMeeting.state,
      )
    ) {
      throw new Error("Đang có một cuộc họp chưa kết thúc.");
    }

    const geminiConfig = getGeminiConfig();
    activeMeeting = new MeetingSession(metadata);
    latestResult = null;
    activeMeeting.transition(STATES.CONNECTING);
    emitState();

    transcriptionClient = new GeminiLiveTranscriptionClient({
      apiKey: geminiConfig.apiKey,
      model: geminiConfig.liveModel,
      languages: geminiConfig.languages,
      prompt: geminiConfig.prompt,
      keywords: metadata.keywords || [],
    });
    attachTranscriptionEvents(transcriptionClient);

    try {
      await transcriptionClient.connect();
      activeMeeting.transition(STATES.LISTENING);
      emitState();
      return activeMeeting.toJSON();
    } catch (error) {
      activeMeeting.transition(STATES.FAILED);
      emitState();
      transcriptionClient?.close();
      throw error;
    }
  });

  ipcMain.on("meeting:audio", (_event, arrayBuffer) => {
    if (activeMeeting?.state !== STATES.LISTENING || !transcriptionClient) {
      return;
    }

    transcriptionClient.appendAudio(Buffer.from(arrayBuffer));
  });

  ipcMain.handle("meeting:pause", () => {
    if (activeMeeting?.state !== STATES.LISTENING) {
      throw new Error("Cuộc họp không ở trạng thái đang lắng nghe.");
    }

    activeMeeting.transition(STATES.PAUSED);
    transcriptionClient?.endAudioStream();
    emitState();
    return activeMeeting.toJSON();
  });

  ipcMain.handle("meeting:resume", () => {
    if (activeMeeting?.state !== STATES.PAUSED) {
      throw new Error("Cuộc họp không ở trạng thái tạm dừng.");
    }

    activeMeeting.transition(STATES.LISTENING);
    emitState();
    return activeMeeting.toJSON();
  });

  ipcMain.handle("meeting:done", async () => {
    if (![STATES.LISTENING, STATES.PAUSED].includes(activeMeeting?.state)) {
      throw new Error("Không có cuộc họp đang hoạt động để hoàn tất.");
    }

    activeMeeting.transition(STATES.FINALIZING);
    emitState();
    emitToRenderer("meeting:progress", {
      step: "transcript",
      message: "Đang chốt câu nói cuối cùng…",
    });

    try {
      const transcript = await transcriptionClient.finish();

      if (!transcript.trim()) {
        throw new Error(
          "Không nhận được transcript. Hãy kiểm tra microphone, âm lượng và GEMINI_API_KEY.",
        );
      }

      const result = await finalizeMeeting({
        meeting: activeMeeting.toJSON(),
        transcript,
        geminiConfig: getGeminiConfig(),
        googleConfig: getGoogleWorkspaceConfig(),
        outputDirectory: getOutputDirectory(),
        openExternal: (url) => shell.openExternal(url),
        onProgress: (step, message) => {
          emitToRenderer("meeting:progress", { step, message });
        },
      });

      activeMeeting.transition(STATES.COMPLETED);
      result.meeting = activeMeeting.toJSON();
      latestResult = result;
      emitState();
      return result;
    } catch (error) {
      activeMeeting.transition(STATES.FAILED);
      emitState();
      throw error;
    } finally {
      transcriptionClient?.close();
    }
  });

  ipcMain.handle("meeting:cancel", () => {
    if (
      !activeMeeting ||
      [STATES.COMPLETED, STATES.FAILED, STATES.CANCELLED].includes(
        activeMeeting.state,
      )
    ) {
      return activeMeeting?.toJSON() || null;
    }

    transcriptionClient?.close();
    activeMeeting.transition(STATES.CANCELLED);
    emitState();
    return activeMeeting.toJSON();
  });

  ipcMain.handle("google:authorize", async (_event, options = {}) => {
    const googleConfig = getGoogleWorkspaceConfig();

    if (googleConfig.authMode !== "oauth") {
      return {
        ok: true,
        message: "Đang dùng service account; không cần đăng nhập OAuth.",
      };
    }

    googleAuthorizationController?.abort();
    const authorizationController = new AbortController();
    googleAuthorizationController = authorizationController;

    try {
      const auth = await getGoogleAuthClient(googleConfig, {
        interactive: true,
        forceAccountSelection: Boolean(options.force),
        openExternal: (url) => shell.openExternal(url),
        signal: authorizationController.signal,
      });
      const account = await getGoogleAccountProfile(auth).catch(() => null);

      return {
        ok: true,
        message: "Đăng nhập Google thành công.",
        accountEmail: account?.email || "",
      };
    } finally {
      if (googleAuthorizationController === authorizationController) {
        googleAuthorizationController = null;
      }
    }
  });

  ipcMain.handle("google:disconnect", async () => {
    const googleConfig = getGoogleWorkspaceConfig();
    googleAuthorizationController?.abort();
    googleAuthorizationController = null;

    if (googleConfig.authMode !== "oauth") {
      return {
        ok: true,
        message: "Service account không có phiên người dùng để ngắt kết nối.",
      };
    }

    await disconnectGoogleAccount(googleConfig);
    return {
      ok: true,
      message: "Đã ngắt kết nối tài khoản Google trên thiết bị này.",
    };
  });

  ipcMain.handle("result:open-local", async () => {
    const filePath = latestResult?.local?.markdownPath;

    if (!filePath) {
      throw new Error("Chưa có biên bản cục bộ để mở.");
    }

    const errorMessage = await shell.openPath(filePath);

    if (errorMessage) {
      throw new Error(errorMessage);
    }

    return true;
  });

  ipcMain.handle("result:open-google-doc", async () => {
    const url = latestResult?.googleDocument?.documentUrl;

    if (!url) {
      throw new Error("Cuộc họp này chưa có Google Docs.");
    }

    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle("result:open-google-sheet", async () => {
    const url = latestResult?.sheet?.spreadsheetUrl;

    if (!url) {
      throw new Error("Cuộc họp này chưa được đồng bộ lên Google Sheets.");
    }

    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle("result:open-calendar", async () => {
    const url = latestResult?.calendar?.htmlLink;

    if (!url) {
      throw new Error("Cuộc họp này chưa có link Google Calendar.");
    }

    await shell.openExternal(url);
    return true;
  });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    configureMediaPermissions();
    registerIpcHandlers();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    transcriptionClient?.close();
    googleAuthorizationController?.abort();
    googleAuthorizationController = null;

    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
