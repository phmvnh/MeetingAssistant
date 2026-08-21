const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);

  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("meetingAssistant", {
  getConfigStatus: () => ipcRenderer.invoke("app:config-status"),
  startMeeting: (metadata) => ipcRenderer.invoke("meeting:start", metadata),
  sendAudio: (arrayBuffer) => ipcRenderer.send("meeting:audio", arrayBuffer),
  pauseMeeting: () => ipcRenderer.invoke("meeting:pause"),
  resumeMeeting: () => ipcRenderer.invoke("meeting:resume"),
  finishMeeting: () => ipcRenderer.invoke("meeting:done"),
  cancelMeeting: () => ipcRenderer.invoke("meeting:cancel"),
  authorizeGoogle: (options = {}) =>
    ipcRenderer.invoke("google:authorize", options),
  disconnectGoogle: () => ipcRenderer.invoke("google:disconnect"),
  openLocalDocument: () => ipcRenderer.invoke("result:open-local"),
  openGoogleDocument: () => ipcRenderer.invoke("result:open-google-doc"),
  openGoogleSheet: () => ipcRenderer.invoke("result:open-google-sheet"),
  openCalendar: () => ipcRenderer.invoke("result:open-calendar"),
  onTranscription: (callback) => subscribe("transcription:event", callback),
  onMeetingState: (callback) => subscribe("meeting:state", callback),
  onProgress: (callback) => subscribe("meeting:progress", callback),
});
