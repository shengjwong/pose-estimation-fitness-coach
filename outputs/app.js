import {
  FilesetResolver,
  PoseLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/vision_bundle.mjs";

const refs = {
  video: document.getElementById("video"),
  canvas: document.getElementById("overlay"),
  empty: document.getElementById("emptyState"),
  status: document.getElementById("modelStatus"),
  start: document.getElementById("startButton"),
  switch: document.getElementById("switchButton"),
  demo: document.getElementById("demoButton"),
  exercise: document.getElementById("exerciseSelect"),
  score: document.getElementById("formScore"),
  scoreMeter: document.getElementById("scoreMeter"),
  cues: document.getElementById("cueList"),
  reps: document.getElementById("repCount"),
  depth: document.getElementById("depthMetric"),
  alignment: document.getElementById("alignmentMetric"),
  tempo: document.getElementById("tempoMetric"),
};

const ctx = refs.canvas.getContext("2d");
const POSE_CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
  [24, 26], [26, 28], [27, 29], [28, 30], [29, 31], [30, 32],
];

let poseLandmarker = null;
let stream = null;
let usingFrontCamera = true;
let running = false;
let demoRunning = false;
let lastVideoTime = -1;
let repCount = 0;
let repPhase = "up";
let lastRepAt = 0;
let currentScore = 0;

refs.start.addEventListener("click", toggleCamera);
refs.switch.addEventListener("click", switchCamera);
refs.demo.addEventListener("click", toggleDemo);
refs.exercise.addEventListener("change", resetExerciseState);
window.addEventListener("resize", fitCanvas);

initPoseModel();

async function initPoseModel() {
  setStatus("Loading model", "");
  try {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm"
    );

    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.45,
      minPosePresenceConfidence: 0.45,
      minTrackingConfidence: 0.45,
    });

    setStatus("Model ready", "ready");
  } catch (error) {
    console.error(error);
    setStatus("Model unavailable; demo works", "error");
  }
}

async function toggleCamera() {
  if (running) {
    stopCamera();
    return;
  }

  stopDemo();
  if (!poseLandmarker) {
    setStatus("Waiting for model", "");
    await initPoseModel();
  }
  if (!poseLandmarker) return;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: usingFrontCamera ? "user" : "environment",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    refs.video.srcObject = stream;
    await refs.video.play();
    running = true;
    refs.start.textContent = "Stop camera";
    refs.empty.classList.add("hidden");
    refs.video.classList.toggle("mirror", usingFrontCamera);
    refs.canvas.classList.toggle("mirror", usingFrontCamera);
    fitCanvas();
    requestAnimationFrame(predictWebcam);
  } catch (error) {
    console.error(error);
    setStatus("Camera permission needed", "error");
  }
}

function stopCamera() {
  running = false;
  refs.start.textContent = "Start camera";
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  refs.video.srcObject = null;
  refs.empty.classList.remove("hidden");
  clearCanvas();
}

async function switchCamera() {
  usingFrontCamera = !usingFrontCamera;
  if (running) {
    stopCamera();
    await toggleCamera();
  }
}

function toggleDemo() {
  if (demoRunning) {
    stopDemo();
    return;
  }
  stopCamera();
  demoRunning = true;
  refs.demo.textContent = "Stop demo";
  refs.empty.classList.add("hidden");
  fitCanvas();
  requestAnimationFrame(runDemo);
}

function stopDemo() {
  demoRunning = false;
  refs.demo.textContent = "Demo mode";
  if (!running) {
    refs.empty.classList.remove("hidden");
    clearCanvas();
  }
}

function predictWebcam() {
  if (!running || !poseLandmarker) return;

  if (refs.video.currentTime !== lastVideoTime) {
    lastVideoTime = refs.video.currentTime;
    const result = poseLandmarker.detectForVideo(refs.video, performance.now());
    const landmarks = result.landmarks?.[0];
    if (landmarks) {
      drawPose(landmarks);
      updateCoach(landmarks);
    } else {
      showCues(["Step into view so your full body is visible."]);
    }
  }

  requestAnimationFrame(predictWebcam);
}

function runDemo(time) {
  if (!demoRunning) return;
  const landmarks = createDemoPose(time / 1000, refs.exercise.value);
  drawPose(landmarks);
  updateCoach(landmarks, true);
  requestAnimationFrame(runDemo);
}

function updateCoach(landmarks, isDemo = false) {
  const exercise = refs.exercise.value;
  const analysis = {
    squat: analyzeSquat,
    pushup: analyzePushup,
    plank: analyzePlank,
    press: analyzePress,
  }[exercise](landmarks);

  maybeCountRep(exercise, analysis);
  currentScore = Math.round(currentScore * 0.72 + analysis.score * 0.28);
  refs.score.textContent = String(currentScore);
  refs.scoreMeter.style.width = `${currentScore}%`;
  refs.scoreMeter.style.background = currentScore > 78 ? "var(--good)" : currentScore > 58 ? "var(--warn)" : "var(--bad)";
  refs.reps.textContent = String(repCount);
  refs.depth.textContent = analysis.depth;
  refs.alignment.textContent = analysis.alignment;
  refs.tempo.textContent = analysis.tempo || (isDemo ? "Demo" : "Live");
  showCues(analysis.cues);
}

function analyzeSquat(l) {
  const side = visibleSide(l);
  const hip = l[side.hip], knee = l[side.knee], ankle = l[side.ankle], shoulder = l[side.shoulder];
  const kneeAngle = angle(hip, knee, ankle);
  const torsoAngle = verticalAngle(shoulder, hip);
  const cues = [];
  let score = 100;

  if (kneeAngle > 120) {
    cues.push("Lower until thighs approach parallel.");
    score -= 20;
  } else {
    cues.push("Good depth. Drive through mid-foot.");
  }
  if (torsoAngle > 28) {
    cues.push("Lift chest and keep ribs stacked over hips.");
    score -= 18;
  }
  if (Math.abs(knee.x - ankle.x) > 0.12) {
    cues.push("Track knees over toes.");
    score -= 16;
  }
  if (cues.length === 1) cues.push("Stand tall to finish the rep.");

  return {
    score: clamp(score, 35, 100),
    cues,
    depth: `${Math.round(kneeAngle)} deg`,
    alignment: `${Math.round(torsoAngle)} deg lean`,
    tempo: repPhase === "down" ? "Rising" : "Lowering",
    repSignal: kneeAngle < 95 ? "down" : kneeAngle > 152 ? "up" : repPhase,
  };
}

function analyzePushup(l) {
  const side = visibleSide(l);
  const shoulder = l[side.shoulder], elbow = l[side.elbow], wrist = l[side.wrist], hip = l[side.hip], ankle = l[side.ankle];
  const elbowAngle = angle(shoulder, elbow, wrist);
  const bodyLine = angle(shoulder, hip, ankle);
  const shoulderWristOffset = Math.abs(shoulder.x - wrist.x);
  const cues = [];
  let score = 100;

  if (bodyLine < 162) {
    cues.push("Brace core; keep shoulders, hips, and ankles in one line.");
    score -= 24;
  }
  if (shoulderWristOffset > 0.1) {
    cues.push("Stack shoulders closer over wrists.");
    score -= 15;
  }
  if (elbowAngle > 120) {
    cues.push("Lower under control until elbows bend near 90 degrees.");
    score -= 16;
  } else {
    cues.push("Good bottom position. Press the floor away.");
  }

  return {
    score: clamp(score, 35, 100),
    cues,
    depth: `${Math.round(elbowAngle)} deg`,
    alignment: `${Math.round(bodyLine)} deg line`,
    tempo: repPhase === "down" ? "Pressing" : "Lowering",
    repSignal: elbowAngle < 90 ? "down" : elbowAngle > 155 ? "up" : repPhase,
  };
}

function analyzePlank(l) {
  const side = visibleSide(l);
  const shoulder = l[side.shoulder], hip = l[side.hip], ankle = l[side.ankle];
  const bodyLine = angle(shoulder, hip, ankle);
  const expectedHipY = lerp(shoulder.y, ankle.y, 0.48);
  const hipOffset = hip.y - expectedHipY;
  const cues = [];
  let score = 100;

  if (bodyLine < 165) {
    cues.push("Make a straighter line from shoulders through heels.");
    score -= 22;
  } else {
    cues.push("Strong body line. Keep breathing.");
  }
  if (hipOffset < -0.07) {
    cues.push("Lower hips slightly.");
    score -= 16;
  }
  if (hipOffset > 0.07) {
    cues.push("Lift hips slightly and brace abs.");
    score -= 16;
  }

  return {
    score: clamp(score, 35, 100),
    cues,
    depth: "Hold",
    alignment: `${Math.round(bodyLine)} deg line`,
    tempo: "Steady",
    repSignal: "up",
  };
}

function analyzePress(l) {
  const side = visibleSide(l);
  const shoulder = l[side.shoulder], elbow = l[side.elbow], wrist = l[side.wrist], hip = l[side.hip];
  const elbowAngle = angle(shoulder, elbow, wrist);
  const wristAboveShoulder = shoulder.y - wrist.y;
  const stack = Math.abs(shoulder.x - hip.x);
  const cues = [];
  let score = 100;

  if (wristAboveShoulder < 0.08) {
    cues.push("Press hands higher until wrists finish over shoulders.");
    score -= 20;
  } else {
    cues.push("Good overhead finish. Control the descent.");
  }
  if (elbowAngle < 145) {
    cues.push("Reach full elbow extension at the top.");
    score -= 14;
  }
  if (stack > 0.12) {
    cues.push("Avoid leaning back; stack ribs over hips.");
    score -= 18;
  }

  return {
    score: clamp(score, 35, 100),
    cues,
    depth: `${Math.round(elbowAngle)} deg`,
    alignment: `${Math.round(stack * 100)}% stack`,
    tempo: repPhase === "down" ? "Pressing" : "Lowering",
    repSignal: wristAboveShoulder > 0.16 && elbowAngle > 150 ? "up" : wristAboveShoulder < -0.01 ? "down" : repPhase,
  };
}

function maybeCountRep(exercise, analysis) {
  if (exercise === "plank") return;
  const now = performance.now();
  if (analysis.repSignal === "down" && repPhase !== "down") {
    repPhase = "down";
  }
  if (analysis.repSignal === "up" && repPhase === "down" && now - lastRepAt > 700) {
    repCount += 1;
    lastRepAt = now;
    repPhase = "up";
  }
}

function resetExerciseState() {
  repCount = 0;
  repPhase = "up";
  lastRepAt = 0;
  currentScore = 0;
}

function drawPose(landmarks) {
  fitCanvas();
  clearCanvas();
  ctx.lineWidth = Math.max(3, refs.canvas.width / 260);
  ctx.lineCap = "round";

  for (const [a, b] of POSE_CONNECTIONS) {
    if (isVisible(landmarks[a]) && isVisible(landmarks[b])) {
      drawLine(landmarks[a], landmarks[b], "rgba(96, 212, 189, 0.92)");
    }
  }

  for (const point of landmarks) {
    if (!isVisible(point)) continue;
    const { x, y } = toCanvas(point);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(4, refs.canvas.width / 180), 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 179, 108, 0.96)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(8, 17, 15, 0.75)";
    ctx.stroke();
  }
}

function drawLine(a, b, color) {
  const pa = toCanvas(a);
  const pb = toCanvas(b);
  ctx.beginPath();
  ctx.moveTo(pa.x, pa.y);
  ctx.lineTo(pb.x, pb.y);
  ctx.strokeStyle = color;
  ctx.stroke();
}

function fitCanvas() {
  const rect = refs.canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width * devicePixelRatio));
  const height = Math.max(1, Math.round(rect.height * devicePixelRatio));
  if (refs.canvas.width !== width || refs.canvas.height !== height) {
    refs.canvas.width = width;
    refs.canvas.height = height;
  }
}

function clearCanvas() {
  ctx.clearRect(0, 0, refs.canvas.width, refs.canvas.height);
}

function toCanvas(point) {
  return {
    x: point.x * refs.canvas.width,
    y: point.y * refs.canvas.height,
  };
}

function showCues(cues) {
  refs.cues.replaceChildren(...cues.slice(0, 4).map((cue) => {
    const li = document.createElement("li");
    li.textContent = cue;
    return li;
  }));
}

function setStatus(text, className) {
  refs.status.textContent = text;
  refs.status.className = `status-pill ${className}`.trim();
}

function visibleSide(l) {
  const leftVisibility = avgVisibility([l[11], l[13], l[15], l[23], l[25], l[27]]);
  const rightVisibility = avgVisibility([l[12], l[14], l[16], l[24], l[26], l[28]]);
  return leftVisibility >= rightVisibility
    ? { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 }
    : { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 };
}

function avgVisibility(points) {
  return points.reduce((sum, point) => sum + (point?.visibility ?? 1), 0) / points.length;
}

function isVisible(point) {
  return point && (point.visibility ?? 1) > 0.35;
}

function angle(a, b, c) {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const magA = Math.hypot(ab.x, ab.y);
  const magC = Math.hypot(cb.x, cb.y);
  return Math.acos(clamp(dot / (magA * magC), -1, 1)) * 180 / Math.PI;
}

function verticalAngle(a, b) {
  return Math.atan2(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) * 180 / Math.PI;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function createDemoPose(seconds, exercise) {
  const t = (Math.sin(seconds * 2.4) + 1) / 2;
  const l = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  const assign = (i, x, y) => {
    l[i] = { x, y, z: 0, visibility: 1 };
  };

  if (exercise === "pushup" || exercise === "plank") {
    const dip = exercise === "pushup" ? t * 0.12 : 0.02;
    assign(11, 0.32, 0.46 + dip); assign(12, 0.32, 0.46 + dip);
    assign(13, 0.26, 0.56 + dip); assign(14, 0.26, 0.56 + dip);
    assign(15, 0.34, 0.68); assign(16, 0.34, 0.68);
    assign(23, 0.58, exercise === "plank" ? 0.50 : 0.48 + dip * 0.25); assign(24, 0.58, exercise === "plank" ? 0.50 : 0.48 + dip * 0.25);
    assign(25, 0.74, 0.58); assign(26, 0.74, 0.58);
    assign(27, 0.86, 0.65); assign(28, 0.86, 0.65);
  } else if (exercise === "press") {
    const up = t;
    assign(11, 0.46, 0.42); assign(12, 0.54, 0.42);
    assign(23, 0.47, 0.62); assign(24, 0.53, 0.62);
    assign(13, 0.42, lerp(0.46, 0.24, up)); assign(14, 0.58, lerp(0.46, 0.24, up));
    assign(15, 0.40, lerp(0.38, 0.12, up)); assign(16, 0.60, lerp(0.38, 0.12, up));
    assign(25, 0.46, 0.82); assign(26, 0.54, 0.82);
    assign(27, 0.44, 0.96); assign(28, 0.56, 0.96);
  } else {
    const down = t;
    assign(11, 0.45, lerp(0.28, 0.40, down)); assign(12, 0.55, lerp(0.28, 0.40, down));
    assign(23, 0.45, lerp(0.55, 0.68, down)); assign(24, 0.55, lerp(0.55, 0.68, down));
    assign(25, 0.43, lerp(0.75, 0.70, down)); assign(26, 0.57, lerp(0.75, 0.70, down));
    assign(27, 0.42, 0.94); assign(28, 0.58, 0.94);
    assign(13, 0.40, 0.42); assign(14, 0.60, 0.42);
    assign(15, 0.38, 0.54); assign(16, 0.62, 0.54);
  }

  return l;
}
