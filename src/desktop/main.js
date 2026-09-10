require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");

const {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  safeStorage,
  session,
  shell,
} = require("electron");

const {
  getGeminiConfig,
  getGoogleWorkspaceConfig,
  getTranscriptionConfig,
} = require("../config");
const {
  createTranscriptionClient,
} = require("../transcription/createTranscriptionClient");
const {
  ModelManager,
} = require("../transcription/modelManager");
const {
  getSidecarExecutablePath,
} = require("../transcription/runtimeResolver");
const { MeetingSession, STATES } = require("../meeting/meetingSession");
const { finalizeMeeting } = require("../meeting/finalize");
const {
  getSummaryProvider,
  listSummaryProviders,
} = require("../meeting/summaryProviders");
const {
  testSummaryConnection,
} = require("../meeting/summarize");
const {
  normalizeApiKey,
  normalizeModel,
  SummarySettingsStore,
} = require("./summarySettingsStore");
const { StorageManager } = require("./storageManager");
const { StorageSettingsStore } = require("./storageSettingsStore");
const {
  disconnectGoogleAccount,
  getGoogleAccountProfile,
  getGoogleAuthClient,
  getGoogleAuthStatus,
  resolveProjectPath,
} = require("../google/auth");
const {
  resolveExistingMeetingSpreadsheetUrl,
} = require("../google/sheetsMeeting");

let mainWindow = null;
let activeMeeting = null;
let transcriptionClient = null;
let latestResult = null;
let googleAuthorizationController = null;
let summarySettingsStore = null;
let modelManager = null;
let storageSettingsStore = null;
let storageManager = null;
let activeAudioStorageSettings = null;
let meetingStartInProgress = false;
let meetingStartPromise = null;
let meetingTerminalPromise = null;
let meetingTeardownPromise = null;
let storageMutationInProgress = false;
let storageMutationPromise = null;
let storageMaintenancePromise = null;
let storageSettingsPromise = null;
let quitAfterStorageCleanup = false;
let shutdownInProgress = false;
let storageCleanupTimer = null;

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

function getAudioCacheDirectory() {
  return path.join(app.getPath("userData"), "cache", "meetings");
}

function meetingIsActive() {
  return Boolean(
    activeMeeting &&
      [
        STATES.CONNECTING,
        STATES.LISTENING,
        STATES.PAUSED,
        STATES.FINALIZING,
      ].includes(activeMeeting.state),
  );
}

function storageIsLockedByMeeting() {
  return (
    meetingIsActive() ||
    meetingStartInProgress ||
    Boolean(meetingTerminalPromise) ||
    Boolean(meetingTeardownPromise)
  );
}

function runMeetingStart(operation) {
  if (
    meetingStartInProgress ||
    meetingTerminalPromise ||
    storageMutationInProgress ||
    storageMutationPromise ||
    storageSettingsPromise ||
    shutdownInProgress
  ) {
    throw new Error("Ứng dụng đang hoàn tất một thao tác lưu trữ. Vui lòng chờ.");
  }

  const pendingMaintenance = storageMaintenancePromise;
  const pendingTeardown = meetingTeardownPromise;
  meetingStartInProgress = true;
  const corePromise = (async () => {
    await Promise.all(
      [pendingMaintenance, pendingTeardown].filter(Boolean),
    );

    if (shutdownInProgress) {
      throw new Error("Ứng dụng đang đóng. Không thể bắt đầu cuộc họp mới.");
    }

    return operation();
  })();
  let trackedPromise;
  trackedPromise = corePromise.finally(() => {
    if (meetingStartPromise === trackedPromise) {
      meetingStartPromise = null;
      meetingStartInProgress = false;
    }
  });
  meetingStartPromise = trackedPromise;
  return trackedPromise;
}

function runMeetingTerminal(operation) {
  if (meetingTerminalPromise) {
    throw new Error(
      "Cuộc họp đang được hoàn tất hoặc hủy. Vui lòng chờ thao tác hiện tại.",
    );
  }

  if (shutdownInProgress) {
    throw new Error("Ứng dụng đang đóng. Không thể thực hiện thao tác này.");
  }

  const corePromise = Promise.resolve().then(operation);
  let trackedPromise;
  trackedPromise = corePromise.finally(() => {
    if (meetingTerminalPromise === trackedPromise) {
      meetingTerminalPromise = null;
    }
  });
  meetingTerminalPromise = trackedPromise;
  return trackedPromise;
}

function runStorageMaintenance(operation) {
  if (storageMaintenancePromise) {
    return storageMaintenancePromise;
  }

  if (
    shutdownInProgress ||
    storageMutationInProgress ||
    storageMutationPromise ||
    storageIsLockedByMeeting()
  ) {
    return Promise.resolve({ skipped: true, reason: "busy" });
  }

  const corePromise = Promise.resolve().then(operation);
  let trackedPromise;
  trackedPromise = corePromise.finally(() => {
    if (storageMaintenancePromise === trackedPromise) {
      storageMaintenancePromise = null;
    }
  });
  storageMaintenancePromise = trackedPromise;
  return trackedPromise;
}

function runStorageMutation(operation) {
  if (
    storageMutationInProgress ||
    storageMutationPromise ||
    storageSettingsPromise
  ) {
    throw new Error("Đang có một thao tác dọn dung lượng khác.");
  }

  if (storageIsLockedByMeeting()) {
    throw new Error(
      "Không thể xóa dữ liệu khi cuộc họp đang được xử lý.",
    );
  }

  const pendingMaintenance = storageMaintenancePromise;
  storageMutationInProgress = true;
  const corePromise = (async () => {
    if (pendingMaintenance) {
      await pendingMaintenance;
    }

    if (shutdownInProgress || storageIsLockedByMeeting()) {
      throw new Error(
        "Không thể xóa dữ liệu khi cuộc họp đang được xử lý.",
      );
    }

    return operation();
  })();
  let trackedPromise;
  trackedPromise = corePromise.finally(() => {
    if (storageMutationPromise === trackedPromise) {
      storageMutationPromise = null;
      storageMutationInProgress = false;
    }
  });
  storageMutationPromise = trackedPromise;
  return trackedPromise;
}

function runStorageSettingsOperation(operation) {
  if (shutdownInProgress) {
    throw new Error("Ứng dụng đang đóng. Không thể lưu thiết lập mới.");
  }

  if (
    storageSettingsPromise ||
    storageMutationInProgress ||
    storageMutationPromise
  ) {
    throw new Error("Đang có một thao tác lưu trữ khác. Vui lòng chờ.");
  }

  if (storageIsLockedByMeeting()) {
    throw new Error(
      "Không thể thay đổi thiết lập lưu trữ khi cuộc họp đang được xử lý.",
    );
  }

  const corePromise = Promise.resolve().then(operation);
  let trackedPromise;
  trackedPromise = corePromise.finally(() => {
    if (storageSettingsPromise === trackedPromise) {
      storageSettingsPromise = null;
    }
  });
  storageSettingsPromise = trackedPromise;
  return trackedPromise;
}

function getProtectedMeetingIds() {
  return meetingIsActive() && activeMeeting?.meetingId
    ? [activeMeeting.meetingId]
    : [];
}

async function closeTranscriptionClient(client) {
  if (!client) {
    return;
  }

  try {
    await Promise.resolve(client.close());
  } catch (error) {
    console.warn("Không thể đóng transcription client hoàn toàn:", error.message);
  }
}

async function cleanupMeetingAudio(meetingId, settings) {
  if (
    !storageManager ||
    !meetingId ||
    !settings?.saveRawAudio ||
    settings.initialized !== true
  ) {
    return;
  }

  try {
    if (settings.audioRetention === "after_meeting") {
      await storageManager.removeMeetingAudio(meetingId);
      return;
    }

    await storageManager.cleanupExpiredAudio({
      audioRetention: settings.audioRetention,
      protectedMeetingIds: getProtectedMeetingIds(),
    });
  } catch (error) {
    console.warn("Không thể tự động dọn cache âm thanh:", error.message);
  }
}

async function teardownMeetingTranscription(client, meetingId, settings) {
  if (meetingTeardownPromise) {
    await meetingTeardownPromise;
    return;
  }

  const operation = (async () => {
    await closeTranscriptionClient(client);
    await cleanupMeetingAudio(meetingId, settings);
  })();
  meetingTeardownPromise = operation;

  try {
    await operation;
  } finally {
    if (meetingTeardownPromise === operation) {
      meetingTeardownPromise = null;
    }
  }
}

async function teardownHeadlessMeeting() {
  await Promise.allSettled(
    [meetingStartPromise, meetingTerminalPromise].filter(Boolean),
  );

  const client = transcriptionClient;
  if (!client) {
    return;
  }

  const meeting = activeMeeting;
  const meetingId = meeting?.meetingId;
  const settings = activeAudioStorageSettings;
  if ([STATES.LISTENING, STATES.PAUSED].includes(meeting?.state)) {
    meeting.transition(STATES.CANCELLED);
    emitState();
  }
  transcriptionClient = null;
  await teardownMeetingTranscription(client, meetingId, settings);
  if (activeMeeting === meeting) {
    activeAudioStorageSettings = null;
  }
}

async function getStorageStatus(options = {}) {
  if (!storageManager) {
    throw new Error("Trình quản lý dung lượng chưa sẵn sàng.");
  }

  if (options.cleanup === true) {
    await runStorageMaintenance(() =>
      storageManager.cleanupExpiredAudio({
        protectedMeetingIds: getProtectedMeetingIds(),
      }),
    );
  } else if (storageMaintenancePromise) {
    await storageMaintenancePromise;
  }

  return storageManager.getStatus();
}

function isConfigured(value) {
  return Boolean(
    value &&
      !/^(your-|<|\.\.\.)/i.test(value) &&
      !/example\.com|api-key/i.test(value),
  );
}

function getEnvironmentSummaryConfig() {
  return {
    provider: "gemini",
    apiKey: "",
    model: getSummaryProvider("gemini").defaultModel,
    configurationError: "Chưa cấu hình API key AI trong ứng dụng.",
  };
}

function decorateSummarySettings(settings, error = "") {
  const active = settings.providers.find(
    (provider) => provider.id === settings.activeProvider,
  );
  return {
    ...settings,
    source: active?.configured ? "saved" : "missing",
    environmentFallback: false,
    environmentModel: getSummaryProvider("gemini").defaultModel,
    error,
  };
}

function createDefaultSummarySettings(error = "") {
  return decorateSummarySettings(
    {
      activeProvider: "gemini",
      providers: listSummaryProviders().map((provider) => ({
        ...provider,
        model: provider.defaultModel,
        configured: false,
      })),
    },
    error,
  );
}

async function getSummaryAiSettings() {
  if (!summarySettingsStore) {
    return createDefaultSummarySettings(
      "Kho cấu hình AI chưa được khởi tạo.",
    );
  }

  try {
    return decorateSummarySettings(
      await summarySettingsStore.getPublicSettings(),
    );
  } catch (error) {
    return createDefaultSummarySettings(error.message);
  }
}

async function getSummaryConfigForFinalize() {
  try {
    const storedConfig = await summarySettingsStore?.getActiveConfig();

    if (storedConfig) {
      return storedConfig;
    }
  } catch (error) {
    const fallback = getEnvironmentSummaryConfig();

    return {
      ...fallback,
      warning: fallback.apiKey
        ? `Kho cấu hình AI: ${error.message} Đang dùng Gemini từ .env.`
        : "",
      configurationError: fallback.apiKey
        ? ""
        : `Kho cấu hình AI: ${error.message} ${fallback.configurationError}`,
    };
  }

  return getEnvironmentSummaryConfig();
}

async function resolveSummaryTestConfig(payload = {}) {
  const provider = getSummaryProvider(payload.provider || "gemini");
  const model = normalizeModel(provider.id, payload.model);
  const typedApiKey = normalizeApiKey(payload.apiKey);

  if (typedApiKey) {
    return {
      provider: provider.id,
      model,
      apiKey: typedApiKey,
    };
  }

  const stored = await summarySettingsStore?.getProviderConfig(provider.id);

  if (stored) {
    return {
      ...stored,
      model,
    };
  }

  throw new Error(
    `Chưa có API key cho ${provider.label}. Hãy nhập key hoặc lưu cấu hình trước.`,
  );
}

async function getConfigStatus() {
  let googleConfig;

  try {
    googleConfig = getGoogleWorkspaceConfig();
  } catch {
    googleConfig = null;
  }

  const summarySettings = await getSummaryAiSettings();
  const geminiSettings = summarySettings.providers.find(
    (provider) => provider.id === "gemini",
  );
  const googleCredentialsPath = googleConfig
    ? resolveProjectPath(
        googleConfig.authMode === "oauth"
          ? googleConfig.oauthCredentialsPath
          : googleConfig.serviceAccountPath,
      )
    : "";
  const calendarId = googleConfig?.calendarId || "";
  const calendarIdValid =
    !calendarId ||
    (isConfigured(calendarId) &&
      calendarId.includes("@") &&
      calendarId.toLowerCase() !== "primary");

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
    geminiConfigured: Boolean(geminiSettings?.configured),
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
  client.on("error", (error) => {
    emitToRenderer("transcription:event", {
      type: "error",
      message: error.message,
    });
  });
  client.on("cache-error", () => {
    emitToRenderer("transcription:event", {
      type: "warning",
      message:
        "Không thể lưu cache âm thanh trên máy. Transcript vẫn tiếp tục hoạt động.",
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

  ipcMain.handle("storage:get-status", () => getStorageStatus());

  ipcMain.handle("storage:save-settings", (_event, settings = {}) =>
    runStorageSettingsOperation(async () => {
      if (!storageSettingsStore) {
        throw new Error("Kho cấu hình lưu trữ chưa sẵn sàng.");
      }

      const confirmCleanup = settings.confirmCleanup === true;
      if (confirmCleanup && settings.audioRetention === undefined) {
        throw new Error("Hãy chọn thời hạn lưu cache trước khi xác nhận.");
      }

      const previousSettings = await storageSettingsStore.getSettings();
      await storageSettingsStore.save(
        {
          saveRawAudio: settings.saveRawAudio,
          audioRetention: settings.audioRetention,
        },
        { confirmCleanup },
      );

      const cleanupPolicyChanged =
        previousSettings.initialized !== true ||
        previousSettings.audioRetention !== settings.audioRetention;
      if (confirmCleanup && cleanupPolicyChanged) {
        await runStorageMaintenance(() =>
          storageManager.cleanupExpiredAudio({
            protectedMeetingIds: getProtectedMeetingIds(),
          }),
        );
      }

      return getStorageStatus();
    }),
  );

  ipcMain.handle("storage:clear-audio", async () => {
    return runStorageMutation(async () => {
      const cleanup = await storageManager.clearAudioCache();
      return {
        cleanup,
        status: await getStorageStatus({ cleanup: false }),
      };
    });
  });

  ipcMain.handle("storage:clear-local-documents", async () => {
    return runStorageMutation(async () => {
      const cleanup = await storageManager.clearLocalDocuments();
      if (
        latestResult?.local?.markdownPath &&
        !fs.existsSync(latestResult.local.markdownPath)
      ) {
        latestResult.local = null;
      }
      return {
        cleanup,
        latestLocalDocumentAvailable: Boolean(latestResult?.local?.markdownPath),
        status: await getStorageStatus({ cleanup: false }),
      };
    });
  });

  ipcMain.handle("storage:open-audio-folder", async () => {
    const directory = await storageManager.ensureDirectory("audio");
    const errorMessage = await shell.openPath(directory);
    if (errorMessage) {
      throw new Error(errorMessage);
    }
    return true;
  });

  ipcMain.handle("storage:open-local-documents-folder", async () => {
    const directory = await storageManager.ensureDirectory("documents");
    const errorMessage = await shell.openPath(directory);
    if (errorMessage) {
      throw new Error(errorMessage);
    }
    return true;
  });

  ipcMain.handle("summary-ai:get-settings", () => getSummaryAiSettings());

  ipcMain.handle("summary-ai:save", async (_event, payload = {}) => {
    if (!summarySettingsStore) {
      throw new Error("Kho cấu hình AI chưa được khởi tạo.");
    }

    await summarySettingsStore.save(payload);
    return getSummaryAiSettings();
  });

  ipcMain.handle("summary-ai:remove", async (_event, providerId) => {
    if (!summarySettingsStore) {
      throw new Error("Kho cấu hình AI chưa được khởi tạo.");
    }

    await summarySettingsStore.remove(providerId);
    return getSummaryAiSettings();
  });

  ipcMain.handle("summary-ai:test", async (_event, payload = {}) => {
    const config = await resolveSummaryTestConfig(payload);
    const result = await testSummaryConnection(config);

    return {
      ok: result.ok,
      provider: result.provider,
      providerLabel: result.providerLabel,
      model: result.model,
      message: `Kết nối ${result.providerLabel} thành công với model ${result.model}.`,
    };
  });

  ipcMain.handle("whisper:list-models", () => {
    return modelManager ? modelManager.listModels() : [];
  });

  ipcMain.handle("whisper:download-model", async (_event, modelId) => {
    if (!modelManager) {
      throw new Error("Model Manager chưa sẵn sàng.");
    }
    return modelManager.downloadModel(modelId, {
      onProgress: (info) => {
        emitToRenderer("whisper:download-progress", info);
      },
    });
  });

  ipcMain.handle("whisper:cancel-download", (_event, modelId) => {
    return modelManager ? modelManager.cancelDownload(modelId) : false;
  });

  ipcMain.handle("whisper:delete-model", (_event, modelId) => {
    return modelManager ? modelManager.deleteModel(modelId) : false;
  });

  ipcMain.handle("whisper:select-model", (_event, modelId) => {
    return modelManager ? modelManager.setActiveModel(modelId) : null;
  });

  ipcMain.handle("meeting:start", (_event, metadata) =>
    runMeetingStart(async () => {
      if (
        activeMeeting &&
        ![STATES.COMPLETED, STATES.FAILED, STATES.CANCELLED].includes(
          activeMeeting.state,
        )
      ) {
        throw new Error("Đang có một cuộc họp chưa kết thúc.");
      }

      const transcriptionConfig = getTranscriptionConfig();
      const engine = transcriptionConfig.engine || "whisper";
      const startingMeeting = new MeetingSession(metadata);
      let whisperModelPath = null;
      let sidecarExec = null;
      let sidecarArgs = [];
      let sidecarEnv = null;

      if (engine === "whisper") {
        const activeModel = modelManager?.getActiveModel();
        if (!activeModel || !activeModel.downloaded) {
          throw new Error(
            "Chưa tải model Whisper nào. Hãy vào Cài đặt -> Quản lý Model Whisper để tải model (khuyến nghị: Medium Q5_0) trước khi bắt đầu cuộc họp.",
          );
        }
        whisperModelPath = activeModel.localPath;
        const sidecarInfo = getSidecarExecutablePath(app.getAppPath());
        sidecarExec = sidecarInfo.executable;
        sidecarArgs = sidecarInfo.args || [];
        sidecarEnv = sidecarInfo.env || null;
      }

      const currentStorageSettings = await storageSettingsStore.getSettings();
      const startingStorageSettings = {
        ...currentStorageSettings,
        saveRawAudio:
          typeof metadata?.saveRawAudio === "boolean"
            ? metadata.saveRawAudio
            : currentStorageSettings.saveRawAudio,
      };

      activeMeeting = startingMeeting;
      activeAudioStorageSettings = startingStorageSettings;
      latestResult = null;
      startingMeeting.transition(STATES.CONNECTING);
      emitState();

      let startingClient = null;

      try {
        if (engine === "whisper") {
          startingClient = createTranscriptionClient({
            engine: "whisper",
            sidecarPath: sidecarExec,
            sidecarArgs,
            sidecarEnv,
            modelPath: whisperModelPath,
            language: "vi",
            prompt: transcriptionConfig.prompt,
            cacheDir: startingStorageSettings.saveRawAudio
              ? getAudioCacheDirectory()
              : null,
            meetingId: startingMeeting.meetingId,
            saveRawAudio: startingStorageSettings.saveRawAudio,
          });
        } else {
          const geminiConfig = getGeminiConfig();
          const geminiSettings =
            await summarySettingsStore?.getProviderConfig("gemini");
          if (!geminiSettings?.apiKey) {
            throw new Error(
              "Chưa cấu hình API key Gemini trong ứng dụng. Hãy mở Cấu hình AI và lưu key Gemini trước khi dùng Gemini Live.",
            );
          }
          startingClient = createTranscriptionClient({
            engine: "gemini",
            apiKey: geminiSettings.apiKey,
            liveModel: geminiSettings.model,
            languages: geminiConfig.languages,
            prompt: geminiConfig.prompt,
            keywords: metadata.keywords || [],
          });
        }

        transcriptionClient = startingClient;
        attachTranscriptionEvents(startingClient);
        await startingClient.connect();
        startingMeeting.transition(STATES.LISTENING);
        startingClient.resumeAudioStream?.();
        emitState();
        return startingMeeting.toJSON();
      } catch (error) {
        if (transcriptionClient === startingClient) {
          transcriptionClient = null;
        }
        await teardownMeetingTranscription(
          startingClient,
          startingMeeting.meetingId,
          startingStorageSettings,
        );
        startingMeeting.transition(STATES.FAILED);
        if (activeMeeting === startingMeeting) {
          activeAudioStorageSettings = null;
          emitState();
        }
        throw error;
      }
    }),
  );

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
    transcriptionClient?.resumeAudioStream?.();
    emitState();
    return activeMeeting.toJSON();
  });

  ipcMain.handle("meeting:done", () =>
    runMeetingTerminal(async () => {
      if (![STATES.LISTENING, STATES.PAUSED].includes(activeMeeting?.state)) {
        throw new Error("Không có cuộc họp đang hoạt động để hoàn tất.");
      }

      const finalizingMeeting = activeMeeting;
      const finalizingClient = transcriptionClient;
      if (!finalizingClient) {
        throw new Error("Bộ nhận dạng âm thanh chưa sẵn sàng để hoàn tất.");
      }

      finalizingMeeting.transition(STATES.FINALIZING);
      const finalizingMeetingId = finalizingMeeting.meetingId;
      const finalizingStorageSettings = activeAudioStorageSettings;
      emitState();
      emitToRenderer("meeting:progress", {
        step: "transcript",
        message: "Đang xử lý phần âm thanh cuối và hoàn thiện transcript…",
      });

      try {
        const transcript = await finalizingClient.finish();

        if (!transcript.trim()) {
          throw new Error(
            "Không nhận được transcript. Hãy kiểm tra microphone, âm lượng và model chép lời đã chọn.",
          );
        }

        // Transcript is complete at this point. Release the native Whisper
        // process and its model RAM before waiting on AI/Google network calls.
        await closeTranscriptionClient(finalizingClient);
        if (transcriptionClient === finalizingClient) {
          transcriptionClient = null;
        }

        const result = await finalizeMeeting({
          meeting: finalizingMeeting.toJSON(),
          transcript,
          summaryConfig: await getSummaryConfigForFinalize(),
          googleConfig: getGoogleWorkspaceConfig(),
          outputDirectory: getOutputDirectory(),
          openExternal: (url) => shell.openExternal(url),
          onProgress: (step, message) => {
            emitToRenderer("meeting:progress", { step, message });
          },
        });

        finalizingMeeting.transition(STATES.COMPLETED);
        result.meeting = finalizingMeeting.toJSON();
        latestResult = result;
        emitState();
        return result;
      } catch (error) {
        if (finalizingMeeting.state === STATES.FINALIZING) {
          finalizingMeeting.transition(STATES.FAILED);
          emitState();
        }
        throw error;
      } finally {
        if (transcriptionClient === finalizingClient) {
          transcriptionClient = null;
        }
        await teardownMeetingTranscription(
          finalizingClient,
          finalizingMeetingId,
          finalizingStorageSettings,
        );
        if (activeMeeting === finalizingMeeting) {
          activeAudioStorageSettings = null;
        }
      }
    }),
  );

  ipcMain.handle("meeting:cancel", () =>
    runMeetingTerminal(async () => {
      if (
        !activeMeeting ||
        [STATES.COMPLETED, STATES.FAILED, STATES.CANCELLED].includes(
          activeMeeting.state,
        )
      ) {
        return activeMeeting?.toJSON() || null;
      }

      if (activeMeeting.state === STATES.FINALIZING) {
        throw new Error(
          "Cuộc họp đang được hoàn tất và tạo biên bản. Vui lòng chờ.",
        );
      }

      if (![STATES.LISTENING, STATES.PAUSED].includes(activeMeeting.state)) {
        throw new Error("Cuộc họp chưa sẵn sàng để hủy.");
      }

      const cancelledMeeting = activeMeeting;
      const cancelledClient = transcriptionClient;
      const cancelledMeetingId = cancelledMeeting.meetingId;
      const cancelledStorageSettings = activeAudioStorageSettings;
      cancelledMeeting.transition(STATES.CANCELLED);
      if (transcriptionClient === cancelledClient) {
        transcriptionClient = null;
      }
      emitState();

      await teardownMeetingTranscription(
        cancelledClient,
        cancelledMeetingId,
        cancelledStorageSettings,
      );
      if (activeMeeting === cancelledMeeting) {
        activeAudioStorageSettings = null;
      }
      return cancelledMeeting.toJSON();
    }),
  );

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

  ipcMain.handle("google:open-sheet", async () => {
    const googleConfig = getGoogleWorkspaceConfig();

    if (googleConfig.authMode !== "oauth") {
      throw new Error(
        "Service account không có phiên Google trên trình duyệt để mở Sheet.",
      );
    }

    const auth = await getGoogleAuthClient(googleConfig, {
      interactive: false,
    });
    const url = await resolveExistingMeetingSpreadsheetUrl({
      auth,
      spreadsheetId: googleConfig.spreadsheetId,
    });

    if (!url) {
      throw new Error(
        "Chưa có Google Sheet. Sheet sẽ được tạo sau khi hoàn tất cuộc họp đầu tiên.",
      );
    }

    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle("google:open-calendar", async () => {
    const googleConfig = getGoogleWorkspaceConfig();

    if (googleConfig.authMode !== "oauth") {
      throw new Error(
        "Service account không có phiên Google trên trình duyệt để mở Calendar.",
      );
    }

    await getGoogleAuthClient(googleConfig, { interactive: false });
    await shell.openExternal("https://calendar.google.com");
    return true;
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

  app.whenReady().then(async () => {
    configureMediaPermissions();
    modelManager = new ModelManager({
      userDataPath: app.getPath("userData"),
    });
    summarySettingsStore = new SummarySettingsStore({
      filePath: path.join(app.getPath("userData"), "summary-ai-settings.json"),
      safeStorage,
    });
    storageSettingsStore = new StorageSettingsStore({
      filePath: path.join(app.getPath("userData"), "storage-settings.json"),
    });
    storageManager = new StorageManager({
      audioCacheDirectory: getAudioCacheDirectory(),
      localDocumentsDirectory: getOutputDirectory(),
      settingsStore: storageSettingsStore,
    });
    registerIpcHandlers();
    createWindow();
    runStorageMaintenance(() =>
      storageManager.cleanupExpiredAudio({
        protectedMeetingIds: getProtectedMeetingIds(),
      }),
    ).catch((error) => {
      console.warn("Không thể dọn cache âm thanh khi khởi động:", error.message);
    });
    storageCleanupTimer = setInterval(() => {
      runStorageMaintenance(() =>
        storageManager.cleanupExpiredAudio({
          protectedMeetingIds: getProtectedMeetingIds(),
        }),
      ).catch((error) => {
        console.warn("Không thể dọn cache âm thanh định kỳ:", error.message);
      });
    }, 60 * 60 * 1000);
    storageCleanupTimer.unref?.();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    googleAuthorizationController?.abort();
    googleAuthorizationController = null;

    if (process.platform !== "darwin") {
      app.quit();
    } else {
      teardownHeadlessMeeting().catch((error) => {
        console.warn("Không thể đóng dữ liệu cuộc họp:", error.message);
      });
    }
  });

  app.on("before-quit", (event) => {
    clearInterval(storageCleanupTimer);
    storageCleanupTimer = null;

    if (quitAfterStorageCleanup) {
      return;
    }

    const hasPendingWork = Boolean(
      transcriptionClient ||
        meetingStartPromise ||
        meetingTerminalPromise ||
        meetingTeardownPromise ||
        storageMaintenancePromise ||
        storageMutationPromise ||
        storageSettingsPromise,
    );

    if (!hasPendingWork) {
      return;
    }

    event.preventDefault();
    if (shutdownInProgress) {
      return;
    }

    shutdownInProgress = true;
    (async () => {
      await Promise.allSettled(
        [meetingStartPromise, meetingTerminalPromise].filter(Boolean),
      );

      const client = transcriptionClient;
      if (client) {
        const meetingId = activeMeeting?.meetingId;
        const settings = activeAudioStorageSettings;
        if ([STATES.LISTENING, STATES.PAUSED].includes(activeMeeting?.state)) {
          activeMeeting.transition(STATES.CANCELLED);
          emitState();
        }
        transcriptionClient = null;
        await teardownMeetingTranscription(client, meetingId, settings);
      }

      await Promise.allSettled(
        [
          meetingTeardownPromise,
          storageMaintenancePromise,
          storageMutationPromise,
          storageSettingsPromise,
        ].filter(Boolean),
      );
    })()
      .catch((error) => {
        console.warn("Không thể hoàn tất lưu trữ trước khi thoát:", error.message);
      })
      .finally(() => {
        quitAfterStorageCleanup = true;
        shutdownInProgress = false;
        app.quit();
      });
  });
}
