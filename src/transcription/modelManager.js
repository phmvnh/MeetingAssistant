const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const http = require("node:http");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const {
  MODEL_CATALOG,
  DEFAULT_MODEL_ID,
  getModelInfo,
  listAvailableModels,
} = require("./modelCatalog");

class ModelManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.modelsDir =
      options.modelsDir ||
      (options.userDataPath
        ? path.join(options.userDataPath, "models", "whisper")
        : path.join(process.cwd(), "models", "whisper"));
    this.settingsPath =
      options.settingsPath || path.join(this.modelsDir, "settings.json");
    this.defaultModelId = getModelInfo(options.defaultModelId)
      ? options.defaultModelId
      : DEFAULT_MODEL_ID;
    this.activeModelId =
      this._loadActiveModelId() || this.defaultModelId;
    this.activeDownloads = new Map();
  }

  _loadActiveModelId() {
    try {
      if (!fs.existsSync(this.settingsPath)) {
        return null;
      }

      const settings = JSON.parse(fs.readFileSync(this.settingsPath, "utf8"));
      return getModelInfo(settings?.activeModelId)
        ? settings.activeModelId
        : null;
    } catch {
      return null;
    }
  }

  _persistActiveModelId(modelId) {
    const settingsDirectory = path.dirname(this.settingsPath);
    fs.mkdirSync(settingsDirectory, { recursive: true });
    const tempPath =
      `${this.settingsPath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;

    try {
      fs.writeFileSync(
        tempPath,
        JSON.stringify(
          {
            version: 1,
            activeModelId: modelId,
          },
          null,
          2,
        ),
        "utf8",
      );

      if (fs.existsSync(this.settingsPath)) {
        fs.unlinkSync(this.settingsPath);
      }
      fs.renameSync(tempPath, this.settingsPath);
    } catch {
      if (fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // ignore
        }
      }
      throw new Error(
        "Không thể lưu lựa chọn model Transcript trên máy tính.",
      );
    }
  }

  _applyFallbackModel(modelId) {
    this.activeModelId = modelId;
    try {
      this._persistActiveModelId(modelId);
    } catch (error) {
      this.emit("settings-error", error);
    }
  }

  ensureDirectory() {
    if (!fs.existsSync(this.modelsDir)) {
      fs.mkdirSync(this.modelsDir, { recursive: true });
    }
  }

  getModelFilePath(modelId) {
    const info = getModelInfo(modelId);
    if (!info) return null;
    return path.join(this.modelsDir, info.fileName);
  }

  isModelDownloaded(modelId) {
    const filePath = this.getModelFilePath(modelId);
    if (!filePath) return false;
    try {
      if (!fs.existsSync(filePath)) return false;
      const stat = fs.statSync(filePath);
      return stat.size > 1024 * 1024; // Phải có kích thước hợp lệ
    } catch {
      return false;
    }
  }

  listModels() {
    this.ensureDirectory();
    const catalog = listAvailableModels();
    const models = catalog.map((model) => {
      const filePath = this.getModelFilePath(model.id);
      const isDownloaded = this.isModelDownloaded(model.id);
      let localSize = 0;
      if (isDownloaded && filePath) {
        try {
          localSize = fs.statSync(filePath).size;
        } catch {
          localSize = 0;
        }
      }

      const isDownloading = this.activeDownloads.has(model.id);
      const downloadInfo = this.activeDownloads.get(model.id);

      return {
        ...model,
        downloaded: isDownloaded,
        downloading: isDownloading,
        progress: downloadInfo ? downloadInfo.progress : (isDownloaded ? 100 : 0),
        localPath: isDownloaded ? filePath : null,
        localSizeBytes: localSize,
      };
    });

    const selectedModel = models.find(
      (model) => model.id === this.activeModelId,
    );
    if (!selectedModel?.downloaded) {
      const fallbackModel =
        models.find((model) => model.downloaded) ||
        models.find((model) => model.id === this.defaultModelId);

      if (fallbackModel && fallbackModel.id !== this.activeModelId) {
        this._applyFallbackModel(fallbackModel.id);
      }
    }

    return models.map((model) => ({
      ...model,
      isActive: model.id === this.activeModelId,
    }));
  }

  getActiveModel() {
    const list = this.listModels();
    const active = list.find((m) => m.id === this.activeModelId);
    if (active) return active;
    const downloaded = list.find((m) => m.downloaded);
    if (downloaded) {
      this.activeModelId = downloaded.id;
      return downloaded;
    }
    return list[0] || null;
  }

  setActiveModel(modelId) {
    const info = getModelInfo(modelId);
    if (!info) {
      throw new Error(`Model ID không tồn tại: ${modelId}`);
    }

    if (!this.isModelDownloaded(modelId)) {
      throw new Error(
        `Model ${info.name} chưa được tải về máy tính.`,
      );
    }

    this._persistActiveModelId(modelId);
    this.activeModelId = modelId;
    this.emit("active-model-changed", modelId);
    return this.getActiveModel();
  }

  deleteModel(modelId) {
    const filePath = this.getModelFilePath(modelId);
    if (this.activeDownloads.has(modelId)) {
      this.cancelDownload(modelId);
    }
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    const partPath = `${filePath}.part`;
    if (fs.existsSync(partPath)) {
      fs.unlinkSync(partPath);
    }

    if (this.activeModelId === modelId) {
      const fallback = this.getActiveModel();
      this.emit("active-model-changed", fallback?.id || null);
    }

    this.emit("model-deleted", modelId);
    return true;
  }

  cancelDownload(modelId) {
    const download = this.activeDownloads.get(modelId);
    if (download) {
      if (download.abortController) {
        download.abortController.abort();
      }
      this.activeDownloads.delete(modelId);
      const filePath = this.getModelFilePath(modelId);
      const partPath = `${filePath}.part`;
      if (fs.existsSync(partPath)) {
        try {
          fs.unlinkSync(partPath);
        } catch {
          // ignore
        }
      }
      this.emit("download-cancelled", modelId);
      return true;
    }
    return false;
  }

  async downloadModel(modelId, options = {}) {
    const model = getModelInfo(modelId);
    if (!model) {
      throw new Error(`Không tìm thấy thông tin model: ${modelId}`);
    }

    if (this.isModelDownloaded(modelId) && !options.force) {
      return this.getModelFilePath(modelId);
    }

    if (this.activeDownloads.has(modelId)) {
      throw new Error(`Model ${modelId} đang được tải xuống.`);
    }

    this.ensureDirectory();
    const targetPath = this.getModelFilePath(modelId);
    const tempPath = `${targetPath}.part`;

    const abortController = new AbortController();
    const downloadInfo = {
      modelId,
      progress: 0,
      downloadedBytes: 0,
      totalBytes: model.sizeBytes,
      abortController,
    };
    this.activeDownloads.set(modelId, downloadInfo);

    try {
      const url = model.downloadUrls[0];
      await this._fetchFile(url, tempPath, (downloaded, total) => {
        downloadInfo.downloadedBytes = downloaded;
        if (total > 0) downloadInfo.totalBytes = total;
        downloadInfo.progress = total > 0 ? Math.round((downloaded / total) * 100) : 0;
        this.emit("download-progress", {
          modelId,
          progress: downloadInfo.progress,
          downloadedBytes: downloaded,
          totalBytes: downloadInfo.totalBytes,
        });
        if (options.onProgress) {
          options.onProgress(downloadInfo);
        }
      }, abortController.signal);

      // Atomic rename
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
      fs.renameSync(tempPath, targetPath);

      this.activeDownloads.delete(modelId);
      this.emit("download-completed", { modelId, filePath: targetPath });
      return targetPath;
    } catch (err) {
      this.activeDownloads.delete(modelId);
      if (fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // ignore
        }
      }
      if (err.name === "AbortError" || abortController.signal.aborted) {
        throw new Error("Đã hủy tải model.");
      }
      throw err;
    }
  }

  _fetchFile(fileUrl, destPath, onProgress, signal) {
    return new Promise((resolve, reject) => {
      const fileStream = fs.createWriteStream(destPath);

      const requestUrl = (currentUrl, redirectCount = 0) => {
        if (redirectCount > 5) {
          fileStream.close();
          return reject(new Error("Quá nhiều lần chuyển hướng tải (redirect loop)."));
        }

        const client = currentUrl.startsWith("https") ? https : http;
        const req = client.get(currentUrl, { signal }, (res) => {
          if (
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            const nextUrl = new URL(res.headers.location, currentUrl).href;
            return requestUrl(nextUrl, redirectCount + 1);
          }

          if (res.statusCode !== 200) {
            fileStream.close();
            return reject(new Error(`Tải model thất bại, mã HTTP: ${res.statusCode}`));
          }

          const totalBytes = parseInt(res.headers["content-length"] || "0", 10);
          let downloadedBytes = 0;

          res.on("data", (chunk) => {
            downloadedBytes += chunk.length;
            if (onProgress) {
              onProgress(downloadedBytes, totalBytes);
            }
          });

          res.pipe(fileStream);

          fileStream.on("finish", () => {
            fileStream.close(() => resolve());
          });
        });

        req.on("error", (err) => {
          fileStream.close();
          reject(err);
        });
      };

      requestUrl(fileUrl);
    });
  }
}

module.exports = {
  ModelManager,
};
