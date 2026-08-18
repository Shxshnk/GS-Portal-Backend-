// // src/routes/Polarization.js
// const express = require('express');
// const router = express.Router();
// const { pool } = require('../db');

// const ALLOWED_SORT = new Set(['id', 'satellite_name', 'polarization']);
// function sanitizeSort(sortBy = 'id', sortOrder = 'asc') {
//   const by = ALLOWED_SORT.has(String(sortBy)) ? String(sortBy) : 'id';
//   const order = String(sortOrder).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
//   return { by, order };
// }

// // CREATE
// router.post('/', async (req, res) => {
//   try {
//     const { satellite_name, polarization } = req.body || {};
//     if (!satellite_name || !polarization) {
//       return res.status(400).json({ message: 'satellite_name and polarization are required' });
//     }

//     const [result] = await pool.query(
//       `INSERT INTO satellite_polarizations (satellite_name, polarization)
//        VALUES (?, ?)`,
//       [satellite_name.trim(), polarization.trim()]
//     );

//     const [rows] = await pool.query(
//       'SELECT id, satellite_name, polarization FROM satellite_polarizations WHERE id = ?',
//       [result.insertId]
//     );
//     res.status(201).json(rows[0]);
//   } catch (err) {
//     if (err && err.code === 'ER_DUP_ENTRY') {
//       return res.status(409).json({ message: 'This satellite already has the same polarization recorded.' });
//     }
//     console.error('Create polarization error:', err);
//     res.status(500).json({ message: 'Internal server error' });
//   }
// });

// // LIST (filters + search + pagination + sorting)
// router.get('/', async (req, res) => {
//   try {
//     const { q, sat, pol, page = 1, limit = 20, sort_by = 'id', sort_order = 'asc' } = req.query;
//     const { by, order } = sanitizeSort(sort_by, sort_order);

//     const filters = [];
//     const params = [];

//     if (sat) { filters.push('satellite_name LIKE ?'); params.push(`%${sat}%`); }
//     if (pol) { filters.push('polarization = ?'); params.push(pol); }
//     if (q) {
//       filters.push('(satellite_name LIKE ? OR polarization LIKE ?)');
//       params.push(`%${q}%`, `%${q}%`);
//     }

//     const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
//     const lim = Math.min(parseInt(limit, 10) || 20, 100);
//     const pg = Math.max(parseInt(page, 10) || 1, 1);
//     const offset = (pg - 1) * lim;

//     const [countRows] = await pool.query(
//       `SELECT COUNT(*) AS total FROM satellite_polarizations ${where}`, params
//     );
//     const total = countRows[0].total;

//     const [rows] = await pool.query(
//       `SELECT id, satellite_name, polarization
//          FROM satellite_polarizations
//          ${where}
//          ORDER BY ${by} ${order}
//          LIMIT ? OFFSET ?`,
//       [...params, lim, offset]
//     );

//     res.json({
//       data: rows,
//       pagination: { total, page: pg, limit: lim, pages: Math.ceil(total / lim) }
//     });
//   } catch (err) {
//     console.error('List polarizations error:', err);
//     res.status(500).json({ message: 'Internal server error' });
//   }
// });

// // READ ONE
// router.get('/:id', async (req, res) => {
//   try {
//     const [rows] = await pool.query(
//       'SELECT id, satellite_name, polarization FROM satellite_polarizations WHERE id = ?',
//       [req.params.id]
//     );
//     if (!rows.length) return res.status(404).json({ message: 'Polarization not found' });
//     res.json(rows[0]);
//   } catch (err) {
//     console.error('Get polarization error:', err);
//     res.status(500).json({ message: 'Internal server error' });
//   }
// });

// // UPDATE
// router.put('/:id', async (req, res) => {
//   try {
//     const { satellite_name, polarization } = req.body || {};
//     if (!satellite_name || !polarization) {
//       return res.status(400).json({ message: 'satellite_name and polarization are required' });
//     }

//     const [result] = await pool.query(
//       `UPDATE satellite_polarizations
//          SET satellite_name = ?, polarization = ?
//        WHERE id = ?`,
//       [satellite_name.trim(), polarization.trim(), req.params.id]
//     );

//     if (result.affectedRows === 0) return res.status(404).json({ message: 'Polarization not found' });

//     const [rows] = await pool.query(
//       'SELECT id, satellite_name, polarization FROM satellite_polarizations WHERE id = ?',
//       [req.params.id]
//     );
//     res.json(rows[0]);
//   } catch (err) {
//     if (err && err.code === 'ER_DUP_ENTRY') {
//       return res.status(409).json({ message: 'This satellite already has the same polarization recorded.' });
//     }
//     console.error('Update polarization error:', err);
//     res.status(500).json({ message: 'Internal server error' });
//   }
// });

// // DELETE
// router.delete('/:id', async (req, res) => {
//   try {
//     const [result] = await pool.query(
//       'DELETE FROM satellite_polarizations WHERE id = ?',
//       [req.params.id]
//     );
//     if (result.affectedRows === 0) return res.status(404).json({ message: 'Polarization not found' });
//     res.status(204).send();
//   } catch (err) {
//     console.error('Delete polarization error:', err);
//     res.status(500).json({ message: 'Internal server error' });
//   }
// });

// module.exports = router;

// src/routes/Polarization.js
const express = require("express");
const router = express.Router();
const { pool } = require("../db");
const { authRequired } = require("../middleware/auth");

/* ---------- sorting helpers ---------- */
const ALLOWED_SORT = new Set(["id", "satellite_name", "polarization"]);
function sanitizeSort(sortBy = "id", sortOrder = "asc") {
  const by = ALLOWED_SORT.has(String(sortBy)) ? String(sortBy) : "id";
  const order = String(sortOrder).toLowerCase() === "desc" ? "DESC" : "ASC";
  return { by, order };
}

/* =========================
   CREATE
   ========================= */
router.post("/", authRequired, async (req, res) => {
  try {
    const { satellite_name, polarization } = req.body || {};
    if (!satellite_name || !polarization) {
      try {
        req.audit?.log?.({
          action: "POLARIZATION_CREATE",
          targetType: "polarization",
          targetId: null,
          statusCode: 400,
          metadata: { reason: "missing_fields" },
        });
      } catch {}
      return res
        .status(400)
        .json({ message: "satellite_name and polarization are required" });
    }

    const [result] = await pool.query(
      `INSERT INTO satellite_polarizations (satellite_name, polarization)
       VALUES (?, ?)`,
      [satellite_name.trim(), polarization.trim()]
    );

    const [rows] = await pool.query(
      "SELECT id, satellite_name, polarization FROM satellite_polarizations WHERE id = ?",
      [result.insertId]
    );

    try {
      req.audit?.log?.({
        action: "POLARIZATION_CREATE",
        targetType: "polarization",
        targetId: String(result.insertId),
        statusCode: 201,
        metadata: {
          satellite_name: satellite_name.trim(),
          polarization: polarization.trim(),
        },
      });
    } catch {}

    res.status(201).json(rows[0]);
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      try {
        req.audit?.log?.({
          action: "POLARIZATION_CREATE",
          targetType: "polarization",
          targetId: null,
          statusCode: 409,
          metadata: { error: "duplicate" },
        });
      } catch {}
      return res.status(409).json({
        message: "This satellite already has the same polarization recorded.",
      });
    }
    console.error("Create polarization error:", err);
    try {
      req.audit?.log?.({
        action: "POLARIZATION_CREATE",
        targetType: "polarization",
        targetId: null,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch {}
    res.status(500).json({ message: "Internal server error" });
  }
});

/* =========================
   LIST (filters + search + pagination + sorting)
   ========================= */
router.get("/", authRequired, async (req, res) => {
  try {
    const {
      q,
      sat,
      pol,
      page = 1,
      limit = 20,
      sort_by = "id",
      sort_order = "asc",
    } = req.query;
    const { by, order } = sanitizeSort(sort_by, sort_order);

    const filters = [];
    const params = [];

    if (sat) {
      filters.push("satellite_name LIKE ?");
      params.push(`%${sat}%`);
    }
    if (pol) {
      filters.push("polarization = ?");
      params.push(pol);
    }
    if (q) {
      filters.push("(satellite_name LIKE ? OR polarization LIKE ?)");
      params.push(`%${q}%`, `%${q}%`);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const lim = Math.min(parseInt(limit, 10) || 20, 100);
    const pg = Math.max(parseInt(page, 10) || 1, 1);
    const offset = (pg - 1) * lim;

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM satellite_polarizations ${where}`,
      params
    );
    const total = countRows[0].total;

    const [rows] = await pool.query(
      `SELECT id, satellite_name, polarization
         FROM satellite_polarizations
         ${where}
         ORDER BY ${by} ${order}
         LIMIT ? OFFSET ?`,
      [...params, lim, offset]
    );

    try {
      req.audit?.log?.({
        action: "POLARIZATION_LIST",
        targetType: "polarization",
        targetId: null,
        statusCode: 200,
        metadata: { total, returned: rows.length, page: pg, limit: lim },
      });
    } catch {}

    res.json({
      data: rows,
      pagination: { total, page: pg, limit: lim, pages: Math.ceil(total / lim) },
    });
  } catch (err) {
    console.error("List polarizations error:", err);
    try {
      req.audit?.log?.({
        action: "POLARIZATION_LIST",
        targetType: "polarization",
        targetId: null,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch {}
    res.status(500).json({ message: "Internal server error" });
  }
});

/* =========================
   READ ONE
   ========================= */
router.get("/:id", authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, satellite_name, polarization FROM satellite_polarizations WHERE id = ?",
      [req.params.id]
    );
    if (!rows.length) {
      try {
        req.audit?.log?.({
          action: "POLARIZATION_READ",
          targetType: "polarization",
          targetId: String(req.params.id),
          statusCode: 404,
          metadata: { reason: "not_found" },
        });
      } catch {}
      return res.status(404).json({ message: "Polarization not found" });
    }

    try {
      req.audit?.log?.({
        action: "POLARIZATION_READ",
        targetType: "polarization",
        targetId: String(req.params.id),
        statusCode: 200,
        metadata: { satellite_name: rows[0].satellite_name },
      });
    } catch {}

    res.json(rows[0]);
  } catch (err) {
    console.error("Get polarization error:", err);
    try {
      req.audit?.log?.({
        action: "POLARIZATION_READ",
        targetType: "polarization",
        targetId: String(req.params.id),
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch {}
    res.status(500).json({ message: "Internal server error" });
  }
});

/* =========================
   UPDATE
   ========================= */
router.put("/:id", authRequired, async (req, res) => {
  try {
    const { satellite_name, polarization } = req.body || {};
    if (!satellite_name || !polarization) {
      try {
        req.audit?.log?.({
          action: "POLARIZATION_UPDATE",
          targetType: "polarization",
          targetId: String(req.params.id),
          statusCode: 400,
          metadata: { reason: "missing_fields" },
        });
      } catch {}
      return res
        .status(400)
        .json({ message: "satellite_name and polarization are required" });
    }

    const [result] = await pool.query(
      `UPDATE satellite_polarizations
         SET satellite_name = ?, polarization = ?
       WHERE id = ?`,
      [satellite_name.trim(), polarization.trim(), req.params.id]
    );

    if (result.affectedRows === 0) {
      try {
        req.audit?.log?.({
          action: "POLARIZATION_UPDATE",
          targetType: "polarization",
          targetId: String(req.params.id),
          statusCode: 404,
          metadata: { reason: "not_found" },
        });
      } catch {}
      return res.status(404).json({ message: "Polarization not found" });
    }

    const [rows] = await pool.query(
      "SELECT id, satellite_name, polarization FROM satellite_polarizations WHERE id = ?",
      [req.params.id]
    );

    try {
      req.audit?.log?.({
        action: "POLARIZATION_UPDATE",
        targetType: "polarization",
        targetId: String(req.params.id),
        statusCode: 200,
        metadata: {
          satellite_name: satellite_name.trim(),
          polarization: polarization.trim(),
        },
      });
    } catch {}

    res.json(rows[0]);
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      try {
        req.audit?.log?.({
          action: "POLARIZATION_UPDATE",
          targetType: "polarization",
          targetId: String(req.params.id),
          statusCode: 409,
          metadata: { error: "duplicate" },
        });
      } catch {}
      return res.status(409).json({
        message: "This satellite already has the same polarization recorded.",
      });
    }
    console.error("Update polarization error:", err);
    try {
      req.audit?.log?.({
        action: "POLARIZATION_UPDATE",
        targetType: "polarization",
        targetId: String(req.params.id),
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch {}
    res.status(500).json({ message: "Internal server error" });
  }
});

/* =========================
   DELETE
   ========================= */
router.delete("/:id", authRequired, async (req, res) => {
  try {
    const [result] = await pool.query(
      "DELETE FROM satellite_polarizations WHERE id = ?",
      [req.params.id]
    );
    if (result.affectedRows === 0) {
      try {
        req.audit?.log?.({
          action: "POLARIZATION_DELETE",
          targetType: "polarization",
          targetId: String(req.params.id),
          statusCode: 404,
          metadata: { reason: "not_found" },
        });
      } catch {}
      return res.status(404).json({ message: "Polarization not found" });
    }

    try {
      req.audit?.log?.({
        action: "POLARIZATION_DELETE",
        targetType: "polarization",
        targetId: String(req.params.id),
        statusCode: 204,
        metadata: {},
      });
    } catch {}

    res.status(204).send();
  } catch (err) {
    console.error("Delete polarization error:", err);
    try {
      req.audit?.log?.({
        action: "POLARIZATION_DELETE",
        targetType: "polarization",
        targetId: String(req.params.id),
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch {}
    res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;

