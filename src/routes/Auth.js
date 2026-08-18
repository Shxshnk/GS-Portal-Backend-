// const express = require("express");
// const router = express.Router();
// const bcrypt = require("bcryptjs");
// const jwt = require("jsonwebtoken");
// const { pool } = require("../db");
// const { authRequired } = require("../middleware/auth");

// function sign(user) {
//   return jwt.sign(
//     { id: user.id, username: user.username, roleId: user.role_id || null },
//     process.env.JWT_SECRET || "dev-secret",
//     { expiresIn: "8h" }
//   );
// }

// /** POST /api/auth/login  (Local accounts) */
// router.post("/login", async (req, res) => {
//   const { usernameOrEmail, password } = req.body;
//   if (!usernameOrEmail || !password) return res.status(400).json({ error: "Missing credentials" });

//   try {
//     const [[user]] = await pool.query(
//       `SELECT id, username, email, full_name, user_type, password_hash, role_id, status
//        FROM users WHERE username = ? OR email = ? LIMIT 1`,
//       [usernameOrEmail, usernameOrEmail]
//     );
//     if (!user) return res.status(401).json({ error: "Invalid credentials" });
//     if (user.status !== "active") return res.status(403).json({ error: "User disabled" });
//     if (user.user_type !== "Local") return res.status(400).json({ error: "Use LDAP login" });

//     const ok = await bcrypt.compare(password, user.password_hash || "");
//     if (!ok) return res.status(401).json({ error: "Invalid credentials" });

//     const token = sign(user);
//     res.json({ token, user: { id: user.id, username: user.username, roleId: user.role_id || null } });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Login failed" });
//   }
// });

// /** GET /api/auth/me (JWT required) */
// router.get("/me", authRequired, async (req, res) => {
//   try {
//     const userId = req.user.id;
//     const [[user]] = await pool.query(
//       `SELECT u.id, u.username, u.email, u.full_name AS fullName, u.user_type AS userType,
//               u.role_id AS roleId, r.name AS roleName, u.status,
//               u.created_at AS createdAt, u.updated_at AS updatedAt
//        FROM users u
//        LEFT JOIN roles r ON r.id = u.role_id
//        WHERE u.id = ?`, [userId]
//     );
//     if (!user) return res.status(404).json({ error: "User not found" });

//     res.json(user); // affiliations will be Phase 4
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Failed to fetch profile" });
//   }
// });

// module.exports = router;

// src/routes/Auth.js
const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pool } = require("../db");
const { authRequired } = require("../middleware/auth");

function sign(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      roleId: user.role_id || null,
      role: user.role_name || null,   // 👈 ADD
    },

    process.env.JWT_SECRET || "dev-secret",
    { expiresIn: "8h" }
  );
}

// Quick probe to verify the router is mounted
router.get("/ping", (_req, res) =>
  res.json({ ok: true, where: "auth-router" })
);

/** POST /api/auth/login  (Local accounts) */
router.post("/login", async (req, res) => {
  const { usernameOrEmail, password } = req.body || {};
  if (!usernameOrEmail || !password) {
    try {
      req.audit?.log?.({
        action: "AUTH_LOGIN",
        targetType: "user",
        targetId: null,
        statusCode: 400,
        metadata: { reason: "missing_credentials", usernameOrEmail: usernameOrEmail || "" },
      });
    } catch { }
    return res.status(400).json({ error: "Missing credentials" });
  }

  try {
    const [[user]] = await pool.query(
      `SELECT
  u.id,
  u.username,
  u.email,
  u.full_name,
  u.user_type,
  u.password_hash,
  u.role_id,
  r.name AS role_name,
 
  u.status
FROM users u
LEFT JOIN roles r ON r.id = u.role_id

       WHERE username = ? OR email = ?
       LIMIT 1`,
      [usernameOrEmail, usernameOrEmail]
    );

    if (!user) {
      try {
        req.audit?.log?.({
          action: "AUTH_LOGIN",
          targetType: "user",
          targetId: null,
          statusCode: 401,
          metadata: { reason: "invalid_credentials_no_user", usernameOrEmail },
        });
      } catch { }
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (user.status !== "active") {
      try {
        req.audit?.log?.({
          action: "AUTH_LOGIN",
          targetType: "user",
          targetId: user.id,
          statusCode: 403,
          metadata: { reason: "user_disabled", username: user.username },
        });
      } catch { }
      return res.status(403).json({ error: "User disabled" });
    }

    if (user.user_type !== "Local") {
      try {
        req.audit?.log?.({
          action: "AUTH_LOGIN",
          targetType: "user",
          targetId: user.id,
          statusCode: 400,
          metadata: { reason: "use_ldap_login", username: user.username },
        });
      } catch { }
      return res.status(400).json({ error: "Use LDAP login" });
    }

    const ok = await bcrypt.compare(password, user.password_hash || "");
    if (!ok) {
      try {
        req.audit?.log?.({
          action: "AUTH_LOGIN",
          targetType: "user",
          targetId: user.id,
          statusCode: 401,
          metadata: { reason: "invalid_credentials_bad_password", username: user.username },
        });
      } catch { }
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = sign(user);

    try {
      req.audit?.log?.({
        action: "AUTH_LOGIN",
        targetType: "user",
        targetId: user.id,
        statusCode: 200,
        metadata: { method: "local", username: user.username, roleId: user.role_id || null },
      });
    } catch { }

    res.json({ token, user: { id: user.id, username: user.username, roleId: user.role_id || null } });
  } catch (err) {
    console.error(err);
    try {
      req.audit?.log?.({
        action: "AUTH_LOGIN",
        targetType: "user",
        targetId: null,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch { }
    res.status(500).json({ error: "Login failed" });
  }
});

/** POST /api/auth/logout (JWT required) */
router.post("/logout", authRequired, async (req, res) => {
  try {
    req.audit?.log?.({
      action: "AUTH_LOGOUT",
      targetType: "user",
      targetId: req.user.id,
      statusCode: 200,
      metadata: { username: req.user.username || "" },
    });
  } catch { }
  res.json({ ok: true });
});

/** GET /api/auth/me (JWT required) */
router.get("/me", authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const [[user]] = await pool.query(
      `SELECT
      u.id,
      u.username,
      u.email,
  u.full_name AS fullName,
  u.user_type AS userType,
  u.role_id AS roleId,
  r.name AS roleName,
  u.status,
  u.created_at AS createdAt,
  u.updated_at AS updatedAt,
  (
    SELECT JSON_ARRAYAGG(JSON_OBJECT('page_key', page_key, 'access_level', access_level))
    FROM role_page_access
    WHERE role_id = u.role_id
  ) AS pages
FROM users u
LEFT JOIN roles r ON r.id = u.role_id
WHERE u.id = ?`,
      [userId]
    );

    if (!user) {
      try {
        req.audit?.log?.({
          action: "AUTH_ME",
          targetType: "user",
          targetId: userId,
          statusCode: 404,
          metadata: { reason: "user_not_found" },
        });
      } catch { }
      return res.status(404).json({ error: "User not found" });
    }

    try {
      req.audit?.log?.({
        action: "AUTH_ME",
        targetType: "user",
        targetId: userId,
        statusCode: 200,
        metadata: { roleId: user.roleId || null, status: user.status },
      });
    } catch { }

    res.json(user);
  } catch (err) {
    console.error(err);
    try {
      req.audit?.log?.({
        action: "AUTH_ME",
        targetType: "user",
        targetId: req.user?.id || null,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch { }
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

module.exports = router;
