
// src/routes/Entities.js
const express = require("express");
const router = express.Router();
const { pool } = require("../db");
const { authRequired } = require("../middleware/auth");

/* ------------------------------ LIST ------------------------------ */
// GET /api/entities
router.get("/", authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, description,
              created_at AS createdAt, updated_at AS updatedAt
       FROM entities
       ORDER BY name`
    );

    try {
      req.audit?.log?.({
        action: "ENTITY_LIST",
        targetType: "entity",
        targetId: null,
        statusCode: 200,
        metadata: { count: rows.length },
      });
    } catch {}

    res.json(rows);
  } catch (err) {
    console.error(err);
    try {
      req.audit?.log?.({
        action: "ENTITY_LIST",
        targetType: "entity",
        targetId: null,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch {}
    res.status(500).json({ error: "Failed to list entities" });
  }
});

/* ----------------------------- CREATE ----------------------------- */
// POST /api/entities   { name, description? }
router.post("/", authRequired, async (req, res) => {
  try {
    const { name, description = null } = req.body;
    if (!name) {
      try {
        req.audit?.log?.({
          action: "ENTITY_CREATE",
          targetType: "entity",
          targetId: null,
          statusCode: 400,
          metadata: { reason: "name_required" },
        });
      } catch {}
      return res.status(400).json({ error: "name required" });
    }

    await pool.query(
      `INSERT INTO entities (id, name, description)
       VALUES (UUID(), ?, ?)`,
      [name, description]
    );

    const [[row]] = await pool.query(
      `SELECT id FROM entities WHERE name = ? LIMIT 1`,
      [name]
    );

    try {
      req.audit?.log?.({
        action: "ENTITY_CREATE",
        targetType: "entity",
        targetId: row?.id || null,
        statusCode: 201,
        metadata: { name, hasDescription: !!description },
      });
    } catch {}

    res.status(201).json({ id: row?.id });
  } catch (err) {
    console.error(err);
    if (err.code === "ER_DUP_ENTRY") {
      try {
        req.audit?.log?.({
          action: "ENTITY_CREATE",
          targetType: "entity",
          targetId: null,
          statusCode: 409,
          metadata: { reason: "duplicate_name" },
        });
      } catch {}
      return res.status(409).json({ error: "Entity name already exists" });
    }
    try {
      req.audit?.log?.({
        action: "ENTITY_CREATE",
        targetType: "entity",
        targetId: null,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch {}
    res.status(500).json({ error: "Failed to create entity" });
  }
});

/* ------------------------------- GET ------------------------------ */
// GET /api/entities/:id
router.get("/:id", authRequired, async (req, res) => {
  try {
    const entityId = req.params.id;
    const [[row]] = await pool.query(
      `SELECT id, name, description,
              created_at AS createdAt, updated_at AS updatedAt
       FROM entities WHERE id = ?`,
      [entityId]
    );
    if (!row) {
      try {
        req.audit?.log?.({
          action: "ENTITY_GET",
          targetType: "entity",
          targetId: entityId,
          statusCode: 404,
          metadata: { reason: "not_found" },
        });
      } catch {}
      return res.status(404).json({ error: "Not found" });
    }

    try {
      req.audit?.log?.({
        action: "ENTITY_GET",
        targetType: "entity",
        targetId: entityId,
        statusCode: 200,
        metadata: {},
      });
    } catch {}

    res.json(row);
  } catch (err) {
    console.error(err);
    try {
      req.audit?.log?.({
        action: "ENTITY_GET",
        targetType: "entity",
        targetId: req.params.id,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch {}
    res.status(500).json({ error: "Failed to get entity" });
  }
});

/* ------------------------------ UPDATE ---------------------------- */
// PATCH /api/entities/:id   { name?, description? }
router.patch("/:id", authRequired, async (req, res) => {
  try {
    const entityId = req.params.id;
    const { name, description } = req.body;

    const fields = [];
    const params = [];
    if (name !== undefined)        { fields.push("name = ?");        params.push(name); }
    if (description !== undefined) { fields.push("description = ?"); params.push(description); }
    if (!fields.length) {
      try {
        req.audit?.log?.({
          action: "ENTITY_UPDATE",
          targetType: "entity",
          targetId: entityId,
          statusCode: 200,
          metadata: { updated: 0, reason: "no_fields" },
        });
      } catch {}
      return res.json({ ok: true, updated: 0 });
    }

    params.push(entityId);
    const [result] = await pool.query(
      `UPDATE entities SET ${fields.join(", ")} WHERE id = ?`,
      params
    );

    try {
      req.audit?.log?.({
        action: "ENTITY_UPDATE",
        targetType: "entity",
        targetId: entityId,
        statusCode: 200,
        metadata: { updated: result.affectedRows, changed: Object.keys(req.body || {}) },
      });
    } catch {}

    res.json({ ok: true, updated: result.affectedRows });
  } catch (err) {
    console.error(err);
    if (err.code === "ER_DUP_ENTRY") {
      try {
        req.audit?.log?.({
          action: "ENTITY_UPDATE",
          targetType: "entity",
          targetId: req.params.id,
          statusCode: 409,
          metadata: { reason: "duplicate_name" },
        });
      } catch {}
      return res.status(409).json({ error: "Entity name already exists" });
    }
    try {
      req.audit?.log?.({
        action: "ENTITY_UPDATE",
        targetType: "entity",
        targetId: req.params.id,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch {}
    res.status(500).json({ error: "Failed to update entity" });
  }
});

/* ------------------------------ DELETE ---------------------------- */
// DELETE /api/entities/:id
router.delete("/:id", authRequired, async (req, res) => {
  const id = req.params.id;

  try {
    // Is this entity used by any user?
 const [[row]] = await pool.query(
  `
  SELECT COUNT(*) AS cnt
  FROM user_affiliations
  WHERE entity_id = ?
  `,
  [id]
);



//   if (row && row.cnt > 0) {
//   const message =
//     "This entity is already associated with one or more users. Remove those assignments before deleting.";

//   try {
//     req.audit?.log?.({
//       action: "ENTITY_DELETE",
//       targetType: "entity",
//       targetId: id,
//       statusCode: 409,
//       metadata: { reason: "in_use", count: row.cnt },
//     });
//   } catch {}

//   return res.status(409).json({
//     error: "ENTITY_IN_USE",
//     message,
//   });
// }
// If entity is in use → delete all relations first instead of blocking
if (row && row.cnt > 0) {
  await pool.query(`DELETE FROM user_affiliations WHERE entity_id = ?`, [id]);
}



    const [del] = await pool.query("DELETE FROM entities WHERE id = ?", [id]);
    if (del.affectedRows === 0) {
      try {
        req.audit?.log?.({
          action: "ENTITY_DELETE",
          targetType: "entity",
          targetId: id,
          statusCode: 404,
          metadata: { reason: "not_found" },
        });
      } catch {}
      return res.status(404).json({ message: "Entity not found" });
    }

    try {
      req.audit?.log?.({
        action: "ENTITY_DELETE",
        targetType: "entity",
        targetId: id,
        statusCode: 200,
        metadata: { deleted: del.affectedRows },
      });
    } catch {}

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /entities/:id failed", err);
    try {
      req.audit?.log?.({
        action: "ENTITY_DELETE",
        targetType: "entity",
        targetId: id,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch {}
    return res.status(500).json({ message: "Failed to delete entity" });
  }
});

module.exports = router;
