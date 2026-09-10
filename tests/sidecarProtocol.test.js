const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MESSAGE_TYPES,
  encodeFrame,
  encodeAudioFrame,
  encodeFlushFrame,
  encodeCloseFrame,
  NdjsonParser,
  BinaryFrameDecoder,
} = require("../src/transcription/sidecarProtocol");

test("sidecarProtocol encodes binary frames correctly", () => {
  const pcm = Buffer.from([0x01, 0x02, 0x03, 0x04]);
  const audioFrame = encodeAudioFrame(pcm);
  assert.equal(audioFrame.readUInt8(0), MESSAGE_TYPES.AUDIO_FRAME);
  assert.equal(audioFrame.readUInt32BE(1), 4);
  assert.deepEqual(audioFrame.subarray(5), pcm);

  const flushFrame = encodeFlushFrame();
  assert.equal(flushFrame.readUInt8(0), MESSAGE_TYPES.FLUSH);
  assert.equal(flushFrame.readUInt32BE(1), 0);

  const closeFrame = encodeCloseFrame();
  assert.equal(closeFrame.readUInt8(0), MESSAGE_TYPES.CLOSE);
  assert.equal(closeFrame.readUInt32BE(1), 0);
});

test("BinaryFrameDecoder decodes split chunks correctly", () => {
  const framesReceived = [];
  const decoder = new BinaryFrameDecoder((frame) => {
    framesReceived.push(frame);
  });

  const pcm = Buffer.from([10, 20, 30, 40]);
  const fullFrame = encodeAudioFrame(pcm);

  // Gửi một nửa frame đầu
  decoder.push(fullFrame.subarray(0, 3));
  assert.equal(framesReceived.length, 0);

  // Gửi nửa còn lại
  decoder.push(fullFrame.subarray(3));
  assert.equal(framesReceived.length, 1);
  assert.equal(framesReceived[0].type, MESSAGE_TYPES.AUDIO_FRAME);
  assert.deepEqual(framesReceived[0].payload, pcm);
});

test("NdjsonParser parses line-by-line JSON events", () => {
  const events = [];
  const parser = new NdjsonParser((ev) => events.push(ev));

  parser.push('{"type":"ready","model":"medium-q5_0"}\n{"type":"delta"');
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "ready");

  parser.push(',"itemId":"seg-1","transcript":"Xin chào"}\n');
  assert.equal(events.length, 2);
  assert.equal(events[1].itemId, "seg-1");
  assert.equal(events[1].transcript, "Xin chào");
});
