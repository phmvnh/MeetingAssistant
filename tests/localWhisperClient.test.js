const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { LocalWhisperClient } = require("../src/transcription/localWhisperClient");
const { BinaryFrameDecoder, MESSAGE_TYPES } = require("../src/transcription/sidecarProtocol");

function createMockChild(options = {}) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  child.killed = false;
  let closed = false;
  child.emitClose = (code = 0, signal = null) => {
    if (closed) {
      return;
    }

    closed = true;
    child.exitCode = code;
    child.signalCode = signal;
    child.emit("close", code, signal);
  };
  child.kill = (signal = "SIGTERM") => {
    child.killed = true;
    child.emitClose(null, signal);
    return true;
  };

  if (options.closeOnStdinEnd !== false) {
    child.stdin.once("finish", () => {
      setImmediate(() => child.emitClose(0));
    });
  }

  return child;
}

test("LocalWhisperClient rejects meeting IDs that could escape the cache root", () => {
  assert.throws(
    () =>
      new LocalWhisperClient({
        modelPath: "fake-model.bin",
        cacheDir: "cache",
        meetingId: "..\\outside",
        saveRawAudio: true,
      }),
    /Meeting ID.*không hợp lệ/i,
  );
  assert.throws(
    () =>
      new LocalWhisperClient({
        modelPath: "fake-model.bin",
        cacheDir: "cache",
        meetingId: "C:\\outside",
        saveRawAudio: true,
      }),
    /Meeting ID.*không hợp lệ/i,
  );
});

test("LocalWhisperClient does not create raw audio cache by default", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "whisper-no-cache-test-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const fakeModel = path.join(tmpDir, "ggml-fake.bin");
  const cacheDir = path.join(tmpDir, "cache");
  fs.writeFileSync(fakeModel, "model-data");
  const mockChild = createMockChild();
  const client = new LocalWhisperClient({
    modelPath: fakeModel,
    cacheDir,
    meetingId: "no-audio-cache",
    spawnFn: () => mockChild,
  });

  const connectPromise = client.connect();
  mockChild.stdout.write(JSON.stringify({ type: "ready" }) + "\n");
  await connectPromise;
  client.appendAudio(Buffer.from([1, 2, 3, 4]));
  await client.close();

  assert.equal(fs.existsSync(path.join(cacheDir, "no-audio-cache")), false);
});

test("LocalWhisperClient writes raw audio only after explicit opt-in", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "whisper-cache-test-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const fakeModel = path.join(tmpDir, "ggml-fake.bin");
  const cacheDir = path.join(tmpDir, "cache");
  const meetingId = "saved-audio-cache";
  const audio = Buffer.from([1, 2, 3, 4, 5, 6]);
  fs.writeFileSync(fakeModel, "model-data");
  const mockChild = createMockChild();
  const client = new LocalWhisperClient({
    modelPath: fakeModel,
    cacheDir,
    meetingId,
    saveRawAudio: true,
    spawnFn: () => mockChild,
  });

  const connectPromise = client.connect();
  mockChild.stdout.write(JSON.stringify({ type: "ready" }) + "\n");
  await connectPromise;
  client.appendAudio(audio);
  await client.close();

  assert.deepEqual(
    fs.readFileSync(path.join(cacheDir, meetingId, "audio.pcm.part")),
    audio,
  );
});

test("LocalWhisperClient connects, receives events and finishes properly", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "whisper-client-test-"));
  const fakeModel = path.join(tmpDir, "ggml-fake.bin");
  fs.writeFileSync(fakeModel, "model-data");

  const mockChild = createMockChild();
  const receivedFrames = [];
  const frameDecoder = new BinaryFrameDecoder((frame) => {
    receivedFrames.push(frame);
  });

  mockChild.stdin.on("data", (chunk) => {
    frameDecoder.push(chunk);
  });

  const client = new LocalWhisperClient({
    modelPath: fakeModel,
    language: "vi",
    cacheDir: tmpDir,
    meetingId: "test-meeting-1",
    spawnFn: () => mockChild,
  });

  const connectPromise = client.connect();

  // Sidecar gửi ready
  mockChild.stdout.write(JSON.stringify({ type: "ready", model: "fake" }) + "\n");
  await connectPromise;
  assert.equal(client.isReady, true);
  assert.equal(client.connectTimeoutTimer, null);

  // Client append audio
  const audioData = Buffer.from([1, 2, 3, 4]);
  client.appendAudio(audioData);
  assert.equal(receivedFrames.length, 1);
  assert.equal(receivedFrames[0].type, MESSAGE_TYPES.AUDIO_FRAME);
  assert.deepEqual(receivedFrames[0].payload, audioData);

  // Sidecar phát delta & completed
  const deltaPromise = new Promise((resolve) => client.once("delta", resolve));
  mockChild.stdout.write(
    JSON.stringify({
      type: "delta",
      itemId: "seg-1",
      transcript: "Tôi đang nói",
    }) + "\n"
  );
  const deltaEvent = await deltaPromise;
  assert.equal(deltaEvent.partial, "Tôi đang nói");
  assert.equal(deltaEvent.completed, false);

  const completedPromise = new Promise((resolve) => client.once("completed", resolve));
  mockChild.stdout.write(
    JSON.stringify({
      type: "completed",
      itemId: "seg-1",
      transcript: "Tôi đang nói xong.",
    }) + "\n"
  );
  const completedEvent = await completedPromise;
  assert.equal(completedEvent.transcript, "Tôi đang nói xong.");
  assert.equal(completedEvent.completed, true);

  // Sidecar finish
  const finishPromise = client.finish();
  mockChild.stdout.write(JSON.stringify({ type: "flush-completed" }) + "\n");
  const transcript = await finishPromise;
  assert.equal(transcript, "Tôi đang nói xong.");

  await client.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("LocalWhisperClient passes launcher arguments before sidecar arguments", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "whisper-client-args-test-"));
  const fakeModel = path.join(tmpDir, "ggml-fake.bin");
  fs.writeFileSync(fakeModel, "model-data");

  const mockChild = createMockChild();
  let spawnedArgs;
  const client = new LocalWhisperClient({
    sidecarPath: process.execPath,
    sidecarArgs: [path.join(tmpDir, "mock-sidecar.js")],
    modelPath: fakeModel,
    spawnFn: (_executable, args) => {
      spawnedArgs = args;
      return mockChild;
    },
  });

  const connectPromise = client.connect();
  mockChild.stdout.write(JSON.stringify({ type: "ready" }) + "\n");
  await connectPromise;

  assert.deepEqual(spawnedArgs, [
    path.join(tmpDir, "mock-sidecar.js"),
    "--model",
    fakeModel,
    "--language",
    "vi",
  ]);

  await client.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("LocalWhisperClient flushes audio automatically while listening", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "whisper-client-stream-test-"));
  const fakeModel = path.join(tmpDir, "ggml-fake.bin");
  fs.writeFileSync(fakeModel, "model-data");

  const mockChild = createMockChild();
  const receivedTypes = [];
  const frameDecoder = new BinaryFrameDecoder((frame) => {
    receivedTypes.push(frame.type);
  });
  mockChild.stdin.on("data", (chunk) => frameDecoder.push(chunk));

  const client = new LocalWhisperClient({
    modelPath: fakeModel,
    streamingFlushIntervalMs: 20,
    spawnFn: () => mockChild,
  });

  const connectPromise = client.connect();
  mockChild.stdout.write(JSON.stringify({ type: "ready" }) + "\n");
  await connectPromise;
  client.appendAudio(Buffer.alloc(3200));

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(receivedTypes.includes(MESSAGE_TYPES.FLUSH), true);

  await client.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("LocalWhisperClient drains audio queued behind an in-flight flush before finishing", async () => {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "whisper-client-drain-test-"),
  );
  const fakeModel = path.join(tmpDir, "ggml-fake.bin");
  fs.writeFileSync(fakeModel, "model-data");

  const mockChild = createMockChild();
  const receivedTypes = [];
  const frameDecoder = new BinaryFrameDecoder((frame) => {
    receivedTypes.push(frame.type);
  });
  mockChild.stdin.on("data", (chunk) => frameDecoder.push(chunk));

  const client = new LocalWhisperClient({
    modelPath: fakeModel,
    streamingFlushIntervalMs: 0,
    spawnFn: () => mockChild,
  });

  const connectPromise = client.connect();
  mockChild.stdout.write(JSON.stringify({ type: "ready" }) + "\n");
  await connectPromise;

  client.appendAudio(Buffer.alloc(3200));
  client.endAudioStream();
  assert.equal(
    receivedTypes.filter((type) => type === MESSAGE_TYPES.FLUSH).length,
    1,
  );

  client.appendAudio(Buffer.alloc(3200));
  const finishPromise = client.finish();
  let finished = false;
  finishPromise.then(() => {
    finished = true;
  });

  mockChild.stdout.write(
    JSON.stringify({
      type: "completed",
      itemId: "seg-1",
      transcript: "Phần đầu.",
    }) + "\n",
  );
  mockChild.stdout.write(JSON.stringify({ type: "flush-completed" }) + "\n");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(finished, false);
  assert.equal(
    receivedTypes.filter((type) => type === MESSAGE_TYPES.FLUSH).length,
    2,
  );

  mockChild.stdout.write(
    JSON.stringify({
      type: "completed",
      itemId: "seg-2",
      transcript: "Phần cuối đến muộn.",
    }) + "\n",
  );
  mockChild.stdout.write(JSON.stringify({ type: "flush-completed" }) + "\n");

  assert.equal(
    await finishPromise,
    "Phần đầu.\nPhần cuối đến muộn.",
  );

  await client.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("LocalWhisperClient rejects instead of returning a partial transcript on finish timeout", async () => {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "whisper-client-timeout-test-"),
  );
  const fakeModel = path.join(tmpDir, "ggml-fake.bin");
  fs.writeFileSync(fakeModel, "model-data");

  const mockChild = createMockChild();
  const client = new LocalWhisperClient({
    modelPath: fakeModel,
    finishTimeoutMs: 20,
    streamingFlushIntervalMs: 0,
    spawnFn: () => mockChild,
  });

  const connectPromise = client.connect();
  mockChild.stdout.write(JSON.stringify({ type: "ready" }) + "\n");
  await connectPromise;
  client.appendAudio(Buffer.alloc(3200));

  await assert.rejects(
    client.finish(),
    /Quá thời gian hoàn thiện transcript/,
  );

  await client.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("LocalWhisperClient shares one drain across concurrent finish calls", async () => {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "whisper-client-idempotent-test-"),
  );
  const fakeModel = path.join(tmpDir, "ggml-fake.bin");
  fs.writeFileSync(fakeModel, "model-data");

  const mockChild = createMockChild();
  const receivedTypes = [];
  const frameDecoder = new BinaryFrameDecoder((frame) => {
    receivedTypes.push(frame.type);
  });
  mockChild.stdin.on("data", (chunk) => frameDecoder.push(chunk));

  const client = new LocalWhisperClient({
    modelPath: fakeModel,
    streamingFlushIntervalMs: 0,
    spawnFn: () => mockChild,
  });

  const connectPromise = client.connect();
  mockChild.stdout.write(JSON.stringify({ type: "ready" }) + "\n");
  await connectPromise;
  client.appendAudio(Buffer.alloc(3200));

  const firstFinish = client.finish();
  const secondFinish = client.finish();
  assert.equal(
    receivedTypes.filter((type) => type === MESSAGE_TYPES.FLUSH).length,
    1,
  );

  mockChild.stdout.write(
    JSON.stringify({
      type: "completed",
      itemId: "seg-1",
      transcript: "Transcript đã chốt.",
    }) + "\n",
  );
  mockChild.stdout.write(JSON.stringify({ type: "flush-completed" }) + "\n");

  assert.deepEqual(
    await Promise.all([firstFinish, secondFinish]),
    ["Transcript đã chốt.", "Transcript đã chốt."],
  );
  assert.equal(await client.finish(), "Transcript đã chốt.");
  assert.equal(
    receivedTypes.filter((type) => type === MESSAGE_TYPES.FLUSH).length,
    1,
  );

  await client.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("LocalWhisperClient waits for a graceful sidecar exit before close resolves", async (t) => {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "whisper-client-graceful-close-test-"),
  );
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const fakeModel = path.join(tmpDir, "ggml-fake.bin");
  fs.writeFileSync(fakeModel, "model-data");

  const mockChild = createMockChild({ closeOnStdinEnd: false });
  const client = new LocalWhisperClient({
    modelPath: fakeModel,
    closeGracePeriodMs: 1000,
    spawnFn: () => mockChild,
  });

  const connectPromise = client.connect();
  mockChild.stdout.write(JSON.stringify({ type: "ready" }) + "\n");
  await connectPromise;

  let closeResolved = false;
  const closePromise = client.close().then(() => {
    closeResolved = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closeResolved, false);
  assert.equal(mockChild.stdin.writableEnded, true);
  assert.equal(mockChild.killed, false);

  mockChild.emitClose(0);
  await closePromise;
  assert.equal(closeResolved, true);
  assert.equal(mockChild.killed, false);
});

test("LocalWhisperClient escalates to SIGKILL when the sidecar ignores graceful shutdown", async (t) => {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "whisper-client-force-close-test-"),
  );
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const fakeModel = path.join(tmpDir, "ggml-fake.bin");
  fs.writeFileSync(fakeModel, "model-data");

  const mockChild = createMockChild({ closeOnStdinEnd: false });
  const signals = [];
  mockChild.kill = (signal) => {
    signals.push(signal);
    mockChild.killed = true;
    if (signal === "SIGKILL") {
      setImmediate(() => mockChild.emitClose(null, signal));
    }
    return true;
  };

  const client = new LocalWhisperClient({
    modelPath: fakeModel,
    closeGracePeriodMs: 5,
    closeTerminateTimeoutMs: 5,
    closeKillTimeoutMs: 20,
    spawnFn: () => mockChild,
  });

  const connectPromise = client.connect();
  mockChild.stdout.write(JSON.stringify({ type: "ready" }) + "\n");
  await connectPromise;
  await client.close();

  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});

test("LocalWhisperClient close is bounded if a sidecar never emits close", async (t) => {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "whisper-client-bounded-close-test-"),
  );
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const fakeModel = path.join(tmpDir, "ggml-fake.bin");
  fs.writeFileSync(fakeModel, "model-data");

  const mockChild = createMockChild({ closeOnStdinEnd: false });
  const signals = [];
  mockChild.kill = (signal) => {
    signals.push(signal);
    return true;
  };

  const client = new LocalWhisperClient({
    modelPath: fakeModel,
    closeGracePeriodMs: 5,
    closeTerminateTimeoutMs: 5,
    closeKillTimeoutMs: 5,
    spawnFn: () => mockChild,
  });

  const connectPromise = client.connect();
  mockChild.stdout.write(JSON.stringify({ type: "ready" }) + "\n");
  await connectPromise;

  await assert.rejects(
    client.close(),
    /Không thể xác nhận sidecar Whisper đã dừng/,
  );
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});

test("LocalWhisperClient rejects finish after an unexpected sidecar exit", async (t) => {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "whisper-client-unexpected-exit-test-"),
  );
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const fakeModel = path.join(tmpDir, "ggml-fake.bin");
  fs.writeFileSync(fakeModel, "model-data");

  const mockChild = createMockChild({ closeOnStdinEnd: false });
  const client = new LocalWhisperClient({
    modelPath: fakeModel,
    spawnFn: () => mockChild,
  });
  const clientErrors = [];
  client.on("client-error", (error) => clientErrors.push(error));

  const connectPromise = client.connect();
  mockChild.stdout.write(JSON.stringify({ type: "ready" }) + "\n");
  await connectPromise;
  mockChild.stdout.write(
    JSON.stringify({
      type: "completed",
      itemId: "seg-1",
      transcript: "Transcript mới chỉ có một phần.",
    }) + "\n",
  );
  await new Promise((resolve) => setImmediate(resolve));

  mockChild.emitClose(17);

  assert.equal(clientErrors.length, 1);
  assert.match(clientErrors[0].message, /dừng đột ngột.*mã exit 17/i);
  await assert.rejects(client.finish(), (error) => error === clientErrors[0]);
  await client.close();
});

test("LocalWhisperClient emits one safe client-error when process error is followed by close", async (t) => {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "whisper-client-process-error-test-"),
  );
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const fakeModel = path.join(tmpDir, "ggml-fake.bin");
  fs.writeFileSync(fakeModel, "model-data");

  const mockChild = createMockChild({ closeOnStdinEnd: false });
  const client = new LocalWhisperClient({
    modelPath: fakeModel,
    spawnFn: () => mockChild,
  });
  const clientErrors = [];
  client.on("client-error", (error) => clientErrors.push(error));

  const connectPromise = client.connect();
  mockChild.stdout.write(JSON.stringify({ type: "ready" }) + "\n");
  await connectPromise;

  mockChild.emit("error", new Error("sidecar test failure"));
  mockChild.emitClose(1);

  assert.equal(clientErrors.length, 1);
  assert.match(clientErrors[0].message, /sidecar test failure/);
  await assert.rejects(client.finish(), (error) => error === clientErrors[0]);
  await client.close();
});

test("LocalWhisperClient clears its connect timeout after an early close", async (t) => {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "whisper-client-connect-reject-test-"),
  );
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const fakeModel = path.join(tmpDir, "ggml-fake.bin");
  fs.writeFileSync(fakeModel, "model-data");

  const mockChild = createMockChild({ closeOnStdinEnd: false });
  const client = new LocalWhisperClient({
    modelPath: fakeModel,
    connectTimeoutMs: 1000,
    spawnFn: () => mockChild,
  });

  const connectPromise = client.connect();
  mockChild.emitClose(9);

  await assert.rejects(connectPromise, /đóng sớm.*mã exit 9/i);
  assert.equal(client.connectTimeoutTimer, null);
  await client.close();
});

test("LocalWhisperClient sidecar errors are safe without an EventEmitter error listener", async (t) => {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "whisper-client-safe-error-event-test-"),
  );
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const fakeModel = path.join(tmpDir, "ggml-fake.bin");
  fs.writeFileSync(fakeModel, "model-data");

  const mockChild = createMockChild();
  const client = new LocalWhisperClient({
    modelPath: fakeModel,
    spawnFn: () => mockChild,
  });

  const connectPromise = client.connect();
  mockChild.stdout.write(JSON.stringify({ type: "ready" }) + "\n");
  await connectPromise;

  assert.doesNotThrow(() => {
    mockChild.stdout.write(
      JSON.stringify({ type: "error", message: "Lỗi sidecar dùng cho test" }) +
        "\n",
    );
  });
  await client.close();
});
