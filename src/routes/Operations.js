// // src/routes/Operations.js
// const express = require("express");
// const router = express.Router();
// const { pool } = require("../db");

// /* ---------- helpers ---------- */
// function normalizeSort(table, nameCol, sortBy, sortOrder) {
// const allowed = new Set(["id", nameCol, "added_by", "created_at", "updated_at"]);
// const sb = allowed.has(String(sortBy)) ? sortBy : "id";
// const so = String(sortOrder).toLowerCase() === "desc" ? "DESC" : "ASC";
// return { sb, so };
// }

// async function listRecords(table, nameCol, req, res) {
// try {
//     const {
//     limit = 50,
//     offset = 0,
//     search = "",
//     sort_by = "id",
//     sort_order = "asc",
//     } = req.query;

//     const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
//     const off = Math.max(parseInt(offset, 10) || 0, 0);
//     const { sb, so } = normalizeSort(table, nameCol, sort_by, sort_order);

//     const params = [];
//     let where = "";
//     if (search) {
//     where = `WHERE ${nameCol} LIKE ?`;
//     params.push(`%${search}%`);
//     }

//     const [[{ total }]] = await pool.query(
//     `SELECT COUNT(*) AS total FROM ${table} ${where}`,
//     params
//     );

//     const [rows] = await pool.query(
//     `SELECT * FROM ${table} ${where} ORDER BY ${sb} ${so} LIMIT ? OFFSET ?`,
//     [...params, lim, off]
//     );

//     res.json({ total, data: rows });
// } catch (err) {
//     console.error("List error:", err);
//     res.status(500).json({ message: "Failed to list records" });
// }
// }

// async function createRecord(table, cols, req, res, conflictMsg) {
// try {
//     const values = cols.map((c) => (req.body?.[c] ?? "").toString().trim());
//     if (!values[0]) return res.status(400).json({ message: "Name is required" });

//     const placeholders = cols.map(() => "?").join(",");
//     const [r] = await pool.query(
//     `INSERT INTO ${table} (${cols.join(",")}) VALUES (${placeholders})`,
//     values
//     );
//     const id = r.insertId;
//     const [rows] = await pool.query(`SELECT * FROM ${table} WHERE id=?`, [id]);
//     res.status(201).json(rows[0]);
// } catch (err) {
//     if (err?.code === "ER_DUP_ENTRY") {
//     return res.status(409).json({ message: conflictMsg });
//     }
//     console.error("Create error:", err);
//     res.status(500).json({ message: "Failed to create record" });
// }
// }

// async function updateRecord(table, id, cols, req, res, conflictMsg) {
// try {
//     const values = cols.map((c) => (req.body?.[c] ?? "").toString().trim());
//     if (!values[0]) return res.status(400).json({ message: "Name is required" });

//     const setClause = cols.map((c) => `${c}=?`).join(",");
//     const [r] = await pool.query(
//     `UPDATE ${table} SET ${setClause} WHERE id=?`,
//     [...values, id]
//     );
//     if (r.affectedRows === 0) return res.status(404).json({ message: "Not found" });

//     const [rows] = await pool.query(`SELECT * FROM ${table} WHERE id=?`, [id]);
//     res.json(rows[0]);
// } catch (err) {
//     if (err?.code === "ER_DUP_ENTRY") {
//     return res.status(409).json({ message: conflictMsg });
//     }
//     console.error("Update error:", err);
//     res.status(500).json({ message: "Failed to update record" });
// }
// }

// async function deleteRecord(table, id, res) {
// try {
//     const [r] = await pool.query(`DELETE FROM ${table} WHERE id=?`, [id]);
//     if (r.affectedRows === 0) return res.status(404).json({ message: "Not found" });
//     res.status(204).send();
// } catch (err) {
//     console.error("Delete error:", err);
//     res.status(500).json({ message: "Failed to delete record" });
// }
// }

// /* ---------- OPERATIONS ---------- */
// router.get("/operations", (req, res) =>
// listRecords("operations", "operation_name", req, res)
// );

// router.post("/operations", (req, res) =>
// createRecord(
//     "operations",
//     ["operation_name", "added_by"],
//     req,
//     res,
//     "Operation already exists"
// )
// );

// router.put("/operations/:id", (req, res) =>
// updateRecord(
//     "operations",
//     req.params.id,
//     ["operation_name", "added_by"],
//     req,
//     res,
//     "Operation already exists"
// )
// );

// router.delete("/operations/:id", (req, res) =>
// deleteRecord("operations", req.params.id, res)
// );

// /* ---------- OPERATION REQUESTERS ---------- */
// router.get("/operation-requesters", (req, res) =>
// listRecords("operation_requesters", "requester_name", req, res)
// );

// router.post("/operation-requesters", (req, res) =>
// createRecord(
//     "operation_requesters",
//     ["requester_name", "added_by"],
//     req,
//     res,
//     "Requester already exists"
// )
// );

// router.put("/operation-requesters/:id", (req, res) =>
// updateRecord(
//     "operation_requesters",
//     req.params.id,
//     ["requester_name", "added_by"],
//     req,
//     res,
//     "Requester already exists"
// )
// );

// router.delete("/operation-requesters/:id", (req, res) =>
// deleteRecord("operation_requesters", req.params.id, res)
// );

// /* ---------- OPERATION SUPPORTERS ---------- */
// router.get("/operation-supporters", (req, res) =>
// listRecords("operation_supporters", "supporter_name", req, res)
// );

// router.post("/operation-supporters", (req, res) =>
// createRecord(
//     "operation_supporters",
//     ["supporter_name", "added_by"],
//     req,
//     res,
//     "Supporter already exists"
// )
// );

// router.put("/operation-supporters/:id", (req, res) =>
// updateRecord(
//     "operation_supporters",
//     req.params.id,
//     ["supporter_name", "added_by"],
//     req,
//     res,
//     "Supporter already exists"
// )
// );

// router.delete("/operation-supporters/:id", (req, res) =>
// deleteRecord("operation_supporters", req.params.id, res)
// );

// module.exports = router;

// src/routes/Operations.js
const express = require("express");
const router = express.Router();
const { pool } = require("../db");
const { authRequired } = require("../middleware/auth");

/* ---------- helpers (sorting/paging) ---------- */
function normalizeSort(nameCol, sortBy, sortOrder) {
  const allowed = new Set(["id", nameCol, "added_by", "created_at", "updated_at"]);
  const sb = allowed.has(String(sortBy)) ? String(sortBy) : "id";
  const so = String(sortOrder).toLowerCase() === "desc" ? "DESC" : "ASC";
  return { sb, so };
}

/* ---------- generic handlers with audit ---------- */
async function listRecords(
  { table, nameCol, actionPrefix, targetType },
  req,
  res
) {
  try {
    const {
      limit = 50,
      offset = 0,
      search = "",
      sort_by = "id",
      sort_order = "asc",
    } = req.query;

    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
    const off = Math.max(parseInt(offset, 10) || 0, 0);
    const { sb, so } = normalizeSort(nameCol, sort_by, sort_order);

    const params = [];
    let where = "";
    if (search) {
      where = `WHERE ${nameCol} LIKE ?`;
      params.push(`%${search}%`);
    }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM ${table} ${where}`,
      params
    );

    const [rows] = await pool.query(
      `SELECT * FROM ${table} ${where} ORDER BY ${sb} ${so} LIMIT ? OFFSET ?`,
      [...params, lim, off]
    );



    res.json({ total, data: rows });
  } catch (err) {
    console.error(`[${actionPrefix}] List error:`, err);
    try {
      req.audit?.log?.({
        action: `${actionPrefix}_LIST`,
        targetType,
        targetId: null,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch { }
    res.status(500).json({ message: "Failed to list records" });
  }
}

async function createRecord(
  { table, cols, conflictMsg, actionPrefix, targetType },
  req,
  res
) {
  try {
    const values = cols.map((c) => (req.body?.[c] ?? "").toString().trim());
    if (!values[0]) {
      try {
        req.audit?.log?.({
          action: `${actionPrefix}_CREATE`,
          targetType,
          targetId: null,
          statusCode: 400,
          metadata: { reason: "missing_name", cols },
        });
      } catch { }
      return res.status(400).json({ message: "Name is required" });
    }

    const placeholders = cols.map(() => "?").join(",");
    const [r] = await pool.query(
      `INSERT INTO ${table} (${cols.join(",")}) VALUES (${placeholders})`,
      values
    );
    const id = r.insertId;
    const [rows] = await pool.query(`SELECT * FROM ${table} WHERE id=?`, [id]);

    try {
      req.audit?.log?.({
        action: `${actionPrefix}_CREATE`,
        targetType,
        targetId: String(id),
        statusCode: 201,
        metadata: Object.fromEntries(cols.map((c, i) => [c, values[i]])),
      });
    } catch { }

    res.status(201).json(rows[0]);
  } catch (err) {
    if (err?.code === "ER_DUP_ENTRY") {
      try {
        req.audit?.log?.({
          action: `${actionPrefix}_CREATE`,
          targetType,
          targetId: null,
          statusCode: 409,
          metadata: { reason: "duplicate" },
        });
      } catch { }
      return res.status(409).json({ message: conflictMsg });
    }
    console.error(`[${actionPrefix}] Create error:`, err);
    try {
      req.audit?.log?.({
        action: `${actionPrefix}_CREATE`,
        targetType,
        targetId: null,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch { }
    res.status(500).json({ message: "Failed to create record" });
  }
}

async function updateRecord(
  { table, id, cols, conflictMsg, actionPrefix, targetType },
  req,
  res
) {
  try {
    const values = cols.map((c) => (req.body?.[c] ?? "").toString().trim());
    if (!values[0]) {
      try {
        req.audit?.log?.({
          action: `${actionPrefix}_UPDATE`,
          targetType,
          targetId: String(id),
          statusCode: 400,
          metadata: { reason: "missing_name", cols },
        });
      } catch { }
      return res.status(400).json({ message: "Name is required" });
    }

    const [oldRows] = await pool.query(`SELECT * FROM ${table} WHERE id=?`, [id]);
    const oldRow = oldRows.length ? oldRows[0] : null;

    const setClause = cols.map((c) => `${c}=?`).join(",");
    const [r] = await pool.query(
      `UPDATE ${table} SET ${setClause} WHERE id=?`,
      [...values, id]
    );
    if (r.affectedRows === 0) {
      try {
        req.audit?.log?.({
          action: `${actionPrefix}_UPDATE`,
          targetType,
          targetId: String(id),
          statusCode: 404,
          metadata: { reason: "not_found" },
        });
      } catch { }
      return res.status(404).json({ message: "Not found" });
    }

    const [rows] = await pool.query(`SELECT * FROM ${table} WHERE id=?`, [id]);
    const newRow = rows[0];

    try {
      req.audit?.log?.({
        action: `${actionPrefix}_UPDATE`,
        targetType,
        targetId: String(id),
        statusCode: 200,
        metadata: { oldValue: oldRow, newValue: newRow },
      });
    } catch { }

    res.json(newRow);
  } catch (err) {
    if (err?.code === "ER_DUP_ENTRY") {
      try {
        req.audit?.log?.({
          action: `${actionPrefix}_UPDATE`,
          targetType,
          targetId: String(id),
          statusCode: 409,
          metadata: { reason: "duplicate" },
        });
      } catch { }
      return res.status(409).json({ message: conflictMsg });
    }
    console.error(`[${actionPrefix}] Update error:`, err);
    try {
      req.audit?.log?.({
        action: `${actionPrefix}_UPDATE`,
        targetType,
        targetId: String(id),
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch { }
    res.status(500).json({ message: "Failed to update record" });
  }
}

async function deleteRecord(
  { table, id, actionPrefix, targetType },
  res,
  req
) {
  try {
    const [r] = await pool.query(`DELETE FROM ${table} WHERE id=?`, [id]);
    if (r.affectedRows === 0) {
      try {
        req.audit?.log?.({
          action: `${actionPrefix}_DELETE`,
          targetType,
          targetId: String(id),
          statusCode: 404,
          metadata: { reason: "not_found" },
        });
      } catch { }
      return res.status(404).json({ message: "Not found" });
    }

    try {
      req.audit?.log?.({
        action: `${actionPrefix}_DELETE`,
        targetType,
        targetId: String(id),
        statusCode: 204,
        metadata: { deleted: r.affectedRows },
      });
    } catch { }

    res.status(204).send();
  } catch (err) {
    console.error(`[${actionPrefix}] Delete error:`, err);
    try {
      req.audit?.log?.({
        action: `${actionPrefix}_DELETE`,
        targetType,
        targetId: String(id),
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch { }
    res.status(500).json({ message: "Failed to delete record" });
  }
}

/* ============================= ROUTES ============================= */
/* ---------- OPERATIONS ---------- */
router.get(
  "/operations",
  authRequired,
  (req, res) =>
    listRecords(
      { table: "operations", nameCol: "operation_name", actionPrefix: "OPERATIONS", targetType: "operation" },
      req,
      res
    )
);

router.post(
  "/operations",
  authRequired,
  (req, res) =>
    createRecord(
      {
        table: "operations",
        cols: ["operation_name", "added_by"],
        conflictMsg: "Operation already exists",
        actionPrefix: "OPERATIONS",
        targetType: "operation",
      },
      req,
      res
    )
);

router.put(
  "/operations/:id",
  authRequired,
  (req, res) =>
    updateRecord(
      {
        table: "operations",
        id: req.params.id,
        cols: ["operation_name", "added_by"],
        conflictMsg: "Operation already exists",
        actionPrefix: "OPERATIONS",
        targetType: "operation",
      },
      req,
      res
    )
);

router.delete(
  "/operations/:id",
  authRequired,
  (req, res) =>
    deleteRecord(
      { table: "operations", id: req.params.id, actionPrefix: "OPERATIONS", targetType: "operation" },
      res,
      req
    )
);

/* ---------- OPERATION REQUESTERS ---------- */
router.get(
  "/operation-requesters",
  authRequired,
  (req, res) =>
    listRecords(
      {
        table: "operation_requesters",
        nameCol: "requester_name",
        actionPrefix: "OP_REQUESTERS",
        targetType: "operation_requester",
      },
      req,
      res
    )
);

router.post(
  "/operation-requesters",
  authRequired,
  (req, res) =>
    createRecord(
      {
        table: "operation_requesters",
        cols: ["requester_name", "added_by"],
        conflictMsg: "Requester already exists",
        actionPrefix: "OP_REQUESTERS",
        targetType: "operation_requester",
      },
      req,
      res
    )
);

router.put(
  "/operation-requesters/:id",
  authRequired,
  (req, res) =>
    updateRecord(
      {
        table: "operation_requesters",
        id: req.params.id,
        cols: ["requester_name", "added_by"],
        conflictMsg: "Requester already exists",
        actionPrefix: "OP_REQUESTERS",
        targetType: "operation_requester",
      },
      req,
      res
    )
);

router.delete(
  "/operation-requesters/:id",
  authRequired,
  (req, res) =>
    deleteRecord(
      {
        table: "operation_requesters",
        id: req.params.id,
        actionPrefix: "OP_REQUESTERS",
        targetType: "operation_requester",
      },
      res,
      req
    )
);

/* ---------- OPERATION SUPPORTERS ---------- */
router.get(
  "/operation-supporters",
  authRequired,
  (req, res) =>
    listRecords(
      {
        table: "operation_supporters",
        nameCol: "supporter_name",
        actionPrefix: "OP_SUPPORTERS",
        targetType: "operation_supporter",
      },
      req,
      res
    )
);

router.post(
  "/operation-supporters",
  authRequired,
  (req, res) =>
    createRecord(
      {
        table: "operation_supporters",
        cols: ["supporter_name", "added_by"],
        conflictMsg: "Supporter already exists",
        actionPrefix: "OP_SUPPORTERS",
        targetType: "operation_supporter",
      },
      req,
      res
    )
);

router.put(
  "/operation-supporters/:id",
  authRequired,
  (req, res) =>
    updateRecord(
      {
        table: "operation_supporters",
        id: req.params.id,
        cols: ["supporter_name", "added_by"],
        conflictMsg: "Supporter already exists",
        actionPrefix: "OP_SUPPORTERS",
        targetType: "operation_supporter",
      },
      req,
      res
    )
);

router.delete(
  "/operation-supporters/:id",
  authRequired,
  (req, res) =>
    deleteRecord(
      {
        table: "operation_supporters",
        id: req.params.id,
        actionPrefix: "OP_SUPPORTERS",
        targetType: "operation_supporter",
      },
      res,
      req
    )
);

module.exports = router;
