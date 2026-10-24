// Admin kaun hai: ADMIN_USERNAMES env variable se (comma se alag). Jaise: shivam_01
// Env variable hai isliye koi user khud ko admin bana nahi sakta.
module.exports = function isAdminUsername(username) {
  const list = (process.env.ADMIN_USERNAMES || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(String(username || "").toLowerCase());
};
 