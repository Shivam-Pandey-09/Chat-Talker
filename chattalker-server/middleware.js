
const jwt = require("jsonwebtoken");
 
// Har protected route se pehle: "Authorization: Bearer <token>" check karta hai
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Pehle login karo" });
 
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.id;
    next();
  } catch (err) {
    res.status(401).json({ error: "Token galat ya expire ho gaya, dobara login karo" });
  }
}
 
module.exports = requireAuth;
