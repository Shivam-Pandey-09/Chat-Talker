
// Email bhejne ke liye Brevo ka HTTP API (koi extra package nahi chahiye).
// Render free plan par SMTP aksar block hota hai, isliye API use kar rahe hain.
async function sendMail(to, subject, html) {
  if (!process.env.BREVO_API_KEY) {
    console.log("[MAIL - BREVO_API_KEY nahi hai, sirf console mein]", to, subject, html);
    return;
  }
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": process.env.BREVO_API_KEY,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: {
        name: process.env.MAIL_FROM_NAME || "Chat Talker",
        email: process.env.MAIL_FROM_EMAIL,
      },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });
  if (!r.ok) {
    throw new Error("Email nahi gayi: " + r.status + " " + (await r.text()));
  }
}
 
// Cloudflare Turnstile (free CAPTCHA) ka token server par check karta hai.
// Agar TURNSTILE_SECRET set nahi hai to check skip hota hai (local testing ke liye).
async function verifyCaptcha(token, ip) {
  if (!process.env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: process.env.TURNSTILE_SECRET,
        response: String(token),
        remoteip: ip || "",
      }),
    });
    const d = await r.json();
    return !!d.success;
  } catch (err) {
    console.error("Captcha check fail:", err);
    return false;
  }
}
 
module.exports = { sendMail, verifyCaptcha };
 