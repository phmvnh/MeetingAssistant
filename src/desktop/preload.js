const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);

  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("meetingAssistant", {
  getConfigStatus: () => ipcRenderer.invoke("app:config-status"),
  getStorageStatus: () => ipcRenderer.invoke("storage:get-status"),
  saveStorageSettings: (settings) =>
    ipcRenderer.invoke("storage:save-settings", settings),
  clearAudioCache: () => ipcRenderer.invoke("storage:clear-audio"),
  clearLocalDocuments: () =>
    ipcRenderer.invoke("storage:clear-local-documents"),
  openAudioCacheFolder: () =>
    ipcRenderer.invoke("storage:open-audio-folder"),
  openLocalDocumentsFolder: () =>
    ipcRenderer.invoke("storage:open-local-documents-folder"),
  getSummaryAiSettings: () =>
    ipcRenderer.invoke("summary-ai:get-settings"),
  saveSummaryAiSettings: (settings) =>
    ipcRenderer.invoke("summary-ai:save", settings),
  testSummaryAiConnection: (settings) =>
    ipcRenderer.invoke("summary-ai:test", settings),
  removeSummaryAiSettings: (provider) =>
    ipcRenderer.invoke("summary-ai:remove", provider),
  startMeeting: (metadata) => ipcRenderer.invoke("meeting:start", metadata),
  sendAudio: (arrayBuffer) => ipcRenderer.send("meeting:audio", arrayBuffer),
  pauseMeeting: () => ipcRenderer.invoke("meeting:pause"),
  resumeMeeting: () => ipcRenderer.invoke("meeting:resume"),
  finishMeeting: () => ipcRenderer.invoke("meeting:done"),
  cancelMeeting: () => ipcRenderer.invoke("meeting:cancel"),
  authorizeGoogle: (options = {}) =>
    ipcRenderer.invoke("google:authorize", options),
  disconnectGoogle: () => ipcRenderer.invoke("google:disconnect"),
  openAccountGoogleSheet: () => ipcRenderer.invoke("google:open-sheet"),
  openAccountGoogleCalendar: () => ipcRenderer.invoke("google:open-calendar"),
  openLocalDocument: () => ipcRenderer.invoke("result:open-local"),
  openGoogleDocument: () => ipcRenderer.invoke("result:open-google-doc"),
  openGoogleSheet: () => ipcRenderer.invoke("result:open-google-sheet"),
  openCalendar: () => ipcRenderer.invoke("result:open-calendar"),
  listWhisperModels: () => ipcRenderer.invoke("whisper:list-models"),
  downloadWhisperModel: (modelId) =>
    ipcRenderer.invoke("whisper:download-model", modelId),
  cancelWhisperDownload: (modelId) =>
    ipcRenderer.invoke("whisper:cancel-download", modelId),
  deleteWhisperModel: (modelId) =>
    ipcRenderer.invoke("whisper:delete-model", modelId),
  selectWhisperModel: (modelId) =>
    ipcRenderer.invoke("whisper:select-model", modelId),
  onWhisperDownloadProgress: (callback) =>
    subscribe("whisper:download-progress", callback),
  onTranscription: (callback) => subscribe("transcription:event", callback),
  onMeetingState: (callback) => subscribe("meeting:state", callback),
  onProgress: (callback) => subscribe("meeting:progress", callback),
});
