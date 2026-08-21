const path = require("node:path");
const { spawn } = require("node:child_process");

const electronPath = require("electron");
const projectRoot = path.join(__dirname, "..");
const environment = { ...process.env };

// Some IDE terminals inject this variable for their own Electron-based host.
// Keeping it would make the Meeting Assistant binary behave like plain Node.js.
delete environment.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, [projectRoot], {
  cwd: projectRoot,
  env: environment,
  stdio: "inherit",
  windowsHide: false,
});

child.on("error", (error) => {
  console.error("Không thể khởi động Electron:", error.message);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exitCode = code ?? 0;
});
