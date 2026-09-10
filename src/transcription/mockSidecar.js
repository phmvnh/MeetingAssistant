const { BinaryFrameDecoder, MESSAGE_TYPES } = require("./sidecarProtocol");

function startMockSidecar() {
  process.stdout.write(JSON.stringify({ type: "ready", model: "mock-whisper" }) + "\n");

  let segOrder = 1;
  let receivedAudioBytes = 0;

  const decoder = new BinaryFrameDecoder((frame) => {
    if (frame.type === MESSAGE_TYPES.CLOSE) {
      process.exit(0);
    } else if (frame.type === MESSAGE_TYPES.FLUSH) {
      if (receivedAudioBytes > 0) {
        process.stdout.write(
          JSON.stringify({
            type: "completed",
            itemId: `seg-${segOrder}`,
            order: segOrder,
            transcript: "Nội dung chép lời hoàn tất từ local whisper sidecar.",
          }) + "\n"
        );
        segOrder++;
        receivedAudioBytes = 0;
      }
      process.stdout.write(JSON.stringify({ type: "flush-completed" }) + "\n");
    } else if (frame.type === MESSAGE_TYPES.AUDIO_FRAME) {
      receivedAudioBytes += frame.payload.length;
      // Giả lập phát delta sau mỗi ~32KB (1 giây audio)
      if (receivedAudioBytes >= 32000 && receivedAudioBytes < 64000) {
        process.stdout.write(
          JSON.stringify({
            type: "delta",
            itemId: `seg-${segOrder}`,
            order: segOrder,
            transcript: "Đang nhận diện giọng nói cuộc họp...",
          }) + "\n"
        );
      }
    }
  });

  process.stdin.on("data", (chunk) => {
    decoder.push(chunk);
  });
}

if (require.main === module) {
  startMockSidecar();
}

module.exports = {
  startMockSidecar,
};
