const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { ModelManager } = require("../src/transcription/modelManager");

test("ModelManager lists models with status in designated directory", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "whisper-models-test-"));
  try {
    const manager = new ModelManager({ modelsDir: tmpDir });
    const models = manager.listModels();
    assert.ok(Array.isArray(models));
    assert.ok(models.length > 0);

    // Ban đầu chưa có model nào được tải
    const medium = models.find((m) => m.id === "medium-q5_0");
    assert.ok(medium);
    assert.equal(medium.downloaded, false);
    assert.equal(medium.isActive, true);

    // Tạo file giả lập model đã tải
    const fakeModelFile = path.join(tmpDir, medium.fileName);
    fs.writeFileSync(fakeModelFile, Buffer.alloc(2 * 1024 * 1024)); // 2MB

    assert.equal(manager.isModelDownloaded("medium-q5_0"), true);
    const updatedModels = manager.listModels();
    const updatedMedium = updatedModels.find((m) => m.id === "medium-q5_0");
    assert.equal(updatedMedium.downloaded, true);
    assert.equal(updatedMedium.localSizeBytes, 2 * 1024 * 1024);

    // Đổi active model
    const small = models.find((m) => m.id === "small-q5_1");
    const fakeSmallModelFile = path.join(tmpDir, small.fileName);
    fs.writeFileSync(fakeSmallModelFile, Buffer.alloc(2 * 1024 * 1024));
    manager.setActiveModel("small-q5_1");
    assert.equal(manager.getActiveModel().id, "small-q5_1");

    // Lựa chọn vẫn được giữ khi khởi tạo lại ứng dụng
    const restartedManager = new ModelManager({ modelsDir: tmpDir });
    assert.equal(restartedManager.getActiveModel().id, "small-q5_1");
    assert.equal(
      restartedManager
        .listModels()
        .find((model) => model.id === "small-q5_1").isActive,
      true,
    );

    // Nếu model đang chọn bị xóa, tự chuyển sang model đã tải khác và lưu lại
    restartedManager.deleteModel("small-q5_1");
    assert.equal(restartedManager.getActiveModel().id, "medium-q5_0");
    const afterDeleteRestart = new ModelManager({ modelsDir: tmpDir });
    assert.equal(afterDeleteRestart.getActiveModel().id, "medium-q5_0");

    // Xóa model
    manager.deleteModel("medium-q5_0");
    assert.equal(fs.existsSync(fakeModelFile), false);
    assert.equal(manager.isModelDownloaded("medium-q5_0"), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
