
const express = require("express");
const pool = require("./db");
const requireAuth = require("./middleware");
const isAdminUsername = require("./admin");
 
const router = express.Router();
router.use(requireAuth);
 
class BadInput extends Error {}
 
function toBanner(r) {
  return {
    active: r.active,
    mode: r.mode,
    label: r.label,
    title: r.title,
    body: r.body,
    imageUrl: r.image_url,
    buttonText: r.button_text,
    linkUrl: r.link_url,
    html: r.html,
    htmlHeight: r.html_height,
  };
}
 
async function userIsAdmin(userId) {
  const r = await pool.query("SELECT username FROM users WHERE id = $1", [userId]);
  return r.rowCount > 0 && isAdminUsername(r.rows[0].username);
}
 
// Sirf http/https links. "javascript:" jaise khatarnak links allowed nahi.
function cleanUrl(value, name, httpsOnly) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  if (s.length > 500) throw new BadInput(`${name} bahut lamba hai`);
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new BadInput(`${name} sahi link nahi hai (https://... se shuru karo)`);
  }
  const okProtocol = httpsOnly ? u.protocol === "https:" : ["http:", "https:"].includes(u.protocol);
  if (!okProtocol) {
    throw new BadInput(httpsOnly ? `${name} https:// se shuru hona chahiye` : `${name} http ya https hona chahiye`);
  }
  return u.toString();
}
 
function cleanText(value, max, name) {
  const s = String(value ?? "").trim();
  if (s.length > max) throw new BadInput(`${name} max ${max} characters ka ho`);
  return s;
}
 
// SABKO DIKHTA HAI: active box. Admin ko hamesha (hidden ho tab bhi, edit karne ke liye)
router.get("/", async (req, res) => {
  try {
    const admin = await userIsAdmin(req.userId);
    const r = await pool.query("SELECT * FROM home_banner WHERE id = 1");
    const row = r.rows[0];
    if (!row || (!row.active && !admin)) return res.json({ banner: null, isAdmin: admin });
    res.json({ banner: toBanner(row), isAdmin: admin });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
 
// SIRF ADMIN: box badlo
router.put("/", async (req, res) => {
  try {
    if (!(await userIsAdmin(req.userId))) {
      return res.status(403).json({ error: "Sirf admin ye badal sakta hai" });
    }
 
    const b = req.body || {};
    const mode = b.mode === "html" ? "html" : "card";
    const active = !!b.active;
    const label = cleanText(b.label, 20, "Label");
    const title = cleanText(b.title, 120, "Title");
    const body = cleanText(b.body, 400, "Text");
    const buttonText = cleanText(b.buttonText, 40, "Button text");
    const imageUrl = cleanUrl(b.imageUrl, "Image link", true);
    const linkUrl = cleanUrl(b.linkUrl, "Button link", false);
    const html = String(b.html ?? "").slice(0, 10000);
    const htmlHeight = Math.min(600, Math.max(60, parseInt(b.htmlHeight, 10) || 200));
 
    if (active && mode === "card" && !title && !body && !imageUrl) {
      throw new BadInput("Card mein kam se kam title, text ya image daalo");
    }
    if (active && mode === "html" && !html.trim()) {
      throw new BadInput("HTML box khali hai");
    }
 
    const r = await pool.query(
      `INSERT INTO home_banner
         (id, active, mode, label, title, body, image_url, button_text, link_url, html, html_height, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
       ON CONFLICT (id) DO UPDATE SET
         active = EXCLUDED.active, mode = EXCLUDED.mode, label = EXCLUDED.label,
         title = EXCLUDED.title, body = EXCLUDED.body, image_url = EXCLUDED.image_url,
         button_text = EXCLUDED.button_text, link_url = EXCLUDED.link_url,
         html = EXCLUDED.html, html_height = EXCLUDED.html_height, updated_at = NOW()
       RETURNING *`,
      [active, mode, label, title, body, imageUrl, buttonText, linkUrl, html, htmlHeight]
    );
    res.json({ banner: toBanner(r.rows[0]) });
  } catch (err) {
    if (err instanceof BadInput) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
 
module.exports = router;
 