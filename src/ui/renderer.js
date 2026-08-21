const api = window.meetingAssistant;

const elements = {
  form: document.querySelector("#meeting-form"),
  title: document.querySelector("#meeting-title"),
  source: document.querySelector("#meeting-source"),
  microphone: document.querySelector("#microphone"),
  keywords: document.querySelector("#keywords"),
  systemAudio: document.querySelector("#system-audio"),
  createCalendar: document.querySelector("#create-calendar"),
  refreshDevices: document.querySelector("#refresh-devices"),
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
  geminiStatus: document.querySelector("#gemini-status"),
  googleStatus: document.querySelector("#google-status"),
  googleAccount: document.querySelector("#google-account"),
  googleAccountEmail: document.querySelector("#google-account-email"),
  googleAccountDetail: document.querySelector("#google-account-detail"),
  googleAuthButton: document.querySelector("#google-auth-button"),
  googleSwitchButton: document.querySelector("#google-switch-button"),
  googleDisconnectButton: document.querySelector("#google-disconnect-button"),
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
let googleAction = null;
let googleActionSequence = 0;
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

  async prepare({ microphoneId, includeSystemAudio }) {
    await this.stop();

    const audioConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };

    if (microphoneId) {
      audioConstraints.deviceId = { exact: microphoneId };
    }

    const microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
      video: false,
    });
    this.streams.push(microphoneStream);

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
  elements.errorBox.textContent = message;
  elements.errorBox.classList.remove("hidden");
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

function isCurrentGoogleAction(action) {
  return googleAction?.id === action.id;
}

function renderGoogleAccount(status) {
  const isOauth = status.googleAuthMode === "oauth";
  const isServiceAccount = status.googleAuthMode === "service_account";
  const needsReauth = Boolean(status.googleNeedsReauth);
  const isConnected =
    isOauth && Boolean(status.googleAuthorized) && !needsReauth;
  const accountEmail = status.googleAccountEmail?.trim() || "";
  const authorizing = googleAction?.type === "authorize";
  const disconnecting = googleAction?.type === "disconnect";

  if (isOauth) {
    let label = "Google chưa đăng nhập";

    if (!status.googleCredentialsPresent) {
      label = "Thiếu Google OAuth";
    } else if (needsReauth) {
      label = "Google cần kết nối lại";
    } else if (isConnected) {
      label = "Google đã kết nối";
    }

    setChip(
      elements.googleStatus,
      isConnected && status.googleCredentialsPresent,
      label,
    );

    elements.googleAccountEmail.textContent =
      accountEmail || (isConnected ? "Tài khoản Google" : "Chưa có tài khoản");
    elements.googleAccountDetail.textContent = needsReauth
      ? "Phiên đăng nhập đã hết hạn"
      : isConnected
        ? "Docs, Sheets và Calendar"
        : "Đăng nhập để đồng bộ biên bản";
    elements.googleAccount.classList.remove("hidden");
    elements.googleAuthButton.textContent = authorizing
      ? "Mở lại đăng nhập Google"
      : needsReauth
        ? "Kết nối lại Google"
        : "Đăng nhập Google";
    elements.googleSwitchButton.textContent = authorizing
      ? "Mở lại trang chọn tài khoản"
      : "Đổi tài khoản";
    elements.googleAuthButton.classList.toggle("hidden", isConnected);
    elements.googleSwitchButton.classList.toggle("hidden", !isConnected);
    elements.googleDisconnectButton.classList.toggle("hidden", !isConnected);
  } else if (isServiceAccount) {
    const ready =
      Boolean(status.googleAuthorized) && status.googleCredentialsPresent;
    setChip(
      elements.googleStatus,
      ready,
      ready ? "Google service account sẵn sàng" : "Thiếu service account",
    );
    elements.googleAccountEmail.textContent = accountEmail || "Service account";
    elements.googleAccountDetail.textContent =
      "Tài khoản kỹ thuật · không cần đăng nhập";
    elements.googleAccount.classList.remove("hidden");
    elements.googleAuthButton.classList.add("hidden");
    elements.googleSwitchButton.classList.add("hidden");
    elements.googleDisconnectButton.classList.add("hidden");
  } else {
    setChip(elements.googleStatus, false, "Cấu hình Google không hợp lệ");
    elements.googleAccount.classList.add("hidden");
    elements.googleAuthButton.classList.add("hidden");
    elements.googleSwitchButton.classList.add("hidden");
    elements.googleDisconnectButton.classList.add("hidden");
  }

  const actionsDisabled = meetingIsBusy() || disconnecting;
  elements.googleAuthButton.disabled =
    actionsDisabled || !status.googleCredentialsPresent;
  elements.googleSwitchButton.disabled = actionsDisabled;
  elements.googleDisconnectButton.disabled =
    meetingIsBusy() || Boolean(googleAction);
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
    elements.geminiStatus,
    status.geminiConfigured,
    status.geminiConfigured ? "Gemini đã cấu hình" : "Thiếu Gemini key",
  );
  renderGoogleAccount(status);
  elements.startButton.disabled = !status.geminiConfigured;

  const warnings = [];

  if (!status.geminiConfigured) {
    warnings.push("Thêm GEMINI_API_KEY vào .env để bắt đầu nhận dạng âm thanh.");
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
    FINALIZING: "Đang tạo biên bản",
    COMPLETED: "Đã hoàn tất",
    FAILED: "Xử lý thất bại",
    CANCELLED: "Đã hủy",
  };
  elements.liveStatus.textContent = labels[currentState] || currentState;
  elements.progressBox.classList.toggle("hidden", !finalizing);

  if (latestConfigStatus) {
    renderGoogleAccount(latestConfigStatus);
  }

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

  const metadata = {
    title: elements.title.value,
    source: elements.source.value,
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
      includeSystemAudio: elements.systemAudio.checked,
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
  elements.doneButton.disabled = true;
  elements.pauseButton.disabled = true;
  elements.cancelButton.disabled = true;
  await audioCapture.stop();

  try {
    const result = await api.finishMeeting();
    renderResult(result);
  } catch (error) {
    showError(error.message);
  }
});

elements.cancelButton.addEventListener("click", async () => {
  clearError();
  await audioCapture.stop();

  try {
    await api.cancelMeeting();
  } catch (error) {
    showError(error.message);
  }
});

elements.refreshDevices.addEventListener("click", () => {
  refreshMicrophones().catch((error) => showError(error.message));
});

elements.source.addEventListener("change", () => {
  if (["meet", "teams"].includes(elements.source.value)) {
    elements.systemAudio.checked = true;
  }
});

async function authorizeGoogleAccount() {
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
elements.googleSwitchButton.addEventListener("click", authorizeGoogleAccount);

elements.googleDisconnectButton.addEventListener("click", async () => {
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

api.onTranscription((event) => {
  if (event.type === "delta" || event.type === "completed") {
    transcriptItems.set(event.item.itemId, event.item);
    renderTranscript();
  }

  if (event.type === "error") {
    showError(event.message);
  }

  if (event.type === "reconnecting" || event.type === "reconnected") {
    elements.liveStatus.textContent = event.message;
  }
});

api.onMeetingState((meeting) => {
  updateControls(meeting?.state || "IDLE");
});

api.onProgress(({ message }) => {
  elements.progressMessage.textContent = message;
  elements.progressBox.classList.remove("hidden");
});

Promise.all([loadConfigStatus(), refreshMicrophones()]).catch((error) => {
  showError(error.message);
});
