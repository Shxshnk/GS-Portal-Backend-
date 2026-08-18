const jwt = require("jsonwebtoken");

function authRequired(req, res, next) {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;

  if (!token) {
    try {
      req.audit?.log?.({
        action: "AUTH_MISSING",
        targetType: null,
        targetId: null,
        metadata: { reason: "no_bearer_token" },
        statusCode: 401,
      });
    } catch {}
    return res.status(401).json({ error: "Missing token" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || "dev-secret");
   req.user = {
  id: payload.id,
  username: payload.username,
  roleId: payload.roleId ?? null,

  // 🔑 ADD THESE (role resolution)
  role: payload.role || payload.roleName || null,
  roleType: payload.roleType || null,
};
    return next();
  } catch (e) {
    try {
      req.audit?.log?.({
        action: "AUTH_INVALID_TOKEN",
        targetType: null,
        targetId: null,
        metadata: { message: String(e?.message || e) },
        statusCode: 401,
      });
    } catch {}
    return res.status(401).json({ error: "Invalid token" });
  }
}

function optionalAuth(req, _res, next) {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;

  if (!token) return next();
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || "dev-secret");
    req.user = {
      id: payload.id,
      username: payload.username,
      roleId: payload.roleId ?? null,
    };
  } catch {}
  next();
}

module.exports = { authRequired, optionalAuth };
