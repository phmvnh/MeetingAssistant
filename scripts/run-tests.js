const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const testsDirectory = path.join(__dirname, "..", "tests");
const testFiles = fs
  .readdirSync(testsDirectory)
  .filter((fileName) => fileName.endsWith(".test.js"))
  .sort()
  .map((fileName) => path.join(testsDirectory, fileName));

if (testFiles.length === 0) {
  console.error("Không tìm thấy file *.test.js.");
  process.exitCode = 1;
} else {
  const result = spawnSync(process.execPath, ["--test", ...testFiles], {
    stdio: "inherit",
  });
  process.exitCode = result.status ?? 1;
}
