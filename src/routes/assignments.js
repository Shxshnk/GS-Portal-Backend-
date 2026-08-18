// src/routes/assignments.js
const express = require("express");
const router = express.Router();
const { pool } = require("../db");
const { v4: uuidv4 } = require("uuid");
const { authRequired } = require("../middleware/auth");

/* -------------------------------------------
 * GET /api/assignments
 * Aggregated list for the table
 * -----------------------------------------*/
router.get("/", authRequired, async (req, res) => {
  try {
    const [users] = await pool.execute(
      `SELECT u.id, u.username, r.id AS role_id, r.name AS role
       FROM users u LEFT JOIN roles r ON r.id = u.role_id
       ORDER BY u.username ASC`
    );

    const [aff] = await pool.execute(
  `SELECT ua.user_id, e.id AS entity_id, e.name AS entity
   FROM user_affiliations ua
   JOIN entities e ON e.id = ua.entity_id
   ORDER BY e.name`
);


    const byUser = new Map();
    for (const u of users) {
      byUser.set(u.id, {
        id: u.id,
        user: u.username,
        user_id: u.id,
        entity_ids: [],
        entities: [],
        role_id: u.role_id || null,
        role: u.role || "",
       
      });
    }
    for (const a of aff) {
      const row = byUser.get(a.user_id);
      if (!row) continue;
      if (!row.entity_ids.includes(a.entity_id)) {
        row.entity_ids.push(a.entity_id);
        row.entities.push(a.entity);
      }
     
    }

    const result = Array.from(byUser.values()).map((r, i) => ({ ...r, sr: i + 1 }));

    // AUDIT
    try {
      req.audit?.log?.({
        action: "ASSIGNMENT_LIST",
        targetType: "assignment",
        targetId: null,
        metadata: { total: result.length },
        statusCode: 200,
      });
    } catch {}

    res.json(result);
  } catch (err) {
    console.error("GET /assignments failed", err);
    try {
      req.audit?.log?.({
        action: "ASSIGNMENT_LIST",
        targetType: "assignment",
        targetId: null,
        metadata: { error: String(err?.message || err) },
        statusCode: 500,
      });
    } catch {}
    res.status(500).json({ error: "Failed to fetch assignments" });
  }
});

/* -------------------------------------------
 * GET /api/assignments/user/:userId
 * Read assignment for a single user (for modal)
 * -----------------------------------------*/
router.get("/user/:userId", authRequired, async (req, res) => {
  const userId = req.params.userId;

  try {
    const [[u]] = await pool.query(
      `SELECT u.id, u.username, u.role_id, r.name AS role
       FROM users u LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.id = ?`,
      [userId]
    );

    if (!u) {
      try {
        req.audit?.log?.({
          action: "ASSIGNMENT_READ",
          targetType: "user",
          targetId: userId,
          metadata: { reason: "user_not_found" },
          statusCode: 404,
        });
      } catch {}
      return res.status(404).json({ error: "User not found" });
    }

    const [aff] = await pool.query(
  `SELECT e.id AS entity_id, e.name AS entity
   FROM user_affiliations ua
   JOIN entities e ON e.id = ua.entity_id
   WHERE ua.user_id = ?`,
  [userId]
);


    const payload = {
      userId: u.id,
      username: u.username,
      roleId: u.role_id || null,
      entityIds: [...new Set(aff.map((x) => x.entity_id))], // [] => global
      
    };

    try {
      req.audit?.log?.({
        action: "ASSIGNMENT_READ",
        targetType: "user",
        targetId: userId,
        metadata: { hasAffiliations: aff.length > 0, roleId: payload.roleId },
        statusCode: 200,
      });
    } catch {}

    res.json(payload);
  } catch (err) {
    console.error("GET /assignments/user/:userId failed", err);
    try {
      req.audit?.log?.({
        action: "ASSIGNMENT_READ",
        targetType: "user",
        targetId: userId,
        metadata: { error: String(err?.message || err) },
        statusCode: 500,
      });
    } catch {}
    res.status(500).json({ error: "Failed to fetch assignment" });
  }
});

/* -------------------------------------------
 * PUT /api/assignments/user/:userId
 * Replace the user's role + affiliations

 * -----------------------------------------*/
router.put("/user/:userId", authRequired, async (req, res) => {
  const userId = req.params.userId;
  const roleId = req.body.roleId || null;

  // [] => (global). Otherwise an array of entity UUIDs.
  const entityIds = Array.isArray(req.body.entityIds) ? req.body.entityIds : [];


  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ensure user exists
    const [[u]] = await conn.query("SELECT id FROM users WHERE id = ?", [userId]);
    if (!u) {
      await conn.rollback();
      try {
        req.audit?.log?.({
          action: "ASSIGNMENT_UPDATE",
          targetType: "user",
          targetId: userId,
          metadata: { reason: "user_not_found" },
          statusCode: 404,
        });
      } catch {}
      return res.status(404).json({ error: "User not found" });
    }

    // always update role_id (can be null)
    await conn.execute("UPDATE users SET role_id = ? WHERE id = ?", [roleId, userId]);

    // (global) => remove all affiliations and finish
    if (entityIds.length === 0) {
      await conn.execute("DELETE FROM user_affiliations WHERE user_id = ?", [userId]);
      await conn.commit();

      try {
        req.audit?.log?.({
          action: "ASSIGNMENT_UPDATE",
          targetType: "user",
          targetId: userId,
          metadata: { mode: "global", roleId },
          statusCode: 200,
        });
      } catch {}

      return res.json({ ok: true, mode: "global" });
    }

    // if entities were chosen, require at least one designation
   

    // fetch designation ids for (entity_id, name) pairs
   

    // build { entity_id -> { name -> designation_id } }
    

    // desired rows (exactly what UI selected)
   
    // Replace the whole set atomically
   await conn.execute("DELETE FROM user_affiliations WHERE user_id = ?", [userId]);

if (entityIds.length) {
  const inserts = entityIds.map((eid) => [uuidv4(), userId, eid]);
  await conn.query(
    "INSERT INTO user_affiliations (id, user_id, entity_id) VALUES ?",
    [inserts]
  );
}


    await conn.commit();

    try {
      req.audit?.log?.({
        action: "ASSIGNMENT_UPDATE",
        targetType: "user",
        targetId: userId,
       metadata: {
  mode: "replace",
  roleId,
  entityIds,
  rowsInserted: entityIds.length,
},

        statusCode: 200,
      });
    } catch {}

   return res.json({ ok: true, mode: "replace", count: entityIds.length });

  } catch (err) {
    await conn.rollback();
    console.error("PUT /assignments/user/:userId failed", err);
    try {
      req.audit?.log?.({
        action: "ASSIGNMENT_UPDATE",
        targetType: "user",
        targetId: userId,
        metadata: { error: String(err?.message || err) },
        statusCode: 500,
      });
    } catch {}
    res.status(500).json({ error: "Failed to update assignment" });
  } finally {
    conn.release();
  }
});

module.exports = router;

