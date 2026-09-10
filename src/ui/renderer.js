const api = window.meetingAssistant;

const elements = {
  form: document.querySelector("#meeting-form"),
  source: document.querySelector("#meeting-source"),
  microphone: document.querySelector("#microphone"),
  keywords: document.querySelector("#keywords"),
  saveAudio: document.querySelector("#save-audio"),
  createCalendar: document.querySelector("#create-calendar"),
  startButton: document.querySelector("#start-button"),
  pauseButton: document.querySelector("#pause-button"),
  doneButton: document.querySelector("#done-button"),
  cancelButton: document.querySelector("#cancel-button"),
  transcript: document.querySelector("#transcript"),
  emptyTranscript: document.querySelector("#empty-transcript"),
  liveIndicator: document.querySelector("#live-indicator"),
  liveStatus: document.querySelector("#live-status"),
  timer: document.querySelector("#timer"),
  audioLevel: document.querySelector("#audio-level"),
  progressBox: document.querySelector("#progress-box"),
  progressMessage: document.querySelector("#progress-message"),
  errorBox: document.querySelector("#error-box"),
  configWarning: document.querySelector("#config-warning"),
  whisperModelsOpenButton: document.querySelector(
    "#whisper-models-open-button",
  ),
  whisperModelsDialog: document.querySelector("#whisper-models-dialog"),
  whisperModelsClose: document.querySelector("#whisper-models-close"),
  whisperModelsList: document.querySelector("#whisper-models-list"),
  storageOpenButton: document.querySelector("#storage-open-button"),
  storageDialog: document.querySelector("#storage-dialog"),
  storageClose: document.querySelector("#storage-close"),
  storageAudioSize: document.querySelector("#storage-audio-size"),
  storageAudioCount: document.querySelector("#storage-audio-count"),
  storageAudioPath: document.querySelector("#storage-audio-path"),
  storageDocumentsSize: document.querySelector("#storage-documents-size"),
  storageDocumentsCount: document.querySelector("#storage-documents-count"),
  storageDocumentsPath: document.querySelector("#storage-documents-path"),
  storageRetention: document.querySelector("#storage-retention"),
  storageRetentionHelp: document.querySelector("#storage-retention-help"),
  storageSaveSettings: document.querySelector("#storage-save-settings"),
  storageOpenAudioFolder: document.querySelector("#storage-open-audio-folder"),
  storageOpenDocumentsFolder: document.querySelector(
    "#storage-open-documents-folder",
  ),
  storageClearAudio: document.querySelector("#storage-clear-audio"),
  storageClearDocuments: document.querySelector("#storage-clear-documents"),
  storageMessage: document.querySelector("#storage-message"),
  summaryAiSettings: document.querySelector("#summary-ai-settings"),
  summaryAiOpenButton: document.querySelector("#summary-ai-open-button"),
  summaryAiClose: document.querySelector("#summary-ai-close"),
  summaryAiProvider: document.querySelector("#summary-ai-provider"),
  summaryAiModel: document.querySelector("#summary-ai-model"),
  summaryAiKey: document.querySelector("#summary-ai-key"),
  summaryAiKeyHelp: document.querySelector("#summary-ai-key-help"),
  summaryAiStatus: document.querySelector("#summary-ai-status"),
  summaryAiSave: document.querySelector("#summary-ai-save"),
  summaryAiTest: document.querySelector("#summary-ai-test"),
  summaryAiRemove: document.querySelector("#summary-ai-remove"),
  summaryAiMessage: document.querySelector("#summary-ai-message"),
  googleAccount: document.querySelector("#google-account"),
  googleAccountTrigger: document.querySelector("#google-account-trigger"),
  googleAccountAvatar: document.querySelector("#google-account-avatar"),
  googleAccountDropdown: document.querySelector("#google-account-dropdown"),
  googleAccountEmail: document.querySelector("#google-account-email"),
  googleAccountDetail: document.querySelector("#google-account-detail"),
  googleOpenSheetButton: document.querySelector("#google-open-sheet-button"),
  googleOpenCalendarButton: document.querySelector(
    "#google-open-calendar-button",
  ),
  googleAuthButton: document.querySelector("#google-auth-button"),
  googleAuthLabel: document.querySelector("#google-auth-label"),
  googleDisconnectButton: document.querySelector("#google-disconnect-button"),
  googleDisconnectLabel: document.querySelector("#google-disconnect-label"),
  resultPanel: document.querySelector("#result-panel"),
  resultTitle: document.querySelector("#result-title"),
  resultSummary: document.querySelector("#result-summary"),
  resultKeyPoints: document.querySelector("#result-key-points"),
  resultDecisions: document.querySelector("#result-decisions"),
  resultActions: document.querySelector("#result-actions-list"),
  resultQuestions: document.querySelector("#result-questions"),
  resultWarnings: document.querySelector("#result-warnings"),
  openLocalButton: document.querySelector("#open-local-button"),
  openDocButton: document.querySelector("#open-doc-button"),
  openSheetButton: document.querySelector("#open-sheet-button"),
  openCalendarButton: document.querySelector("#open-calendar-button"),
};

let currentState = "IDLE";
let timerHandle = null;
let timerStartedAt = null;
let latestConfigStatus = null;
let latestSummaryAiSettings = null;
let latestStorageStatus = null;
let storageReady = false;
let storageBusy = false;
let storageBusyCount = 0;
let storagePreferenceSequence = 0;
let summaryAiBusy = false;
let googleAction = null;
let googleActionSequence = 0;
let googleAccountMenuOpen = false;
const transcriptItems = new Map();

function downsampleBuffer(input, inputRate, outputRate) {
  if (outputRate === inputRate) {
    return input;
  }

  if (outputRate > inputRate) {
    throw new Error("Tần số đầu ra không được lớn hơn đầu vào.");
  }

  const ratio = inputRate / outputRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const start = Math.floor(outputIndex * ratio);
    const end = Math.min(Math.floor((outputIndex + 1) * ratio), input.length);
    let sum = 0;

    for (let inputIndex = start; inputIndex < end; inputIndex += 1) {
      sum += input[inputIndex];
    }

    output[outputIndex] = sum / Math.max(1, end - start);
  }

  return output;
}

function floatToPcm16(input) {
  const pcm = new Int16Array(input.length);

  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  return pcm.buffer;
}

class AudioCapture {
  constructor() {
    this.streams = [];
    this.audioContext = null;
    this.processor = null;
    this.sources = [];
    this.sending = false;
  }

  async prepare({ microphoneId, includeMicrophone, includeSystemAudio }) {
    await this.stop();

    const audioConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };

    if (microphoneId) {
      audioConstraints.deviceId = { exact: microphoneId };
    }

    if (includeMicrophone) {
      const microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false,
      });
      this.streams.push(microphoneStream);
    }

    if (includeSystemAudio) {
      let displayStream;

      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: {
            width: 2,
            height: 2,
            frameRate: 1,
          },
        });
      } catch (error) {
        throw new Error(`Không thể lấy âm thanh máy tính: ${error.message}`);
      }

      displayStream.getVideoTracks().forEach((track) => track.stop());

      if (displayStream.getAudioTracks().length === 0) {
        displayStream.getTracks().forEach((track) => track.stop());
        throw new Error(
          "Windows không trả về system audio. Hãy kiểm tra loa mặc định và quyền capture.",
        );
      }

      this.streams.push(displayStream);
    }

    if (this.streams.length === 0) {
      throw new Error("Hãy chọn ít nhất một nguồn âm thanh.");
    }

    this.audioContext = new AudioContext({ sampleRate: 48000 });
    await this.audioContext.resume();
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    const sourceCount = this.streams.length;

    for (const stream of this.streams) {
      const source = this.audioContext.createMediaStreamSource(stream);
      const gain = this.audioContext.createGain();
      gain.gain.value = 1 / sourceCount;
      source.connect(gain);
      gain.connect(this.processor);
      this.sources.push({ source, gain });
    }

    const silentOutput = this.audioContext.createGain();
    silentOutput.gain.value = 0;
    this.processor.connect(silentOutput);
    silentOutput.connect(this.audioContext.destination);
    this.sources.push({ source: silentOutput, gain: null });

    this.processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      let sumSquares = 0;

      for (let index = 0; index < input.length; index += 1) {
        sumSquares += input[index] * input[index];
      }

      const rms = Math.sqrt(sumSquares / input.length);
      const level = Math.min(100, Math.round(rms * 360));
      elements.audioLevel.style.width = `${level}%`;

      if (!this.sending) {
        return;
      }

      const downsampled = downsampleBuffer(
        input,
        this.audioContext.sampleRate,
        16000,
      );
      api.sendAudio(floatToPcm16(downsampled));
    };

    await refreshMicrophones();
  }

  startSending() {
    this.streams.forEach((stream) => {
      stream.getAudioTracks().forEach((track) => {
        track.enabled = true;
      });
    });
    this.sending = true;
  }

  pause() {
    this.sending = false;
    this.streams.forEach((stream) => {
      stream.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
    });
    elements.audioLevel.style.width = "0%";
  }

  resume() {
    this.startSending();
  }

  async drainAndStop() {
    if (
      this.sending &&
      this.processor &&
      this.audioContext?.state === "running"
    ) {
      const pendingBufferMs = Math.ceil(
        (this.processor.bufferSize / this.audioContext.sampleRate) * 1000,
      );
      await new Promise((resolve) => {
        setTimeout(resolve, pendingBufferMs + 20);
      });
    }

    await this.stop();
  }

  async stop() {
    this.sending = false;

    if (this.processor) {
      this.processor.onaudioprocess = null;
      this.processor.disconnect();
    }

    for (const entry of this.sources) {
      entry.source?.disconnect();
      entry.gain?.disconnect();
    }

    this.streams.forEach((stream) => {
      stream.getTracks().forEach((track) => track.stop());
    });
    this.streams = [];
    this.sources = [];
    this.processor = null;

    if (this.audioContext && this.audioContext.state !== "closed") {
      await this.audioContext.close();
    }

    this.audioContext = null;
    elements.audioLevel.style.width = "0%";
  }
}

const audioCapture = new AudioCapture();

function showError(message) {
  elements.errorBox.textContent = getUserErrorMessage(message);
  elements.errorBox.classList.remove("hidden");
}

function getUserErrorMessage(error, fallback = "Đã xảy ra lỗi. Vui lòng thử lại.") {
  const rawMessage =
    typeof error === "string" ? error : String(error?.message || "");
  const message = rawMessage
    .replace(
      /^Error invoking remote method ['"][^'"]+['"]:\s*(?:Error:\s*)?/i,
      "",
    )
    .replace(/^Error:\s*/i, "")
    .trim();

  return message || fallback;
}

function clearError() {
  elements.errorBox.textContent = "";
  elements.errorBox.classList.add("hidden");
}

function setChip(element, ok, label) {
  element.textContent = label;
  element.classList.remove("status-pending", "status-ok", "status-warning");
  element.classList.add(ok ? "status-ok" : "status-warning");
}

function meetingIsBusy() {
  return ["CONNECTING", "LISTENING", "PAUSED", "FINALIZING"].includes(
    currentState,
  );
}

function formatBytes(value) {
  const bytes = Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${new Intl.NumberFormat("vi-VN", {
    maximumFractionDigits: size >= 100 ? 0 : size >= 10 ? 1 : 2,
  }).format(size)} ${units[unitIndex]}`;
}

function setStorageMessage(message = "", type = "") {
  elements.storageMessage.textContent = message;
  elements.storageMessage.className = [
    "notice",
    type,
    message ? "" : "hidden",
  ]
    .filter(Boolean)
    .join(" ");
}

function updateStorageRetentionHelp(settings = latestStorageStatus?.settings || {}) {
  if (settings.initialized !== true) {
    elements.storageRetentionHelp.textContent =
      "Tự động dọn chưa được kích hoạt. Bấm Lưu thiết lập để xác nhận chính sách này.";
  } else if (!elements.saveAudio.checked) {
    elements.storageRetentionHelp.textContent =
      "Ứng dụng hiện không lưu âm thanh thô. Chính sách này sẽ dùng khi bạn bật lưu audio.";
  } else if (elements.storageRetention.value === "after_meeting") {
    elements.storageRetentionHelp.textContent =
      "Cache âm thanh sẽ được xóa ngay sau khi cuộc họp kết thúc.";
  } else {
    elements.storageRetentionHelp.textContent =
      "Chỉ cache âm thanh hết hạn bị dọn; model Whisper không bao giờ bị tự động xóa.";
  }
}

function updateStorageControlState() {
  const locked = storageBusy || meetingIsBusy() || !storageReady;
  elements.saveAudio.disabled = locked;
  elements.storageRetention.disabled = locked;
  elements.storageSaveSettings.disabled = locked;
  // A slow disk/OneDrive scan must never trap the user inside the dialog.
  elements.storageClose.disabled = false;
  elements.storageOpenAudioFolder.disabled = storageBusy;
  elements.storageOpenDocumentsFolder.disabled = storageBusy;
  elements.storageClearAudio.disabled =
    locked || !latestStorageStatus?.audioCache?.fileCount;
  elements.storageClearDocuments.disabled =
    locked || !latestStorageStatus?.localDocuments?.fileCount;
  elements.startButton.disabled =
    locked || !latestConfigStatus?.geminiConfigured;
}

function renderStorageStatus(status, options = {}) {
  latestStorageStatus = status;
  storageReady = true;
  const audio = status.audioCache || {};
  const documents = status.localDocuments || {};
  const settings = status.settings || {};

  elements.storageAudioSize.textContent = formatBytes(audio.bytes);
  elements.storageAudioCount.textContent = `${audio.fileCount || 0} tệp`;
  elements.storageAudioPath.textContent = audio.path || "";
  elements.storageDocumentsSize.textContent = formatBytes(documents.bytes);
  elements.storageDocumentsCount.textContent = `${documents.fileCount || 0} tệp`;
  elements.storageDocumentsPath.textContent = documents.path || "";
  elements.storageRetention.value = settings.audioRetention || "after_meeting";

  if (!options.preserveAudioChoice && !meetingIsBusy()) {
    elements.saveAudio.checked = Boolean(settings.saveRawAudio);
  }

  updateStorageRetentionHelp(settings);

  const totalBytes = (audio.bytes || 0) + (documents.bytes || 0);
  setChip(
    elements.storageOpenButton,
    true,
    `Lưu trữ: ${formatBytes(totalBytes)}`,
  );
  updateStorageControlState();
}

async function loadStorageStatus(options = {}) {
  const preferenceSequence = storagePreferenceSequence;

  try {
    const status = await api.getStorageStatus();
    renderStorageStatus(status, {
      ...options,
      preserveAudioChoice:
        options.preserveAudioChoice ||
        preferenceSequence !== storagePreferenceSequence,
    });
    return status;
  } catch (error) {
    setChip(elements.storageOpenButton, false, "Lưu trữ: Không đọc được");
    if (!latestStorageStatus) {
      storageReady = false;
    }
    updateStorageControlState();
    throw error;
  }
}

function setStorageBusy(busy) {
  storageBusyCount = Math.max(0, storageBusyCount + (busy ? 1 : -1));
  storageBusy = storageBusyCount > 0;
  updateStorageControlState();
}

async function saveStorageSettings(options = {}) {
  const selectedRetention =
    elements.storageRetention.value ||
    latestStorageStatus?.settings?.audioRetention ||
    "after_meeting";
  setStorageBusy(true);

  try {
    const freshStatus = await api.getStorageStatus();
    renderStorageStatus(freshStatus, { preserveAudioChoice: true });
    elements.storageRetention.value = selectedRetention;
    updateStorageRetentionHelp(freshStatus.settings);
    const currentSettings = freshStatus.settings || {};
    const audio = freshStatus.audioCache || {};
    const policyWillChange =
      currentSettings.initialized !== true ||
      currentSettings.audioRetention !== selectedRetention;

    if (policyWillChange && (audio.fileCount || 0) > 0) {
      const confirmed = window.confirm(
        `Áp dụng chính sách tự động dọn cho ${formatBytes(audio.bytes || 0)} cache âm thanh (${audio.fileCount} tệp)?\n\n` +
          "Cache đã hết thời hạn theo lựa chọn mới có thể được xóa ngay. Model Whisper không bị ảnh hưởng.",
      );
      if (!confirmed) {
        return freshStatus;
      }
    }

    const status = await api.saveStorageSettings({
      audioRetention: selectedRetention,
      confirmCleanup: true,
    });
    renderStorageStatus(status);
    if (!options.silent) {
      setStorageMessage("Đã lưu thiết lập dung lượng trên thiết bị.", "success");
    }
    return status;
  } catch (error) {
    const message = getUserErrorMessage(error);
    if (options.silent) {
      showError(message);
    } else {
      setStorageMessage(message, "error");
    }
    throw error;
  } finally {
    setStorageBusy(false);
  }
}

async function saveAudioPreference() {
  const preferenceSequence = ++storagePreferenceSequence;
  const saveRawAudio = elements.saveAudio.checked;
  setStorageBusy(true);

  try {
    const status = await api.saveStorageSettings({ saveRawAudio });
    renderStorageStatus(status, {
      preserveAudioChoice: preferenceSequence !== storagePreferenceSequence,
    });
  } catch (error) {
    showError(getUserErrorMessage(error));
    if (preferenceSequence === storagePreferenceSequence) {
      elements.saveAudio.checked = Boolean(
        latestStorageStatus?.settings?.saveRawAudio,
      );
    }
    throw error;
  } finally {
    setStorageBusy(false);
  }
}

async function openStorageDialog() {
  setStorageMessage();
  if (!elements.storageDialog.open) {
    elements.storageDialog.showModal();
  }

  setStorageBusy(true);
  try {
    await loadStorageStatus({ preserveAudioChoice: true });
  } catch (error) {
    setStorageMessage(getUserErrorMessage(error), "error");
  } finally {
    setStorageBusy(false);
  }
}

function closeStorageDialog() {
  if (elements.storageDialog.open) {
    elements.storageDialog.close();
  }
}

async function clearAudioCache() {
  setStorageMessage();
  setStorageBusy(true);

  try {
    const freshStatus = await api.getStorageStatus();
    renderStorageStatus(freshStatus, { preserveAudioChoice: true });
    const bytes = freshStatus.audioCache?.bytes || 0;
    const fileCount = freshStatus.audioCache?.fileCount || 0;

    if (!fileCount) {
      setStorageMessage("Cache âm thanh hiện đang trống.", "success");
      return;
    }

    const confirmed = window.confirm(
      `Xóa ${formatBytes(bytes)} cache âm thanh (${fileCount} tệp) khỏi máy?\n\n` +
        "Model Whisper và biên bản cục bộ sẽ được giữ nguyên. Thao tác này không thể hoàn tác.",
    );
    if (!confirmed) {
      return;
    }

    const result = await api.clearAudioCache();
    renderStorageStatus(result.status, { preserveAudioChoice: true });
    const failed = result.cleanup?.failedEntries?.length || 0;
    setStorageMessage(
      failed
        ? `Đã giải phóng ${formatBytes(result.cleanup.bytesFreed)}, nhưng còn ${failed} mục không thể xóa.`
        : `Đã giải phóng ${formatBytes(result.cleanup?.bytesFreed || 0)} cache âm thanh.`,
      failed ? "warning" : "success",
    );
  } catch (error) {
    setStorageMessage(getUserErrorMessage(error), "error");
  } finally {
    setStorageBusy(false);
  }
}

async function clearLocalDocuments() {
  setStorageMessage();
  setStorageBusy(true);

  try {
    const freshStatus = await api.getStorageStatus();
    renderStorageStatus(freshStatus, { preserveAudioChoice: true });
    const bytes = freshStatus.localDocuments?.bytes || 0;
    const fileCount = freshStatus.localDocuments?.fileCount || 0;

    if (!fileCount) {
      setStorageMessage("Chưa có biên bản cục bộ để xóa.", "success");
      return;
    }

    const confirmed = window.confirm(
      `Xóa ${formatBytes(bytes)} biên bản cục bộ (${fileCount} tệp) khỏi máy?\n\n` +
        "Nếu thư mục nằm trong OneDrive, thao tác xóa có thể được đồng bộ. Google Docs không bị ảnh hưởng.",
    );
    if (!confirmed) {
      return;
    }

    const result = await api.clearLocalDocuments();
    renderStorageStatus(result.status, { preserveAudioChoice: true });
    const failed = result.cleanup?.failedFiles?.length || 0;
    elements.openLocalButton.disabled =
      !result.latestLocalDocumentAvailable;
    setStorageMessage(
      failed
        ? `Đã giải phóng ${formatBytes(result.cleanup.bytesFreed)}, nhưng còn ${failed} tệp không thể xóa.`
        : `Đã giải phóng ${formatBytes(result.cleanup?.bytesFreed || 0)} biên bản cục bộ.`,
      failed ? "warning" : "success",
    );
  } catch (error) {
    setStorageMessage(getUserErrorMessage(error), "error");
  } finally {
    setStorageBusy(false);
  }
}

async function openStorageFolder(openFolder) {
  setStorageMessage();
  try {
    await openFolder();
  } catch (error) {
    setStorageMessage(getUserErrorMessage(error), "error");
  }
}

function isCurrentGoogleAction(action) {
  return googleAction?.id === action.id;
}

function getGoogleAccountInitial(email, fallback = "G") {
  const normalized = String(email || "")
    .split("@")[0]
    .replace(/[^a-z0-9]/gi, "");
  return (normalized[0] || fallback).toUpperCase();
}

function setGoogleAccountMenuOpen(open, options = {}) {
  const accountVisible = !elements.googleAccount.classList.contains("hidden");
  googleAccountMenuOpen = Boolean(open) && accountVisible;
  elements.googleAccountDropdown.classList.toggle(
    "hidden",
    !googleAccountMenuOpen,
  );
  elements.googleAccount.classList.toggle("menu-open", googleAccountMenuOpen);
  elements.googleAccountTrigger.setAttribute(
    "aria-expanded",
    String(googleAccountMenuOpen),
  );

  if (googleAccountMenuOpen && options.focusFirst) {
    elements.googleAccountDropdown
      .querySelector(".google-menu-item:not(.hidden):not(:disabled)")
      ?.focus();
  } else if (!googleAccountMenuOpen && options.restoreFocus) {
    elements.googleAccountTrigger.focus();
  }
}

function getEnabledGoogleMenuItems() {
  return Array.from(
    elements.googleAccountDropdown.querySelectorAll(
      ".google-menu-item:not(.hidden):not(:disabled)",
    ),
  );
}

async function openGoogleWorkspaceShortcut(button, openShortcut) {
  setGoogleAccountMenuOpen(false);
  clearError();
  button.disabled = true;

  try {
    await openShortcut();
  } catch (error) {
    showError(getUserErrorMessage(error));
  } finally {
    if (latestConfigStatus) {
      renderGoogleAccount(latestConfigStatus);
    }
  }
}

function renderGoogleAccount(status) {
  if (!status) {
    return;
  }

  const isOauth = status.googleAuthMode === "oauth";
  const isServiceAccount = status.googleAuthMode === "service_account";
  const needsReauth = Boolean(status.googleNeedsReauth);
  const isConnected =
    isOauth && Boolean(status.googleAuthorized) && !needsReauth;
  const accountEmail = status.googleAccountEmail?.trim() || "";
  const authorizing = googleAction?.type === "authorize";
  const disconnecting = googleAction?.type === "disconnect";

  if (isOauth) {
    elements.googleAccountEmail.textContent =
      accountEmail || (isConnected ? "Tài khoản Google" : "Chưa đăng nhập");
    elements.googleAccountDetail.textContent = needsReauth
      ? "Phiên đăng nhập đã hết hạn"
      : isConnected
        ? "Docs, Sheets và Calendar"
        : "Đăng nhập để đồng bộ biên bản";
    elements.googleAccount.classList.remove("hidden");
    elements.googleAuthLabel.textContent = authorizing
      ? "Mở lại đăng nhập Google"
      : needsReauth
        ? "Kết nối lại Google"
        : "Đăng nhập Google";
    elements.googleDisconnectLabel.textContent = disconnecting
      ? "Đang đăng xuất..."
      : "Đăng xuất";
    elements.googleAuthButton.classList.toggle("hidden", isConnected);
    elements.googleDisconnectButton.classList.toggle("hidden", !isConnected);
  } else if (isServiceAccount) {
    elements.googleAccountEmail.textContent = accountEmail || "Service account";
    elements.googleAccountDetail.textContent =
      "Tài khoản kỹ thuật · không cần đăng nhập";
    elements.googleAccount.classList.remove("hidden");
    elements.googleAuthButton.classList.add("hidden");
    elements.googleDisconnectButton.classList.add("hidden");
  } else {
    elements.googleAccount.classList.add("hidden");
    elements.googleAuthButton.classList.add("hidden");
    elements.googleDisconnectButton.classList.add("hidden");
    setGoogleAccountMenuOpen(false);
  }

  const actionsDisabled = meetingIsBusy() || disconnecting;
  elements.googleAuthButton.disabled =
    actionsDisabled || !status.googleCredentialsPresent;
  elements.googleDisconnectButton.disabled =
    meetingIsBusy() || Boolean(googleAction);
  elements.googleOpenSheetButton.disabled = !isConnected;
  elements.googleOpenCalendarButton.disabled = !isConnected;
  elements.googleAccountAvatar.textContent = getGoogleAccountInitial(
    accountEmail,
    isServiceAccount ? "S" : "G",
  );
  const accountLabel = accountEmail || (isConnected ? "Google" : "chưa đăng nhập");
  elements.googleAccountTrigger.setAttribute(
    "aria-label",
    `Mở menu tài khoản Google: ${accountLabel}`,
  );
  elements.googleAccountTrigger.title = accountEmail || "Tài khoản Google";
}

async function loadConfigStatus(expectedActionId = null) {
  const status = await api.getConfigStatus();

  if (
    expectedActionId !== null &&
    googleAction?.id !== expectedActionId
  ) {
    return null;
  }

  latestConfigStatus = status;
  setChip(
    elements.summaryAiOpenButton,
    status.geminiConfigured,
    "AI Summary",
  );
  renderGoogleAccount(status);
  updateStorageControlState();

  const warnings = [];

  if (!status.geminiConfigured) {
    warnings.push("Mở AI Summary và lưu API key Gemini để bắt đầu nhận dạng âm thanh.");
  }

  if (!status.googleCredentialsPresent) {
    warnings.push("Chưa tìm thấy credentials Google phù hợp với GOOGLE_AUTH_MODE.");
  }

  if (
    status.googleAuthMode === "oauth" &&
    status.googleCredentialsPresent &&
    status.googleNeedsReauth
  ) {
    warnings.push(
      "Phiên đăng nhập Google đã hết hạn. Hãy kết nối lại để tiếp tục đồng bộ.",
    );
  } else if (
    status.googleAuthMode === "oauth" &&
    status.googleCredentialsPresent &&
    !status.googleAuthorized
  ) {
    warnings.push(
      "Đăng nhập Google để tạo Docs và đồng bộ liên kết lên Sheets, Calendar.",
    );
  }

  if (status.docsNeedsSharedDrive) {
    warnings.push(
      "Service account chưa có GOOGLE_DRIVE_FOLDER_ID thuộc Shared Drive; ứng dụng vẫn lưu Markdown cục bộ.",
    );
  }

  if (!status.sheetConfigured || !status.calendarConfigured) {
    warnings.push("Sheets/Calendar chưa đủ cấu hình; bước nào thiếu sẽ được bỏ qua.");
  }

  elements.configWarning.textContent = warnings.join("\n");
  elements.configWarning.classList.toggle("hidden", warnings.length === 0);
  return status;
}

function getSummaryProviderSettings(providerId) {
  return latestSummaryAiSettings?.providers.find(
    (provider) => provider.id === providerId,
  );
}

function setSummaryAiMessage(message = "", type = "") {
  elements.summaryAiMessage.textContent = message;
  elements.summaryAiMessage.className = [
    "notice",
    type,
    message ? "" : "hidden",
  ]
    .filter(Boolean)
    .join(" ");
}

function updateSummaryAiActionState() {
  const provider = getSummaryProviderSettings(
    elements.summaryAiProvider.value,
  );

  elements.summaryAiProvider.disabled = summaryAiBusy;
  elements.summaryAiModel.disabled = summaryAiBusy;
  elements.summaryAiKey.disabled = summaryAiBusy;
  elements.summaryAiSave.disabled = summaryAiBusy;
  elements.summaryAiTest.disabled = summaryAiBusy;
  elements.summaryAiRemove.disabled =
    summaryAiBusy || !provider?.configured;
}

function setSummaryAiBusy(busy) {
  summaryAiBusy = busy;
  updateSummaryAiActionState();
}

function renderSummaryProviderForm(providerId) {
  const provider =
    getSummaryProviderSettings(providerId) ||
    latestSummaryAiSettings?.providers[0];

  if (!provider) {
    return;
  }

  elements.summaryAiProvider.value = provider.id;
  elements.summaryAiModel.replaceChildren();

  for (const model of provider.models || []) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent =
      model === provider.defaultModel ? `${model} (mặc định)` : model;
    elements.summaryAiModel.append(option);
  }

  elements.summaryAiModel.value = provider.models.includes(provider.model)
    ? provider.model
    : provider.defaultModel;
  elements.summaryAiKey.value = "";

  const isActive =
    provider.id === latestSummaryAiSettings.activeProvider;
  elements.summaryAiStatus.className = "settings-status";

  if (provider.configured && isActive) {
    elements.summaryAiStatus.textContent = "Đang dùng";
    elements.summaryAiStatus.classList.add("configured");
  } else if (provider.configured) {
    elements.summaryAiStatus.textContent = "Đã lưu";
    elements.summaryAiStatus.classList.add("configured");
  } else {
    elements.summaryAiStatus.textContent = "Chưa cấu hình";
    elements.summaryAiStatus.classList.add("missing");
  }

  if (provider.configured) {
    elements.summaryAiKey.placeholder =
      "Đã lưu an toàn — để trống để giữ key hiện tại";
    elements.summaryAiKeyHelp.textContent =
      isActive
        ? `${provider.label} đang được dùng để tóm tắt.`
        : `Key ${provider.label} đã lưu. Bấm Lưu để chọn làm AI tóm tắt.`;
  } else {
    elements.summaryAiKey.placeholder = `Nhập API key cho ${provider.label}`;
    elements.summaryAiKeyHelp.textContent =
      "Khóa API được mã hóa an toàn trên máy tính của bạn.";
  }

  updateSummaryAiActionState();
}

function renderSummaryAiSettings(settings) {
  latestSummaryAiSettings = settings;
  renderSummaryProviderForm(settings.activeProvider);

  if (settings.error) {
    setSummaryAiMessage(settings.error, "error");
    openSummaryAiSettings();
  } else {
    setSummaryAiMessage();
  }
}

function openSummaryAiSettings() {
  if (!elements.summaryAiSettings.open) {
    elements.summaryAiSettings.showModal();
  }
}

function closeSummaryAiSettings() {
  elements.summaryAiSettings.close();
}

async function loadSummaryAiSettings() {
  const settings = await api.getSummaryAiSettings();
  renderSummaryAiSettings(settings);
  return settings;
}

async function saveSummaryAiSettings() {
  setSummaryAiMessage();
  setSummaryAiBusy(true);

  try {
    const settings = await api.saveSummaryAiSettings({
      provider: elements.summaryAiProvider.value,
      model: elements.summaryAiModel.value,
      apiKey: elements.summaryAiKey.value,
    });
    renderSummaryAiSettings(settings);
    const provider = getSummaryProviderSettings(settings.activeProvider);
    setSummaryAiMessage(
      `Đã lưu ${provider?.label || "cấu hình AI"} bằng kho mã hóa của thiết bị.`,
      "success",
    );
  } catch (error) {
    setSummaryAiMessage(getUserErrorMessage(error), "error");
  } finally {
    setSummaryAiBusy(false);
  }
}

async function testSummaryAiConnection() {
  setSummaryAiMessage(
    "Đang gửi một request nhỏ để kiểm tra key và model…",
    "warning",
  );
  setSummaryAiBusy(true);

  try {
    const result = await api.testSummaryAiConnection({
      provider: elements.summaryAiProvider.value,
      model: elements.summaryAiModel.value,
      apiKey: elements.summaryAiKey.value,
    });
    setSummaryAiMessage(result.message, "success");
  } catch (error) {
    setSummaryAiMessage(getUserErrorMessage(error), "error");
  } finally {
    setSummaryAiBusy(false);
  }
}

async function removeSummaryAiSettings() {
  const provider = getSummaryProviderSettings(
    elements.summaryAiProvider.value,
  );

  if (
    !provider?.configured ||
    !window.confirm(`Xóa API key đã lưu của ${provider.label}?`)
  ) {
    return;
  }

  setSummaryAiBusy(true);

  try {
    const settings = await api.removeSummaryAiSettings(provider.id);
    renderSummaryAiSettings(settings);
    setSummaryAiMessage(
      `Đã xóa API key của ${provider.label} khỏi thiết bị.`,
      "success",
    );
  } catch (error) {
    setSummaryAiMessage(getUserErrorMessage(error), "error");
  } finally {
    setSummaryAiBusy(false);
  }
}

async function refreshMicrophones() {
  const previousValue = elements.microphone.value;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const microphones = devices.filter((device) => device.kind === "audioinput");
  elements.microphone.replaceChildren();

  if (microphones.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Microphone mặc định";
    elements.microphone.append(option);
    return;
  }

  microphones.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `Microphone ${index + 1}`;
    elements.microphone.append(option);
  });

  if ([...elements.microphone.options].some((option) => option.value === previousValue)) {
    elements.microphone.value = previousValue;
  }
}

function setFormDisabled(disabled) {
  elements.form
    .querySelectorAll("input, select, button")
    .forEach((control) => {
      control.disabled = disabled;
    });

  if (!disabled) {
    updateStorageControlState();
    loadConfigStatus().catch(showError);
  }
}

function startTimer() {
  timerStartedAt = Date.now();
  clearInterval(timerHandle);
  timerHandle = setInterval(() => {
    const elapsedSeconds = Math.floor((Date.now() - timerStartedAt) / 1000);
    const hours = String(Math.floor(elapsedSeconds / 3600)).padStart(2, "0");
    const minutes = String(Math.floor((elapsedSeconds % 3600) / 60)).padStart(2, "0");
    const seconds = String(elapsedSeconds % 60).padStart(2, "0");
    elements.timer.textContent = `${hours}:${minutes}:${seconds}`;
  }, 500);
}

function stopTimer() {
  clearInterval(timerHandle);
  timerHandle = null;
}

function renderTranscript() {
  const items = [...transcriptItems.values()].sort(
    (left, right) => left.order - right.order,
  );

  elements.emptyTranscript.classList.toggle("hidden", items.length > 0);
  elements.transcript
    .querySelectorAll(".transcript-segment")
    .forEach((segment) => segment.remove());

  for (const item of items) {
    const segment = document.createElement("p");
    segment.className = `transcript-segment${item.completed ? "" : " partial"}`;
    segment.textContent = item.completed ? item.transcript : item.partial;
    elements.transcript.append(segment);
  }

  elements.transcript.scrollTop = elements.transcript.scrollHeight;
}

function resetTranscript() {
  transcriptItems.clear();
  renderTranscript();
}

function updateControls(state) {
  currentState = state || "IDLE";
  const listening = currentState === "LISTENING";
  const paused = currentState === "PAUSED";
  const active = listening || paused;
  const finalizing = currentState === "FINALIZING";

  elements.pauseButton.disabled = !active;
  elements.doneButton.disabled = !active;
  elements.cancelButton.disabled = !active;
  elements.pauseButton.textContent = paused ? "Tiếp tục" : "Tạm dừng";
  elements.liveIndicator.className = `live-indicator ${
    listening ? "active" : paused ? "paused" : "idle"
  }`;

  const labels = {
    IDLE: "Sẵn sàng",
    CONNECTING: "Đang kết nối…",
    LISTENING: "Đang lắng nghe",
    PAUSED: "Đã tạm dừng",
    FINALIZING: "Đang hoàn thiện và tóm tắt nội dung…",
    COMPLETED: "Đã hoàn tất",
    FAILED: "Xử lý thất bại",
    CANCELLED: "Đã hủy",
  };
  elements.liveStatus.textContent = labels[currentState] || currentState;
  elements.progressBox.classList.toggle("hidden", !finalizing);

  if (latestConfigStatus) {
    renderGoogleAccount(latestConfigStatus);
  }
  updateStorageControlState();

  if (["COMPLETED", "FAILED", "CANCELLED"].includes(currentState)) {
    stopTimer();
    setFormDisabled(false);
  }
}

function addListItems(container, items, emptyText) {
  container.replaceChildren();
  const values = Array.isArray(items) && items.length ? items : [emptyText];

  values.forEach((value) => {
    const item = document.createElement("li");
    item.textContent = value;
    container.append(item);
  });
}

function renderResult(result) {
  const { notes } = result;
  elements.openLocalButton.disabled = false;
  elements.resultTitle.textContent =
    result.meeting?.title?.trim() || notes.title || "Biên bản cuộc họp";
  elements.resultSummary.textContent = notes.summary || "Không có tóm tắt.";
  addListItems(elements.resultKeyPoints, notes.keyPoints, "Không có thông tin.");
  addListItems(elements.resultDecisions, notes.decisions, "Không có quyết định.");
  addListItems(
    elements.resultQuestions,
    notes.openQuestions,
    "Không có vấn đề chưa giải quyết.",
  );

  elements.resultActions.replaceChildren();
  const actionItems = notes.actionItems || [];

  if (actionItems.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "Không có công việc được xác định.";
    elements.resultActions.append(empty);
  } else {
    actionItems.forEach((action) => {
      const item = document.createElement("div");
      item.className = "action-item";
      const task = document.createElement("strong");
      task.textContent = action.task;
      const metadata = document.createElement("span");
      metadata.textContent = `Phụ trách: ${action.owner || "Chưa xác định"} · Hạn: ${
        action.dueDate || "Chưa xác định"
      }`;
      item.append(task, metadata);
      elements.resultActions.append(item);
    });
  }

  elements.openDocButton.classList.toggle("hidden", !result.googleDocument?.documentUrl);
  elements.openSheetButton.classList.toggle("hidden", !result.sheet?.spreadsheetUrl);
  elements.openCalendarButton.classList.toggle("hidden", !result.calendar?.htmlLink);
  elements.resultWarnings.textContent = (result.warnings || []).join("\n");
  elements.resultWarnings.classList.toggle("hidden", !result.warnings?.length);
  elements.resultPanel.classList.remove("hidden");
  elements.resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();

  if (!storageReady) {
    showError(
      "Chưa đọc xong thiết lập lưu trữ. Hãy mở Quản lý dung lượng và thử lại.",
    );
    return;
  }

  const metadata = {
    source: elements.source.value,
    saveRawAudio: elements.saveAudio.checked,
    createCalendarIfMissing: elements.createCalendar.checked,
    consentConfirmed: true,
    keywords: elements.keywords.value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  };

  setFormDisabled(true);
  elements.resultPanel.classList.add("hidden");
  resetTranscript();

  try {
    await audioCapture.prepare({
      microphoneId: elements.microphone.value,
      includeMicrophone: ["microphone", "both"].includes(elements.source.value),
      includeSystemAudio: ["system", "both"].includes(elements.source.value),
    });
    await api.startMeeting(metadata);
    audioCapture.startSending();
    startTimer();
  } catch (error) {
    await audioCapture.stop();
    setFormDisabled(false);
    updateControls("FAILED");
    showError(error.message);
  }
});

elements.pauseButton.addEventListener("click", async () => {
  clearError();

  try {
    if (currentState === "PAUSED") {
      await api.resumeMeeting();
      audioCapture.resume();
    } else {
      audioCapture.pause();
      await api.pauseMeeting();
    }
  } catch (error) {
    showError(error.message);
  }
});

elements.doneButton.addEventListener("click", async () => {
  clearError();
  updateControls("FINALIZING");
  elements.progressMessage.textContent =
    "Đang xử lý phần âm thanh cuối và hoàn thiện transcript…";
  elements.progressBox.classList.remove("hidden");

  try {
    try {
      await audioCapture.drainAndStop();
    } catch (error) {
      console.warn("Không thể đóng audio capture hoàn toàn:", error.message);
    }

    const result = await api.finishMeeting();
    renderResult(result);
  } catch (error) {
    showError(error.message);
  } finally {
    loadStorageStatus().catch((error) => showError(error.message));
  }
});

elements.cancelButton.addEventListener("click", async () => {
  clearError();
  await audioCapture.stop();

  try {
    await api.cancelMeeting();
  } catch (error) {
    showError(error.message);
  } finally {
    loadStorageStatus().catch((error) => showError(error.message));
  }
});

elements.source.addEventListener("change", () => {
  elements.microphone.disabled = elements.source.value === "system";
});

elements.microphone.disabled = elements.source.value === "system";

elements.saveAudio.addEventListener("change", () => {
  saveAudioPreference().catch(() => {});
});

elements.storageRetention.addEventListener("change", () => {
  updateStorageRetentionHelp();
});

elements.storageOpenButton.addEventListener("click", openStorageDialog);
elements.storageClose.addEventListener("click", closeStorageDialog);
elements.storageSaveSettings.addEventListener("click", () => {
  saveStorageSettings().catch(() => {});
});
elements.storageClearAudio.addEventListener("click", clearAudioCache);
elements.storageClearDocuments.addEventListener("click", clearLocalDocuments);
elements.storageOpenAudioFolder.addEventListener("click", () => {
  openStorageFolder(() => api.openAudioCacheFolder());
});
elements.storageOpenDocumentsFolder.addEventListener("click", () => {
  openStorageFolder(() => api.openLocalDocumentsFolder());
});

elements.summaryAiProvider.addEventListener("change", () => {
  renderSummaryProviderForm(elements.summaryAiProvider.value);
  setSummaryAiMessage();
});
elements.summaryAiOpenButton.addEventListener("click", openSummaryAiSettings);
elements.summaryAiClose.addEventListener("click", closeSummaryAiSettings);
elements.summaryAiSave.addEventListener("click", saveSummaryAiSettings);
elements.summaryAiTest.addEventListener("click", testSummaryAiConnection);
elements.summaryAiRemove.addEventListener("click", removeSummaryAiSettings);

async function authorizeGoogleAccount() {
  setGoogleAccountMenuOpen(false);
  clearError();
  const action = {
    type: "authorize",
    id: ++googleActionSequence,
  };
  googleAction = action;
  renderGoogleAccount(latestConfigStatus);

  try {
    await api.authorizeGoogle({ force: true });
    if (!isCurrentGoogleAction(action)) {
      return;
    }

    await loadConfigStatus(action.id);
  } catch (error) {
    if (isCurrentGoogleAction(action)) {
      showError(error.message);
    }
  } finally {
    if (isCurrentGoogleAction(action)) {
      googleAction = null;
      if (latestConfigStatus) {
        renderGoogleAccount(latestConfigStatus);
      }
    }
  }
}

elements.googleAuthButton.addEventListener("click", authorizeGoogleAccount);

elements.googleAccountTrigger.addEventListener("click", () => {
  setGoogleAccountMenuOpen(!googleAccountMenuOpen);
});

elements.googleAccountTrigger.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowDown") {
    return;
  }

  event.preventDefault();
  setGoogleAccountMenuOpen(true, { focusFirst: true });
});

elements.googleAccountDropdown.addEventListener("keydown", (event) => {
  if (!googleAccountMenuOpen || !["ArrowDown", "ArrowUp"].includes(event.key)) {
    return;
  }

  const menuItems = getEnabledGoogleMenuItems();
  if (!menuItems.length) {
    return;
  }

  event.preventDefault();
  const currentIndex = menuItems.indexOf(document.activeElement);
  const direction = event.key === "ArrowDown" ? 1 : -1;
  const nextIndex =
    currentIndex === -1
      ? direction === 1
        ? 0
        : menuItems.length - 1
      : (currentIndex + direction + menuItems.length) % menuItems.length;
  menuItems[nextIndex].focus();
});

document.addEventListener("click", (event) => {
  if (
    googleAccountMenuOpen &&
    !elements.googleAccount.contains(event.target)
  ) {
    setGoogleAccountMenuOpen(false);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && googleAccountMenuOpen) {
    setGoogleAccountMenuOpen(false, { restoreFocus: true });
  }
});

elements.googleOpenSheetButton.addEventListener("click", () => {
  openGoogleWorkspaceShortcut(elements.googleOpenSheetButton, () =>
    api.openAccountGoogleSheet(),
  );
});

elements.googleOpenCalendarButton.addEventListener("click", () => {
  openGoogleWorkspaceShortcut(elements.googleOpenCalendarButton, () =>
    api.openAccountGoogleCalendar(),
  );
});

elements.googleDisconnectButton.addEventListener("click", async () => {
  setGoogleAccountMenuOpen(false);
  clearError();
  const action = {
    type: "disconnect",
    id: ++googleActionSequence,
  };
  googleAction = action;
  renderGoogleAccount(latestConfigStatus);

  try {
    await api.disconnectGoogle();
    if (!isCurrentGoogleAction(action)) {
      return;
    }

    await loadConfigStatus(action.id);
  } catch (error) {
    if (isCurrentGoogleAction(action)) {
      showError(error.message);
    }
  } finally {
    if (isCurrentGoogleAction(action)) {
      googleAction = null;
      if (latestConfigStatus) {
        renderGoogleAccount(latestConfigStatus);
      }
    }
  }
});

elements.openLocalButton.addEventListener("click", () => {
  api.openLocalDocument().catch((error) => showError(error.message));
});

elements.openDocButton.addEventListener("click", () => {
  api.openGoogleDocument().catch((error) => showError(error.message));
});

elements.openSheetButton.addEventListener("click", () => {
  api.openGoogleSheet().catch((error) => showError(error.message));
});

elements.openCalendarButton.addEventListener("click", () => {
  api.openCalendar().catch((error) => showError(error.message));
});

elements.whisperModelsOpenButton?.addEventListener("click", openWhisperModelsDialog);
elements.whisperModelsClose?.addEventListener("click", closeWhisperModelsDialog);

let whisperModels = [];

async function loadWhisperModels() {
  if (!api?.listWhisperModels) return;
  try {
    whisperModels = await api.listWhisperModels();
    renderWhisperModels();
    updateWhisperStatusButton();
  } catch (err) {
    console.error("Lỗi tải danh sách model Whisper:", err);
  }
}

function updateWhisperStatusButton() {
  if (!elements.whisperModelsOpenButton) return;
  const hasDownloaded = whisperModels.some((m) => m.downloaded);
  if (hasDownloaded) {
    const active =
      whisperModels.find((m) => m.isActive && m.downloaded) ||
      whisperModels.find((m) => m.downloaded);
    const shortName = active ? active.name.split(" ")[0] : "Sẵn sàng";
    elements.whisperModelsOpenButton.textContent = `Transcript: ${shortName}`;
    elements.whisperModelsOpenButton.className =
      "status-chip status-button status-ready";
  } else {
    elements.whisperModelsOpenButton.textContent = "Transcript: Chưa có model";
    elements.whisperModelsOpenButton.className =
      "status-chip status-button status-pending";
  }
}

function renderWhisperModels() {
  if (!elements.whisperModelsList) return;
  elements.whisperModelsList.innerHTML = "";

  for (const model of whisperModels) {
    const card = document.createElement("div");
    card.className = `whisper-model-card ${model.isActive ? "active" : ""}`;

    const badges = [];
    if (model.recommended) {
      badges.push('<span class="model-badge recommended">Khuyến nghị</span>');
    }
    if (model.downloaded) {
      badges.push('<span class="model-badge downloaded">Đã tải</span>');
    }
    if (model.isActive) {
      badges.push('<span class="model-badge active-badge">Đang dùng</span>');
    }

    card.innerHTML = `
      <div class="whisper-model-header">
        <span class="whisper-model-title">${model.name}</span>
        <div class="whisper-model-meta">
          <span>${model.sizeDisplay}</span>
          ${badges.join(" ")}
        </div>
      </div>
      <div class="whisper-model-desc">${model.description}</div>
      <div class="whisper-model-actions" id="actions-${model.id}">
        ${
          model.downloading
            ? `
            <div class="whisper-progress-container">
              <div class="whisper-progress-fill" style="width: ${model.progress}%"></div>
            </div>
            <span style="font-size: 11px; min-width: 35px;">${model.progress}%</span>
            <button class="text-button danger compact" data-action="cancel" data-id="${model.id}">Hủy</button>
          `
            : model.downloaded
              ? `
            ${
              !model.isActive
                ? `<button class="primary-button compact" data-action="select" data-id="${model.id}">Chọn sử dụng</button>`
                : ""
            }
            <button class="text-button danger compact" data-action="delete" data-id="${model.id}">Xóa</button>
          `
              : `<button class="primary-button compact" data-action="download" data-id="${model.id}">Tải về (${model.sizeDisplay})</button>`
        }
      </div>
    `;

    elements.whisperModelsList.appendChild(card);
  }

  elements.whisperModelsList
    .querySelectorAll("button[data-action]")
    .forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const action = e.currentTarget.dataset.action;
        const modelId = e.currentTarget.dataset.id;
        if (action === "download") {
          btn.disabled = true;
          btn.textContent = "Đang tải…";
          try {
            await api.downloadWhisperModel(modelId);
            await loadWhisperModels();
          } catch (err) {
            showError(`Lỗi tải model: ${err.message}`);
            await loadWhisperModels();
          }
        } else if (action === "cancel") {
          await api.cancelWhisperDownload(modelId);
          await loadWhisperModels();
        } else if (action === "delete") {
          if (confirm("Bạn có chắc muốn xóa model này?")) {
            await api.deleteWhisperModel(modelId);
            await loadWhisperModels();
          }
        } else if (action === "select") {
          await api.selectWhisperModel(modelId);
          await loadWhisperModels();
        }
      });
    });
}

function openWhisperModelsDialog() {
  loadWhisperModels();
  if (typeof elements.whisperModelsDialog?.showModal === "function") {
    elements.whisperModelsDialog.showModal();
  }
}

function closeWhisperModelsDialog() {
  if (elements.whisperModelsDialog?.open) {
    elements.whisperModelsDialog.close();
  }
}

if (api?.onWhisperDownloadProgress) {
  api.onWhisperDownloadProgress((info) => {
    const model = whisperModels.find((m) => m.id === info.modelId);
    if (model) {
      model.downloading = true;
      model.progress = info.progress;
      renderWhisperModels();
    }
  });
}

api.onTranscription((event) => {
  if (event.type === "delta" || event.type === "completed") {
    transcriptItems.set(event.item.itemId, event.item);
    renderTranscript();
  }

  if (event.type === "error") {
    showError(event.message);
  }

  if (event.type === "warning") {
    showError(event.message);
  }

  if (event.type === "reconnecting" || event.type === "reconnected") {
    elements.liveStatus.textContent = event.message;
  }
});

api.onMeetingState((meeting) => {
  updateControls(meeting?.state || "IDLE");
});

api.onProgress(({ step, message }) => {
  elements.progressMessage.textContent = message;
  elements.progressBox.classList.remove("hidden");

  const progressLabels = {
    transcript: "Đang hoàn thiện transcript…",
    summarizing: "Đang tóm tắt nội dung cuộc họp…",
    "saving-local": "Đang tạo biên bản…",
    "google-auth": "Đang đồng bộ biên bản…",
    "google-docs": "Đang đồng bộ biên bản…",
    "google-calendar": "Đang đồng bộ biên bản…",
    "google-sheets": "Đang đồng bộ biên bản…",
  };

  if (currentState === "FINALIZING" && progressLabels[step]) {
    elements.liveStatus.textContent = progressLabels[step];
  }
});

Promise.all([
  loadConfigStatus(),
  loadStorageStatus(),
  loadSummaryAiSettings(),
  loadWhisperModels(),
  refreshMicrophones(),
]).catch((error) => {
  showError(error.message);
});
