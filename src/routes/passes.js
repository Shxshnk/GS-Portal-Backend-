// src/routes/passes.js
const express = require("express");
const router = express.Router();
const { pool } = require("../db");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { parse } = require("csv-parse");
const { Parser: Json2csvParser } = require("json2csv");
const { authRequired } = require("../middleware/auth");

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) =>
    cb(null, `${Date.now()}_${file.originalname.replace(/\s+/g, "_")}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

/* -------------------------------------------------------
   IMPORTANT: include pass_type in the allowed field list
--------------------------------------------------------*/
const FIELDS = [
  "pass_req_no",
  "date_text",
  "satellite_name",
  "supporting_station",
  "band_carrier",
  "orbit_no",
  "max_el_deg",
  "aos_ut",
  "los_ut",
  "operations",
  "operations_requester",
  "operations_supporter",
  "pass_type",           // <--- NEW
  "schedule_status",
  "pass_status",
  "remarks",
  "added_by",
  "summary_text",        // <--- NEW For Workflow
  "is_locked",           // <--- NEW For Workflow
];

// Ensure columns exist (Auto-Migration)
pool.query("ALTER TABLE passes ADD COLUMN summary_text TEXT, ADD COLUMN is_locked TINYINT(1) DEFAULT 0").catch(() => { });


// helpers
const nowISO = () => new Date().toISOString();

function normalizeMulti(val) {
  if (!val) return "";
  return String(val)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");
}

/* ============================= CREATE ============================= */
// POST /api/passes
router.post("/", authRequired, async (req, res) => {
  try {
    const body = req.body || {};
    body.schedule_status ??= "Scheduled";
    body.pass_status ??= "Pending";
    body.pass_type ??= "Normal"; // <--- default if omitted

    const required = [
      "pass_req_no",
      "date_text",
      "satellite_name",
      "supporting_station",
      "orbit_no",
      "max_el_deg",
      "aos_ut",
      "los_ut",
    ];
    for (const k of required) {
      if (!body[k]) {
        try {
          req.audit?.log?.({
            action: "PASS_CREATE",
            targetType: "pass",
            targetId: null,
            statusCode: 400,
            metadata: { missing: k },
          });
        } catch { }
        return res.status(400).json({ error: `Missing field: ${k}` });
      }
    }

    const created_at = nowISO();
    const updated_at = created_at;

    const params = {
      ...Object.fromEntries(FIELDS.map((k) => [k, body[k] ?? null])),
      created_at,
      updated_at,
      is_deleted: "0",
    };

    const sql = `
  INSERT INTO passes
  (${FIELDS.join(", ")}, created_at, updated_at, is_deleted)
  VALUES
  (:pass_req_no, :date_text, :satellite_name, :supporting_station,
   :band_carrier,
   :orbit_no, :max_el_deg, :aos_ut, :los_ut,
   :operations, :operations_requester, :operations_supporter,
   :pass_type,
   :schedule_status, :pass_status, :remarks, :added_by,
   :created_at, :updated_at, :is_deleted)
`;


    const [result] = await pool.query(sql, params);
    const [rows] = await pool.query("SELECT * FROM passes WHERE id = ?", [
      result.insertId,
    ]);

    try {
      req.audit?.log?.({
        action: "PASS_CREATE",
        targetType: "pass",
        targetId: String(result.insertId),
        statusCode: 201,
        metadata: {
          pass_req_no: body.pass_req_no,
          satellite_name: body.satellite_name,
          pass_type: body.pass_type,
        },
      });
    } catch { }

    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") {
      try {
        req.audit?.log?.({
          action: "PASS_CREATE",
          targetType: "pass",
          targetId: null,
          statusCode: 409,
          metadata: { reason: "duplicate_pass_req_no" },
        });
      } catch { }
      return res.status(409).json({ error: "pass_req_no must be unique" });
    }
    console.error(e);
    try {
      req.audit?.log?.({
        action: "PASS_CREATE",
        targetType: "pass",
        targetId: null,
        statusCode: 500,
        metadata: { error: String(e?.message || e) },
      });
    } catch { }
    res.status(500).json({ error: "Failed to create pass" });
  }
});

/* =========================== BULK UPLOAD ========================== */
// POST /api/passes/bulk  (form-data: file=<csv>)
router.post("/bulk", authRequired, upload.single("file"), async (req, res) => {
  if (!req.file) {
    try {
      req.audit?.log?.({
        action: "PASS_BULK_UPLOAD",
        targetType: "pass",
        targetId: null,
        statusCode: 400,
        metadata: { reason: "no_file" },
      });
    } catch { }
    return res
      .status(400)
      .json({ error: "No file uploaded (field name: file)" });
  }

  const filePath = req.file.path;
  const fileName = path.basename(filePath);
  let total = 0,
    inserted = 0,
    updated = 0,
    skipped = 0;
  const errors = [];
  let headerChecked = false;

  // NOTE: pass_type is included in the insert columns, but NOT required
  const COLS = [
    "pass_req_no",
    "date_text",
    "satellite_name",
    "supporting_station",
    "band_carrier",
    "orbit_no",
    "max_el_deg",
    "aos_ut",
    "los_ut",
    "operations",
    "operations_requester",
    "operations_supporter",
    "pass_type", // <--- NEW in bulk
    "schedule_status",
    "pass_status",
    "remarks",
    "added_by",
    "created_at",
    "updated_at",
    "is_deleted",
  ];

  const REQUIRED_HEADERS = [
    "pass_req_no",
    "date_text",
    "satellite_name",
    "supporting_station",
    "orbit_no",
    "max_el_deg",
    "aos_ut",
    "los_ut",
  ]; // keep minimal; others optional

  const REQUIRED_VALUES = [
    "pass_req_no",
    "date_text",
    "satellite_name",
    "supporting_station",
    "orbit_no",
    "max_el_deg",
    "aos_ut",
    "los_ut",
  ];

  const normalizeOptional = (v) => {
    const s = (v ?? "").toString().trim();
    return s.length ? s : null;
  };

  function buildPlaceholders(nRows, nCols) {
    const one = `(${Array(nCols).fill("?").join(",")})`;
    return Array(nRows).fill(one).join(",");
  }

  async function upsertChunk(objs) {
    if (!objs.length) return { inserted: 0, updated: 0, tried: 0 };

    const rows = objs.map((o) => [
      o.pass_req_no,
      o.date_text,
      o.satellite_name,
      o.supporting_station,
      normalizeOptional(o.band_carrier),
      o.orbit_no,
      o.max_el_deg,
      o.aos_ut,
      o.los_ut,
      normalizeMulti(o.operations),
      normalizeMulti(o.operations_requester),
      normalizeMulti(o.operations_supporter),

      (o.pass_type || "Normal"), // <--- default for bulk
      o.schedule_status || "Scheduled",
      o.pass_status || "Pending",
      normalizeOptional(o.remarks),
      normalizeOptional(o.added_by),
      nowISO(),
      nowISO(),
      "0",
    ]);

    const placeholders = buildPlaceholders(rows.length, COLS.length);
    const flat = rows.flat();

    const updates = [
      "date_text=VALUES(date_text)",
      "satellite_name=VALUES(satellite_name)",
      "supporting_station=VALUES(supporting_station)",
      "orbit_no=VALUES(orbit_no)",
      "max_el_deg=VALUES(max_el_deg)",
      "aos_ut=VALUES(aos_ut)",
      "los_ut=VALUES(los_ut)",
      "operations=VALUES(operations)",
      "operations_requester=VALUES(operations_requester)",
      "operations_supporter=VALUES(operations_supporter)",
      "pass_type=VALUES(pass_type)", // <--- update on duplicate
      "schedule_status=VALUES(schedule_status)",
      "pass_status=VALUES(pass_status)",
      "remarks=VALUES(remarks)",
      "added_by=VALUES(added_by)",
      "updated_at=VALUES(updated_at)",
      "is_deleted='0'",
    ].join(", ");

    const sql = `
      INSERT INTO passes (${COLS.join(",")})
      VALUES ${placeholders}
      ON DUPLICATE KEY UPDATE ${updates};
    `;

    const [result] = await pool.query(sql, flat);
    const affected = result.affectedRows || 0;
    const tried = rows.length;
    const upd = Math.max(0, affected - tried);
    const ins = affected - 2 * upd;

    return { inserted: ins, updated: upd, tried };
  }

  try {
    const CHUNK_SIZE = 500;
    let buffer = [];

    const stream = fs.createReadStream(filePath);

    const parser = parse({
      bom: true,
      skip_empty_lines: true,
      trim: true,
      columns: (header) => {
        const lower = header.map((h) => String(h).trim().toLowerCase());
        const missing = REQUIRED_HEADERS.filter((h) => !lower.includes(h));
        if (missing.length) {
          throw new Error(`Missing required headers: ${missing.join(", ")}`);
        }
        headerChecked = true;
        return lower;
      },
      relax_column_count: true,
    });

    await new Promise((resolve, reject) => {
      parser.on("data", async (row) => {
        total++;
        const miss = REQUIRED_VALUES.filter((k) => {
          const v = row[k];
          return v === undefined || v === null || String(v).trim() === "";
        });
        if (miss.length) {
          skipped++;
          if (errors.length < 25)
            errors.push({ row: total, reason: `Missing: ${miss.join(", ")}` });
          return;
        }

        buffer.push(row);

        if (buffer.length >= CHUNK_SIZE) {
          parser.pause();
          try {
            const r = await upsertChunk(buffer);
            inserted += r.inserted;
            updated += r.updated;
            skipped += r.tried - (r.inserted + r.updated);
            buffer = [];
          } catch (e) {
            skipped += buffer.length;
            if (errors.length < 25)
              errors.push({ row: total, reason: e.message });
            buffer = [];
          } finally {
            parser.resume();
          }
        }
      });

      parser.on("end", async () => {
        try {
          if (!headerChecked) throw new Error("Invalid/missing header row");
          if (buffer.length) {
            const r = await upsertChunk(buffer);
            inserted += r.inserted;
            updated += r.updated;
            skipped += r.tried - (r.inserted + r.updated);
          }
          resolve();
        } catch (e) {
          reject(e);
        }
      });

      parser.on("error", reject);

      stream.pipe(parser);
    });

    try {
      req.audit?.log?.({
        action: "PASS_BULK_UPLOAD",
        targetType: "pass",
        targetId: null,
        statusCode: 200,
        metadata: {
          file: fileName,
          total_rows: total,
          inserted_rows: inserted,
          updated_rows: updated,
          skipped_rows: skipped,
          errors_preview: errors.slice(0, 5),
        },
      });
    } catch { }

    res.json({
      ok: true,
      file: fileName,
      total_rows: total,
      inserted_rows: inserted,
      updated_rows: updated,
      skipped_rows: skipped,
      errors_preview: errors,
      note:
        "Remarks/pass_type are optional; skipped includes validation failures on required fields.",
    });
  } catch (e) {
    console.error(e);
    try {
      req.audit?.log?.({
        action: "PASS_BULK_UPLOAD",
        targetType: "pass",
        targetId: null,
        statusCode: 400,
        metadata: { file: fileName, error: String(e?.message || e) },
      });
    } catch { }
    res.status(400).json({ error: e.message || "Bulk upload failed" });
  } finally {
    try {
      fs.unlinkSync(filePath);
    } catch { }
  }
});

/* ============================== EXPORTS ============================== */
// GET /api/passes/export  -> CSV download
router.get("/export", authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM passes WHERE is_deleted='0' ORDER BY id DESC"
    );

    // include pass_type in export
    const fields = [
      "pass_req_no",
      "date_text",
      "satellite_name",
      "supporting_station",
      "orbit_no",
      "max_el_deg",
      "aos_ut",
      "los_ut",
      "operations",
      "operations_requester",
      "operations_supporter",
      "pass_type",          // <--- NEW
      "schedule_status",
      "pass_status",
      "remarks",
      "added_by",
      "created_at",
      "updated_at",
    ];
    const parser = new Json2csvParser({ fields });
    const csv = parser.parse(rows);

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="passes_export_${ts}.csv"`
    );

    try {
      req.audit?.log?.({
        action: "PASS_EXPORT",
        targetType: "pass",
        targetId: null,
        statusCode: 200,
        metadata: { count: rows.length },
      });
    } catch { }

    res.send(csv);
  } catch (e) {
    console.error(e);
    try {
      req.audit?.log?.({
        action: "PASS_EXPORT",
        targetType: "pass",
        targetId: null,
        statusCode: 500,
        metadata: { error: String(e?.message || e) },
      });
    } catch { }
    res.status(500).json({ error: "Export failed" });
  }
});

// GET /api/passes/export-range?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get("/export-range", authRequired, async (req, res) => {
  try {
    const { from, to } = req.query || {};
    if (!from || !to) {
      try {
        req.audit?.log?.({
          action: "PASS_EXPORT_RANGE",
          targetType: "pass",
          targetId: null,
          statusCode: 400,
          metadata: { reason: "missing_from_to" },
        });
      } catch { }
      return res
        .status(400)
        .json({ error: "Query params 'from' and 'to' (YYYY-MM-DD) are required" });
    }

    const fromDate = new Date(String(from));
    const toDate = new Date(String(to));
    if (isNaN(+fromDate) || isNaN(+toDate)) {
      try {
        req.audit?.log?.({
          action: "PASS_EXPORT_RANGE",
          targetType: "pass",
          targetId: null,
          statusCode: 400,
          metadata: { reason: "invalid_from_to" },
        });
      } catch { }
      return res
        .status(400)
        .json({ error: "Invalid 'from' or 'to' date. Use YYYY-MM-DD." });
    }

    const fromYMD = fromDate.toISOString().slice(0, 10);
    const toYMD = toDate.toISOString().slice(0, 10);

    const [rows] = await pool.query(
      `
      SELECT *
      FROM passes
      WHERE is_deleted='0'
        AND COALESCE(
              STR_TO_DATE(date_text, '%d-%m-%Y'),
              STR_TO_DATE(date_text, '%Y-%m-%d'),
              STR_TO_DATE(date_text, '%d/%m/%Y'),
              STR_TO_DATE(date_text, '%m/%d/%Y')
            ) BETWEEN ? AND ?
      ORDER BY id DESC
      `,
      [fromYMD, toYMD]
    );

    // include pass_type in export
    const fields = [
      "pass_req_no",
      "date_text",
      "satellite_name",
      "supporting_station",
      "orbit_no",
      "max_el_deg",
      "aos_ut",
      "los_ut",
      "operations",
      "operations_requester",
      "operations_supporter",
      "pass_type",          // <--- NEW
      "schedule_status",
      "pass_status",
      "remarks",
      "added_by",
      "created_at",
      "updated_at",
    ];
    const parser = new Json2csvParser({ fields });
    const csv = parser.parse(rows);

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="passes_export_${fromYMD}_to_${toYMD}_${ts}.csv"`
    );

    try {
      req.audit?.log?.({
        action: "PASS_EXPORT_RANGE",
        targetType: "pass",
        targetId: null,
        statusCode: 200,
        metadata: { from: fromYMD, to: toYMD, count: rows.length },
      });
    } catch { }

    res.send(csv);
  } catch (e) {
    console.error(e);
    try {
      req.audit?.log?.({
        action: "PASS_EXPORT_RANGE",
        targetType: "pass",
        targetId: null,
        statusCode: 500,
        metadata: { error: String(e?.message || e) },
      });
    } catch { }
    res.status(500).json({ error: "Export (range) failed" });
  }
});

/* =============================== STATS ============================== */
router.get("/stats", authRequired, async (req, res) => {
  try {
    const { date, from, to } = req.query || {};

    const toYMD = (d) => {
      const dt = new Date(String(d));
      if (isNaN(+dt)) return null;
      return dt.toISOString().slice(0, 10);
    };

    let fromYMD, toYMDv;
    if (date) {
      const ymd = toYMD(date);
      if (!ymd) {
        try {
          req.audit?.log?.({
            action: "PASS_STATS",
            targetType: "pass",
            targetId: null,
            statusCode: 400,
            metadata: { reason: "invalid_date" },
          });
        } catch { }
        return res.status(400).json({ error: "Invalid ?date (YYYY-MM-DD)" });
      }
      fromYMD = ymd;
      toYMDv = ymd;
    } else if (from && to) {
      fromYMD = toYMD(from);
      toYMDv = toYMD(to);
      if (!fromYMD || !toYMDv) {
        try {
          req.audit?.log?.({
            action: "PASS_STATS",
            targetType: "pass",
            targetId: null,
            statusCode: 400,
            metadata: { reason: "invalid_from_to" },
          });
        } catch { }
        return res.status(400).json({ error: "Invalid ?from or ?to (YYYY-MM-DD)" });
      }
    } else {
      const today = new Date();
      const y = today.getFullYear();
      const m = String(today.getMonth() + 1).padStart(2, "0");
      const d = String(today.getDate()).padStart(2, "0");
      fromYMD = `${y}-${m}-${d}`;
      toYMDv = fromYMD;
    }

    // Prefer MM/DD/YYYY or MM-DD-YYYY first; then other formats
    const sql = `
      SELECT COALESCE(pass_status, 'Unknown') AS status, COUNT(*) AS count
      FROM passes
      WHERE is_deleted = '0'
        AND DATE(COALESCE(
              STR_TO_DATE(TRIM(date_text), '%m/%d/%Y'),
              STR_TO_DATE(TRIM(date_text), '%m-%d-%Y'),
              STR_TO_DATE(TRIM(date_text), '%Y-%m-%d'),
              STR_TO_DATE(TRIM(date_text), '%d/%m/%Y'),
              STR_TO_DATE(TRIM(date_text), '%d-%m-%Y')
            )) BETWEEN ? AND ?
      GROUP BY COALESCE(pass_status, 'Unknown')
    `;

    const [rows] = await pool.query(sql, [fromYMD, toYMDv]);

    const BASE = { Completed: 0, Pending: 0, Failed: 0, Canceled: 0, Other: 0 };
    for (const r of rows) {
      const key = ["Completed", "Pending", "Failed", "Canceled"].includes(
        r.status
      )
        ? r.status
        : "Other";
      BASE[key] += Number(r.count) || 0;
    }
    const total = Object.values(BASE).reduce((a, b) => a + b, 0);

    try {
      req.audit?.log?.({
        action: "PASS_STATS",
        targetType: "pass",
        targetId: null,
        statusCode: 200,
        metadata: { from: fromYMD, to: toYMDv, total },
      });
    } catch { }

    res.json({
      ok: true,
      range: { from: fromYMD, to: toYMDv },
      total,
      by_status: BASE,
      breakdown: Object.entries(BASE).map(([status, count]) => ({
        status,
        count,
      })),
    });
  } catch (e) {
    console.error(e);
    try {
      req.audit?.log?.({
        action: "PASS_STATS",
        targetType: "pass",
        targetId: null,
        statusCode: 500,
        metadata: { error: String(e?.message || e) },
      });
    } catch { }
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

/* ================================ LIST =============================== */
router.get("/", authRequired, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM passes WHERE is_deleted='0' ORDER BY id DESC"
    );



    res.json(rows);
  } catch (e) {
    console.error(e);
    try {
      _req.audit?.log?.({
        action: "PASS_LIST",
        targetType: "pass",
        targetId: null,
        statusCode: 500,
        metadata: { error: String(e?.message || e) },
      });
    } catch { }
    res.status(500).json({ error: "Failed to fetch passes" });
  }
});

/* =============================== READ =============================== */
router.get("/:id", authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM passes WHERE id=? AND is_deleted='0'",
      [req.params.id]
    );
    if (!rows.length) {
      try {
        req.audit?.log?.({
          action: "PASS_GET",
          targetType: "pass",
          targetId: req.params.id,
          statusCode: 404,
        });
      } catch { }
      return res.status(404).json({ error: "Not found" });
    }

    try {
      req.audit?.log?.({
        action: "PASS_GET",
        targetType: "pass",
        targetId: req.params.id,
        statusCode: 200,
      });
    } catch { }

    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    try {
      req.audit?.log?.({
        action: "PASS_GET",
        targetType: "pass",
        targetId: req.params.id,
        statusCode: 500,
        metadata: { error: String(e?.message || e) },
      });
    } catch { }
    res.status(500).json({ error: "Failed to fetch pass" });
  }
});

/* ============================== UPDATE ============================== */
router.put("/:id", authRequired, async (req, res) => {
  try {
    const [existing] = await pool.query("SELECT * FROM passes WHERE id = ? AND is_deleted = '0'", [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: "Not found" });
    if (existing[0].is_locked) return res.status(403).json({ error: "Pass is locked. No changes allowed." });

    const body = req.body || {};
    const fieldsToUpdate = FIELDS.filter((k) => body[k] !== undefined);
    if (!fieldsToUpdate.length) {
      try {
        req.audit?.log?.({
          action: "PASS_UPDATE",
          targetType: "pass",
          targetId: req.params.id,
          statusCode: 400,
          metadata: { reason: "no_fields" },
        });
      } catch { }
      return res.status(400).json({ error: "No fields to update" });
    }

    const setClause = fieldsToUpdate.map((k) => `${k} = :${k}`).join(", ");
    const sql = `
      UPDATE passes
      SET ${setClause}, updated_at = :updated_at
      WHERE id = :id AND is_deleted='0'
    `;

    const params = { id: req.params.id, updated_at: nowISO() };
    for (const k of fieldsToUpdate) params[k] = body[k];

    const [result] = await pool.query(sql, params);
    if (result.affectedRows === 0) {
      try {
        req.audit?.log?.({
          action: "PASS_UPDATE",
          targetType: "pass",
          targetId: req.params.id,
          statusCode: 404,
        });
      } catch { }
      return res.status(404).json({ error: "Not found" });
    }

    const [rows] = await pool.query("SELECT * FROM passes WHERE id = ?", [
      req.params.id,
    ]);

    try {
      req.audit?.log?.({
        action: "PASS_UPDATE",
        targetType: "pass",
        targetId: req.params.id,
        statusCode: 200,
        metadata: { oldValue: existing[0], newValue: rows[0] },
      });
    } catch { }

    res.json(rows[0]);
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") {
      try {
        req.audit?.log?.({
          action: "PASS_UPDATE",
          targetType: "pass",
          targetId: req.params.id,
          statusCode: 409,
          metadata: { reason: "duplicate_pass_req_no" },
        });
      } catch { }
      return res.status(409).json({ error: "pass_req_no must be unique" });
    }
    console.error(e);
    try {
      req.audit?.log?.({
        action: "PASS_UPDATE",
        targetType: "pass",
        targetId: req.params.id,
        statusCode: 500,
        metadata: { error: String(e?.message || e) },
      });
    } catch { }
    res.status(500).json({ error: "Failed to update pass" });
  }
});

/* ============================== DELETE ============================== */
router.delete("/:id", authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.query("DELETE FROM passes WHERE id = ?", [id]);
    if (result.affectedRows === 0) {
      try {
        req.audit?.log?.({
          action: "PASS_DELETE",
          targetType: "pass",
          targetId: id,
          statusCode: 404,
        });
      } catch { }
      return res.status(404).json({ error: "Pass not found" });
    }

    try {
      req.audit?.log?.({
        action: "PASS_DELETE",
        targetType: "pass",
        targetId: id,
        statusCode: 200,
      });
    } catch { }

    return res.json({ ok: true, deleted: result.affectedRows });
  } catch (err) {
    console.error(err);
    try {
      req.audit?.log?.({
        action: "PASS_DELETE",
        targetType: "pass",
        targetId: req.params.id,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch { }
    return res.status(500).json({ error: "Failed to delete pass" });
  }
});

// DELETE ALL: DELETE /api/passes?confirm=ALL
router.delete("/", authRequired, async (req, res) => {
  try {
    const { confirm } = req.query || {};
    if (confirm !== "ALL") {
      try {
        req.audit?.log?.({
          action: "PASS_DELETE_ALL",
          targetType: "pass",
          targetId: null,
          statusCode: 400,
          metadata: { reason: "missing_confirm_ALL" },
        });
      } catch { }
      return res
        .status(400)
        .json({ error: "Add ?confirm=ALL to delete all passes." });
    }
    const [result] = await pool.query("DELETE FROM passes");

    try {
      req.audit?.log?.({
        action: "PASS_DELETE_ALL",
        targetType: "pass",
        targetId: null,
        statusCode: 200,
        metadata: { deleted: result.affectedRows ?? 0 },
      });
    } catch { }

    return res.json({ ok: true, deleted: result.affectedRows ?? 0 });
  } catch (err) {
    console.error(err);
    try {
      req.audit?.log?.({
        action: "PASS_DELETE_ALL",
        targetType: "pass",
        targetId: null,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch { }
    return res.status(500).json({ error: "Failed to delete all passes" });
  }
});

module.exports = router;
