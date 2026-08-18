 

// src/routes/users.js
const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { pool } = require("../db");
const { authRequired } = require("../middleware/auth");

/* ---------------------- helpers ---------------------- */
function buildAvatarUrl(file) {
  if (!file) return null;
  // server must expose: app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
  return `/uploads/avatars/${file}`;
}

function checkPasswordComplexity(password) {
  if (!password || password.length < 8) return false;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  return hasUpper && hasLower && hasSpecial;
}

/* ---------------------- Multer (avatars) ---------------------- */
const AVATAR_DIR = path.join(process.cwd(), "uploads", "avatars");
fs.mkdirSync(AVATAR_DIR, { recursive: true });

// 5 MB default; override via .env UPLOAD_MAX_SIZE_MB=8
const MAX_MB = Number(process.env.UPLOAD_MAX_SIZE_MB || 5);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, AVATAR_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname || "") || ".png").toLowerCase();
    const safeExt = [".png", ".jpg", ".jpeg", ".webp"].includes(ext) ? ext : ".png";
    // prefer authenticated user id; fall back to route param
    const uid = (req.user && req.user.id) || req.params.id || "user";
    cb(null, `${uid}_${Date.now()}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const byMime = /image\/(png|jpeg|jpg|webp)/i.test(file.mimetype);
    const byExt = /\.(png|jpe?g|webp)$/i.test(file.originalname || "");
    const ok = byMime || byExt;
    if (ok) return cb(null, true);
    return cb(new Error("Only PNG/JPG/WEBP images are allowed."));
  },
});

/* ---------------------- LIST users ---------------------- */
router.get("/", authRequired, async (req, res) => {
  try {
    const { page = 1, pageSize = 20, q = "", status } = req.query;
    const limit = Math.min(Number(pageSize) || 20, 100);
    const offset = ((Number(page) || 1) - 1) * limit;

    const where = [];
    const params = [];
    if (q) {
      where.push("(u.username LIKE ? OR u.email LIKE ? OR u.full_name LIKE ?)");
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (status) { where.push("u.status = ?"); params.push(status); }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [[{ count }]] = await pool.query(`SELECT COUNT(*) AS count FROM users u ${whereSql}`, params);

    const [rows] = await pool.query(
      `SELECT u.id, u.username, u.email, u.full_name AS fullName, u.user_type AS userType,
              u.role_id AS roleId, r.name AS roleName, u.status,
              u.phone, u.avatar_file,
              u.created_at AS createdAt, u.updated_at AS updatedAt
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       ${whereSql}
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const data = rows.map((r) => ({ ...r, avatarUrl: buildAvatarUrl(r.avatar_file) }));



    res.json({ data, page: Number(page), pageSize: limit, total: count });
  } catch (err) {
    console.error(err);
    try {
      req.audit?.log?.({
        action: "USER_LIST",
        targetType: "user",
        targetId: null,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch {}
    res.status(500).json({ error: "Failed to list users" });
  }
});

/* ---------------------- GET one ---------------------- */
router.get("/:id", authRequired, async (req, res) => {
  try {
    const userId = req.params.id;
    const [[user]] = await pool.query(
      `SELECT u.id, u.username, u.email, u.full_name AS fullName, u.user_type AS userType,
              u.ldap_dn AS ldapDn, u.role_id AS roleId, r.name AS roleName, u.status,
              u.phone, u.avatar_file,
              u.created_at AS createdAt, u.updated_at AS updatedAt
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.id = ?`,
      [userId]
    );
    if (!user) {
      try {
        req.audit?.log?.({
          action: "USER_GET",
          targetType: "user",
          targetId: userId,
          statusCode: 404,
        });
      } catch {}
      return res.status(404).json({ error: "User not found" });
    }



    res.json({ ...user, avatarUrl: buildAvatarUrl(user.avatar_file) });
  } catch (err) {
    console.error(err);
    try {
      req.audit?.log?.({
        action: "USER_GET",
        targetType: "user",
        targetId: req.params.id,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch {}
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

/* ---------------------- CREATE user ---------------------- */
router.post("/", authRequired, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { username, email, fullName, userType, password, ldapDn, phone } = req.body;

    if (!username || !email || !fullName || !userType) {
      try {
        req.audit?.log?.({
          action: "USER_CREATE",
          targetType: "user",
          targetId: null,
          statusCode: 400,
          metadata: { reason: "missing_fields" },
        });
      } catch {}
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (userType === "Local" && !password) {
      try {
        req.audit?.log?.({
          action: "USER_CREATE",
          targetType: "user",
          targetId: null,
          statusCode: 400,
          metadata: { reason: "password_required_for_local" },
        });
      } catch {}
      return res.status(400).json({ error: "Password required for Local users" });
    }
    if (userType === "Local" && !checkPasswordComplexity(password)) {
      try {
        req.audit?.log?.({
          action: "USER_CREATE",
          targetType: "user",
          targetId: null,
          statusCode: 400,
          metadata: { reason: "password_complexity_not_met" },
        });
      } catch {}
      return res.status(400).json({ error: "Password must be at least 8 characters long, and contain at least one uppercase letter, one lowercase letter, and one special character." });
    }
    if (userType === "LDAP" && !ldapDn) {
      try {
        req.audit?.log?.({
          action: "USER_CREATE",
          targetType: "user",
          targetId: null,
          statusCode: 400,
          metadata: { reason: "ldap_dn_required_for_ldap" },
        });
      } catch {}
      return res.status(400).json({ error: "ldapDn required for LDAP users" });
    }

    await conn.beginTransaction();

    const [[dup]] = await conn.query(`SELECT id FROM users WHERE username = ? OR email = ? LIMIT 1`, [
      username,
      email,
    ]);
    if (dup) {
      await conn.rollback();
      try {
        req.audit?.log?.({
          action: "USER_CREATE",
          targetType: "user",
          targetId: null,
          statusCode: 409,
          metadata: { reason: "duplicate_username_or_email" },
        });
      } catch {}
      return res.status(409).json({ error: "Username or email already exists" });
    }

    const passwordHash = userType === "Local" ? await bcrypt.hash(password, 10) : null;

    await conn.query(
      `INSERT INTO users (id, username, email, full_name, user_type, password_hash, ldap_dn, role_id, status, phone, avatar_file)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, NULL, 'active', ?, NULL)`,
      [username, email, fullName, userType, passwordHash, userType === "LDAP" ? ldapDn : null, phone || null]
    );

    const [[created]] = await conn.query(`SELECT id FROM users WHERE username = ?`, [username]);

    try {
      req.audit?.log?.({
        action: "USER_CREATE",
        targetType: "user",
        targetId: created.id,
        statusCode: 201,
        metadata: { newValue: { id: created.id, username, email, fullName, userType, phone }, targetLabel: username },
      });
    } catch {}

    await conn.commit();
    res.status(201).json({ id: created.id });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    try {
      req.audit?.log?.({
        action: "USER_CREATE",
        targetType: "user",
        targetId: null,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch {}
    res.status(500).json({ error: "Failed to create user" });
  } finally {
    conn.release();
  }
});

/* ---------------------- UPDATE user (enable/disable/etc.) ---------------------- */
router.patch("/:id", authRequired, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const userId = req.params.id;
    const { fullName, email, status, userType, ldapDn, phone } = req.body;

    // ❗ do not allow user to disable themselves
    if (status && userId === req.user.id && status === "disabled") {
      try {
        req.audit?.log?.({
          action: "USER_DISABLE",
          targetType: "user",
          targetId: userId,
          statusCode: 400,
          metadata: { reason: "self_disable_blocked" },
        });
      } catch {}
      return res.status(400).json({ error: "You cannot disable your own account." });
    }

    await conn.beginTransaction();

    // Capture old value before update
    const [[oldUser]] = await conn.query(
      `SELECT id, username, email, full_name AS fullName, user_type AS userType, status, phone FROM users WHERE id = ?`,
      [userId]
    );
    const oldValue = oldUser || null;

    const fields = [];
    const params = [];
    if (fullName !== undefined) { fields.push("full_name = ?"); params.push(fullName); }
    if (email !== undefined)    { fields.push("email = ?"); params.push(email); }
    if (status !== undefined)   { fields.push("status = ?"); params.push(status); }
    if (userType !== undefined) { fields.push("user_type = ?"); params.push(userType); }
    if (ldapDn !== undefined)   { fields.push("ldap_dn = ?"); params.push(ldapDn); }
    if (phone !== undefined)    { fields.push("phone = ?"); params.push(phone); }
    if (!fields.length) return res.json({ ok: true, updated: 0 });

    params.push(userId);
    const [result] = await conn.query(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`, params);

    // Better audit: mark enable/disable explicitly if status changed
    const action =
      status === "disabled" ? "USER_DISABLE" : status === "active" ? "USER_ENABLE" : "USER_UPDATE";

    // Fetch new value after update
    const [[newUser]] = await conn.query(
      `SELECT id, username, email, full_name AS fullName, user_type AS userType, status, phone FROM users WHERE id = ?`,
      [userId]
    );

    try {
      req.audit?.log?.({
        action,
        targetType: "user",
        targetId: userId,
        statusCode: 200,
        metadata: { oldValue, newValue: newUser || null, targetLabel: oldValue?.username },
      });
    } catch {}

    await conn.commit();
    res.json({ ok: true, updated: result.affectedRows });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    try {
      req.audit?.log?.({
        action: "USER_UPDATE",
        targetType: "user",
        targetId: req.params.id,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch {}
    res.status(500).json({ error: "Failed to update user" });
  } finally {
    conn.release();
  }
});

/* ---------------------- me: update my profile (basic fields only) ---------------------- */
router.put("/me", authRequired, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const userId = req.user.id; // set by authRequired
    const { full_name, fullName, phone, contact_no, ldap_dn, ldapDn } = req.body;

    await conn.beginTransaction();

    const fields = [];
    const params = [];

    // accept either camelCase or snake_case from UI
    if (full_name !== undefined || fullName !== undefined) {
      fields.push("full_name = ?");
      params.push(full_name ?? fullName);
    }
    if (phone !== undefined || contact_no !== undefined) {
      fields.push("phone = ?");
      params.push(phone ?? contact_no);
    }
    if (ldap_dn !== undefined || ldapDn !== undefined) {
      fields.push("ldap_dn = ?");
      params.push(ldap_dn ?? ldapDn);
    }

    if (!fields.length) {
      await conn.rollback();
      return res.json({ ok: true, updated: 0 });
    }

    params.push(userId);
    const [result] = await conn.query(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`, params);

    try {
      req.audit?.log?.({
        action: "USER_ME_UPDATE",
        targetType: "user",
        targetId: userId,
        statusCode: 200,
        metadata: { fields: fields.map((f) => f.split(" ")[0]) },
      });
    } catch {}

    await conn.commit();
    res.json({ ok: true, updated: result.affectedRows });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    try {
      req.audit?.log?.({
        action: "USER_ME_UPDATE",
        targetType: "user",
        targetId: req.user.id,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch {}
    res.status(500).json({ error: "Failed to update profile" });
  } finally {
    conn.release();
  }
});

/* ---------------------- avatar upload helpers ---------------------- */
function handleAvatarUpload(req, res, _next, userIdProvider) {
  // wrap multer to catch errors and return JSON
  upload.single("avatar")(req, res, async (err) => {
    if (err) {
      const payload = { error: err.code === "LIMIT_FILE_SIZE" ? `Avatar too large. Max ${MAX_MB} MB.` : (err.message || "Upload failed") };
      try {
        req.audit?.log?.({
          action: "USER_AVATAR_UPLOAD",
          targetType: "user",
          targetId: (typeof userIdProvider === "function" ? userIdProvider(req) : userIdProvider) || null,
          statusCode: 400,
          metadata: payload,
        });
      } catch {}
      return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json(payload);
    }

    const userId = typeof userIdProvider === "function" ? userIdProvider(req) : userIdProvider;
    if (!req.file) {
      try {
        req.audit?.log?.({
          action: "USER_AVATAR_UPLOAD",
          targetType: "user",
          targetId: userId || null,
          statusCode: 400,
          metadata: { error: "No file uploaded" },
        });
      } catch {}
      return res.status(400).json({ error: "No file uploaded" });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [[row]] = await conn.query(`SELECT avatar_file FROM users WHERE id = ?`, [userId]);
      if (!row) {
        await conn.rollback();
        fs.unlink(req.file.path, () => {});
        try {
          req.audit?.log?.({
            action: "USER_AVATAR_UPLOAD",
            targetType: "user",
            targetId: userId,
            statusCode: 404,
          });
        } catch {}
        return res.status(404).json({ error: "User not found" });
      }

      await conn.query(`UPDATE users SET avatar_file = ?, updated_at = NOW() WHERE id = ?`, [
        req.file.filename,
        userId,
      ]);

      // delete old if any
      if (row.avatar_file) {
        const oldPath = path.join(AVATAR_DIR, row.avatar_file);
        fs.unlink(oldPath, () => {});
      }

      await conn.commit();

      try {
        req.audit?.log?.({
          action: "USER_AVATAR_UPLOAD",
          targetType: "user",
          targetId: userId,
          statusCode: 200,
          metadata: { file: req.file.filename },
        });
      } catch {}

      res.json({
        ok: true,
        profile_photo_path: `avatars/${req.file.filename}`,
        url: buildAvatarUrl(req.file.filename),
      });
    } catch (e) {
      await conn.rollback();
      console.error(e);
      try {
        req.audit?.log?.({
          action: "USER_AVATAR_UPLOAD",
          targetType: "user",
          targetId: userId,
          statusCode: 500,
          metadata: { error: String(e?.message || e) },
        });
      } catch {}
      res.status(500).json({ error: "Failed to upload avatar" });
    } finally {
      conn.release();
    }
  });
}

/* ---------------------- Upload / replace avatar by :id ---------------------- */
router.post("/:id/avatar", authRequired, (req, res) => {
  handleAvatarUpload(req, res, null, req.params.id);
});

/* ---------------------- Upload / replace my own avatar ---------------------- */
router.put("/me/avatar", authRequired, (req, res) => {
  handleAvatarUpload(req, res, null, (r) => r.user.id);
});

/* ---------------------- Remove avatar ---------------------- */
router.delete("/:id/avatar", authRequired, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const userId = req.params.id;
    await conn.beginTransaction();

    const [[row]] = await conn.query(`SELECT avatar_file FROM users WHERE id = ?`, [userId]);
    if (!row) {
      await conn.rollback();
      try {
        req.audit?.log?.({
          action: "USER_AVATAR_DELETE",
          targetType: "user",
          targetId: userId,
          statusCode: 404,
        });
      } catch {}
      return res.status(404).json({ error: "User not found" });
    }

    await conn.query(`UPDATE users SET avatar_file = NULL WHERE id = ?`, [userId]);

    if (row.avatar_file) {
      const p = path.join(AVATAR_DIR, row.avatar_file);
      fs.unlink(p, () => {});
    }

    await conn.commit();

    try {
      req.audit?.log?.({
        action: "USER_AVATAR_DELETE",
        targetType: "user",
        targetId: userId,
        statusCode: 200,
      });
    } catch {}

    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    try {
      req.audit?.log?.({
        action: "USER_AVATAR_DELETE",
        targetType: "user",
        targetId: req.params.id,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch {}
    res.status(500).json({ error: "Failed to remove avatar" });
  } finally {
    conn.release();
  }
});

/* ---------------------- Set/reset Local password ---------------------- */
router.post("/:id/password", authRequired, async (req, res) => {
  try {
    const userId = req.params.id;
    const { password } = req.body;
    if (!password) {
      try {
        req.audit?.log?.({
          action: "USER_PASSWORD_SET",
          targetType: "user",
          targetId: userId,
          statusCode: 400,
          metadata: { reason: "missing_password" },
        });
      } catch {}
      return res.status(400).json({ error: "Password required" });
    }
    if (!checkPasswordComplexity(password)) {
      try {
        req.audit?.log?.({
          action: "USER_PASSWORD_SET",
          targetType: "user",
          targetId: userId,
          statusCode: 400,
          metadata: { reason: "password_complexity_not_met" },
        });
      } catch {}
      return res.status(400).json({ error: "Password must be at least 8 characters long, and contain at least one uppercase letter, one lowercase letter, and one special character." });
    }

    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      `UPDATE users SET password_hash = ?, user_type = 'Local' WHERE id = ?`,
      [hash, userId]
    );

    try {
      req.audit?.log?.({
        action: "USER_PASSWORD_SET",
        targetType: "user",
        targetId: userId,
        statusCode: 200,
        metadata: { updated: result.affectedRows },
      });
    } catch {}

    res.json({ ok: true, updated: result.affectedRows });
  } catch (err) {
    console.error(err);
    try {
      req.audit?.log?.({
        action: "USER_PASSWORD_SET",
        targetType: "user",
        targetId: req.params.id,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch {}
    res.status(500).json({ error: "Failed to set password" });
  }
});


router.delete("/:id", authRequired, async (req, res) => {
  const userId = req.params.id;
  let conn;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // check user exists
    const [[user]] = await conn.query(
      `SELECT username, avatar_file FROM users WHERE id = ?`,
      [userId]
    );
    if (!user) {
      await conn.rollback();
      return res.status(404).json({ error: "User not found" });
    }

    if (user.username.toLowerCase() === "isroadmin") {
      await conn.rollback();
      return res.status(403).json({
        error: "SYSTEM_USER",
        message: "System admin cannot be deleted"
      });
    }

    // Capture full user details before delete
    const [[fullUser]] = await conn.query(
      `SELECT u.id, u.username, u.email, u.full_name AS fullName, u.user_type AS userType, u.status, u.phone, r.name AS roleName FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
      [userId]
    );
    const oldValue = fullUser || null;

    const avatarFile = user.avatar_file;
const [ticketRows] = await conn.query(
  `SELECT id FROM tickets WHERE assignee_id = ? OR requester_id = ? OR target_user_id = ?`,
  [userId, userId, userId]
);

const ticketIds = ticketRows.map((r) => r.id);

if (ticketIds.length > 0) {
  const placeholders = ticketIds.map(() => "?").join(",");

  // 2️⃣ Delete ticket dependencies in FK-safe order
  await conn.query(
    `DELETE FROM ticket_attachments WHERE ticket_id IN (${placeholders})`,
    ticketIds
  );
  await conn.query(
    `DELETE FROM ticket_comments WHERE ticket_id IN (${placeholders})`,
    ticketIds
  );
  await conn.query(
    `DELETE FROM ticket_status_history WHERE ticket_id IN (${placeholders})`,
    ticketIds
  );

  // 3️⃣ Delete tickets
  await conn.query(
    `DELETE FROM tickets WHERE id IN (${placeholders})`,
    ticketIds
  );
}

// 4️⃣ Delete affiliations & assignments BEFORE deleting user
// 4️⃣ Delete user affiliations BEFORE deleting user
await conn.query(`DELETE FROM user_affiliations WHERE user_id = ?`, [userId]);


// 5️⃣ Finally delete user row
await conn.query(`DELETE FROM users WHERE id = ?`, [userId]);

    await conn.commit();

    // delete avatar file
    if (avatarFile) {
      const p = path.join(AVATAR_DIR, avatarFile);
      fs.unlink(p, () => {});
    }

    try {
      req.audit?.log?.({
        action: "USER_DELETE",
        targetType: "user",
        targetId: userId,
        statusCode: 200,
        metadata: { oldValue, targetLabel: user.username },
      });
    } catch {}

    return res.status(200).json({ ok: true, deleted: true });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error("DELETE USER FAILED:", err);
    return res.status(500).json({ error: "Failed to delete user" });
  } finally {
    if (conn) conn.release();
  }
});


module.exports = router;

  
