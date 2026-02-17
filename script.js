const el = (id) => document.getElementById(id);

// Screens
const menuScreen = el("menuScreen");
const gameScreen = el("gameScreen");

// Menu
const readyBtn = el("readyBtn");
const howBtn = el("howBtn");
const howBox = el("howBox");
const menuDiff = el("menuDiff");
const menuDuration = el("menuDuration");
const menuBot = el("menuBot");
const menuPen = el("menuPen");

// Game UI
const youScoreEl = el("youScore");
const botScoreEl = el("botScore");
const streakEl = el("streak");
const timeEl = el("time");
const barEl = el("bar");
const qEl = el("question");
const statusEl = el("status");
const inlineStatus = el("inlineStatus");
const ansEl = el("answer");
const submitBtn = el("submitBtn");
const nextBtn = el("nextBtn");
const resetBtn = el("resetBtn");

// Tools
const penBtn = el("penBtn");
const eraserBtn = el("eraserBtn");
const undoBtn = el("undoBtn");
const clearBtn = el("clearBtn");

// Countdown
const countdown = el("countdown");
const countText = el("countText");

// Result overlay
const resultOverlay = el("resultOverlay");
const resultTitle = el("resultTitle");
const resultSubtitle = el("resultSubtitle");
const resultNext = el("resultNext");
const resultMenu = el("resultMenu");

// Canvas
const canvas = el("pad");
const ctx = canvas.getContext("2d");

// Settings
let SETTINGS = { diff:"easy", duration:90, bot:"chill", penWidth:3 };

// State
let youScore = 0, botScore = 0, streak = 0;
let roundActive = false;
let startTime = 0;
let timer = null;

let current = null;
let botSubmitAt = Infinity;
let botWillBeCorrect = false;

// ===== Questions (numeric-only demo) =====
function questionBank() {
  return [
    { prompt: "Compute ∫₀² (3x² + 1) dx", answer: 10, tol: 1e-6 },
    { prompt: "If f(x)=x³ − 5x, what is f'(2)?", answer: 7, tol: 1e-6 },
    { prompt: "Limit: limₓ→0 (sin x)/x", answer: 1, tol: 1e-3 },
    { prompt: "Compute ∫₀¹ x(1+x²) dx", answer: 3/4, tol: 1e-6 },
    { prompt: "Compute ∫₁³ (2x) dx", answer: 8, tol: 1e-6 },
    { prompt: "If f(x)=3x²+4x, what is f'(1)?", answer: 10, tol: 1e-6 },
  ];
}
function pickQuestion() {
  const list = questionBank();
  return list[Math.floor(Math.random() * list.length)];
}

// ===== Parsing =====
function parseNumeric(input) {
  const s = String(input).trim();
  if (!s) return null;
  if (!/^[\d\s.+\-\/]+$/.test(s)) return null;

  if (s.includes("/")) {
    const parts = s.split("/").map(p => p.trim());
    if (parts.length !== 2) return null;
    const a = Number(parts[0]), b = Number(parts[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
    return a / b;
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ===== UI helpers =====
function setStatus(msg) { statusEl.textContent = msg; }
function setInline(msg, cls="") {
  inlineStatus.className = "inlineStatus " + cls;
  inlineStatus.textContent = msg;
}
function flashInput(cls) {
  ansEl.classList.remove("inputGood","inputBad");
  if (cls) ansEl.classList.add(cls);
  setTimeout(() => ansEl.classList.remove("inputGood","inputBad"), 550);
}
function updateStats() {
  youScoreEl.textContent = youScore;
  botScoreEl.textContent = botScore;
  streakEl.textContent = streak;
}
function stopTimer() {
  if (timer !== null) { clearInterval(timer); timer = null; }
}
function showResult(title, subtitle) {
  resultTitle.textContent = title;
  resultSubtitle.textContent = subtitle;
  resultOverlay.classList.remove("hidden");
}
function hideResult() {
  resultOverlay.classList.add("hidden");
}

// ===== Slower bot profile =====
function botProfile(bot, diff) {
  const base = diff === "easy" ? 1 : diff === "medium" ? 0.92 : 0.85;

  // Slower overall (seconds). Chill gives lots of scratchpad time.
  if (bot === "chill") {
    return { acc: 0.45 * base, minDelay: 25, maxDelay: 55 };
  }
  if (bot === "normal") {
    return { acc: 0.60 * base, minDelay: 18, maxDelay: 42 };
  }
  // cracked: still faster but not unfair
  return { acc: 0.75 * base, minDelay: 14, maxDelay: 30 };
}

// ===== Countdown =====
function doCountdown(n) {
  countdown.classList.remove("hidden");
  return new Promise((resolve) => {
    let t = n;
    countText.textContent = String(t);
    const interval = setInterval(() => {
      t -= 1;
      if (t <= 0) {
        clearInterval(interval);
        countdown.classList.add("hidden");
        resolve();
      } else {
        countText.textContent = String(t);
      }
    }, 800);
  });
}

// ===== Start flow =====
async function startFromMenu() {
  SETTINGS.diff = menuDiff.value;
  SETTINGS.duration = Number(menuDuration.value);
  SETTINGS.bot = menuBot.value;
  SETTINGS.penWidth = Number(menuPen.value);

  menuScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");

  nextBtn.disabled = true;
  ansEl.value = "";
  setInline("", "");
  setStatus("Get ready...");
  updateStats();
  clearScratchpadHard();
  hideResult();

  await doCountdown(3);
  startRound();
}

function startRound() {
  stopTimer();
  roundActive = true;
  hideResult();

  current = pickQuestion();
  qEl.textContent = current.prompt;

  ansEl.value = "";
  ansEl.focus();
  nextBtn.disabled = true;

  startTime = performance.now();

  const bp = botProfile(SETTINGS.bot, SETTINGS.diff);
  botWillBeCorrect = Math.random() < bp.acc;
  const delay = bp.minDelay + Math.random() * (bp.maxDelay - bp.minDelay);
  botSubmitAt = startTime + delay * 1000;

  setStatus("Solve, then submit your final answer.");
  setInline("Round live.", "warn");

  timer = setInterval(tick, 30);
}

function finish(winner) {
  if (!roundActive) return;
  roundActive = false;
  stopTimer();

  if (winner === "you") {
    youScore += 1; streak += 1;
    updateStats();
    setStatus("✅ You win!");
    setInline("Correct.", "good");
    showResult("You win ✅", "Nice. Ready for the next round?");
    nextBtn.disabled = false;
  } else if (winner === "bot") {
    botScore += 1; streak = 0;
    updateStats();
    setStatus("❌ Bot wins!");
    setInline("Bot got it first.", "bad");
    showResult("Bot wins ❌", "Round over. Click Next to continue.");
    nextBtn.disabled = false;
  } else {
    streak = 0;
    updateStats();
    setStatus("⏱️ Time’s up.");
    setInline("Out of time.", "bad");
    showResult("Time’s up ⏱️", "Try another round.");
    nextBtn.disabled = false;
  }
}

function submitAnswer() {
  if (!roundActive || !current) return;

  const v = parseNumeric(ansEl.value);
  if (v === null) {
    setInline("That doesn’t look numeric. Try 2.5 or 7/2.", "bad");
    flashInput("inputBad");
    return;
  }

  const ok = Math.abs(v - current.answer) <= current.tol;
  if (ok) {
    flashInput("inputGood");
    finish("you");
  } else {
    setInline("Not correct — keep working and resubmit.", "warn");
    flashInput("inputBad");
  }
}

function tick() {
  if (!roundActive) return;

  const now = performance.now();
  const elapsed = (now - startTime) / 1000;

  timeEl.textContent = elapsed.toFixed(2);
  const ratio = Math.max(0, 1 - elapsed / SETTINGS.duration);
  barEl.style.transform = `scaleX(${ratio})`;

  if (now >= botSubmitAt) {
    botSubmitAt = Infinity;
    if (botWillBeCorrect) {
      finish("bot");
      return;
    } else {
      setInline("Bot answered wrong 😅 Keep going!", "warn");
    }
  }

  if (elapsed >= SETTINGS.duration) finish("none");
}

// ===== Reset / Next =====
function fullResetToMenu() {
  roundActive = false;
  stopTimer();
  botSubmitAt = Infinity;
  hideResult();

  youScore = 0; botScore = 0; streak = 0;
  updateStats();

  timeEl.textContent = "0.00";
  barEl.style.transform = "scaleX(1)";
  qEl.textContent = "Question will appear here";
  ansEl.value = "";
  setStatus("Ready.");
  setInline("", "");
  nextBtn.disabled = true;

  clearScratchpadHard();

  gameScreen.classList.add("hidden");
  menuScreen.classList.remove("hidden");
}

async function nextRound() {
  if (roundActive) return;
  hideResult();
  nextBtn.disabled = true;
  ansEl.value = "";
  setInline("", "");
  setStatus("Next round...");
  clearScratchpadHard();
  await doCountdown(3);
  startRound();
}

// ===== Scratchpad =====
let drawing = false;
let tool = "pen";
let history = [];
let lastPos = null;

function setTool(newTool) {
  tool = newTool;
  penBtn.classList.toggle("active", tool === "pen");
  eraserBtn.classList.toggle("active", tool === "eraser");
  canvas.style.cursor = tool === "eraser" ? "cell" : "crosshair";
}
function saveState() {
  try {
    history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (history.length > 30) history.shift();
  } catch {}
}
function undo() {
  const prev = history.pop();
  if (prev) ctx.putImageData(prev, 0, 0);
}
function clearScratchpadHard() {
  history = [];
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawing = false;
  lastPos = null;
  ctx.beginPath();
}
function clearPad() {
  saveState();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}
function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height),
  };
}
function applyToolStyle() {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (tool === "pen") {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "#141828"; // dark ink
    ctx.lineWidth = SETTINGS.penWidth;
  } else {
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineWidth = 22;
  }
}
canvas.addEventListener("pointerdown", (e) => {
  drawing = true;
  canvas.setPointerCapture(e.pointerId);
  saveState();
  lastPos = getPos(e);

  ctx.beginPath();
  ctx.moveTo(lastPos.x, lastPos.y);

  applyToolStyle();
  ctx.lineTo(lastPos.x + 0.01, lastPos.y + 0.01);
  ctx.stroke();
});
canvas.addEventListener("pointermove", (e) => {
  if (!drawing || !lastPos) return;

  const p = getPos(e);
  applyToolStyle();

  ctx.beginPath();
  ctx.moveTo(lastPos.x, lastPos.y);
  ctx.lineTo(p.x, p.y);
  ctx.stroke();

  lastPos = p;
});
function stopDrawing() {
  drawing = false;
  lastPos = null;
  ctx.beginPath();
}
canvas.addEventListener("pointerup", stopDrawing);
canvas.addEventListener("pointercancel", stopDrawing);
canvas.addEventListener("pointerleave", stopDrawing);

// ===== Events =====
howBtn.addEventListener("click", () => howBox.classList.toggle("hidden"));
readyBtn.addEventListener("click", startFromMenu);

submitBtn.addEventListener("click", submitAnswer);
ansEl.addEventListener("keydown", (e) => { if (e.key === "Enter") submitAnswer(); });

nextBtn.addEventListener("click", nextRound);
resetBtn.addEventListener("click", fullResetToMenu);

penBtn.addEventListener("click", () => setTool("pen"));
eraserBtn.addEventListener("click", () => setTool("eraser"));
undoBtn.addEventListener("click", undo);
clearBtn.addEventListener("click", clearPad);

// Result overlay buttons
resultNext.addEventListener("click", nextRound);
resultMenu.addEventListener("click", fullResetToMenu);

// Init
setTool("pen");
updateStats();
setStatus("Ready.");
setInline("", "");
