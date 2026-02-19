const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// allow larger payloads for spectate snapshots
const io = new Server(server, { maxHttpBufferSize: 8e6 });

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, "..", "public")));

server.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));

/* =========================
   Question bank
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
    Q("If f(x)=x², what is f(5)?", "25"),
  ],
  medium: [
    Q("Differentiate: d/dx (x² sin x)", "2xsinx+x^2cosx"),
    Q("Compute ∫₀¹ (x³ − 2x) dx", "-1/4"),
    Q("If f(x)=ln(x), what is f′(e)?", "1/e"),
    Q("Differentiate: d/dx (e^{3x})", "3e^{3x}"),
    Q("Compute ∫₀^{π} sin x dx", "2"),
    Q("Differentiate: d/dx ((x+1)/x)", "-1/x^2"),
  ],
  hard: [
    Q("Differentiate: d/dx (ln(x²+1))", "2x/(x^2+1)"),
    Q("Compute ∫₀¹ 1/(1+x²) dx", "pi/4"),
    Q("Differentiate: d/dx (x^x)", "x^x(lnx+1)"),
    Q("Compute ∫₁^{e} 1/x dx", "1"),
    Q("Differentiate: d/dx (sin(3x))", "3cos(3x)"),
  ],
};

function pickQuestion(diff) {
  const pool = QUESTIONS[diff] || QUESTIONS.easy;
  return pool[Math.floor(Math.random() * pool.length)];
}

/* =========================
   Answer checking
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
   Rooms + match stats
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
    players: room.players.map(p => ({ id: p.id, name: p.name, ready: p.ready, rank: p.rank || null })),
    match: { started: !!room.match?.started }
  };
}

function normalizeRank(rank) {
  if (!rank || typeof rank !== "object") return null;
  const elo = Number(rank.elo);
  return {
    elo: Number.isFinite(elo) ? Math.max(0, Math.round(elo)) : 800,
    label: String(rank.label || "Bronze III").slice(0, 32),
    css: String(rank.css || "badge-bronze").slice(0, 32),
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

function winnersArray(room) {
  return room.players.map(p => ({ id: p.id, wins: p.wins || 0, name: p.name }));
}

function resetRoundLocks(room) {
  for (const p of room.players) {
    p.locked = false;
    p.correct = false;
    p.answerText = "";
    p.lockMs = null;
    p.gaveUp = false;
  }
}

function calcSummary(room) {
  const perPlayer = {};
  for (const p of room.players) {
    perPlayer[p.id] = {
      id: p.id,
      name: p.name,
      wins: p.wins || 0,
      roundsPlayed: 0,
      correctCount: 0,
      giveUpCount: 0,
      avgLockSec: null,
      fastestCorrectSec: null
    };
  }

  const rounds = room.matchStats.rounds || [];
  for (const r of rounds) {
    for (const pid of Object.keys(r.players)) {
      const ps = perPlayer[pid];
      if (!ps) continue;
      ps.roundsPlayed += 1;

      const pr = r.players[pid];
      if (pr.gaveUp) ps.giveUpCount += 1;
      if (pr.correct) {
        ps.correctCount += 1;
        if (typeof pr.lockSec === "number") {
          if (ps.fastestCorrectSec == null || pr.lockSec < ps.fastestCorrectSec) {
            ps.fastestCorrectSec = pr.lockSec;
          }
        }
      }
    }
  }

  // avg lock time (all locks incl wrong + giveup? we'll exclude giveup)
  for (const pid of Object.keys(perPlayer)) {
    let sum = 0, n = 0;
    for (const r of rounds) {
      const pr = r.players[pid];
      if (!pr) continue;
      if (pr.gaveUp) continue;
      if (typeof pr.lockSec === "number") { sum += pr.lockSec; n += 1; }
    }
    perPlayer[pid].avgLockSec = n ? (sum / n) : null;
  }

  return { perPlayer, rounds };
}

function pickRoundWinner(room) {
  // first correct lock wins, else null tie
  const correctPlayers = room.players.filter(p => p.correct && typeof p.lockMs === "number");
  if (correctPlayers.length === 0) return null;
  correctPlayers.sort((a, b) => a.lockMs - b.lockMs);
  return correctPlayers[0].id;
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
    bot.gaveUp = false;
    bot.correct = Math.random() < acc;
    bot.answerText = bot.correct ? room.match.q.answer : "…";
    bot.lockMs = Date.now() - room.match.roundStartMs;

    io.to(room.code).emit("lock_update", {
      playerId: bot.id,
      locked: true,
      correct: bot.correct,
      gaveUp: false
    });

    if (bothLocked(room)) {
      const winnerId = pickRoundWinner(room);
      endRound(room, winnerId, "locked");
    }
  }, delay);
}

function startMatch(room) {
  room.match.started = true;
  room.match.roundIndex = 0;
  room.match.totalRounds = room.settings.questionsTotal;

  for (const p of room.players) p.wins = 0;

  room.matchStats = {
    startedAt: Date.now(),
    rounds: []
  };

  io.to(room.code).emit("match_begin", {
    totalRounds: room.match.totalRounds,
    settings: room.settings,
    players: room.players.map(p => ({ id: p.id, name: p.name, rank: p.rank || null }))
  });

  startRound(room);
}

function startRound(room) {
  room.match.roundIndex += 1;
  room.match.q = pickQuestion(room.settings.diff);
  room.match.roundStartMs = Date.now();

  resetRoundLocks(room);

  io.to(room.code).emit("round_start", {
    roundIndex: room.match.roundIndex,
    totalRounds: room.match.totalRounds,
    durationSec: room.settings.durationSec,
    question: room.match.q.prompt,
  });

  if (room.match.timer) clearTimeout(room.match.timer);
  room.match.timer = setTimeout(() => {
    const winnerId = pickRoundWinner(room);
    endRound(room, winnerId, "time");
  }, room.settings.durationSec * 1000);

  if (room.mode === "bot") botSchedule(room);

  emitRoom(room);
}

function endRound(room, winnerId, reason) {
  if (!room.match?.started) return;

  if (room.match.timer) {
    clearTimeout(room.match.timer);
    room.match.timer = null;
  }

  if (winnerId) {
    const w = room.players.find(p => p.id === winnerId);
    if (w) w.wins = (w.wins || 0) + 1;
  }

  // store round stats
  const roundIndex = room.match.roundIndex;
  const q = room.match.q;

  const roundObj = {
    roundIndex,
    prompt: q.prompt,
    correctAnswer: q.answer,
    winnerId: winnerId || null,
    reason,
    players: {}
  };

  for (const p of room.players) {
    roundObj.players[p.id] = {
      name: p.name,
      answerText: p.answerText || "",
      correct: !!p.correct,
      gaveUp: !!p.gaveUp,
      lockSec: typeof p.lockMs === "number" ? Math.round((p.lockMs / 1000) * 100) / 100 : null
    };
  }

  room.matchStats.rounds.push(roundObj);

  io.to(room.code).emit("round_end", {
    winnerId: winnerId || null,
    reason,
    winners: winnersArray(room),
    reveal: roundObj, // includes answers + correct answer
  });

  // match done?
  if (roundIndex >= room.match.totalRounds) {
    const summary = calcSummary(room);

    // decide match winner by wins
    let winner = null;
    if (room.players.length >= 2) {
      const a = room.players[0], b = room.players[1];
      if ((a.wins || 0) > (b.wins || 0)) winner = a.id;
      else if ((b.wins || 0) > (a.wins || 0)) winner = b.id;
    } else if (room.players[0]) {
      winner = room.players[0].id;
    }

    io.to(room.code).emit("match_end", {
      winnerId: winner,
      winners: winnersArray(room),
      summary
    });

    room.match.started = false;
    emitRoom(room);
    return;
  }

  // next round after a short pause
  setTimeout(() => startRound(room), 2200);
}

/* =========================
   Socket.io handlers
========================= */
io.on("connection", (socket) => {

  // drawing relay (multiplayer only)
  socket.on("draw_event", ({ code, type, data }) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return;
    if (!room.match?.started) return;
    if (room.mode !== "multi") return;
    socket.to(code).emit("draw_event", { from: socket.id, type, data: data || {} });
  });

  // spectate snapshot request
  socket.on("spectate:request", ({ code }) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room || room.mode !== "multi") return;
    socket.to(code).emit("spectate:requestState", { requesterId: socket.id });
  });

  socket.on("spectate:state", ({ to, img }) => {
    if (!to || !img) return;
    io.to(to).emit("spectate:state", { img });
  });

  socket.on("create_room", ({ name, settings, profile }) => {
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
        {
          id: socket.id, name: name || "Player 1", ready: false, locked: false, correct: false, wins: 0,
          rank: normalizeRank(profile)
        }
      ],
      match: { started: false, roundIndex: 0, totalRounds: 0, q: null, timer: null, roundStartMs: null },
      matchStats: { startedAt: null, rounds: [] }
    };

    rooms.set(code, room);
    socket.join(code);

    socket.emit("joined_room", { code, youId: socket.id, isHost: true, room: snapshot(room) });
    emitRoom(room);
  });

  socket.on("create_bot_room", ({ name, settings, profile }) => {
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
        {
          id: socket.id, name: name || "You", ready: false, locked: false, correct: false, wins: 0,
          rank: normalizeRank(profile)
        },
        {
          id: `bot_${code}`, name: "Bot", ready: true, locked: false, correct: false, wins: 0,
          rank: { elo: 1000, label: "Silver I", css: "badge-silver" }
        }
      ],
      match: { started: false, roundIndex: 0, totalRounds: 0, q: null, timer: null, roundStartMs: null },
      matchStats: { startedAt: null, rounds: [] }
    };

    rooms.set(code, room);
    socket.join(code);

    socket.emit("joined_room", { code, youId: socket.id, isHost: true, room: snapshot(room) });
    emitRoom(room);
  });

  socket.on("join_room", ({ code, name, profile }) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return socket.emit("join_error", { message: "Room not found." });
    if (room.mode !== "multi") return socket.emit("join_error", { message: "Not a multiplayer room." });
    if (room.players.length >= 2) return socket.emit("join_error", { message: "Room is full." });

    room.players.push({
      id: socket.id, name: name || "Player 2", ready: false, locked: false, correct: false, wins: 0,
      rank: normalizeRank(profile)
    });
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
      startMatch(room);
    }
  });

  socket.on("lock_answer", ({ code, answer }) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room?.match?.started) return;

    const p = room.players.find(x => x.id === socket.id);
    if (!p || p.locked) return;

    p.locked = true;
    p.gaveUp = false;
    p.answerText = String(answer ?? "");
    p.correct = answersMatch(p.answerText, room.match.q.answer);
    p.lockMs = Date.now() - room.match.roundStartMs;

    io.to(code).emit("lock_update", {
      playerId: p.id,
      locked: true,
      correct: p.correct,
      gaveUp: false
    });

    if (bothLocked(room)) {
      const winnerId = pickRoundWinner(room);
      endRound(room, winnerId, "locked");
    }
  });

  socket.on("give_up", ({ code }) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room?.match?.started) return;

    const p = room.players.find(x => x.id === socket.id);
    if (!p || p.locked) return;

    p.locked = true;
    p.gaveUp = true;
    p.answerText = "";
    p.correct = false;
    p.lockMs = Date.now() - room.match.roundStartMs;

    io.to(code).emit("lock_update", {
      playerId: p.id,
      locked: true,
      correct: false,
      gaveUp: true
    });

    if (bothLocked(room)) {
      const winnerId = pickRoundWinner(room);
      endRound(room, winnerId, "locked");
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
