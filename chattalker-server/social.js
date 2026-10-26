
const express = require("express");
const pool = require("./db");
const requireAuth = require("./middleware");
const { sendMail } = require("./mail");
 
const router = express.Router();
router.use(requireAuth);
 
function isOnline(io, userId) {
  const room = io.sockets.adapter.rooms.get(`user-${userId}`);
  return !!room && room.size > 0;
}
 
// Jin logo ka kuch badla unhe live bata do, wo apna list dobara le lenge
function notify(io, ...userIds) {
  userIds.forEach((id) => io.to(`user-${id}`).emit("social_update"));
}
 
function parseOther(req, res) {
  const other = Number(req.body.userId);
  if (!Number.isInteger(other) || other === req.userId) {
    res.status(400).json({ error: "Galat user" });
    return null;
  }
  return other;
}
 
const PAIR = `((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))`;
 
// SAB KUCH EK SAATH: friends, requests, blocked
router.get("/overview", async (req, res) => {
  try {
    const io = req.app.get("io");
    const me = req.userId;
 
    const friends = await pool.query(
      `SELECT u.id, u.username, u.gender
         FROM friendships f
         JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
        WHERE f.status = 'accepted' AND (f.requester_id = $1 OR f.addressee_id = $1)
        ORDER BY u.username`,
      [me]
    );
    const incoming = await pool.query(
      `SELECT u.id, u.username, u.gender, f.created_at
         FROM friendships f JOIN users u ON u.id = f.requester_id
        WHERE f.addressee_id = $1 AND f.status = 'pending'
        ORDER BY f.created_at DESC`,
      [me]
    );
    const outgoing = await pool.query(
      `SELECT u.id, u.username, u.gender
         FROM friendships f JOIN users u ON u.id = f.addressee_id
        WHERE f.requester_id = $1 AND f.status = 'pending'
        ORDER BY f.created_at DESC`,
      [me]
    );
    const blocked = await pool.query(
      `SELECT u.id, u.username, u.gender
         FROM blocks b JOIN users u ON u.id = b.blocked_id
        WHERE b.blocker_id = $1
        ORDER BY u.username`,
      [me]
    );
 
    res.json({
      friends: friends.rows.map((r) => ({ ...r, online: isOnline(io, r.id) })),
      incoming: incoming.rows,
      outgoing: outgoing.rows,
      blocked: blocked.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
 
// FRIEND REQUEST BHEJO
router.post("/friend-request", async (req, res) => {
  try {
    const io = req.app.get("io");
    const me = req.userId;
    const other = parseOther(req, res);
    if (other === null) return;
 
    const exists = await pool.query("SELECT 1 FROM users WHERE id = $1", [other]);
    if (exists.rowCount === 0) return res.status(404).json({ error: "User nahi mila" });
 
    const blocked = await pool.query(
      `SELECT 1 FROM blocks
        WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`,
      [me, other]
    );
    if (blocked.rowCount > 0) {
      return res.status(403).json({ error: "Is user ko friend request nahi bhej sakte" });
    }
 
    const existing = await pool.query(`SELECT * FROM friendships WHERE ${PAIR}`, [me, other]);
    const row = existing.rows[0];
 
    if (row) {
      if (row.status === "accepted") return res.json({ status: "accepted" });
      if (row.requester_id === me) return res.json({ status: "pending" });
      // samne wale ne pehle hi request bheji thi -> seedha dost ban gaye
      await pool.query("UPDATE friendships SET status = 'accepted' WHERE id = $1", [row.id]);
      notify(io, me, other);
      return res.json({ status: "accepted" });
    }
 
    await pool.query(
      "INSERT INTO friendships (requester_id, addressee_id) VALUES ($1, $2)",
      [me, other]
    );
    notify(io, me, other);
    res.status(201).json({ status: "pending" });
  } catch (err) {
    if (err.code === "23505") return res.json({ status: "pending" });
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
 
// REQUEST ACCEPT / REJECT
router.post("/friend-request/respond", async (req, res) => {
  try {
    const io = req.app.get("io");
    const me = req.userId;
    const other = parseOther(req, res); // other = jisne request bheji thi
    if (other === null) return;
 
    if (req.body.accept) {
      const r = await pool.query(
        `UPDATE friendships SET status = 'accepted'
          WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'`,
        [other, me]
      );
      if (r.rowCount === 0) return res.status(404).json({ error: "Request nahi mili" });
    } else {
      await pool.query(
        `DELETE FROM friendships
          WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'`,
        [other, me]
      );
    }
    notify(io, me, other);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
 
// UNFRIEND (pending messages bhi saaf)
router.post("/unfriend", async (req, res) => {
  try {
    const io = req.app.get("io");
    const me = req.userId;
    const other = parseOther(req, res);
    if (other === null) return;
 
    await pool.query(`DELETE FROM friendships WHERE status = 'accepted' AND ${PAIR}`, [me, other]);
    await pool.query(
      `DELETE FROM pending_messages
        WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)`,
      [me, other]
    );
    notify(io, me, other);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
 
// BLOCK: friendship, pending requests aur pending messages sab hat jate hain
router.post("/block", async (req, res) => {
  try {
    const io = req.app.get("io");
    const me = req.userId;
    const other = parseOther(req, res);
    if (other === null) return;
 
    await pool.query(
      "INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [me, other]
    );
    await pool.query(`DELETE FROM friendships WHERE ${PAIR}`, [me, other]);
    await pool.query(
      `DELETE FROM pending_messages
        WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)`,
      [me, other]
    );
    await req.app.get("refreshBlocks")(me, other);
    notify(io, me, other);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
 
router.post("/unblock", async (req, res) => {
  try {
    const io = req.app.get("io");
    const me = req.userId;
    const other = parseOther(req, res);
    if (other === null) return;
 
    await pool.query("DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2", [me, other]);
    await req.app.get("refreshBlocks")(me, other);
    notify(io, me, other);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
 
// GLOBAL SEARCH: saare users mein username se dhundo (naam/email/phone nahi dikhte)
router.get("/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim().slice(0, 30);
    if (q.length < 2) return res.json({ users: [] });
 
    const escaped = q.replace(/[\\%_]/g, (c) => "\\" + c); // LIKE ke special characters
    const r = await pool.query(
      `SELECT u.id, u.username,
              CASE
                WHEN f.status = 'accepted' THEN 'friend'
                WHEN f.status = 'pending' AND f.requester_id = $1 THEN 'sent'
                WHEN f.status = 'pending' THEN 'received'
                ELSE 'none'
              END AS relation
         FROM users u
         LEFT JOIN friendships f
           ON (f.requester_id = $1 AND f.addressee_id = u.id)
           OR (f.requester_id = u.id AND f.addressee_id = $1)
        WHERE u.id <> $1
          AND u.username ILIKE $2 ESCAPE '\\'
          AND NOT EXISTS (
            SELECT 1 FROM blocks b
             WHERE (b.blocker_id = $1 AND b.blocked_id = u.id)
                OR (b.blocker_id = u.id AND b.blocked_id = $1)
          )
        ORDER BY (LOWER(u.username) = LOWER($3)) DESC,
                 (u.username ILIKE $4 ESCAPE '\\') DESC,
                 u.username
        LIMIT 15`,
      [req.userId, `%${escaped}%`, q, `${escaped}%`]
    );
    res.json({ users: r.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
 
// REPORT: aapko email aa jati hai, database mein kuch save nahi hota
const escapeHtml = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
 
router.post("/report", async (req, res) => {
  try {
    const other = parseOther(req, res);
    if (other === null) return;
 
    const reason = String(req.body.reason || "").trim().slice(0, 300);
    const context = Array.isArray(req.body.messages) ? req.body.messages.slice(-10) : [];
    const lines = context
      .map((m) => `${m && m.own ? "Reporter" : "Reported"}: ${escapeHtml(String((m && m.text) || "").slice(0, 300))}`)
      .join("<br>");
 
    const r = await pool.query("SELECT id, username FROM users WHERE id = ANY($1::int[])", [
      [req.userId, other],
    ]);
    const nameOf = (id) => (r.rows.find((u) => u.id === id) || {}).username || "?";
 
    await sendMail(
      process.env.ADMIN_EMAIL,
      "Chat Talker - Naya report",
      `<p><b>Reporter:</b> ${escapeHtml(nameOf(req.userId))} (ID ${req.userId})</p>
       <p><b>Reported:</b> ${escapeHtml(nameOf(other))} (ID ${other})</p>
       <p><b>Reason:</b> ${escapeHtml(reason) || "(nahi likha)"}</p>
       <p><b>Last messages (reporter ke browser se):</b><br>${lines || "(koi nahi)"}</p>`
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Report nahi gaya, thodi der baad try karo" });
  }
});
 
module.exports = router;
 