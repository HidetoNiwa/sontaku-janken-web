import { FilesetResolver, HandLandmarker } from "../vendor/tasks-vision/vision_bundle.mjs";
import {
  HAND_LABEL,
  classifyHand,
  judge,
  lockGesture,
  losingHand,
  outcomeLabel,
  sanitizeLogs,
  summarize,
  toCsv,
} from "./logic.mjs";

const STORAGE_KEY = "sontaku-janken-log-v1";
const SOUND_KEY = "sontaku-janken-sound";
const JUDGE_DELAY_MS = 200;
const WATCH_MS = 750;

const CALLS = {
  formal: [
    { label: "じゃん", sub: "出す手を用意してください", ms: 560, freq: 494, speak: "じゃんけん" },
    { label: "けん", sub: "ぽんに合わせて手を出してください", ms: 620, freq: 587 },
    { label: "ぽん", sub: "音の0.2秒後に手を読みます", ms: 0, freq: 196, reveal: true, speak: "ぽん" },
  ],
  quick: [
    { label: "じゃん", sub: "出す手を用意してください", ms: 520, freq: 494, speak: "じゃんけん" },
    { label: "けん", sub: "ぽんに合わせて手を出してください", ms: 560, freq: 587 },
    { label: "ぽん", sub: "音の0.2秒後に手を読みます", ms: 0, freq: 196, reveal: true, speak: "ぽん" },
  ],
};

const APOLOGIES = ["恐れ入ります", "完敗でございます", "さすがです", "おっしゃる通りです", "敵いません", "勉強になります"];

const HAND_SVG = {
  rock: `<svg viewBox="0 0 200 250" aria-hidden="true">
    <ellipse cx="104" cy="132" rx="62" ry="68" fill="#f4d7c8" stroke="#1c1915" stroke-width="6"/>
    <path d="M62 118c-20 6-30 28-22 46 8 16 28 16 36 0" fill="#f4d7c8" stroke="#1c1915" stroke-width="6" stroke-linejoin="round"/>
    <path d="M78 112c10 22 8 46 0 70M104 104c8 24 6 50-2 76M126 112c6 22 2 46-6 68" fill="none" stroke="#1c1915" stroke-width="5" stroke-linecap="round" opacity=".45"/>
  </svg>`,
  scissors: `<svg viewBox="0 0 200 250" aria-hidden="true">
    <rect x="78" y="16" width="30" height="124" rx="15" fill="#f4d7c8" stroke="#1c1915" stroke-width="6"/>
    <rect x="118" y="28" width="30" height="112" rx="15" fill="#f4d7c8" stroke="#1c1915" stroke-width="6"/>
    <ellipse cx="112" cy="176" rx="64" ry="56" fill="#f4d7c8" stroke="#1c1915" stroke-width="6"/>
    <path d="M58 154c-18 8-26 28-16 42 10 14 28 10 34-4" fill="#f4d7c8" stroke="#1c1915" stroke-width="6" stroke-linejoin="round"/>
  </svg>`,
  paper: `<svg viewBox="0 0 200 250" aria-hidden="true">
    <rect x="36" y="22" width="26" height="118" rx="13" fill="#f4d7c8" stroke="#1c1915" stroke-width="6"/>
    <rect x="68" y="10" width="26" height="130" rx="13" fill="#f4d7c8" stroke="#1c1915" stroke-width="6"/>
    <rect x="100" y="14" width="26" height="126" rx="13" fill="#f4d7c8" stroke="#1c1915" stroke-width="6"/>
    <rect x="132" y="28" width="26" height="110" rx="13" fill="#f4d7c8" stroke="#1c1915" stroke-width="6"/>
    <ellipse cx="100" cy="184" rx="74" ry="52" fill="#f4d7c8" stroke="#1c1915" stroke-width="6"/>
  </svg>`,
};

const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

const $ = (id) => document.getElementById(id);

const ui = {
  stage: $("stage"),
  video: $("video"),
  call: $("call"),
  callSub: $("call-sub"),
  pill: $("pill"),
  watch: $("watch-bar"),
  idle: $("idle-message"),
  idleText: $("idle-text"),
  seal: $("seal"),
  handArt: $("hand-art"),
  handName: $("hand-name"),
  excuse: $("excuse"),
  result: $("result-label"),
  cameraBtn: $("camera-btn"),
  startBtn: $("start-btn"),
  sound: $("sound"),
  callStyle: $("call-style"),
  deviceLabel: $("device-label"),
  device: $("device"),
  csvBtn: $("csv-btn"),
  clearBtn: $("clear-btn"),
  logBody: $("log-body"),
  empty: $("empty-charts"),
  streak: $("streak"),
};

const ctx = ui.stage.getContext("2d");
const history = [];
let logs = loadLogs();
let landmarker = null;
let modelReady = false;
let modelError = "";
let stream = null;
let running = false;
let phase = "idle";
let watchTimer = 0;
let lastVideoTime = -1;
let lastTs = -1;
let pillCache = "";
let audioCtx = null;
let lineChart = null;
let barChart = null;
let handChart = null;
let latestGesture = null;
let stableLive = false;
let lastLandmarks = null;
let holdResult = false;
let judgeNotBefore = 0;
let shownKind = "";
let waitingForRock = false;
let rockReady = null;

ui.sound.checked = localStorage.getItem(SOUND_KEY) !== "off";

function loadLogs() {
  try {
    return sanitizeLogs(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"));
  } catch {
    return [];
  }
}

function saveLogs() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
}

function soundOn() {
  return ui.sound.checked;
}

function ensureAudio() {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function tone(freq, duration, type = "sine", gain = 0.06) {
  if (!soundOn()) return;
  const context = ensureAudio();
  const osc = context.createOscillator();
  const amp = context.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  amp.gain.setValueAtTime(gain, context.currentTime);
  amp.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
  osc.connect(amp);
  amp.connect(context.destination);
  osc.start();
  osc.stop(context.currentTime + duration);
}

function clap() {
  if (!soundOn()) return;
  const context = ensureAudio();
  const length = Math.floor(context.sampleRate * 0.15);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2;
  }
  const noise = context.createBufferSource();
  noise.buffer = buffer;
  const filter = context.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 900;
  const amp = context.createGain();
  amp.gain.value = 0.35;
  noise.connect(filter);
  filter.connect(amp);
  amp.connect(context.destination);
  noise.start();
  tone(140, 0.18, "triangle", 0.08);
}

function pickVoice() {
  const voices = speechSynthesis.getVoices();
  return voices.find((voice) => voice.lang === "ja-JP") || voices.find((voice) => voice.lang.startsWith("ja")) || null;
}

function speak(text) {
  if (!soundOn() || !text || !("speechSynthesis" in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "ja-JP";
  utter.rate = 1.04;
  const voice = pickVoice();
  if (voice) utter.voice = voice;
  speechSynthesis.speak(utter);
}

function setCall(label, sub, pop = true) {
  ui.call.textContent = label;
  ui.callSub.textContent = sub || "";
  ui.call.parentElement.classList.remove("pop");
  if (pop) {
    void ui.call.parentElement.offsetWidth;
    ui.call.parentElement.classList.add("pop");
  }
}

function showHand(kind, slam) {
  const next = kind || "";
  if (shownKind !== next) {
    shownKind = next;
    ui.handArt.innerHTML = kind ? HAND_SVG[kind] : "";
    ui.handName.textContent = kind ? HAND_LABEL[kind] : "未出し";
  }
  if (slam && kind) {
    ui.handArt.classList.remove("slam");
    void ui.handArt.offsetWidth;
    ui.handArt.classList.add("slam");
  }
}

function setSeal(text, indigo) {
  if (!text) {
    ui.seal.hidden = true;
    return;
  }
  ui.seal.hidden = false;
  ui.seal.textContent = text;
  ui.seal.classList.toggle("indigo", indigo);
  ui.seal.classList.remove("stamp");
  void ui.seal.offsetWidth;
  ui.seal.classList.add("stamp");
}

function resetThrow() {
  showHand(null, false);
  setSeal("");
  ui.excuse.textContent = stream ? "読みに合わせて、負け手を用意します" : "まだ手は出していません";
  ui.result.textContent = "";
  ui.result.className = "result-label";
}

function syncButtons() {
  const busy = phase === "calling" || phase === "watching";
  ui.cameraBtn.disabled = busy && !waitingForRock;
  ui.cameraBtn.textContent = stream ? "カメラを切る" : "カメラを起動";
  ui.startBtn.disabled = busy || !stream || !modelReady;
  if (busy) ui.startBtn.textContent = phase === "watching" ? "読み取り中" : waitingForRock ? "グー待ち" : "合図中";
  else if (!modelReady && !modelError) ui.startBtn.textContent = "準備中";
  else if (logs.length) ui.startBtn.textContent = "もう一勝負";
  else ui.startBtn.textContent = "勝負する";
  ui.callStyle.disabled = busy;
  ui.device.disabled = busy || !stream;
  const cameraOn = !!stream;
  ui.cameraBtn.classList.toggle("primary", !cameraOn);
  ui.cameraBtn.classList.toggle("ghost", cameraOn);
  ui.startBtn.classList.toggle("primary", cameraOn);
  ui.startBtn.classList.toggle("ghost", !cameraOn);
}

function setPill(text, mode) {
  if (text !== pillCache) {
    pillCache = text;
    ui.pill.textContent = text;
  }
  ui.pill.classList.toggle("stable", mode === "stable");
  ui.pill.classList.toggle("tentative", mode === "tentative");
}

function pushSample(gesture) {
  const now = performance.now();
  history.push({ t: now, g: gesture });
  while (history.length && now - history[0].t > 1000) history.shift();
}

function coverBox(videoWidth, videoHeight, width, height) {
  const scale = Math.max(width / videoWidth, height / videoHeight);
  const dw = videoWidth * scale;
  const dh = videoHeight * scale;
  return { dx: (width - dw) / 2, dy: (height - dh) / 2, dw, dh };
}

function resizeStage() {
  const rect = ui.stage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  if (ui.stage.width !== Math.round(width * dpr) || ui.stage.height !== Math.round(height * dpr)) {
    ui.stage.width = Math.round(width * dpr);
    ui.stage.height = Math.round(height * dpr);
  }
  return { width, height, dpr };
}

function drawFrame(landmarks) {
  const { width, height, dpr } = resizeStage();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#d9d1c3";
  ctx.fillRect(0, 0, width, height);

  const video = ui.video;
  if (!video.videoWidth) return null;

  const box = coverBox(video.videoWidth, video.videoHeight, width, height);
  ctx.save();
  ctx.translate(width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, box.dx, box.dy, box.dw, box.dh);

  if (landmarks) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = stableLive ? "#2f6f4e" : "#1e3a5f";
    ctx.fillStyle = "#c23b22";
    for (const [a, b] of CONNECTIONS) {
      ctx.beginPath();
      ctx.moveTo(box.dx + landmarks[a].x * box.dw, box.dy + landmarks[a].y * box.dh);
      ctx.lineTo(box.dx + landmarks[b].x * box.dw, box.dy + landmarks[b].y * box.dh);
      ctx.stroke();
    }
    for (const point of landmarks) {
      ctx.beginPath();
      ctx.arc(box.dx + point.x * box.dw, box.dy + point.y * box.dh, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  return box;
}

function nextTimestamp() {
  let now = performance.now();
  if (now <= lastTs) now = lastTs + 1;
  lastTs = now;
  return now;
}

function updateLiveRead(gesture) {
  latestGesture = gesture;
  const lockedNow = lockGesture(history, performance.now());
  stableLive = lockedNow != null && lockedNow === gesture;
  if (!stream) return;

  if (phase === "watching") {
    const waiting = performance.now() < judgeNotBefore;
    setPill(waiting ? "音の0.2秒後に判定します" : "手を判定しています", "tentative");
    return;
  }
  if (waitingForRock) {
    let sub = "グーを出してください";
    let mode = "";
    if (gesture === "rock" && stableLive) {
      sub = "グーを確認しました";
      mode = "stable";
    } else if (gesture === "rock") {
      sub = "そのグーのまま、少し待ってください";
      mode = "tentative";
    } else if (gesture) {
      sub = `いまは${HAND_LABEL[gesture]}です。グーを出してください`;
      mode = "tentative";
    }
    setPill(sub, mode);
    if (ui.callSub.textContent !== sub) ui.callSub.textContent = sub;
    return;
  }
  if (phase === "calling") {
    setPill(gesture ? `読み ${HAND_LABEL[gesture]}` : "手を探しています", gesture ? "tentative" : "");
    return;
  }
  if (!gesture) {
    setPill("手を探しています", "");
    if (!holdResult && phase === "idle") {
      showHand(null, false);
      ui.excuse.textContent = "手のひらをカメラに向けてください";
      ui.result.textContent = "";
      ui.result.className = "result-label";
    }
    return;
  }
  const losing = losingHand(gesture);
  setPill(
    stableLive ? `読み ${HAND_LABEL[gesture]} → 負け手 ${HAND_LABEL[losing]}` : `仮読み ${HAND_LABEL[gesture]}`,
    stableLive ? "stable" : "tentative",
  );
  if (holdResult || phase !== "idle") return;
  showHand(losing, false);
  ui.excuse.textContent = stableLive
    ? `今なら${HAND_LABEL[losing]}を出して負けます`
    : "形が安定するまで待っています";
  ui.result.textContent = "";
  ui.result.className = "result-label";
}

function frame() {
  if (!running) return;
  const video = ui.video;
  if (landmarker && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    try {
      const result = landmarker.detectForVideo(video, nextTimestamp());
      lastLandmarks = result.landmarks?.[0] ?? null;
    } catch (error) {
      console.error(error);
      lastLandmarks = null;
    }
    const gesture = lastLandmarks ? classifyHand(lastLandmarks) : null;
    pushSample(gesture);
    updateLiveRead(gesture);
    if (waitingForRock && phase === "calling" && lockGesture(history, performance.now()) === "rock" && rockReady) {
      const done = rockReady;
      rockReady = null;
      waitingForRock = false;
      done(true);
    }
    if (phase === "watching" && performance.now() >= judgeNotBefore) {
      const locked = lockGesture(history, performance.now());
      if (locked) finishRound(locked);
    }
  }
  drawFrame(lastLandmarks);
  requestAnimationFrame(frame);
}

async function createLandmarker() {
  ui.idleText.textContent = "手の読み取りを準備しています";
  const slow = setTimeout(() => {
    if (!modelReady) ui.idleText.textContent = "モデルの取得に時間がかかっています。通信を確認してください";
  }, 8000);
  try {
    const vision = await FilesetResolver.forVisionTasks(
      new URL("../vendor/tasks-vision/wasm", import.meta.url).href,
    );
    const options = {
      baseOptions: {
        modelAssetPath: new URL("../models/hand_landmarker.task", import.meta.url).href,
      },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.5,
    };
    try {
      landmarker = await HandLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: "GPU" },
      });
    } catch {
      landmarker = await HandLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: "CPU" },
      });
    }
    modelReady = true;
    modelError = "";
    if (!stream) ui.idleText.textContent = "カメラを起動すると、ここに手が映ります。";
  } catch (error) {
    console.error(error);
    modelError = "手の読み取りモデルを取得できませんでした";
    ui.idleText.textContent = modelError;
  } finally {
    clearTimeout(slow);
    syncButtons();
  }
}

async function listCameras() {
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "videoinput");
  ui.device.innerHTML = "";
  for (const device of devices) {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = (device.label || "カメラ").replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)/i, "");
    ui.device.append(option);
  }
  ui.deviceLabel.hidden = devices.length < 2;
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    ui.idleText.textContent = "このブラウザはカメラを使えません";
    return;
  }
  try {
    const deviceId = ui.device.value;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        facingMode: deviceId ? undefined : "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    ui.video.srcObject = stream;
    await ui.video.play();
    ui.idle.hidden = true;
    running = true;
    requestAnimationFrame(frame);
    await listCameras();
    const current = stream.getVideoTracks()[0]?.getSettings?.().deviceId;
    if (current) ui.device.value = current;
    setPill("手を探しています", "");
    resetThrow();
    setCall("待機", "読みが手と一致したら、勝負してください");
  } catch (error) {
    console.error(error);
    stream = null;
    ui.idle.hidden = false;
    ui.idleText.textContent = "カメラを起動できませんでした。許可を確認してください";
    setPill("カメラ停止中", "");
  }
  syncButtons();
}

function stopCamera() {
  running = false;
  for (const track of stream?.getTracks?.() ?? []) track.stop();
  stream = null;
  ui.video.srcObject = null;
  ui.idle.hidden = false;
  ui.idleText.textContent = "カメラを停止しました";
  setPill("カメラ停止中", "");
  history.length = 0;
  lastLandmarks = null;
  holdResult = false;
  judgeNotBefore = 0;
  if (phase !== "idle") {
    phase = "idle";
    clearTimeout(watchTimer);
    ui.watch.hidden = true;
  }
  cancelRockWait();
  resetThrow();
  setCall("待機", "カメラを起動すると、手が読めます");
  syncButtons();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startRound() {
  if (ui.startBtn.disabled) return;
  phase = "calling";
  holdResult = false;
  judgeNotBefore = 0;
  clearTimeout(watchTimer);
  ui.watch.hidden = true;
  ui.watch.classList.remove("run");
  history.length = 0;
  resetThrow();
  ui.excuse.textContent = "合図が終わるまで、手は出しません";
  syncButtons();
  if (soundOn()) {
    speechSynthesis.cancel();
    ensureAudio();
  }

  const formal = ui.callStyle.value !== "quick";
  if (formal) {
    const ready = await holdForRock();
    if (!ready) return;
    ui.excuse.textContent = "合図が終わるまで、手は出しません";
  }
  const steps = formal ? CALLS.formal : CALLS.quick;
  for (const step of steps) {
    if (phase !== "calling") return;
    setCall(step.label, step.sub);
    if (step.reveal) {
      clap();
    } else {
      tone(step.freq, 0.12, "sine", 0.05);
    }
    if (step.speak) speak(step.speak);
    if (step.reveal) {
      beginWatch();
      return;
    }
    await wait(step.ms);
  }
}

function cancelRockWait() {
  waitingForRock = false;
  if (!rockReady) return;
  const done = rockReady;
  rockReady = null;
  done(false);
}

function holdForRock() {
  const started = performance.now();
  waitingForRock = true;
  setCall("最初はグー", "グーを出してください");
  tone(392, 0.12, "sine", 0.05);
  speak("最初はグー。グーを出してください");
  ui.excuse.textContent = "グーが出るまで待ちます";
  syncButtons();
  return new Promise((resolve) => {
    rockReady = resolve;
  }).then(async (ready) => {
    if (!ready || phase !== "calling") return false;
    ui.callSub.textContent = "グーを確認しました";
    ui.excuse.textContent = "グーを確認しました";
    setPill("グーを確認しました", "stable");
    syncButtons();
    const remain = Math.max(280, 800 - (performance.now() - started));
    await wait(remain);
    return phase === "calling";
  });
}

function beginWatch() {
  phase = "watching";
  history.length = 0;
  judgeNotBefore = performance.now() + JUDGE_DELAY_MS;
  ui.watch.hidden = false;
  ui.watch.classList.remove("run");
  void ui.watch.offsetWidth;
  ui.watch.classList.add("run");
  ui.excuse.textContent = "音の0.2秒後に、手を読みます";
  syncButtons();
  clearTimeout(watchTimer);
  watchTimer = setTimeout(() => {
    if (performance.now() < judgeNotBefore) return;
    finishRound(lockGesture(history, performance.now()));
  }, WATCH_MS);
}

function finishRound(opponent) {
  if (phase !== "watching") return;
  phase = "result";
  clearTimeout(watchTimer);
  ui.watch.hidden = true;

  const self = opponent ? losingHand(opponent) : null;
  const outcome = opponent ? judge(self, opponent) : "unread";
  const entry = { t: Date.now(), opponent, self, outcome };
  logs.push(entry);
  if (logs.length > 200) logs = logs.slice(-200);
  saveLogs();
  renderResult(entry);
  renderBook();
  syncButtons();

  if (outcome === "lose") {
    const line = APOLOGIES[Math.floor(Math.random() * APOLOGIES.length)];
    ui.excuse.textContent = line;
    speak(`${line}。あなたの勝ちです。`);
  } else if (outcome === "unread") {
    ui.excuse.textContent = "手が読めませんでした";
    speak("手が読めませんでした。もう一度お願いします。");
  } else if (outcome === "draw") {
    ui.excuse.textContent = "あいこです";
    speak("あいこでしょ。");
  } else {
    ui.excuse.textContent = "失礼いたしました。勝ってしまいました";
    speak("失礼いたしました。勝ってしまいました。");
  }
  holdResult = true;
  phase = "idle";
  syncButtons();
}

function renderResult(entry) {
  showHand(entry.self, true);
  ui.result.className = "result-label";
  if (entry.outcome === "lose") {
    ui.result.textContent = "あなたの勝ち";
    ui.result.classList.add("win-human");
    setSeal("負", false);
    setCall("ぽん", `相手 ${HAND_LABEL[entry.opponent]} / こちら ${HAND_LABEL[entry.self]}`);
  } else if (entry.outcome === "win") {
    ui.result.textContent = "あなたの負け";
    ui.result.classList.add("lose-human");
    setSeal("勝", true);
    setCall("ぽん", "忖度が外れました");
  } else if (entry.outcome === "draw") {
    ui.result.textContent = "あいこ";
    setSeal("相", true);
    setCall("あいこ", "もう一度いきます");
  } else {
    ui.result.textContent = "読み取れず";
    setSeal("");
    showHand(null, false);
    ui.handName.textContent = "未出し";
    setCall("ぽん", "手を大きく、はっきり出してください");
  }
}

function renderBook() {
  const summary = summarize(logs);
  $("kpi-total").textContent = String(summary.total);
  $("kpi-lose").textContent = String(summary.lose);
  $("kpi-win").textContent = String(summary.win);
  $("kpi-draw").textContent = String(summary.draw);
  $("kpi-unread").textContent = String(summary.unread);
  $("kpi-rate").textContent = summary.sontakuRate == null ? "—" : `${Math.round(summary.sontakuRate * 100)}%`;
  ui.streak.textContent = String(summary.streak);
  ui.empty.hidden = summary.total > 0;
  renderLog(logs);
  updateCharts(summary);
}

function renderLog(entries) {
  ui.logBody.replaceChildren();
  const rows = [...entries].reverse();
  for (const entry of rows) {
    const tr = document.createElement("tr");
    const when = new Date(entry.t).toLocaleString("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const cells = [
      when,
      HAND_LABEL[entry.opponent] ?? "—",
      HAND_LABEL[entry.self] ?? "—",
      outcomeLabel(entry.outcome),
    ];
    cells.forEach((text, index) => {
      const td = document.createElement("td");
      td.textContent = text;
      if (index === 3 && entry.outcome === "lose") td.className = "win-cell";
      tr.append(td);
    });
    ui.logBody.append(tr);
  }
}

function ensureCharts() {
  if (lineChart || typeof Chart === "undefined") return;
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.color = "#3a342c";
  Chart.defaults.animation.duration = 400;
  const common = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
  };
  lineChart = new Chart($("line-chart"), {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          data: [],
          stepped: true,
          borderColor: "#c23b22",
          backgroundColor: "rgba(194, 59, 34, 0.12)",
          fill: true,
          pointRadius: 0,
          borderWidth: 2,
        },
      ],
    },
    options: {
      ...common,
      scales: {
        x: { title: { display: true, text: "勝負" }, ticks: { maxTicksLimit: 8 } },
        y: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: "あなたの勝ち" } },
      },
    },
  });
  barChart = new Chart($("bar-chart"), {
    type: "bar",
    data: {
      labels: ["あなたの勝ち", "あなたの負け", "あいこ", "読めず"],
      datasets: [
        {
          data: [0, 0, 0, 0],
          backgroundColor: ["#c23b22", "#1e3a5f", "#8d6840", "#c8bfb2"],
          borderRadius: 6,
        },
      ],
    },
    options: {
      ...common,
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
  handChart = new Chart($("hand-chart"), {
    type: "doughnut",
    data: {
      labels: ["グー", "チョキ", "パー"],
      datasets: [
        {
          data: [0, 0, 0],
          backgroundColor: ["#1e3a5f", "#c23b22", "#2f6f4e"],
          borderWidth: 2,
          borderColor: "#fffaf3",
        },
      ],
    },
    options: {
      ...common,
      plugins: {
        legend: { display: true, position: "bottom", labels: { boxWidth: 12 } },
      },
    },
  });
}

function updateCharts(summary) {
  if (typeof Chart === "undefined") {
    ui.empty.hidden = false;
    ui.empty.textContent = "グラフを読み込めませんでした";
    return;
  }
  ensureCharts();
  lineChart.data.labels = summary.cumulative.map((_, index) => String(index + 1));
  lineChart.data.datasets[0].data = summary.cumulative;
  lineChart.update();
  barChart.data.datasets[0].data = [summary.lose, summary.win, summary.draw, summary.unread];
  barChart.update();
  handChart.data.datasets[0].data = [summary.hands.rock, summary.hands.scissors, summary.hands.paper];
  handChart.update();
}

function downloadCsv() {
  const blob = new Blob(["\uFEFF" + toCsv(logs)], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "sontaku-janken-log.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

ui.cameraBtn.addEventListener("click", () => {
  if (stream) stopCamera();
  else startCamera();
});

ui.startBtn.addEventListener("click", () => {
  startRound();
});

ui.sound.addEventListener("change", () => {
  localStorage.setItem(SOUND_KEY, ui.sound.checked ? "on" : "off");
  if (!ui.sound.checked) speechSynthesis.cancel();
});

ui.device.addEventListener("change", async () => {
  if (!stream) return;
  stopCamera();
  await startCamera();
});

ui.csvBtn.addEventListener("click", downloadCsv);

ui.clearBtn.addEventListener("click", () => {
  if (!logs.length) return;
  if (!confirm("勝負の記録を消しますか？")) return;
  logs = [];
  saveLogs();
  renderBook();
});

document.addEventListener("keydown", (event) => {
  if (event.code !== "Space") return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  event.preventDefault();
  startRound();
});

speechSynthesis.addEventListener?.("voiceschanged", () => pickVoice());
window.addEventListener("resize", () => resizeStage());

resetThrow();
setCall("待機", "勝負の前に、読みと手が一致するか見てください", false);
syncButtons();
renderBook();
createLandmarker();
