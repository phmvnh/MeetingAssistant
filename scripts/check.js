const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.join(__dirname, "..");
const excludedDirectories = new Set([".git", "node_modules", "whisper.cpp"]);

function collectJavaScriptFiles(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      collectJavaScriptFiles(fullPath, output);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      output.push(fullPath);
    }
  }

  return output;
}

const files = collectJavaScriptFiles(projectRoot);
const failures = [];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    failures.push({
      file: path.relative(projectRoot, file),
      message: result.stderr || result.stdout,
    });
  }
}

if (failures.length) {
  failures.forEach((failure) => {
    console.error(`\n${failure.file}\n${failure.message}`);
  });
  process.exitCode = 1;
} else {
  console.log(`Syntax check: PASS (${files.length} JavaScript files)`);
}
