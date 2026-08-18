

// src/routes/Roles.js
const express = require("express");
const router = express.Router();
const { pool } = require("../db");
const { authRequired } = require("../middleware/auth");

/* =========================
   LIST ROLES
   GET /api/roles
   ========================= */
router.get("/", authRequired, async (_req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
  id,
  name,
  description,
  type,                   -- ADD THIS
  is_system   AS isSystem
FROM roles
ORDER BY is_system DESC, name ASC


    `);

    try {
      _req.audit?.log?.({
        action: "ROLE_LIST",
        targetType: "role",
        targetId: null,
        statusCode: 200,
        metadata: { count: rows.length },
      });
    } catch { }

    res.json(rows);
  } catch (err) {
    console.error("GET /roles failed:", err);
    try {
      _req.audit?.log?.({
        action: "ROLE_LIST",
        targetType: "role",
        targetId: null,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch { }
    res.status(500).json({ error: "Failed to load roles" });
  }
});

/* =========================
   CREATE ROLE
   POST /api/roles
   body: { name, accessType }
   ========================= */
router.post("/", authRequired, async (req, res) => {
  try {
    const name = (req.body?.name || "").trim();
    const description = (req.body?.description || "").trim();

    if (!name || !description) {
      return res.status(400).json({ error: "name and description are required" });
    }


    // uniqueness by name
    const [dupe] = await pool.query("SELECT id FROM roles WHERE name = ?", [name]);
    if (dupe.length) {
      try {
        req.audit?.log?.({
          action: "ROLE_CREATE",
          targetType: "role",
          targetId: null,
          statusCode: 409,
          metadata: { name, reason: "duplicate_name" },
        });
      } catch { }
      return res.status(409).json({ error: "Role already exists" });
    }

    // UUID id


    let roleType = req.body?.type === "editor" ? "editor" : "viewer";
    if (name.toLowerCase() === "admin") {
      roleType = null;
    }

    await pool.query(
      `INSERT INTO roles (id, name, description, is_system)
   VALUES (UUID(), ?, ?, 0)`,
      [name, description]
    );

    const [[created]] = await pool.query(
      `SELECT id FROM roles WHERE name = ? LIMIT 1`,
      [name]
    );

    try {
      req.audit?.log?.({
        action: "ROLE_CREATE",
        targetType: "role",
        targetId: created?.id || null,
        statusCode: 201,
        metadata: { name, description },
      });
    } catch { }

    res.status(201).json({ id: created?.id || null });
  } catch (err) {
    console.error("POST /roles failed:", err);
    try {
      req.audit?.log?.({
        action: "ROLE_CREATE",
        targetType: "role",
        targetId: null,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch { }
    res.status(500).json({ error: "Failed to create role" });
  }
});

/* =========================
   UPDATE ROLE
   PATCH /api/roles/:id
   body: { name?, accessType?, isDisabled? }
   - Prevents changes to system roles
   - Duplicate name check when renaming
   ========================= */
router.patch("/:id", authRequired, async (req, res) => {
  const { id } = req.params;

  try {
    // Fetch current role first
    const [[role]] = await pool.query(
      `SELECT id, name, description, is_system AS isSystem, is_disabled AS isDisabled
   FROM roles WHERE id = ?`,
      [id]
    );

    if (!role) {
      try {
        req.audit?.log?.({
          action: "ROLE_UPDATE",
          targetType: "role",
          targetId: id,
          statusCode: 404,
          metadata: { reason: "not_found" },
        });
      } catch { }
      return res.status(404).json({ error: "Role not found" });
    }

    const next = {
      name: typeof req.body.name === "string" ? req.body.name.trim() : undefined,
      description:
        typeof req.body.description === "string"
          ? req.body.description.trim()
          : undefined,
      type:
        typeof req.body.type === "string"
          ? req.body.type === "editor" ? "editor" : "viewer"
          : undefined,
      isDisabled:
        typeof req.body.isDisabled === "number"
          ? req.body.isDisabled
          : undefined,
    };

    // No changes?
    if (
      next.name === undefined &&
      next.description === undefined &&
      next.isDisabled === undefined &&
      next.type === undefined
    ) {
      return res.json({ ok: true, updated: 0 });
    }


    // Protect system roles from modification
    if (role.isSystem) {
      try {
        req.audit?.log?.({
          action: "ROLE_UPDATE",
          targetType: "role",
          targetId: id,
          statusCode: 400,
          metadata: { reason: "system_role_locked" },
        });
      } catch { }
      return res
        .status(400)
        .json({ error: "System roles cannot be modified" });
    }

    // If renaming, enforce uniqueness
    if (next.name && next.name !== role.name) {
      const [dupe] = await pool.query(
        "SELECT id FROM roles WHERE name = ? AND id <> ?",
        [next.name, id]
      );
      if (dupe.length) {
        try {
          req.audit?.log?.({
            action: "ROLE_UPDATE",
            targetType: "role",
            targetId: id,
            statusCode: 409,
            metadata: { reason: "duplicate_name", name: next.name },
          });
        } catch { }
        return res.status(409).json({ error: "Role already exists" });
      }
    }

    const fields = [];
    const args = [];
    if (next.name !== undefined) {
      fields.push("name = ?");
      args.push(next.name);
    }
    if (next.description !== undefined) {
      fields.push("description = ?");
      args.push(next.description);
    }
    if (next.type !== undefined) {
      fields.push("type = ?");
      args.push(next.type);
    }

    if (next.isDisabled !== undefined) {
      fields.push("is_disabled = ?");
      args.push(next.isDisabled ? 1 : 0);
    }

    if (!fields.length) return res.json({ ok: true, updated: 0 });

    args.push(id);
    await pool.query(`UPDATE roles SET ${fields.join(", ")} WHERE id = ?`, args);

    try {
      req.audit?.log?.({
        action: "ROLE_UPDATE",
        targetType: "role",
        targetId: id,
        statusCode: 200,
        metadata: {
          changed: Object.fromEntries(
            fields.map((f, i) => [f.split(" = ")[0], args[i]])
          ),
        },
      });
    } catch { }

    res.json({ ok: true });
  } catch (err) {
    console.error("PATCH /roles failed:", err);
    try {
      req.audit?.log?.({
        action: "ROLE_UPDATE",
        targetType: "role",
        targetId: id,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch { }
    res.status(500).json({ error: "Failed to update role" });
  }
});


/* =========================
   DELETE ROLE
   DELETE /api/roles/:id
   - Blocks deletion of system roles
   - Blocks if assigned to any users
   ========================= */
router.delete("/:id", authRequired, async (req, res) => {
  const { id } = req.params;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // 1) Fetch role
    const [[role]] = await conn.query(
      `SELECT id, is_system AS isSystem FROM roles WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!role) {
      try {
        req.audit?.log?.({
          action: "ROLE_DELETE",
          targetType: "role",
          targetId: id,
          statusCode: 404,
          metadata: { reason: "not_found" },
        });
      } catch { }
      await conn.rollback();
      return res.status(404).json({ error: "Role not found" });
    }

    // 2) Protect system roles
    if (role.isSystem) {
      try {
        req.audit?.log?.({
          action: "ROLE_DELETE",
          targetType: "role",
          targetId: id,
          statusCode: 400,
          metadata: { reason: "system_role_locked" },
        });
      } catch { }
      await conn.rollback();
      return res.status(400).json({ error: "System roles cannot be deleted" });
    }

    // 3) Ensure no users reference this role
    const [[{ count }]] = await conn.query(
      `SELECT COUNT(*) AS count FROM users WHERE role_id = ?`,
      [id]
    );
    if (count > 0) {
      await conn.query(`UPDATE users SET role_id = NULL WHERE role_id = ?`, [id]);
    }


    // 4) Delete
    const [result] = await conn.query(`DELETE FROM roles WHERE id = ?`, [id]);

    try {
      req.audit?.log?.({
        action: "ROLE_DELETE",
        targetType: "role",
        targetId: id,
        statusCode: 200,
        metadata: { deleted: result.affectedRows },
      });
    } catch { }

    await conn.commit();
    return res.json({ ok: true, deleted: result.affectedRows });
  } catch (err) {
    await conn.rollback();
    console.error("DELETE /roles failed:", err);
    try {
      req.audit?.log?.({
        action: "ROLE_DELETE",
        targetType: "role",
        targetId: id,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch { }
    return res.status(500).json({ error: "Failed to delete role" });
  } finally {
    conn.release();
  }
});


module.exports = router;
