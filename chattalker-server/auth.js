const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("./db");
const requireAuth = require("./middleware");
 
const router = express.Router();
 
const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{2,19}$/;
const PHONE_RE = /^\+?[0-9]{10,15}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
 
function makeToken(user) {
  return jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: "7d" });
}
 
function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    email: row.email,
    phone: row.phone,
    gender: row.gender,
    bio: row.bio,
  };
}
 
// USERNAME AVAILABLE HAI?
router.get("/check-username", async (req, res) => {
  try {
    const username = String(req.query.username || "").trim();
    if (!USERNAME_RE.test(username)) {
      return res.json({
        available: false,
        reason: "Letter se shuru karo, 3-20 characters, sirf letters/numbers/_",
      });
    }
    const r = await pool.query(
      "SELECT 1 FROM users WHERE LOWER(username) = LOWER($1)",
      [username]
    );
    res.json({ available: r.rowCount === 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
 
// SIGNUP
router.post("/signup", async (req, res) => {
  try {
    const { name, username, contactType, contact, password, gender } = req.body;
 
    if (!name || !username || !contact || !password) {
      return res.status(400).json({ error: "Saari details bharo" });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password kam se kam 8 characters ka ho" });
    }
 
    const uname = String(username).trim();
    if (!USERNAME_RE.test(uname)) {
      return res.status(400).json({
        error: "Username letter se shuru ho, 3-20 characters, sirf letters/numbers/_",
      });
    }
 
    let email = null;
    let phone = null;
    if (contactType === "phone") {
      phone = String(contact).replace(/[\s-]/g, "");
      if (!PHONE_RE.test(phone)) {
        return res.status(400).json({ error: "Sahi phone number daalo" });
      }
    } else {
      email = String(contact).trim().toLowerCase();
      if (!EMAIL_RE.test(email)) {
        return res.status(400).json({ error: "Sahi email daalo" });
      }
    }
 
    const takenName = await pool.query(
      "SELECT 1 FROM users WHERE LOWER(username) = LOWER($1)",
      [uname]
    );
    if (takenName.rowCount > 0) {
      return res.status(409).json({ error: "Ye username le liya gaya hai" });
    }
    if (email) {
      const e = await pool.query("SELECT 1 FROM users WHERE email = $1", [email]);
      if (e.rowCount > 0) {
        return res.status(409).json({ error: "Ye email pehle se registered hai" });
      }
    }
    if (phone) {
      const p = await pool.query("SELECT 1 FROM users WHERE phone = $1", [phone]);
      if (p.rowCount > 0) {
        return res.status(409).json({ error: "Ye phone number pehle se registered hai" });
      }
    }
 
    const password_hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, username, email, phone, password_hash, gender)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, username, email, phone, gender, bio`,
      [name.trim(), uname, email, phone, password_hash, gender || null]
    );
 
    const user = result.rows[0];
    res.status(201).json({ token: makeToken(user), user });
  } catch (err) {
    if (err.code === "23505") {
      return res
        .status(409)
        .json({ error: "Username, email ya phone pehle se use mein hai" });
    }
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
 
// LOGIN (email, phone ya username)
router.post("/login", async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ error: "Email/phone/username aur password chahiye" });
    }
 
    const raw = String(identifier).trim();
    const lower = raw.toLowerCase();
    const phoneNorm = raw.replace(/[\s-]/g, "");
 
    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1 OR LOWER(username) = $2 OR phone = $3",
      [lower, lower, phoneNorm]
    );
    const row = result.rows[0];
    const ok = row && (await bcrypt.compare(password, row.password_hash));
    if (!ok) {
      return res.status(401).json({ error: "Email/phone/username ya password galat hai" });
    }
 
    const user = publicUser(row);
    res.json({ token: makeToken(user), user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
 
// ME: token se pehchano ki kaun login hai (page refresh pe auto-login ke liye)
router.get("/me", requireAuth, async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM users WHERE id = $1", [req.userId]);
    if (r.rowCount === 0) {
      return res.status(401).json({ error: "User nahi mila, dobara login karo" });
    }
    res.json({ user: publicUser(r.rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
 
// PROFILE EDIT (username badalna allowed nahi, wahi pehchan hai)
router.put("/profile", requireAuth, async (req, res) => {
  try {
    const name = String(req.body.name ?? "").trim();
    const bio = String(req.body.bio ?? "").slice(0, 160);
    const gender = String(req.body.gender ?? "").trim().slice(0, 20) || null;
 
    if (!name || name.length > 100) {
      return res.status(400).json({ error: "Naam 1 se 100 characters ka ho" });
    }
 
    const r = await pool.query(
      "UPDATE users SET name = $1, bio = $2, gender = $3 WHERE id = $4 RETURNING *",
      [name, bio, gender, req.userId]
    );
    res.json({ user: publicUser(r.rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
 
module.exports = router;
 