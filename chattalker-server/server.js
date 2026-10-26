const express = require("express");
const cors = require("cors");
const http = require("http");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const rateLimit = require("express-rate-limit");
require("dotenv").config();
const pool = require("./db");
 
// Frontend ka address. Deploy pe FRONTEND_URL env variable mein Vercel ka link daalna.
// Kai ho toh comma se alag karo: https://a.vercel.app,https://b.com
const ALLOWED_ORIGINS = (process.env.FRONTEND_URL || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);
 
const app = express();
app.set("trust proxy", 1); // Render proxy ke peeche asli IP dekhne ke liye
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json());
 
// Password guess karne wale bots ko rokne ke liye (login/signup pe)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Bahut zyada koshishein. 15 minute baad try karo." },
});
app.use("/auth/login", authLimiter);
app.use("/auth/signup", authLimiter);

// Email bhejne wale routes par kadi limit (spam email rokne ke liye)

const mailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Bahut zyada koshishein. 15 minute baad try karo." },
});
app.use("/auth/forgot-password", mailLimiter);
app.use("/auth/reset-password", mailLimiter);
app.use("/auth/resend-verification", mailLimiter);
 
app.use("/auth", require("./auth"));
// Search se saare users ki list churane se rokne ke liye
app.use(
  "/social/search",
  rateLimit({
    windowMs: 60 * 1000,
    limit: 40,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Bahut tez search. Thoda ruko." },
  })
);
app.use("/social", require("./social"));
app.use("/banner", require("./banner"));
 
app.get("/", (req, res) => {
  res.send("ChatTalker server chal raha hai ✅");
});
 
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS },
});
app.set("io", io); // REST routes (social.js) isse live events bhejte hain
 
// ---------- Settings ----------
const MAX_PENDING_PER_CHAT = 50; // ek dost ke liye max itne offline messages DB mein
const PENDING_MAX_AGE_DAYS = 7; // itne din baad bina dekhe message bhi delete
 
// ---------- Helpers ----------
function isOnline(userId) {
  const room = io.sockets.adapter.rooms.get(`user-${userId}`);
  return !!room && room.size > 0;
}
 
// Block list memory mein (sirf online users ki), taaki matching tez rahe
const blockCache = new Map(); // userId -> Set(ids jinse block ka rishta hai, kisi bhi taraf se)
 
async function loadBlocks(userId) {
  const r = await pool.query(
    "SELECT blocker_id, blocked_id FROM blocks WHERE blocker_id = $1 OR blocked_id = $1",
    [userId]
  );
  const set = new Set();
  for (const row of r.rows) {
    set.add(row.blocker_id === userId ? row.blocked_id : row.blocker_id);
  }
  blockCache.set(userId, set);
}
 
function isBlocked(a, b) {
  return !!(blockCache.get(a)?.has(b) || blockCache.get(b)?.has(a));
}
 
app.set("refreshBlocks", async (...ids) => {
  await Promise.all(ids.filter((id) => blockCache.has(id)).map(loadBlocks));
});
 
async function notifyPresence(userId, online) {
  try {
    const r = await pool.query(
      `SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS fid
         FROM friendships
        WHERE status = 'accepted' AND (requester_id = $1 OR addressee_id = $1)`,
      [userId]
    );
    r.rows.forEach((row) =>
      io.to(`user-${row.fid}`).emit("presence", { userId, online })
    );
  } catch (err) {
    console.error(err);
  }
}
 
// Offline the tab ke messages: user aate hi bhejo, jab client "mil gaya" bole tab DB se delete
async function flushPending(socket, userId) {
  const r = await pool.query(
    "SELECT id, sender_id, text, created_at FROM pending_messages WHERE receiver_id = $1 ORDER BY id",
    [userId]
  );
  if (r.rowCount === 0) return;
 
  const payload = r.rows.map((m) => ({
    id: m.id,
    from: m.sender_id,
    text: m.text,
    ts: m.created_at,
  }));
 
  socket.emit("pending_dms", payload, async () => {
    try {
      const ids = payload.map((m) => m.id);
      await pool.query("DELETE FROM pending_messages WHERE id = ANY($1::int[])", [ids]);
      const senders = [...new Set(payload.map((m) => m.from))];
      senders.forEach((sid) =>
        io.to(`user-${sid}`).emit("dm_delivered", { by: userId })
      );
    } catch (err) {
      console.error(err);
    }
  });
}
 
// Purane bekaar pending messages saaf (DB chhota rakhne ke liye)
async function cleanupOldPending() {
  try {
    const r = await pool.query(
      `DELETE FROM pending_messages WHERE created_at < NOW() - ($1 || ' days')::interval`,
      [String(PENDING_MAX_AGE_DAYS)]
    );
    if (r.rowCount > 0) console.log("Purane pending messages hataye:", r.rowCount);
  } catch (err) {
    console.error(err);
  }
}

// Cleanup din mein sirf 1 baar, aur tabhi jab koi user aaye (DB waise bhi jaaga hota hai)

let lastCleanup = 0;
function maybeCleanup() {
  if (Date.now() - lastCleanup < 24 * 60 * 60 * 1000) return;
  lastCleanup = Date.now();
  cleanupOldPending();
}

// ---------- Login check (JWT) ----------
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error("Pehle login karo"));
 
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const r = await pool.query(
      "SELECT id, username, gender FROM users WHERE id = $1",
      [payload.id]
    );
    if (r.rowCount === 0) return next(new Error("User nahi mila"));
 
    socket.data.user = r.rows[0];
    await loadBlocks(r.rows[0].id);
    next();
  } catch (err) {
    next(new Error("Token galat ya expire ho gaya, dobara login karo"));
  }
});
 
// ---------- Random matching ----------
const PREFERENCES = ["Any gender", "Woman", "Man", "Non-binary"];
const waiting = []; // { socket, userId, gender, preference }
 
function compatible(a, b) {
  if (a.userId === b.userId) return false; // apne aap se match nahi
  if (isBlocked(a.userId, b.userId)) return false; // block wale kabhi match nahi
  const aOk = a.preference === "Any gender" || a.preference === b.gender;
  const bOk = b.preference === "Any gender" || b.preference === a.gender;
  return aOk && bOk;
}
 
function removeFromQueue(socket) {
  const i = waiting.findIndex((w) => w.socket.id === socket.id);
  if (i !== -1) waiting.splice(i, 1);
}
 
function endChat(socket) {
  const room = socket.data.room;
  const partnerId = socket.data.partnerId;
  socket.data.room = null;
  socket.data.partnerId = null;
  if (room) socket.leave(room);
 
  if (partnerId) {
    const partner = io.sockets.sockets.get(partnerId);
    if (partner) {
      partner.data.room = null;
      partner.data.partnerId = null;
      if (room) partner.leave(room);
      partner.emit("partner_left");
    }
  }
}
 
io.on("connection", (socket) => {
  const user = socket.data.user;
  const wasOnline = isOnline(user.id); // is socket ke judne se pehle
  socket.join(`user-${user.id}`);
  console.log("Connected:", user.username, socket.id);
 
  if (!wasOnline) notifyPresence(user.id, true);
  flushPending(socket, user.id).catch((err) => console.error(err));
  maybeCleanup();
 
  // ----- Random chat (kabhi save nahi hoti) -----
  socket.on("find_match", ({ preference } = {}) => {
    endChat(socket);
    removeFromQueue(socket);
 
    const me = {
      socket,
      userId: user.id,
      gender: user.gender || "Unknown",
      preference: PREFERENCES.includes(preference) ? preference : "Any gender",
    };
 
    const idx = waiting.findIndex((w) => compatible(me, w));
    if (idx === -1) {
      waiting.push(me);
      socket.emit("waiting");
      return;
    }
 
    const [other] = waiting.splice(idx, 1);
    const otherUser = other.socket.data.user;
    const room = `room-${socket.id}-${other.socket.id}`;
 
    socket.join(room);
    other.socket.join(room);
    socket.data.room = room;
    socket.data.partnerId = other.socket.id;
    other.socket.data.room = room;
    other.socket.data.partnerId = socket.id;
 
    socket.emit("match_found", {
      partner: { id: otherUser.id, name: otherUser.username, gender: otherUser.gender },
    });
    other.socket.emit("match_found", {
      partner: { id: user.id, name: user.username, gender: user.gender },
    });
  });
 
  socket.on("send_message", (text) => {
    const room = socket.data.room;
    if (!room || typeof text !== "string" || !text.trim()) return;
    io.to(room).emit("receive_message", {
      text: text.trim().slice(0, 1000),
      from: socket.id,
    });
  });
 
  socket.on("leave_chat", () => {
    removeFromQueue(socket);
    endChat(socket);
  });
 
  // ----- Dosto ko message -----
  // Online ho toh seedha live. Offline ho toh DB mein rukta hai, dekhte hi delete.
  socket.on("dm_send", async ({ to, text } = {}, ack) => {
    const reply = typeof ack === "function" ? ack : () => {};
    try {
      const other = Number(to);
      const body = typeof text === "string" ? text.trim().slice(0, 1000) : "";
      if (!Number.isInteger(other) || other === user.id || !body) {
        return reply({ ok: false, error: "Message bheja nahi ja sakta" });
      }
 
      const fr = await pool.query(
        `SELECT 1 FROM friendships
          WHERE status = 'accepted'
            AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))`,
        [user.id, other]
      );
      if (fr.rowCount === 0) return reply({ ok: false, error: "Pehle friend bano" });
 
      const bl = await pool.query(
        `SELECT 1 FROM blocks
          WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`,
        [user.id, other]
      );
      if (bl.rowCount > 0) return reply({ ok: false, error: "Ye chat block hai" });
 
      const payload = { from: user.id, to: other, text: body, ts: Date.now() };
 
      if (isOnline(other)) {
        io.to(`user-${other}`).to(`user-${user.id}`).emit("dm", payload);
        return reply({ ok: true, queued: false });
      }
 
      const cnt = await pool.query(
        "SELECT COUNT(*)::int AS n FROM pending_messages WHERE sender_id = $1 AND receiver_id = $2",
        [user.id, other]
      );
      if (cnt.rows[0].n >= MAX_PENDING_PER_CHAT) {
        return reply({
          ok: false,
          error: "Wo abhi offline hain aur pehle ke messages pending hain. Thodi der baad bhejo.",
        });
      }
 
      await pool.query(
        "INSERT INTO pending_messages (sender_id, receiver_id, text) VALUES ($1, $2, $3)",
        [user.id, other, body]
      );
      io.to(`user-${user.id}`).emit("dm", { ...payload, queued: true });
      reply({ ok: true, queued: true });
    } catch (err) {
      console.error(err);
      reply({ ok: false, error: "Server error" });
    }
  });
 
  socket.on("disconnect", () => {
    console.log("Disconnected:", user.username, socket.id);
    removeFromQueue(socket);
    endChat(socket);
    if (!isOnline(user.id)) {
      blockCache.delete(user.id);
      notifyPresence(user.id, false);
    }
  });
});
 
server.on("error", (err) => {
  console.error("Server start nahi hua:", err.message);
  process.exit(1);
});
 
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Server: port ${PORT}`));
 