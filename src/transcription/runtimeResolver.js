const fs = require("node:fs");
const path = require("node:path");

function getSidecarExecutablePath(appRoot = process.cwd()) {
  const isWindows = process.platform === "win32";
  const binaryName = isWindows ? "whisper-sidecar.exe" : "whisper-sidecar";

  const candidatePaths = [
    path.join(appRoot, "resources", "bin", "win-x64", binaryName),
    path.join(appRoot, "bin", binaryName),
    path.join(appRoot, "native", "whisper-sidecar", "build", "Release", binaryName),
    path.join(appRoot, "native", "whisper-sidecar", "build", binaryName),
  ];

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      return {
        executable: candidate,
        isNative: true,
        args: [],
      };
    }
  }

  // Fallback dev mock script
  const mockScriptPath = path.join(
    appRoot,
    "src",
    "transcription",
    "mockSidecar.js"
  );
  return {
    executable: process.execPath,
    isNative: false,
    args: [mockScriptPath],
    env: {
      ELECTRON_RUN_AS_NODE: "1",
    },
  };
}

module.exports = {
  getSidecarExecutablePath,
};
