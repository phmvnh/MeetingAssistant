const MODEL_CATALOG = {
  "medium-q5_0": {
    id: "medium-q5_0",
    name: "Medium (Cân bằng - Khuyến nghị)",
    description: "Cân bằng tối ưu giữa độ chính xác tiếng Việt và tốc độ xử lý.",
    fileName: "ggml-medium-q5_0.bin",
    sizeBytes: 539200000,
    sizeDisplay: "514 MB",
    recommended: true,
    sha256: "0c78a0bc7c76840742f534be7ac47ef93844f2ffbc049fdb7876a4dfec1ea5aa",
    downloadUrls: [
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin",
    ],
  },
  "small-q5_1": {
    id: "small-q5_1",
    name: "Small (Nhanh & Máy nhẹ)",
    description: "Xử lý nhanh, phù hợp cho máy tính cấu hình vừa hoặc CPU cũ.",
    fileName: "ggml-small-q5_1.bin",
    sizeBytes: 190000000,
    sizeDisplay: "181 MB",
    recommended: false,
    sha256: "8e75faeecdb5a420b925b3cf556c4d7ecfdfdf13fe25501bc5b3400a4fb79c46",
    downloadUrls: [
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin",
    ],
  },
  medium: {
    id: "medium",
    name: "Medium FP16 (Độ chính xác tối đa)",
    description: "Chất lượng chép lời cao nhất, yêu cầu máy tính cấu hình mạnh (CPU/RAM).",
    fileName: "ggml-medium.bin",
    sizeBytes: 1530000000,
    sizeDisplay: "1.42 GB",
    recommended: false,
    sha256: "fd9727b6e1217c2f614f9b698455c4777604b76d2349da13b973437a602f2aa1",
    downloadUrls: [
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
    ],
  },
  "large-v3-turbo-q5_0": {
    id: "large-v3-turbo-q5_0",
    name: "Large V3 Turbo (Cao cấp)",
    description: "Mô hình thế hệ mới nhất, tối ưu tốc độ và nhận diện đa ngôn ngữ.",
    fileName: "ggml-large-v3-turbo-q5_0.bin",
    sizeBytes: 574000000,
    sizeDisplay: "547 MB",
    recommended: false,
    sha256: "2ae54942cf7b0b2e3c0ee0bc0d099951666687a7442eb12720d20ef35496ee8f",
    downloadUrls: [
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin",
    ],
  },
};

const DEFAULT_MODEL_ID = "medium-q5_0";

function getModelInfo(modelId) {
  return MODEL_CATALOG[modelId] || null;
}

function listAvailableModels() {
  return Object.values(MODEL_CATALOG).map((item) => ({ ...item }));
}

function getDefaultModel() {
  return { ...MODEL_CATALOG[DEFAULT_MODEL_ID] };
}

module.exports = {
  MODEL_CATALOG,
  DEFAULT_MODEL_ID,
  getModelInfo,
  listAvailableModels,
  getDefaultModel,
};
