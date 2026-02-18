const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// IMPORTANT: allow bigger payloads (snapshots)
const io = new Server(server, {
  maxHttpBufferSize: 8e6 // 8 MB
});

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, "..", "public")));

server.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));

/* =========================
   Questions
========================= */
const Q = (prompt, answer) => ({ prompt, answer: String(answer) });

const QUESTIONS = {
  easy: [
    Q("If f(x)=x³−5x, what is f′(2)?", "7"),
    Q("Compute ∫₀² (3x²+1) dx", "10"),
    Q("Differentiate: d/dx (4x² − 3x + 1)", "8x-3"),
    Q("Compute ∫₁³ 2x dx", "8"),
    Q("If f(x)=2x+5, what is f(4)?", "13"),
    Q("Differentiate: d/dx (sin x)", "cosx"),
    Q("Compute ∫₀¹ 6x dx", "3"),
    Q("Differentiate: d/dx (x²)", "2x"),
    Q("Compute ∫₀³ 2 dx", "6"),
    Q("If f(x)=x², what is f(5)?", "25")
  ],
  medium: [
    Q("Differentiate: d/dx (x² sin x)", "2xsinx+x^2cosx"),
    Q("Compute ∫₀¹ (x³ − 2x) dx", "-1/4"),
    Q("If f(x)=ln(x), what is f′(e)?", "1/e"),
    Q("Differentiate: d/dx (e^{3x})", "3e^{3x}"),
    Q("Compute ∫₀^{π} sin x dx", "2"),
    Q("Differentiate: d/dx ((x+1)/x)", "-1/x^2")
  ],
  hard: [
    Q("Differentiate: d/dx (ln(x²+1))", "2x/(x^2+1)"),
    Q("Compute ∫₀¹ 1/(1+x²) dx", "pi/4"),
    Q("Differentiate: d/dx (x^x)", "x^x(lnx+1)"),
    Q("Compute ∫₁^{e} 1/x dx", "1"),
    Q("Differentiate: d/dx (sin(3x))", "3cos(3x)")
  ]
};

function pickQuestion(diff) {
  const pool = QUESTIONS[diff] || QUESTIONS.easy;
  return pool[Math.floor(Math.random() * pool.length)];
}

/* =========================
   Answer check (simple)
========================= */
function normalize(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/−/g, "-")
    .replace(/π/g, "pi");
}

function parseMaybeNumber(s) {
  const t = normalize(s);
  const frac = t.match(/^(-?\d+)\/(-?\d+)$/);
  if (frac) {
    const a = Number(frac[1]), b = Number(frac[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
    return a / b;
  }
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);

  const piFrac = t.match(/^(-?\d+)?pi(?:\/(\d+))?$/);
  if (piFrac) {
    const k = piFrac[1] == null || piFrac[1] === "" ? 1 : Number(piFrac[1]);
    const d = piFrac[2] ? Number(piFrac[2]) : 1;
    return (k * Math.PI) / d;
  }
  return null;
}

function answersMatch(user, correct) {
  const u = normalize(user);
  const c = normalize(correct);

  const un = parseMaybeNumber(u);
  const cn = parseMaybeNumber(c);
  if (un != null && cn != null) return Math.abs(un - cn) <= 1e-3;

  return u === c;
}

/* =========================
   Rooms
========================= */
function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 5; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

const rooms = new Map();

function snapshot(room) {
  return {
    code: room.code,
    mode: room.mode,
    settings: room.settings,
    players: room.players.map(p => ({ id: p.id, name: p.name, ready: p.ready }))
  };
}

function emitRoom(room) {
  io.to(room.code).emit("room_update", snapshot(room));
}

function bothReady(room) {
  if (room.mode === "bot") return room.players[0]?.ready;
  return room.players.length === 2 && room.players.every(p => p.ready);
}

function bothLocked(room) {
  if (room.mode === "bot") return room.players.every(p => p.locked);
  return room.players.length === 2 && room.players.every(p => p.locked);
}

function resetRoundLocks(room) {
  for (const p of room.players) {
    p.locked = false;
    p.correct = false;
  }
}

function winnersArray(room) {
  return room.players.map(p => ({ id: p.id, wins: p.wins || 0 }));
}

function pickRoundWinner(room) {
  const correct = room.players.filter(p => p.correct);
  if (correct.length === 1) return correct[0].id;
  return null;
}

function botSchedule(room) {
  const bot = room.players.find(p => p.name === "Bot");
  if (!bot) return;

  const diff = room.settings.diff;
  let min = 5000, max = 12000, acc = 0.75;
  if (diff === "medium") { min = 7000; max = 14000; acc = 0.65; }
  if (diff === "hard") { min = 9000; max = 17000; acc = 0.55; }

  const delay = Math.floor(min + Math.random() * (max - min));
  setTimeout(() => {
    if (!room.match?.started) return;
    if (bot.locked) return;

    bot.locked = true;
    bot.correct = Math.random() < acc;

    io.to(room.code).emit("lock_update", { playerId: bot.id, locked: true, correct: bot.correct });

    if (bothLocked(room)) {
      const winnerId = pickRoundWinner(room);
      endRound(room, winnerId);
    }
  }, delay);
}

function startRound(room) {
  room.match.started = true;
  room.match.roundIndex += 1;
  room.match.totalRounds = room.settings.questionsTotal;

  resetRoundLocks(room);
  room.match.q = pickQuestion(room.settings.diff);

  io.to(room.code).emit("match_begin");
  io.to(room.code).emit("round_start", {
    roundIndex: room.match.roundIndex,
    totalRounds: room.match.totalRounds,
    durationSec: room.settings.durationSec,
    question: room.match.q.prompt
  });

  if (room.match.timer) clearTimeout(room.match.timer);
  room.match.timer = setTimeout(() => endRound(room, null), room.settings.durationSec * 1000);

  if (room.mode === "bot") botSchedule(room);

  emitRoom(room);
}

function endRound(room, winnerId) {
  if (!room.match?.started) return;

  if (room.match.timer) {
    clearTimeout(room.match.timer);
    room.match.timer = null;
  }

  if (winnerId) {
    const w = room.players.find(p => p.id === winnerId);
    if (w) w.wins = (w.wins || 0) + 1;
  }

  io.to(room.code).emit("round_end", {
    winnerId,
    winners: winnersArray(room)
  });

  const r = room.match.roundIndex;
  const total = room.match.totalRounds;

  if (r >= total) {
    const [a, b] = room.players;
    let final = { type: "tie" };
    if (a && b) {
      if ((a.wins || 0) > (b.wins || 0)) final = { type: "win", winnerId: a.id };
      else if ((b.wins || 0) > (a.wins || 0)) final = { type: "win", winnerId: b.id };
    } else if (a) {
      final = { type: "win", winnerId: a.id };
    }

    io.to(room.code).emit("match_end", { final, winners: winnersArray(room) });
    room.match.started = false;
    emitRoom(room);
    return;
  }

  setTimeout(() => startRound(room), 2200);
}

/* =========================
   Socket.io
========================= */
io.on("connection", (socket) => {

  // Live drawing relay
  socket.on("draw_event", ({ code, type, data }) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return;
    if (!room.match?.started) return;
    if (room.mode !== "multi") return;

    socket.to(code).emit("draw_event", { from: socket.id, type, data: data || {} });
  });

  // Spectate snapshot request
  socket.on("spectate:request", ({ code }) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room || room.mode !== "multi") return;
    socket.to(code).emit("spectate:requestState", { requesterId: socket.id });
  });

  // Snapshot forward
  socket.on("spectate:state", ({ to, img }) => {
    if (!to || !img) return;
    io.to(to).emit("spectate:state", { img });
  });

  socket.on("create_room", ({ name, settings }) => {
    let code;
    do { code = makeCode(); } while (rooms.has(code));

    const room = {
      code,
      mode: "multi",
      settings: {
        diff: settings?.diff || "easy",
        durationSec: Number(settings?.durationSec || 90),
        questionsTotal: Number(settings?.questionsTotal || 5),
        penWidth: Number(settings?.penWidth || 3)
      },
      players: [
        { id: socket.id, name: name || "Player 1", ready: false, locked: false, correct: false, wins: 0 }
      ],
      match: { started: false, roundIndex: 0, totalRounds: 0, q: null, timer: null }
    };

    rooms.set(code, room);
    socket.join(code);

    socket.emit("joined_room", { code, youId: socket.id, isHost: true, room: snapshot(room) });
    emitRoom(room);
  });

  socket.on("create_bot_room", ({ name, settings }) => {
    let code;
    do { code = makeCode(); } while (rooms.has(code));

    const room = {
      code,
      mode: "bot",
      settings: {
        diff: settings?.diff || "easy",
        durationSec: Number(settings?.durationSec || 90),
        questionsTotal: Number(settings?.questionsTotal || 5),
        penWidth: Number(settings?.penWidth || 3)
      },
      players: [
        { id: socket.id, name: name || "You", ready: false, locked: false, correct: false, wins: 0 },
        { id: `bot_${code}`, name: "Bot", ready: true, locked: false, correct: false, wins: 0 }
      ],
      match: { started: false, roundIndex: 0, totalRounds: 0, q: null, timer: null }
    };

    rooms.set(code, room);
    socket.join(code);

    socket.emit("joined_room", { code, youId: socket.id, isHost: true, room: snapshot(room) });
    emitRoom(room);
  });

  socket.on("join_room", ({ code, name }) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return socket.emit("join_error", { message: "Room not found." });
    if (room.mode !== "multi") return socket.emit("join_error", { message: "Not a multiplayer room." });
    if (room.players.length >= 2) return socket.emit("join_error", { message: "Room is full." });

    room.players.push({ id: socket.id, name: name || "Player 2", ready: false, locked: false, correct: false, wins: 0 });
    socket.join(code);

    socket.emit("joined_room", { code, youId: socket.id, isHost: false, room: snapshot(room) });
    emitRoom(room);
  });

  socket.on("set_ready", ({ code, ready }) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return;

    const p = room.players.find(x => x.id === socket.id);
    if (!p) return;

    p.ready = !!ready;
    emitRoom(room);

    if (!room.match.started && bothReady(room)) {
      room.match.roundIndex = 0;
      for (const pl of room.players) pl.wins = 0;
      startRound(room);
    }
  });

  socket.on("lock_answer", ({ code, answer }) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room?.match?.started) return;

    const p = room.players.find(x => x.id === socket.id);
    if (!p || p.locked) return;

    p.locked = true;
    p.correct = answersMatch(answer, room.match.q.answer);

    io.to(code).emit("lock_update", { playerId: p.id, locked: true, correct: p.correct });

    if (bothLocked(room)) {
      const winnerId = pickRoundWinner(room);
      endRound(room, winnerId);
    }
  });

  socket.on("give_up", ({ code }) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room?.match?.started) return;

    const p = room.players.find(x => x.id === socket.id);
    if (!p || p.locked) return;

    p.locked = true;
    p.correct = false;

    io.to(code).emit("lock_update", { playerId: p.id, locked: true, correct: false });

    if (bothLocked(room)) {
      const winnerId = pickRoundWinner(room);
      endRound(room, winnerId);
    }
  });

  socket.on("leave_room", ({ code }) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return;

    socket.leave(code);
    room.players = room.players.filter(p => p.id !== socket.id);

    if (room.match?.timer) {
      clearTimeout(room.match.timer);
      room.match.timer = null;
    }

    if (room.players.length === 0 || room.mode === "bot") {
      rooms.delete(code);
      return;
    }

    room.match.started = false;
    room.match.roundIndex = 0;
    room.players[0].ready = false;

    emitRoom(room);
  });

  socket.on("disconnect", () => {
    for (const [code, room] of rooms.entries()) {
      const before = room.players.length;
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length !== before) {
        if (room.match?.timer) clearTimeout(room.match.timer);
        room.match.timer = null;

        if (room.players.length === 0 || room.mode === "bot") rooms.delete(code);
        else {
          room.match.started = false;
          room.match.roundIndex = 0;
          room.players[0].ready = false;
          emitRoom(room);
        }
      }
    }
  });
});
