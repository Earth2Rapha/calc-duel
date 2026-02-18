const el = (id) => document.getElementById(id);

// Screens
const menuScreen  = el("menuScreen");
const lobbyScreen = el("lobbyScreen");
const gameScreen  = el("gameScreen");

// Menu
const menuError = el("menuError");
const menuError2 = el("menuError2");
const menuName = el("menuName");
const menuNameJoinMirror = el("menuNameJoinMirror");
const menuCode = el("menuCode");
const menuDiff = el("menuDiff");
const menuDuration = el("menuDuration");
const menuQuestions = el("menuQuestions");
const menuPen = el("menuPen");
const createLobbyBtn = el("createLobbyBtn");
const joinLobbyBtn = el("joinLobbyBtn");
const botBtn = el("botBtn");

// Tabs
const dateItems = Array.from(document.querySelectorAll(".dateItem"));
const tabs = {
  create: el("tab-create"),
  join: el("tab-join"),
  bot: el("tab-bot"),
  how: el("tab-how"),
};
function setMenuTab(key){
  Object.keys(tabs).forEach(k => tabs[k]?.classList.toggle("hidden", k !== key));
  dateItems.forEach(it => it.classList.toggle("active", it.dataset.tab === key));
}

// Lobby
const lobbyCodeEl = el("lobbyCode");
const copyCodeBtn = el("copyCodeBtn");
const lobbySub = el("lobbySub");
const playerList = el("playerList");
const joinPrompt = el("joinPrompt");
const roomDiffEl = el("roomDiff");
const roomDurEl = el("roomDur");
const roomQEl = el("roomQ");
const roomPenEl = el("roomPen");
const readyUpBtn = el("readyUpBtn");
const leaveLobbyBtn = el("leaveLobbyBtn");
const lobbyStatus = el("lobbyStatus");

// Game
const youScoreEl = el("youScore");
const oppScoreEl = el("oppScore");
const timeEl = el("time");
const barEl = el("bar");
const qEl = el("question");
const statusEl = el("status");
const inlineStatus = el("inlineStatus");
const ansEl = el("answer");
const submitBtn = el("submitBtn");
const giveUpBtn = el("giveUpBtn");
const leaveBtn = el("leaveBtn");

// Overlays
const roundOverlay = el("roundOverlay");
const roundTitle = el("roundTitle");
const roundSubtitle = el("roundSubtitle");
const roundNextIn = el("roundNextIn");

const matchOverlay = el("matchOverlay");
const matchTitle = el("matchTitle");
const matchSubtitle = el("matchSubtitle");
const backLobbyBtn = el("backLobbyBtn");
const backMenuBtn = el("backMenuBtn");

// Canvases
const canvasGrid = el("canvasGrid");
const spectateBadge = el("spectateBadge");
const oppPane = el("oppPane");

const canvas = el("pad");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

const oppCanvas = el("oppPad");
const oppCtx = oppCanvas.getContext("2d", { willReadFrequently: true });

// Tools
const penBtn = el("penBtn");
const eraserBtn = el("eraserBtn");
const undoBtn = el("undoBtn");
const clearBtn = el("clearBtn");

// Socket
const socket = io();

// State
let ROOM = { code: null, youId: null, isHost: false };
let SETTINGS = { diff:"easy", durationSec:90, questionsTotal:5, penWidth:3 };
let roomMode = "multi";

let roundActive = false;
let roundStart = 0;
let durationSec = 90;
let winsMap = new Map();
let lockedMe = false;

function show(screenEl){
  const all = Array.from(document.querySelectorAll(".screen"));
  for (const s of all){
    s.classList.add("hidden");
    s.style.display = "none";
  }
  screenEl.classList.remove("hidden");
  screenEl.style.display = screenEl.dataset.display || "flex";
}

function setMenuError(msg, which=1){
  const box = which === 2 ? menuError2 : menuError;
  if (!box) return;
  if (!msg){ box.classList.add("hidden"); box.textContent = ""; return; }
  box.textContent = msg;
  box.classList.remove("hidden");
}

function setStatus(msg){ statusEl.textContent = msg || ""; }
function setInline(msg){ inlineStatus.textContent = msg || ""; }

function readSettingsFromMenu(){
  SETTINGS = {
    diff: menuDiff.value,
    durationSec: Number(menuDuration.value || 90),
    questionsTotal: Number(menuQuestions.value || 5),
    penWidth: Number(menuPen.value || 3),
  };
}

function renderLobby(room){
  roomMode = room.mode || "multi";
  lobbyCodeEl.textContent = room.code || "-----";

  roomDiffEl.textContent = room.settings?.diff ?? "—";
  roomDurEl.textContent = `${room.settings?.durationSec ?? "—"}s`;
  roomQEl.textContent = `${room.settings?.questionsTotal ?? "—"}`;
  roomPenEl.textContent = `${room.settings?.penWidth ?? SETTINGS.penWidth}`;

  playerList.innerHTML = "";
  const players = room.players || [];

  const row = (name, ready) => {
    const d = document.createElement("div");
    d.className = "playerRow";
    d.innerHTML = `<div style="font-weight:900">${name}</div><div style="font-weight:900">${ready}</div>`;
    playerList.appendChild(d);
  };

  row(players[0]?.name || "Player 1", players[0]?.ready ? "Ready ✅" : "Not ready");
  if (room.mode === "bot") row("Bot", "Ready ✅");
  else row(players[1]?.name || "Waiting for player…", players[1]?.ready ? "Ready ✅" : "—");

  const hasOpp = room.mode === "bot" ? true : players.some(p => p.id !== ROOM.youId);
  joinPrompt.textContent = hasOpp ? "Opponent joined. Click Ready to start." : "Waiting for opponent…";
  readyUpBtn.disabled = !hasOpp;
  lobbySub.textContent = room.mode === "bot" ? "Single-player vs Bot" : "Multiplayer lobby";
}

function updateScores(winners){
  winsMap = new Map();
  for (const w of winners || []) winsMap.set(w.id, w.wins);

  const myWins = winsMap.get(ROOM.youId) ?? 0;
  let oppWins = 0;
  for (const [id, w] of winsMap.entries()) if (id !== ROOM.youId) oppWins = w;

  youScoreEl.textContent = myWins;
  oppScoreEl.textContent = oppWins;
}

/* =========================
   Spectate snapshot helpers
========================= */
function makeCompressedSnapshotDataURL() {
  // Downscale + JPEG compress (WAY smaller than PNG)
  const MAX_W = 900; // keep it readable
  const MAX_H = 520;

  const src = canvas;
  const srcW = src.width;
  const srcH = src.height;
  if (!srcW || !srcH) return null;

  // Compute scale so it fits in MAX
  const scale = Math.min(MAX_W / srcW, MAX_H / srcH, 1);
  const w = Math.max(1, Math.floor(srcW * scale));
  const h = Math.max(1, Math.floor(srcH * scale));

  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const octx = off.getContext("2d");

  octx.fillStyle = "#ffffff";
  octx.fillRect(0, 0, w, h);
  octx.drawImage(src, 0, 0, w, h);

  // JPEG quality: 0.55 keeps it small
  return off.toDataURL("image/jpeg", 0.55);
}

function enterSpectateMode(on){
  const enabled = on && roomMode === "multi";

  spectateBadge.classList.toggle("hidden", !enabled);
  oppPane.classList.toggle("hidden", !enabled);
  canvasGrid.classList.toggle("spectating", enabled);

  // lock tools while spectating
  penBtn.disabled = enabled;
  eraserBtn.disabled = enabled;
  undoBtn.disabled = enabled;
  clearBtn.disabled = enabled;

  if (enabled) {
    // IMPORTANT: wait a tick so the opponent canvas is visible, then resize properly
    requestAnimationFrame(() => {
      resizeBoth();
      clearOppHard();

      console.log("[Spectate] requesting snapshot…");
      socket.emit("spectate:request", { code: ROOM.code });
    });
  }
}


/* =========================
   Menu UI init
========================= */
dateItems.forEach(it => it.addEventListener("click", () => setMenuTab(it.dataset.tab)));
setMenuTab("create");

menuName.addEventListener("input", () => {
  if (menuNameJoinMirror) menuNameJoinMirror.value = menuName.value;
});
if (menuNameJoinMirror) menuNameJoinMirror.value = menuName.value;

/* =========================
   Menu buttons
========================= */
createLobbyBtn.addEventListener("click", () => {
  setMenuError("", 1); setMenuError("", 2);
  readSettingsFromMenu();
  socket.emit("create_room", { name: (menuName.value || "Player").trim(), settings: SETTINGS });
});

joinLobbyBtn.addEventListener("click", () => {
  setMenuError("", 1); setMenuError("", 2);
  const code = (menuCode.value || "").trim().toUpperCase();
  if (!code) return setMenuError("Enter a lobby code.", 2);
  socket.emit("join_room", { code, name: (menuName.value || "Player").trim() });
});

botBtn.addEventListener("click", () => {
  setMenuError("", 1); setMenuError("", 2);
  readSettingsFromMenu();
  socket.emit("create_bot_room", { name: (menuName.value || "You").trim(), settings: SETTINGS });
});

/* =========================
   Lobby buttons
========================= */
copyCodeBtn.addEventListener("click", async () => {
  const code = (lobbyCodeEl.textContent || "").trim();
  try{
    await navigator.clipboard.writeText(code);
    lobbyStatus.textContent = `Copied ${code} ✅`;
    setTimeout(() => (lobbyStatus.textContent = ""), 1200);
  }catch{
    lobbyStatus.textContent = `Copy failed. Code: ${code}`;
  }
});

readyUpBtn.addEventListener("click", () => {
  if (!ROOM.code) return;
  socket.emit("set_ready", { code: ROOM.code, ready: true });
  lobbyStatus.textContent = "Ready ✅";
});

function leaveEverything(){
  if (ROOM.code) socket.emit("leave_room", { code: ROOM.code });
  ROOM = { code:null, youId:null, isHost:false };
  winsMap = new Map();
  roundActive = false;
  lockedMe = false;
  enterSpectateMode(false);
  roundOverlay.classList.add("hidden");
  matchOverlay.classList.add("hidden");
  show(menuScreen);
}

leaveLobbyBtn.addEventListener("click", leaveEverything);
leaveBtn.addEventListener("click", leaveEverything);
backMenuBtn.addEventListener("click", leaveEverything);
backLobbyBtn.addEventListener("click", () => { matchOverlay.classList.add("hidden"); show(lobbyScreen); });

/* =========================
   Game buttons
========================= */
submitBtn.addEventListener("click", () => {
  if (!ROOM.code || !roundActive) return;
  socket.emit("lock_answer", { code: ROOM.code, answer: ansEl.value });
});

ansEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitBtn.click();
});

giveUpBtn.addEventListener("click", () => {
  if (!ROOM.code || !roundActive) return;
  socket.emit("give_up", { code: ROOM.code });
});

/* =========================
   Socket events
========================= */
socket.on("join_error", ({ message }) => {
  setMenuError(message || "Join error.", 2);
  show(menuScreen);
});

socket.on("joined_room", ({ code, youId, isHost, room }) => {
  ROOM = { code, youId, isHost };
  show(lobbyScreen);
  renderLobby(room);
});

socket.on("room_update", (room) => {
  if (!ROOM.code || room.code !== ROOM.code) return;
  renderLobby(room);
});

socket.on("match_begin", () => {
  show(gameScreen);
  roundOverlay.classList.add("hidden");
  matchOverlay.classList.add("hidden");

  lockedMe = false;
  enterSpectateMode(false);

  setStatus("Match started.");
  setInline("");
  ansEl.value = "";

  clearPadHard();
  clearOppHard();
  resizeBoth();
});

socket.on("round_start", ({ roundIndex, totalRounds, durationSec: ds, question }) => {
  durationSec = ds || durationSec;
  roundStart = performance.now();
  roundActive = true;

  lockedMe = false;
  enterSpectateMode(false);

  qEl.textContent = `Round ${roundIndex}/${totalRounds}: ${question}`;
  setStatus("Round live.");
  setInline("Draw working. Lock answer when ready.");
  ansEl.value = "";

  clearPadHard();
  clearOppHard();
  resizeBoth();
});

socket.on("lock_update", ({ playerId, locked, correct }) => {
  if (!locked) return;

  if (playerId === ROOM.youId) {
    lockedMe = true;
    setInline(correct ? "Locked ✅ — spectating…" : "Locked ❌ — spectating…");
    enterSpectateMode(true);
  } else {
    setInline(correct ? "Opponent locked ✅" : "Opponent locked ❌");
  }
});

socket.on("round_end", ({ winnerId, winners }) => {
  roundActive = false;
  lockedMe = false;
  enterSpectateMode(false);
  updateScores(winners);

  roundTitle.textContent = winnerId
    ? (winnerId === ROOM.youId ? "You win this round ✅" : "Opponent wins ❌")
    : "Round tied";
  roundSubtitle.textContent = "Next round starting…";
  roundOverlay.classList.remove("hidden");

  let t = 2;
  roundNextIn.textContent = String(t);
  const iv = setInterval(() => {
    t -= 1;
    roundNextIn.textContent = String(Math.max(0, t));
    if (t <= 0) {
      clearInterval(iv);
      roundOverlay.classList.add("hidden");
    }
  }, 1000);
});

socket.on("match_end", ({ final, winners }) => {
  roundActive = false;
  lockedMe = false;
  enterSpectateMode(false);
  updateScores(winners);
  roundOverlay.classList.add("hidden");

  if (final?.type === "win") {
    matchTitle.textContent = final.winnerId === ROOM.youId ? "You win the match 🏆" : "Opponent wins 🏆";
  } else {
    matchTitle.textContent = "Match tied 🤝";
  }

  const myWins = winsMap.get(ROOM.youId) ?? 0;
  let oppWins = 0;
  for (const [id, w] of winsMap.entries()) if (id !== ROOM.youId) oppWins = w;
  matchSubtitle.textContent = `Final score: You ${myWins} — Opponent ${oppWins}`;
  matchOverlay.classList.remove("hidden");
});

/* =========================
   Timer UI
========================= */
setInterval(() => {
  if (!roundActive) return;
  const elapsed = (performance.now() - roundStart) / 1000;
  timeEl.textContent = elapsed.toFixed(1);
  const ratio = Math.max(0, 1 - elapsed / durationSec);
  barEl.style.transform = `scaleX(${ratio})`;
}, 50);

/* =========================
   Drawing (local + remote)
========================= */
let tool = "pen";
let drawing = false;
let lastPos = null;
let history = [];

let rTool = "pen";
let rWidth = 3;
let rLast = null;

let lastSendAt = 0;
const SEND_EVERY_MS = 25;

function setTool(t){
  tool = t;
  penBtn.classList.toggle("active", tool === "pen");
  eraserBtn.classList.toggle("active", tool === "eraser");
}

function applyToolStyle(cctx, whichTool, width){
  cctx.lineCap = "round";
  cctx.lineJoin = "round";
  if (whichTool === "pen"){
    cctx.globalCompositeOperation = "source-over";
    cctx.strokeStyle = "#141828";
    cctx.lineWidth = width;
  } else {
    cctx.globalCompositeOperation = "destination-out";
    cctx.lineWidth = 22;
  }
}

function resizeCanvasToDisplay(c, cctx){
  const rect = c.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  // IMPORTANT: keep internal bitmap smaller to reduce snapshot size
  const maxInternalW = 1400;
  const maxInternalH = 900;

  let w = Math.max(1, Math.floor(rect.width * dpr));
  let h = Math.max(1, Math.floor(rect.height * dpr));

  const scaleDown = Math.min(maxInternalW / w, maxInternalH / h, 1);
  w = Math.floor(w * scaleDown);
  h = Math.floor(h * scaleDown);

  c.width = w;
  c.height = h;

  // Map CSS px to internal px
  const sx = w / rect.width;
  const sy = h / rect.height;
  cctx.setTransform(sx, 0, 0, sy, 0, 0);
}

function resizeBoth(){
  resizeCanvasToDisplay(canvas, ctx);
  resizeCanvasToDisplay(oppCanvas, oppCtx);
}

function getPos(e, c){
  const rect = c.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function saveState(){
  try{
    history.push(ctx.getImageData(0,0,canvas.width,canvas.height));
    if (history.length > 30) history.shift();
  }catch{}
}

function clearPadHard(){
  history = [];
  drawing = false;
  lastPos = null;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.beginPath();
}

function clearOppHard(){
  rLast = null;
  oppCtx.save();
  oppCtx.setTransform(1,0,0,1,0,0);               // clear in raw pixel space
  oppCtx.clearRect(0,0,oppCanvas.width,oppCanvas.height);
  oppCtx.restore();
  oppCtx.beginPath();
}


function undo(){
  const prev = history.pop();
  if (prev) ctx.putImageData(prev, 0, 0);
}

canvas.addEventListener("pointerdown", (e) => {
  if (!roundActive || lockedMe) return;

  drawing = true;
  canvas.setPointerCapture(e.pointerId);
  saveState();

  lastPos = getPos(e, canvas);
  applyToolStyle(ctx, tool, SETTINGS.penWidth);

  ctx.beginPath();
  ctx.moveTo(lastPos.x, lastPos.y);
  ctx.lineTo(lastPos.x + 0.01, lastPos.y + 0.01);
  ctx.stroke();

  if (ROOM.code && roomMode === "multi") {
    socket.emit("draw_event", { code: ROOM.code, type: "start", data: { x:lastPos.x, y:lastPos.y, tool, width: SETTINGS.penWidth } });
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (!drawing || !lastPos) return;
  if (!roundActive || lockedMe) return;

  const p = getPos(e, canvas);
  applyToolStyle(ctx, tool, SETTINGS.penWidth);

  ctx.beginPath();
  ctx.moveTo(lastPos.x, lastPos.y);
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
  lastPos = p;

  const now = performance.now();
  if (ROOM.code && roomMode === "multi" && now - lastSendAt >= SEND_EVERY_MS) {
    lastSendAt = now;
    socket.emit("draw_event", { code: ROOM.code, type: "move", data: { x:p.x, y:p.y } });
  }
});

function stopDrawing(){
  if (!drawing) return;
  drawing = false;
  lastPos = null;
  ctx.beginPath();
  if (ROOM.code && roomMode === "multi" && roundActive && !lockedMe) {
    socket.emit("draw_event", { code: ROOM.code, type: "end", data: {} });
  }
}

canvas.addEventListener("pointerup", stopDrawing);
canvas.addEventListener("pointercancel", stopDrawing);
canvas.addEventListener("pointerleave", stopDrawing);

penBtn.addEventListener("click", () => setTool("pen"));
eraserBtn.addEventListener("click", () => setTool("eraser"));
undoBtn.addEventListener("click", () => { if (!lockedMe) undo(); });
clearBtn.addEventListener("click", () => {
  if (lockedMe) return;
  saveState();
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if (ROOM.code && roomMode === "multi") socket.emit("draw_event", { code: ROOM.code, type:"clear", data:{} });
});

// Remote draw (only render while spectating)
function remoteStart(d){
  rTool = d.tool || "pen";
  rWidth = Number(d.width || 3);
  rLast = { x:d.x, y:d.y };
  applyToolStyle(oppCtx, rTool, rWidth);

  oppCtx.beginPath();
  oppCtx.moveTo(rLast.x, rLast.y);
  oppCtx.lineTo(rLast.x + 0.01, rLast.y + 0.01);
  oppCtx.stroke();
}
function remoteMove(d){
  if (!rLast) return;
  const p = { x:d.x, y:d.y };
  applyToolStyle(oppCtx, rTool, rWidth);

  oppCtx.beginPath();
  oppCtx.moveTo(rLast.x, rLast.y);
  oppCtx.lineTo(p.x, p.y);
  oppCtx.stroke();
  rLast = p;
}
function remoteEnd(){
  rLast = null;
  oppCtx.beginPath();
}

socket.on("draw_event", ({ from, type, data }) => {
  if (roomMode !== "multi") return;
  if (!lockedMe) return;
  if (from === ROOM.youId) return;

  if (type === "start") remoteStart(data);
  else if (type === "move") remoteMove(data);
  else if (type === "end") remoteEnd();
  else if (type === "clear") clearOppHard();
});

/* =========================
   Snapshot sending/receiving
========================= */

// Opponent asks you for your current canvas snapshot
socket.on("spectate:requestState", ({ requesterId }) => {
  if (!requesterId) return;
  if (roomMode !== "multi") return;

  const img = makeCompressedSnapshotDataURL();
  if (!img) return;

  console.log("[Spectate] sending snapshot bytes≈", img.length);
  socket.emit("spectate:state", { to: requesterId, img });
});

// You receive opponent snapshot: draw it instantly
socket.on("spectate:state", ({ img }) => {
  if (!img) return;
  if (!lockedMe) return;

  console.log("[Spectate] received snapshot bytes≈", img.length);

  // Ensure opponent canvas has correct size now that it's visible
  resizeBoth();

  const im = new Image();
  im.onload = () => {
    // Draw using CSS-size coordinates (because we setTransform in resize)
    const rect = oppCanvas.getBoundingClientRect();
    if (rect.width < 5 || rect.height < 5) {
      // If still hidden for any reason, try again next frame
      requestAnimationFrame(() => {
        resizeBoth();
        const r2 = oppCanvas.getBoundingClientRect();
        oppCtx.clearRect(0,0,r2.width,r2.height);
        oppCtx.drawImage(im, 0, 0, r2.width, r2.height);
      });
      return;
    }

    oppCtx.clearRect(0,0,rect.width,rect.height);
    oppCtx.drawImage(im, 0, 0, rect.width, rect.height);
  };
  im.src = img;
});


// Resize
window.addEventListener("resize", () => {
  if (!gameScreen.classList.contains("hidden")) resizeBoth();
});

// Init
setTool("pen");
show(menuScreen);
setMenuTab("create");
requestAnimationFrame(() => resizeBoth());
