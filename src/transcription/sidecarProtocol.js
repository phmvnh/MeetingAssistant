const MESSAGE_TYPES = {
  AUDIO_FRAME: 0x01,
  FLUSH: 0x02,
  CLOSE: 0x03,
};

/**
 * Đóng gói frame nhị phân để gửi qua stdin của sidecar process:
 * [1 byte Type][4 bytes UInt32BE Payload Length][Payload Bytes]
 */
function encodeFrame(type, payload = Buffer.alloc(0)) {
  const bufPayload = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const header = Buffer.alloc(5);
  header.writeUInt8(type, 0);
  header.writeUInt32BE(bufPayload.length, 1);
  return Buffer.concat([header, bufPayload]);
}

function encodeAudioFrame(pcmBuffer) {
  return encodeFrame(MESSAGE_TYPES.AUDIO_FRAME, pcmBuffer);
}

function encodeFlushFrame() {
  return encodeFrame(MESSAGE_TYPES.FLUSH);
}

function encodeCloseFrame() {
  return encodeFrame(MESSAGE_TYPES.CLOSE);
}

/**
 * Bộ giải mã NDJSON stream (các dòng JSON cách nhau bởi \n) từ stdout của sidecar.
 */
class NdjsonParser {
  constructor(onEvent) {
    this.onEvent = onEvent;
    this.buffer = "";
  }

  push(chunk) {
    this.buffer += chunk.toString("utf8");
    const lines = this.buffer.split(/\r?\n/);
    // Giữ lại phần chưa hoàn chỉnh ở cuối
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (this.onEvent) {
          this.onEvent(parsed);
        }
      } catch (err) {
        if (this.onEvent) {
          this.onEvent({
            type: "parse-error",
            raw: trimmed,
            error: err.message,
          });
        }
      }
    }
  }

  flush() {
    const trimmed = this.buffer.trim();
    this.buffer = "";
    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed);
        if (this.onEvent) {
          this.onEvent(parsed);
        }
      } catch (err) {
        if (this.onEvent) {
          this.onEvent({
            type: "parse-error",
            raw: trimmed,
            error: err.message,
          });
        }
      }
    }
  }
}

/**
 * Bộ giải mã binary frame từ stream (phục vụ test hoặc mock sidecar).
 */
class BinaryFrameDecoder {
  constructor(onFrame) {
    this.onFrame = onFrame;
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 5) {
      const type = this.buffer.readUInt8(0);
      const payloadLength = this.buffer.readUInt32BE(1);
      if (this.buffer.length < 5 + payloadLength) {
        // Chưa đủ byte cho toàn bộ frame
        break;
      }
      const payload = this.buffer.subarray(5, 5 + payloadLength);
      this.buffer = this.buffer.subarray(5 + payloadLength);
      if (this.onFrame) {
        this.onFrame({ type, payload });
      }
    }
  }
}

module.exports = {
  MESSAGE_TYPES,
  encodeFrame,
  encodeAudioFrame,
  encodeFlushFrame,
  encodeCloseFrame,
  NdjsonParser,
  BinaryFrameDecoder,
};
