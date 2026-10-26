
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const pool = require("./db");
const requireAuth = require("./middleware");
const { sendMail, verifyCaptcha } = require("./mail");
const disposableList = require("disposable-email-domains");
 
const disposable = new Set(disposableList);
 
const router = express.Router();
 
const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{2,19}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
 
const FRONTEND = (process.env.FRONTEND_URL || "http://localhost:3000").split(",")[0].trim().replace(/\/$/, "");
const BACKEND = (process.env.BACKEND_URL || "http://localhost:4000").replace(/\/$/, "");
 
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
 
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
 
// Verification email bhejne ka helper
async function sendVerificationEmail(userId, email) {
  const token = crypto.randomBytes(32).toString("hex");
  await pool.query(
    "UPDATE users SET verify_token_hash = $1, verify_expires = NOW() + INTERVAL '24 hours' WHERE id = $2",
    [sha256(token), userId]
  );
  const link = `${BACKEND}/auth/verify-email?token=${token}`;
  await sendMail(
    email,
    "Chat Talker - Email verify karo",
    `<p>Chat Talker mein aapka swagat hai!</p>
     <p><a href="${link}">Yaha click karke apna email verify karo</a></p>
     <p>Ye link 24 ghante tak chalega. Agar aapne signup nahi kiya to is email ko ignore karo.</p>`
  );
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
 
// SIGNUP (ab sirf email se, aur email verify karna padega)
router.post("/signup", async (req, res) => {
  try {
    const { name, username, contact, password, gender, captchaToken, website } = req.body;
 
    // Honeypot: "website" naam ka hidden field sirf bots bharte hain
    if (website) return res.status(201).json({ needsVerification: true });
 
    // CAPTCHA
    if (!(await verifyCaptcha(captchaToken, req.ip))) {
      return res.status(400).json({ error: "CAPTCHA fail hua, dobara try karo" });
    }
 
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
 
    const email = String(contact).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Sahi email daalo" });
    }
    const domain = email.split("@")[1];
    if (disposable.has(domain)) {
      return res.status(400).json({ error: "Temporary email allowed nahi hai. Apna asli email use karo." });
    }
 
    const takenName = await pool.query(
      "SELECT 1 FROM users WHERE LOWER(username) = LOWER($1)",
      [uname]
    );
    if (takenName.rowCount > 0) {
      return res.status(409).json({ error: "Ye username le liya gaya hai" });
    }
    const e = await pool.query("SELECT 1 FROM users WHERE email = $1", [email]);
    if (e.rowCount > 0) {
      return res.status(409).json({ error: "Ye email pehle se registered hai" });
    }
 
    const password_hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, username, email, password_hash, gender, email_verified)
       VALUES ($1, $2, $3, $4, $5, FALSE)
       RETURNING id, email`,
      [String(name).trim(), uname, email, password_hash, gender || null]
    );
 
    const u = result.rows[0];
    try {
      await sendVerificationEmail(u.id, u.email);
    } catch (mailErr) {
      console.error(mailErr);
      // Account ban gaya, user "dobara bhejo" se link mangwa sakta hai
    }
 
    // Token nahi dete, pehle email verify karna hoga
    res.status(201).json({
      needsVerification: true,
      message: "Verification link aapke email par bheja gaya hai. Inbox/spam check karo.",
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Username ya email pehle se use mein hai" });
    }
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
 
// EMAIL VERIFY (email ka link yahan aata hai)
router.get("/verify-email", async (req, res) => {
  try {
    const token = String(req.query.token || "");
    if (!token) return res.redirect(`${FRONTEND}/?verified=0`);
 
    const r = await pool.query(
      `UPDATE users
          SET email_verified = TRUE, verify_token_hash = NULL, verify_expires = NULL
        WHERE verify_token_hash = $1 AND verify_expires > NOW()
        RETURNING id`,
      [sha256(token)]
    );
    res.redirect(`${FRONTEND}/?verified=${r.rowCount > 0 ? 1 : 0}`);
  } catch (err) {
    console.error(err);
    res.redirect(`${FRONTEND}/?verified=0`);
  }
});
 
// VERIFICATION EMAIL DOBARA BHEJO
router.post("/resend-verification", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const r = await pool.query(
      "SELECT id, email FROM users WHERE email = $1 AND email_verified = FALSE",
      [email]
    );
    if (r.rowCount > 0) {
      sendVerificationEmail(r.rows[0].id, r.rows[0].email).catch((e) => console.error(e));
    }
    // Hamesha same jawab, taaki pata na chale ki email registered hai ya nahi
    res.json({ ok: true, message: "Agar ye email registered hai to link bhej diya gaya hai." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
 
// LOGIN (email ya username)
router.post("/login", async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ error: "Email/username aur password chahiye" });
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
      return res.status(401).json({ error: "Email/username ya password galat hai" });
    }
 
    if (!row.email_verified) {
      return res.status(403).json({
        error: "Pehle apna email verify karo. Inbox/spam check karo.",
        needsVerification: true,
        email: row.email,
      });
    }
 
    const user = publicUser(row);
    res.json({ token: makeToken(user), user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
 
// FORGOT PASSWORD: email par 6 digit code bhejta hai
router.post("/forgot-password", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Sahi email daalo" });
    }
 
    const r = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (r.rowCount > 0) {
      const code = String(crypto.randomInt(100000, 1000000));
      await pool.query(
        "UPDATE users SET reset_token_hash = $1, reset_expires = NOW() + INTERVAL '15 minutes' WHERE id = $2",
        [sha256(code), r.rows[0].id]
      );
      sendMail(
        email,
        "Chat Talker - Password reset code",
        `<p>Aapka password reset code: <b style="font-size:22px">${code}</b></p>
         <p>Ye code 15 minute tak chalega. Aapne request nahi ki to ignore karo.</p>`
      ).catch((e) => console.error(e));
    }
    // Hamesha same jawab (email registered hai ya nahi, ye nahi batate)
    res.json({ ok: true, message: "Agar ye email registered hai to code bhej diya gaya hai." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
 
// RESET PASSWORD: email + code + naya password
router.post("/reset-password", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const code = String(req.body.code || "").trim();
    const newPassword = String(req.body.newPassword || "");
 
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "Password kam se kam 8 characters ka ho" });
    }
 
    const hash = await bcrypt.hash(newPassword, 10);
    const r = await pool.query(
      `UPDATE users
          SET password_hash = $1, reset_token_hash = NULL, reset_expires = NULL
        WHERE email = $2 AND reset_token_hash = $3 AND reset_expires > NOW()
        RETURNING id`,
      [hash, email, sha256(code)]
    );
    if (r.rowCount === 0) {
      return res.status(400).json({ error: "Code galat ya expire ho gaya" });
    }
    res.json({ ok: true, message: "Password badal gaya, ab login karo." });
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
 