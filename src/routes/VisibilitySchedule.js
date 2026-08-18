// src/routes/VisibilitySchedule.js
const express = require("express");
const router = express.Router();
const { pool } = require("../db");
const { authRequired } = require("../middleware/auth");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) =>
        cb(null, `${Date.now()}_${file.originalname.replace(/\s+/g, "_")}`),
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

const nowSQL = () => new Date().toISOString().slice(0, 19).replace("T", " ");

/* ---- Ops that trigger "pass_requested" automatically ---- */
const PASS_OPS = ["TM", "TC", "TR", "PB"];
function opsRequirePass(operations) {
    if (!operations) return false;
    const upper = operations.toUpperCase();
    return PASS_OPS.some((op) => upper.split(/[\s,/]+/).includes(op));
}

/* ---- Ensure main table exists ---- */
async function ensureTable() {
    const sql = `
    CREATE TABLE IF NOT EXISTS visibility_schedule (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      date_text        VARCHAR(20)   NOT NULL,
      sc               VARCHAR(20)   NOT NULL,
      stn              VARCHAR(20)   NOT NULL,
      orbit            VARCHAR(20),
      max_ele          VARCHAR(20),
      aos              VARCHAR(20),
      los              VARCHAR(20),
      operations       TEXT,
      pass_status      VARCHAR(30)   NOT NULL DEFAULT 'idle',
      post_pass_status VARCHAR(20)   NOT NULL DEFAULT 'Pending',
      created_at       DATETIME      NOT NULL,
      updated_at       DATETIME      NOT NULL,
      is_deleted       TINYINT(1)    NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
    await pool.query(sql);

    /* Migrate: add post_pass_status if it does not exist yet */
    try {
        await pool.query(`
      ALTER TABLE visibility_schedule
        ADD COLUMN post_pass_status VARCHAR(20) NOT NULL DEFAULT 'Pending'
        AFTER pass_status
    `);
    } catch (e) {
        if (e?.code !== "ER_DUP_FIELDNAME") throw e;
    }
}

/* ---- Ensure DRAFT table exists (no post_pass_status) ---- */
async function ensureDraftTable() {
    const sql = `
    CREATE TABLE IF NOT EXISTS visibility_schedule_draft (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      date_text        VARCHAR(20)   NOT NULL,
      sc               VARCHAR(20)   NOT NULL,
      stn              VARCHAR(20)   NOT NULL,
      orbit            VARCHAR(20),
      max_ele          VARCHAR(20),
      aos              VARCHAR(20),
      los              VARCHAR(20),
      operations       TEXT,
      pass_status      VARCHAR(30)   NOT NULL DEFAULT 'idle',
      created_at       DATETIME      NOT NULL,
      updated_at       DATETIME      NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
    await pool.query(sql);
}

ensureTable().catch((e) =>
    console.error("[VisibilitySchedule] table init failed:", e?.message || e)
);
ensureDraftTable().catch((e) =>
    console.error("[VisibilitySchedule] draft table init failed:", e?.message || e)
);

/* ---- Parse .ant text rows ---- */
function parseAntText(text) {
    const rows = [];
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trimStart();
        if (!/^\d{4}\s+\d{2}\s+\d{2}/.test(trimmed)) continue;
        const parts = trimmed.split(/\s+/);
        if (parts.length < 9) continue;
        rows.push({
            date_text: `${parts[0]}-${parts[1]}-${parts[2]}`,
            sc: parts[3],
            stn: parts[4],
            orbit: parts[5],
            max_ele: parts[6],
            aos: parts[7],
            los: parts[8],
            operations: parts.slice(9).join(" "),
        });
    }
    return rows;
}

/* ---- helpers for validation ---- */
async function getSatelliteMappings() {
    const [rows] = await pool.query("SELECT satellite_id, satellite_name FROM satellites");
    const idMap = new Map();
    const nameSet = new Set();
    for (const r of rows) {
        const id = (r.satellite_id || "").trim().toUpperCase();
        const name = (r.satellite_name || "").trim().toUpperCase();
        if (id && name) idMap.set(id, name);
        if (name) nameSet.add(name);
    }
    return { idMap, nameSet };
}

async function getStationMappings() {
    const idMap = new Map();
    const nameSet = new Set();
    try {
        const [rows] = await pool.query("SELECT ground_station FROM ground_stations");
        for (const r of rows) {
            const stn = (r.ground_station || "").trim().toUpperCase();
            if (stn) nameSet.add(stn);
        }
    } catch { }

    try {
        const [rows] = await pool.query("SELECT antenna_type, location FROM antennas");
        for (const r of rows) {
            const typeKey = (r.antenna_type || "").trim().toUpperCase();
            const locKey = (r.location || "").trim().toUpperCase();
            if (typeKey && locKey) idMap.set(typeKey, locKey);
            if (locKey) nameSet.add(locKey);
            if (typeKey) nameSet.add(typeKey);
        }
    } catch { }

    return { idMap, nameSet };
}

async function getValidLicensePairs() {
    const today = new Date().toISOString().slice(0, 10);
    const [rows] = await pool.query(
        `SELECT satellite_name, station_name FROM licenses
         WHERE (status = 'Approved' OR status = 'No License Required')
           AND (validity_expiry = '' OR validity_expiry IS NULL OR STR_TO_DATE(validity_expiry, '%m/%d/%Y') >= ?)`
        , [today]
    );
    const set = new Set();
    for (const r of rows) {
        const sats = (r.satellite_name || "").split(/[,;]+/).map((s) => s.trim().toUpperCase());
        const stns = (r.station_name || "").split(/[,;]+/).map((s) => s.trim().toUpperCase());
        for (const sat of sats) {
            for (const stn of stns) {
                if (sat && stn) set.add(`${sat}||${stn}`);
            }
        }
    }
    return set;
}

/* ========== BULK UPLOAD → DRAFT TABLE ========== */
router.post("/bulk", authRequired, upload.single("file"), async (req, res) => {
    if (!req.file)
        return res.status(400).json({ error: "No file uploaded (field name: file)" });

    const filePath = req.file.path;
    try {
        const text = fs.readFileSync(filePath, "utf8");
        const rows = parseAntText(text);
        if (!rows.length)
            return res.status(400).json({ error: "No valid data rows found in the file." });

        /* --- Dynamic validation --- */
        const satMaps = await getSatelliteMappings();
        const stnMaps = await getStationMappings();
        const validLicenses = await getValidLicensePairs();

        const unknownSats = new Set();
        const unknownStns = new Set();
        const invalidLicenses = new Set();

        for (const r of rows) {
            const scKey = (r.sc || "").trim().toUpperCase();
            const stnKey = (r.stn || "").trim().toUpperCase();

            let realSat = null;
            if (satMaps.idMap.has(scKey)) realSat = satMaps.idMap.get(scKey);
            else if (satMaps.nameSet.has(scKey)) realSat = scKey;

            let realStn = null;
            if (stnMaps.idMap.has(stnKey)) realStn = stnMaps.idMap.get(stnKey);
            else if (stnMaps.nameSet.has(stnKey)) realStn = stnKey;

            if (!realSat) unknownSats.add(r.sc);
            if (!realStn) unknownStns.add(r.stn);
            if (realSat && realStn) {
                if (!validLicenses.has(`${realSat}||${realStn}`)) {
                    invalidLicenses.add(`${r.sc} / ${r.stn}`);
                }
            }
        }

        const errs = [];
        if (unknownSats.size)
            errs.push(`Unknown S/C in database: ${[...unknownSats].join(", ")}`);
        if (unknownStns.size)
            errs.push(`Unknown Station in database: ${[...unknownStns].join(", ")}`);
        if (invalidLicenses.size)
            errs.push(`No valid license for: ${[...invalidLicenses].join("; ")}`);

        if (errs.length)
            return res.status(422).json({ error: errs.join(" | "), validation: errs });

        /* --- Clear old drafts, then insert new ones --- */
        await pool.query("DELETE FROM visibility_schedule_draft");

        const CHUNK = 500;
        let inserted = 0;
        for (let i = 0; i < rows.length; i += CHUNK) {
            const chunk = rows.slice(i, i + CHUNK);
            const placeholders = chunk.map(() => "(?,?,?,?,?,?,?,?,?,?,?)").join(",");
            const flat = chunk.flatMap((r) => {
                const status = opsRequirePass(r.operations) ? "pass_requested" : "idle";
                return [
                    r.date_text, r.sc, r.stn, r.orbit, r.max_ele,
                    r.aos, r.los, r.operations, status, nowSQL(), nowSQL()
                ];
            });
            const sql = `
        INSERT INTO visibility_schedule_draft
          (date_text, sc, stn, orbit, max_ele, aos, los, operations,
           pass_status, created_at, updated_at)
        VALUES ${placeholders}
      `;
            const [result] = await pool.query(sql, flat);
            inserted += result.affectedRows;
        }
        try {
            req.audit?.log?.({ action: "VISIBILITY_DRAFT_UPLOAD", targetType: "visibility_schedule_draft", statusCode: 200, metadata: { total: rows.length, inserted } });
        } catch { }

        res.json({ ok: true, inserted, total: rows.length });
    } catch (e) {
        console.error("[VS draft bulk]", e);
        res.status(500).json({ error: e.message || "Bulk upload to draft failed" });
    } finally {
        try { fs.unlinkSync(filePath); } catch { }
    }
});

/* ========== GET DRAFT ROWS ========== */
router.get("/draft", authRequired, async (_req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT * FROM visibility_schedule_draft ORDER BY id ASC"
        );
        res.json(rows);
    } catch (e) {
        console.error("[VS draft list]", e);
        res.status(500).json({ error: "Failed to fetch draft rows" });
    }
});

/* ========== DELETE DRAFT ROWS ========== */
router.delete("/draft", authRequired, async (req, res) => {
    try {
        const { ids } = req.body || {};
        if (Array.isArray(ids) && ids.length > 0) {
            const [rowsToDelete] = await pool.query(`SELECT * FROM visibility_schedule_draft WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
            const placeholders = ids.map(() => "?").join(",");
            await pool.query(`DELETE FROM visibility_schedule_draft WHERE id IN (${placeholders})`, ids);
            
            try {
                req.audit?.log?.({ 
                    action: "VISIBILITY_DRAFT_DELETE", 
                    targetType: "visibility_schedule_draft", 
                    statusCode: 200, 
                    metadata: { 
                        deletedIds: ids,
                        oldValue: rowsToDelete.length === 1 ? rowsToDelete[0] : rowsToDelete,
                        targetLabel: rowsToDelete.length === 1 ? `${rowsToDelete[0].sc} - ${rowsToDelete[0].stn}` : `${rowsToDelete.length} rows`
                    } 
                });
            } catch { }

            res.json({ ok: true, deleted: ids.length });
        } else {
            // Delete all
            const [rowsToDelete] = await pool.query("SELECT * FROM visibility_schedule_draft");
            const [result] = await pool.query("DELETE FROM visibility_schedule_draft");
            
            try {
                req.audit?.log?.({ 
                    action: "VISIBILITY_DRAFT_CLEAR", 
                    targetType: "visibility_schedule_draft", 
                    statusCode: 200, 
                    metadata: { 
                        count: result.affectedRows,
                        oldValue: rowsToDelete,
                        targetLabel: "All Draft Rows"
                    } 
                });
            } catch { }

            res.json({ ok: true, deleted: result.affectedRows });
        }
    } catch (e) {
        console.error("[VS draft delete]", e);
        res.status(500).json({ error: "Failed to delete draft rows" });
    }
});

/* ========== PATCH DRAFT ROW ========== */
router.patch("/draft/:id", authRequired, async (req, res) => {
    const { id } = req.params;
    const { pass_status, operations } = req.body || {};

    if (pass_status === undefined && operations === undefined)
        return res.status(400).json({ error: "No fields to update" });

    try {
        const [[oldRow]] = await pool.query("SELECT * FROM visibility_schedule_draft WHERE id=?", [id]);
        if (!oldRow) return res.status(404).json({ error: "Draft row not found" });

        const sets = [];
        const vals = [];

        if (pass_status !== undefined) { sets.push("pass_status=?"); vals.push(pass_status); }
        if (operations !== undefined) { sets.push("operations=?"); vals.push(operations); }
        sets.push("updated_at=?"); vals.push(nowSQL());
        vals.push(id);

        await pool.query(
            `UPDATE visibility_schedule_draft SET ${sets.join(",")} WHERE id=?`,
            vals
        );
        const [[row]] = await pool.query("SELECT * FROM visibility_schedule_draft WHERE id=?", [id]);
        
        try {
            const action = pass_status ? `VISIBILITY_DRAFT_${pass_status.toUpperCase()}` : "VISIBILITY_DRAFT_UPDATE";
            req.audit?.log?.({ 
                action, 
                targetType: "visibility_schedule_draft", 
                targetId: id, 
                statusCode: 200, 
                metadata: { 
                    oldValue: oldRow, 
                    newValue: row,
                    targetLabel: `${row.sc} - ${row.stn} (${row.date_text})`
                } 
            });
        } catch { }

        res.json(row);
    } catch (e) {
        console.error("[VS draft patch]", e);
        res.status(500).json({ error: "Failed to update draft row" });
    }
});

/* ========== PUT DRAFT ROW (full edit) ========== */
router.put("/draft/:id", authRequired, async (req, res) => {
    const { id } = req.params;
    const { date_text, sc, stn, orbit, max_ele, aos, los, operations } = req.body || {};
    try {
        const [[oldRow]] = await pool.query("SELECT * FROM visibility_schedule_draft WHERE id=?", [id]);
        if (!oldRow) return res.status(404).json({ error: "Draft row not found" });

        await pool.query(
            `UPDATE visibility_schedule_draft SET date_text=?, sc=?, stn=?, orbit=?, max_ele=?,
             aos=?, los=?, operations=?, updated_at=? WHERE id=?`,
            [date_text, sc, stn, orbit, max_ele, aos, los, operations, nowSQL(), id]
        );
        const [[row]] = await pool.query("SELECT * FROM visibility_schedule_draft WHERE id=?", [id]);
        
        try {
            req.audit?.log?.({ 
                action: "VISIBILITY_DRAFT_EDIT", 
                targetType: "visibility_schedule_draft", 
                targetId: id, 
                statusCode: 200, 
                metadata: { 
                    oldValue: oldRow, 
                    newValue: row,
                    targetLabel: `${row.sc} - ${row.stn}`
                } 
            });
        } catch { }

        res.json(row);
    } catch (e) {
        console.error("[VS draft put]", e);
        res.status(500).json({ error: "Failed to update draft row" });
    }
});

/* ========== PUBLISH DRAFT → visibility_schedule ========== */
router.post("/draft/publish", authRequired, async (req, res) => {
    try {
        const [draftRows] = await pool.query("SELECT * FROM visibility_schedule_draft ORDER BY id ASC");
        if (!draftRows.length) {
            return res.status(400).json({ error: "No draft rows to publish" });
        }

        let upserted = 0;
        for (const r of draftRows) {
            // Check if a row with same sc+stn+orbit already exists
            const [[existing]] = await pool.query(
                "SELECT id FROM visibility_schedule WHERE sc=? AND stn=? AND orbit=? AND is_deleted=0",
                [r.sc, r.stn, r.orbit]
            );

            if (existing) {
                // Update existing row (keep post_pass_status intact, but sync pass_status from draft)
                await pool.query(
                    `UPDATE visibility_schedule
                     SET date_text=?, max_ele=?, aos=?, los=?, operations=?, pass_status=?, updated_at=?
                     WHERE id=? AND is_deleted=0`,
                    [r.date_text, r.max_ele, r.aos, r.los, r.operations, r.pass_status || 'idle', nowSQL(), existing.id]
                );
            } else {
                // Insert new row
                const status = opsRequirePass(r.operations) ? "pass_requested" : "idle";
                await pool.query(
                    `INSERT INTO visibility_schedule
                       (date_text, sc, stn, orbit, max_ele, aos, los, operations,
                        pass_status, post_pass_status, created_at, updated_at, is_deleted)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)`,
                    [r.date_text, r.sc, r.stn, r.orbit, r.max_ele, r.aos, r.los,
                    r.operations, status, "Pending", nowSQL(), nowSQL()]
                );
            }
            upserted++;
        }

        // Clear all draft rows after publish
        await pool.query("DELETE FROM visibility_schedule_draft");

        try {
            req.audit?.log?.({ action: "VISIBILITY_DRAFT_PUBLISHED", targetType: "visibility_schedule", statusCode: 200, metadata: { upserted } });
        } catch { }

        res.json({ ok: true, upserted });
    } catch (e) {
        console.error("[VS draft publish]", e);
        res.status(500).json({ error: e.message || "Publish failed" });
    }
});

/* ========== LIST all rows (main table) ========== */
router.get("/", authRequired, async (_req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT * FROM visibility_schedule WHERE is_deleted=0 ORDER BY id ASC"
        );
        res.json(rows);
    } catch (e) {
        console.error("[VS list]", e);
        res.status(500).json({ error: "Failed to fetch visibility schedule" });
    }
});

/* ========== DELETE single or multiple rows (main table) ========== */
router.delete("/", authRequired, async (req, res) => {
    try {
        const { ids } = req.body || {};
        if (Array.isArray(ids) && ids.length > 0) {
            const placeholders = ids.map(() => "?").join(",");
            await pool.query(
                `UPDATE visibility_schedule SET is_deleted=1, updated_at=? WHERE id IN (${placeholders})`,
                [nowSQL(), ...ids]
            );

            try {
                req.audit?.log?.({ action: "VISIBILITY_SCHEDULE_BULK_DELETE", targetType: "visibility_schedule", statusCode: 200, metadata: { deletedIds: ids } });
            } catch { }

            res.json({ ok: true, deleted: ids.length });
        } else {
            res.status(400).json({ error: "No ids provided" });
        }
    } catch (e) {
        console.error("[VS delete]", e);
        res.status(500).json({ error: "Failed to delete rows" });
    }
});

/* ========== PATCH pass_status / post_pass_status / operations ========== */
const ALLOWED_PASS_STATUSES = ["idle", "requested", "no_support", "pass_requested", "pass_cancelled", "supported"];

router.patch("/:id", authRequired, async (req, res) => {
    const { id } = req.params;
    const { pass_status, post_pass_status, operations } = req.body || {};

    if (pass_status === undefined && post_pass_status === undefined && operations === undefined)
        return res.status(400).json({ error: "No fields to update" });

    if (pass_status !== undefined && !ALLOWED_PASS_STATUSES.includes(pass_status))
        return res.status(400).json({ error: `pass_status must be one of: ${ALLOWED_PASS_STATUSES.join(", ")}` });

    if (post_pass_status !== undefined && !["Pending", "Completed"].includes(post_pass_status))
        return res.status(400).json({ error: "post_pass_status must be 'Pending' or 'Completed'" });

    try {
        const [[oldRow]] = await pool.query("SELECT * FROM visibility_schedule WHERE id=? AND is_deleted=0", [id]);
        if (!oldRow) return res.status(404).json({ error: "Row not found" });

        const sets = [];
        const vals = [];

        if (pass_status !== undefined) { sets.push("pass_status=?"); vals.push(pass_status); }
        if (post_pass_status !== undefined) { sets.push("post_pass_status=?"); vals.push(post_pass_status); }
        if (operations !== undefined) { sets.push("operations=?"); vals.push(operations); }
        sets.push("updated_at=?"); vals.push(nowSQL());
        vals.push(id);

        await pool.query(
            `UPDATE visibility_schedule SET ${sets.join(",")} WHERE id=? AND is_deleted=0`,
            vals
        );
        const [[row]] = await pool.query("SELECT * FROM visibility_schedule WHERE id=?", [id]);

        try {
            let action = "VISIBILITY_SCHEDULE_UPDATE";
            if (pass_status) {
                action = `VISIBILITY_SCHEDULE_${pass_status.toUpperCase()}`;
            } else if (post_pass_status) {
                action = `VISIBILITY_SCHEDULE_POST_PASS_${post_pass_status.toUpperCase()}`;
            }

            req.audit?.log?.({ 
                action, 
                targetType: "visibility_schedule", 
                targetId: id, 
                statusCode: 200, 
                metadata: { 
                    oldValue: oldRow, 
                    newValue: row,
                    targetLabel: `${row.sc} - ${row.stn} (${row.date_text})`
                } 
            });
        } catch { }

        res.json(row);
    } catch (e) {
        console.error("[VS patch]", e);
        res.status(500).json({ error: "Failed to update row" });
    }
});

/* ========== PUT Update single row ========== */
router.put("/:id", authRequired, async (req, res) => {
    const { id } = req.params;
    const { date_text, sc, stn, orbit, max_ele, aos, los, operations } = req.body || {};
    try {
        const [[oldRow]] = await pool.query("SELECT * FROM visibility_schedule WHERE id=? AND is_deleted=0", [id]);
        if (!oldRow) return res.status(404).json({ error: "Row not found" });

        await pool.query(
            `UPDATE visibility_schedule SET date_text=?, sc=?, stn=?, orbit=?, max_ele=?,
       aos=?, los=?, operations=?, updated_at=? WHERE id=? AND is_deleted=0`,
            [date_text, sc, stn, orbit, max_ele, aos, los, operations, nowSQL(), id]
        );
        const [[row]] = await pool.query("SELECT * FROM visibility_schedule WHERE id=?", [id]);
        try {
            req.audit?.log?.({ 
                action: "VISIBILITY_SCHEDULE_EDIT", 
                targetType: "visibility_schedule", 
                targetId: id, 
                statusCode: 200, 
                metadata: { 
                    oldValue: oldRow, 
                    newValue: row,
                    targetLabel: `${row.sc} - ${row.stn}`
                } 
            });
        } catch { }
        res.json(row);
    } catch (e) {
        console.error("[VS put]", e);
        res.status(500).json({ error: "Failed to update row" });
    }
});

/* ========== POST Support (Move to passes) ========== */
router.post("/:id/support", authRequired, async (req, res) => {
    const { id } = req.params;
    try {
        const [[row]] = await pool.query("SELECT * FROM visibility_schedule WHERE id=? AND is_deleted=0", [id]);
        if (!row) return res.status(404).json({ error: "Row not found" });
        if (row.pass_status === "supported") return res.status(400).json({ error: "Already supported" });

        await pool.query(
            "UPDATE visibility_schedule SET pass_status='supported', updated_at=? WHERE id=?",
            [nowSQL(), id]
        );

        const [[newRow]] = await pool.query("SELECT * FROM visibility_schedule WHERE id=?", [id]);

        try {
            req.audit?.log?.({ 
                action: "VISIBILITY_SCHEDULE_SUPPORTED", 
                targetType: "visibility_schedule", 
                targetId: id, 
                statusCode: 200, 
                metadata: { 
                    message: "Pass Supported", 
                    oldValue: row, 
                    newValue: newRow,
                    targetLabel: `${newRow.sc} - ${newRow.stn}`
                } 
            });
        } catch { }

        res.json({ success: true, message: "Pass Supported" });
    } catch (e) {
        console.error("[VS support]", e);
        res.status(500).json({ error: "Failed to support pass" });
    }
});

/* ========== POST UPDATE PASSES FROM FILE ========== */
router.post("/update-passes", authRequired, upload.single("file"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded (field name: file)" });
    }

    const filePath = req.file.path;
    try {
        const text = fs.readFileSync(filePath, "utf8");
        const rows = parseAntText(text);

        if (!rows.length) {
            return res.status(400).json({ error: "Invalid file structure: No valid pass records found. The file must be a standard schedule text file." });
        }

        let updatedCount = 0;
        let unmatchedCount = 0;
        const unmatchedRows = [];
        let duplicateMatchesCount = 0;

        for (const r of rows) {
            // Find existing records matching Date (date_text), SC (sc), STN (stn), Orbit (orbit)
            const [matches] = await pool.query(
                "SELECT id, max_ele, aos, los, operations FROM visibility_schedule WHERE date_text = ? AND sc = ? AND stn = ? AND orbit = ? AND is_deleted = 0",
                [r.date_text, r.sc, r.stn, r.orbit]
            );

            if (matches.length === 0) {
                unmatchedCount++;
                unmatchedRows.push({
                    date_text: r.date_text,
                    sc: r.sc,
                    stn: r.stn,
                    orbit: r.orbit,
                    max_ele: r.max_ele,
                    aos: r.aos,
                    los: r.los,
                    operations: r.operations
                });
            } else {
                if (matches.length > 1) {
                    duplicateMatchesCount += (matches.length - 1);
                }

                // Update all matching records
                // Do not update: date_text, sc, stn, orbit
                // Update: max_ele, aos, los, operations, updated_at
                for (const match of matches) {
                    await pool.query(
                        `UPDATE visibility_schedule 
                         SET max_ele = ?, aos = ?, los = ?, operations = ?, updated_at = ?
                         WHERE id = ? AND is_deleted = 0`,
                        [r.max_ele, r.aos, r.los, r.operations, nowSQL(), match.id]
                    );
                    updatedCount++;
                }
            }
        }

        // Log unmatched rows to the server console
        if (unmatchedRows.length > 0) {
            console.warn(`[VS Update Passes] Unmatched rows count: ${unmatchedRows.length}`);
            unmatchedRows.forEach(row => {
                console.warn(`Unmatched record: Date=${row.date_text}, S/C=${row.sc}, STN=${row.stn}, Orbit=${row.orbit}`);
            });
        }

        // Audit log
        try {
            req.audit?.log?.({
                action: "VISIBILITY_SCHEDULE_UPDATE_PASSES",
                targetType: "visibility_schedule",
                statusCode: 200,
                metadata: {
                    updatedCount,
                    unmatchedCount,
                    duplicateMatchesCount,
                    unmatchedRowsCount: unmatchedRows.length
                }
            });
        } catch (e) {
            console.error("Audit log failed for update-passes:", e);
        }

        res.json({
            ok: true,
            updatedCount,
            unmatchedCount,
            unmatchedRows,
            duplicateMatchesCount
        });

    } catch (e) {
        console.error("[VS Update Passes Error]", e);
        res.status(500).json({ error: e.message || "Failed to process update passes file" });
    } finally {
        try { fs.unlinkSync(filePath); } catch (unlinkErr) { }
    }
});

module.exports = router;
