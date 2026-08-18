// // src/routes/Designations.js
// const express = require("express");
// const router = express.Router();
// const { pool } = require("../db");
// const { authRequired } = require("../middleware/auth");

// // GET /api/entities/:entityId/designations
// router.get("/entities/:entityId/designations", authRequired, async (req, res) => {
//   try {
//     const entityId = req.params.entityId;
//     const [rows] = await pool.query(
//       `SELECT id, entity_id AS entityId, name,
//               created_at AS createdAt, updated_at AS updatedAt
//        FROM designations
//        WHERE entity_id = ?
//        ORDER BY name`,
//       [entityId]
//     );
//     res.json(rows);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Failed to list designations" });
//   }
// });

// // POST /api/entities/:entityId/designations   { name }
// router.post("/entities/:entityId/designations", authRequired, async (req, res) => {
//   try {
//     const entityId = req.params.entityId;
//     const { name } = req.body;
//     if (!name) return res.status(400).json({ error: "name required" });

//     await pool.query(
//       `INSERT INTO designations (id, entity_id, name)
//        VALUES (UUID(), ?, ?)`,
//       [entityId, name]
//     );

//     const [[row]] = await pool.query(
//       `SELECT id FROM designations WHERE entity_id = ? AND name = ? LIMIT 1`,
//       [entityId, name]
//     );
//     res.status(201).json({ id: row?.id });
//   } catch (err) {
//     console.error(err);
//     if (err.code === "ER_DUP_ENTRY") {
//       return res.status(409).json({ error: "Designation already exists in this entity" });
//     }
//     res.status(500).json({ error: "Failed to create designation" });
//   }
// });

// // GET /api/designations/:id
// router.get("/designations/:id", authRequired, async (req, res) => {
//   try {
//     const id = req.params.id;
//     const [[row]] = await pool.query(
//       `SELECT id, entity_id AS entityId, name,
//               created_at AS createdAt, updated_at AS updatedAt
//        FROM designations WHERE id = ?`,
//       [id]
//     );
//     if (!row) return res.status(404).json({ error: "Not found" });
//     res.json(row);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Failed to get designation" });
//   }
// });

// // PATCH /api/designations/:id   { name }
// router.patch("/designations/:id", authRequired, async (req, res) => {
//   try {
//     const id = req.params.id;
//     const { name } = req.body;
//     if (!name) return res.status(400).json({ error: "name required" });

//     const [result] = await pool.query(
//       `UPDATE designations SET name = ? WHERE id = ?`, [name, id]
//     );
//     res.json({ ok: true, updated: result.affectedRows });
//   } catch (err) {
//     console.error(err);
//     if (err.code === "ER_DUP_ENTRY") {
//       return res.status(409).json({ error: "Designation already exists in this entity" });
//     }
//     res.status(500).json({ error: "Failed to update designation" });
//   }
// });

// // DELETE /api/designations/:id
// router.delete("/designations/:id", authRequired, async (req, res) => {
//   try {
//     const id = req.params.id;

//     const [[{ cnt }]] = await pool.query(
//       `SELECT COUNT(*) AS cnt FROM user_affiliations WHERE designation_id = ?`, [id]
//     );
//     if (cnt > 0) return res.status(400).json({ error: "Designation is in use by users" });

//     const [result] = await pool.query(`DELETE FROM designations WHERE id = ?`, [id]);
//     res.json({ ok: true, deleted: result.affectedRows });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Failed to delete designation" });
//   }
// });

// module.exports = router;


// src/routes/Designations.js
const express = require("express");
const router = express.Router();
const { pool } = require("../db");
const { authRequired } = require("../middleware/auth");

/* ----------------------------- LIST by entity ----------------------------- */
// GET /api/entities/:entityId/designations
router.get("/entities/:entityId/designations", authRequired, async (req, res) => {
  const entityId = req.params.entityId;

  try {
    const [rows] = await pool.query(
      `SELECT id, entity_id AS entityId, name,
              created_at AS createdAt, updated_at AS updatedAt
       FROM designations
       WHERE entity_id = ?
       ORDER BY name`,
      [entityId]
    );

    try {
      req.audit?.log?.({
        action: "DESIGNATION_LIST",
        targetType: "entity",
        targetId: entityId,
        statusCode: 200,
        metadata: { count: rows.length },
      });
    } catch {}

    res.json(rows);
  } catch (err) {
    console.error(err);
    try {
      req.audit?.log?.({
        action: "DESIGNATION_LIST",
        targetType: "entity",
        targetId: entityId,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch {}
    res.status(500).json({ error: "Failed to list designations" });
  }
});

/* --------------------------------- CREATE --------------------------------- */
// POST /api/entities/:entityId/designations   { name }
router.post("/entities/:entityId/designations", authRequired, async (req, res) => {
  const entityId = req.params.entityId;
  const { name } = req.body || {};
  if (!name) {
    try {
      req.audit?.log?.({
        action: "DESIGNATION_CREATE",
        targetType: "entity",
        targetId: entityId,
        statusCode: 400,
        metadata: { reason: "name_required" },
      });
    } catch {}
    return res.status(400).json({ error: "name required" });
  }

  try {
    await pool.query(
      `INSERT INTO designations (id, entity_id, name)
       VALUES (UUID(), ?, ?)`,
      [entityId, name]
    );

    const [[row]] = await pool.query(
      `SELECT id FROM designations WHERE entity_id = ? AND name = ? LIMIT 1`,
      [entityId, name]
    );

    try {
      req.audit?.log?.({
        action: "DESIGNATION_CREATE",
        targetType: "designation",
        targetId: row?.id || null,
        statusCode: 201,
        metadata: { entityId, name },
      });
    } catch {}

    res.status(201).json({ id: row?.id });
  } catch (err) {
    console.error(err);
    if (err.code === "ER_DUP_ENTRY") {
      try {
        req.audit?.log?.({
          action: "DESIGNATION_CREATE",
          targetType: "entity",
          targetId: entityId,
          statusCode: 409,
          metadata: { reason: "duplicate", name },
        });
      } catch {}
      return res.status(409).json({ error: "Designation already exists in this entity" });
    }
    try {
      req.audit?.log?.({
        action: "DESIGNATION_CREATE",
        targetType: "entity",
        targetId: entityId,
        statusCode: 500,
        metadata: { error: String(err?.message || err), name },
      });
    } catch {}
    res.status(500).json({ error: "Failed to create designation" });
  }
});

/* ---------------------------------- GET ----------------------------------- */
// GET /api/designations/:id
router.get("/designations/:id", authRequired, async (req, res) => {
  const id = req.params.id;
  try {
    const [[row]] = await pool.query(
      `SELECT id, entity_id AS entityId, name,
              created_at AS createdAt, updated_at AS updatedAt
       FROM designations
       WHERE id = ?`,
      [id]
    );
    if (!row) {
      try {
        req.audit?.log?.({
          action: "DESIGNATION_GET",
          targetType: "designation",
          targetId: id,
          statusCode: 404,
          metadata: { reason: "not_found" },
        });
      } catch {}
      return res.status(404).json({ error: "Not found" });
    }

    try {
      req.audit?.log?.({
        action: "DESIGNATION_GET",
        targetType: "designation",
        targetId: id,
        statusCode: 200,
      });
    } catch {}

    res.json(row);
  } catch (err) {
    console.error(err);
    try {
      req.audit?.log?.({
        action: "DESIGNATION_GET",
        targetType: "designation",
        targetId: id,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch {}
    res.status(500).json({ error: "Failed to get designation" });
  }
});

/* --------------------------------- UPDATE --------------------------------- */
// PATCH /api/designations/:id   { name }
router.patch("/designations/:id", authRequired, async (req, res) => {
  const id = req.params.id;
  const { name } = req.body || {};
  if (!name) {
    try {
      req.audit?.log?.({
        action: "DESIGNATION_UPDATE",
        targetType: "designation",
        targetId: id,
        statusCode: 400,
        metadata: { reason: "name_required" },
      });
    } catch {}
    return res.status(400).json({ error: "name required" });
  }

  try {
    const [result] = await pool.query(
      `UPDATE designations SET name = ? WHERE id = ?`,
      [name, id]
    );

    try {
      req.audit?.log?.({
        action: "DESIGNATION_UPDATE",
        targetType: "designation",
        targetId: id,
        statusCode: 200,
        metadata: { updated: result.affectedRows, name },
      });
    } catch {}

    res.json({ ok: true, updated: result.affectedRows });
  } catch (err) {
    console.error(err);
    if (err.code === "ER_DUP_ENTRY") {
      try {
        req.audit?.log?.({
          action: "DESIGNATION_UPDATE",
          targetType: "designation",
          targetId: id,
          statusCode: 409,
          metadata: { reason: "duplicate", name },
        });
      } catch {}
      return res.status(409).json({ error: "Designation already exists in this entity" });
    }
    try {
      req.audit?.log?.({
        action: "DESIGNATION_UPDATE",
        targetType: "designation",
        targetId: id,
        statusCode: 500,
        metadata: { error: String(err?.message || err), name },
      });
    } catch {}
    res.status(500).json({ error: "Failed to update designation" });
  }
});

/* --------------------------------- DELETE --------------------------------- */
// DELETE /api/designations/:id
router.delete("/designations/:id", authRequired, async (req, res) => {
  const id = req.params.id;

  try {
    const [[{ cnt }]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM user_affiliations WHERE designation_id = ?`,
      [id]
    );
    if (cnt > 0) {
      try {
        req.audit?.log?.({
          action: "DESIGNATION_DELETE",
          targetType: "designation",
          targetId: id,
          statusCode: 400,
          metadata: { reason: "designation_in_use", userAffiliations: cnt },
        });
      } catch {}
      return res.status(400).json({ error: "Designation is in use by users" });
    }

    const [result] = await pool.query(
      `DELETE FROM designations WHERE id = ?`,
      [id]
    );

    try {
      req.audit?.log?.({
        action: "DESIGNATION_DELETE",
        targetType: "designation",
        targetId: id,
        statusCode: 200,
        metadata: { deleted: result.affectedRows },
      });
    } catch {}

    res.json({ ok: true, deleted: result.affectedRows });
  } catch (err) {
    console.error(err);
    try {
      req.audit?.log?.({
        action: "DESIGNATION_DELETE",
        targetType: "designation",
        targetId: id,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch {}
    res.status(500).json({ error: "Failed to delete designation" });
  }
});

module.exports = router;
