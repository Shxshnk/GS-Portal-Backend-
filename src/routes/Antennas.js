// src/routes/Antennas.js
const express = require("express");
const router = express.Router();
const { pool } = require("../db");
const { authRequired } = require("../middleware/auth");

const ALLOWED_SORT = new Set([
  "id",
  "antenna_type",
  "location",
  "size_m",
  "eirp_dbw",
  "tx_polarization",
  "rx_polarization",
  "created_at",
  "updated_at",
]);
function sanitizeSort(sortBy = "id", sortOrder = "asc") {
  const by = ALLOWED_SORT.has(String(sortBy)) ? String(sortBy) : "id";
  const order = String(sortOrder).toLowerCase() === "desc" ? "DESC" : "ASC";
  return { by, order };
}
const toNum = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/* ---------- Ensure tables exist with all required columns ---------- */
async function ensureTable() {
  // Main antennas table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS antennas (
      id                    INT AUTO_INCREMENT PRIMARY KEY,
      antenna_type          VARCHAR(100) NOT NULL,
      location              VARCHAR(100),
      size_m                DECIMAL(10,3),
      eirp_dbw              DECIMAL(10,3),
      tx_polarization       VARCHAR(100),
      rx_polarization       VARCHAR(100),
      travel_range          VARCHAR(100),
      tracking_velocity     VARCHAR(50),
      tracking_acceleration VARCHAR(50),
      tracking_modes        VARCHAR(100),
      added_by              VARCHAR(100) DEFAULT 'Admin',
      created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Bands child table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS antenna_bands (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      antenna_id  INT NOT NULL,
      band        VARCHAR(100),
      uplink      TINYINT(1) DEFAULT 0,
      downlink    TINYINT(1) DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // G/T child table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS antenna_gt (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      antenna_id  INT NOT NULL,
      band        VARCHAR(100),
      gt_db_k     DECIMAL(10,3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Migrate: add location if missing
  for (const col of [
    "ALTER TABLE antennas ADD COLUMN location VARCHAR(100) AFTER antenna_type",
    "ALTER TABLE antennas ADD COLUMN rx_polarization VARCHAR(100) AFTER tx_polarization",
  ]) {
    try { await pool.query(col); } catch (e) { if (e?.code !== "ER_DUP_FIELDNAME") { /* ignore duplicate column */ } }
  }
}

ensureTable().catch((e) => console.error("[Antennas] table init:", e?.message || e));


router.post("/", authRequired, async (req, res) => {
  const {
    antenna_type,
    location,
    size_m,
    eirp_dbw,
    tx_polarization,
    rx_polarization,
    travel_range,
    tracking_velocity,
    tracking_acceleration,
    tracking_modes,
    added_by,

    // children
    bands,          // [{ band, uplink, downlink }]
    receive_gt,     // [{ band, gt }]
  } = req.body || {};

  if (!antenna_type) {
    try { req.audit?.log?.({ action: "ANTENNA_CREATE", targetType: "antenna", targetId: null, statusCode: 400, metadata: { reason: "missing_type" } }); } catch { }
    return res.status(400).json({ message: "antenna_type is required" });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [ins] = await conn.query(
      `INSERT INTO antennas
       (antenna_type, location, size_m, eirp_dbw, tx_polarization,rx_polarization, travel_range, tracking_velocity,
        tracking_acceleration, tracking_modes, added_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
      [
        String(antenna_type).trim(),
        location ? String(location).trim() : null,
        toNum(size_m),
        toNum(eirp_dbw),
        tx_polarization ? String(tx_polarization).trim() : null,
        rx_polarization ? String(rx_polarization).trim() : null,

        travel_range ? String(travel_range).trim() : null,
        tracking_velocity ? String(tracking_velocity).trim() : null,
        tracking_acceleration ? String(tracking_acceleration).trim() : null,
        tracking_modes ? String(tracking_modes).trim() : null,
        (added_by || "Admin").trim(),
      ]
    );
    const antennaId = ins.insertId;

    // Insert bands
    if (Array.isArray(bands) && bands.length) {
      const values = bands
        .map((b) => [
          antennaId,
          String(b.band || "").trim(),
          b.uplink ? 1 : 0,
          b.downlink ? 1 : 0,
        ])
        .filter((row) => row[1]); // need band
      if (values.length) {
        await conn.query(
          "INSERT INTO antenna_bands (antenna_id, band, uplink, downlink) VALUES ?",
          [values]
        );
      }
    }

    // Insert Receive G/T
    if (Array.isArray(receive_gt) && receive_gt.length) {
      const values = receive_gt
        .map((g) => [antennaId, String(g.band || "").trim(), Number(g.gt) || null])
        .filter((row) => row[1]);
      if (values.length) {
        await conn.query(
          "INSERT INTO antenna_gt (antenna_id, band, gt_db_k) VALUES ?",
          [values]
        );
      }
    }

    await conn.commit();

    // Return the created record (with children)
    const [row] = await conn.query(
      `SELECT * FROM antennas WHERE id = ?`,
      [antennaId]
    );
    const [brows] = await conn.query(
      `SELECT band, uplink, downlink FROM antenna_bands WHERE antenna_id = ? ORDER BY id`,
      [antennaId]
    );
    const [grows] = await conn.query(
      `SELECT band, gt_db_k AS gt FROM antenna_gt WHERE antenna_id = ? ORDER BY id`,
      [antennaId]
    );

    try {
      req.audit?.log?.({
        action: "ANTENNA_CREATE",
        targetType: "antenna",
        targetId: String(antennaId),
        statusCode: 201,
        metadata: { newValue: row[0], targetLabel: antenna_type },
      });
    } catch { }

    res.status(201).json({ ...row[0], bands: brows, receive_gt: grows });
  } catch (err) {
    await conn.rollback();
    console.error("Create antenna error:", err);
    try {
      req.audit?.log?.({
        action: "ANTENNA_CREATE",
        targetType: "antenna",
        targetId: null,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch { }
    res.status(500).json({ message: "Internal server error" });
  } finally {
    conn.release();
  }
});

/* -------------------------------- LIST -------------------------------- */
router.get("/", authRequired, async (req, res) => {
  const {
    q,
    band,                 // optional filter: returns antennas that have this band in antenna_bands
    page = 1,
    limit = 20,
    sort_by = "id",
    sort_order = "asc",
  } = req.query;

  const { by, order } = sanitizeSort(sort_by, sort_order);

  const filters = [];
  const params = [];

  if (q) {
    filters.push(
      "(a.antenna_type LIKE ? OR a.tx_polarization LIKE ? OR a.rx_polarization LIKE ? OR a.tracking_modes LIKE ? OR a.travel_range LIKE ?)"
    );
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);

  }

  // filter by band (exists in child table)
  let joinBand = "";
  if (band) {
    joinBand = "INNER JOIN antenna_bands b ON b.antenna_id = a.id AND b.band = ?";
    params.push(String(band));
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const lim = Math.min(parseInt(limit, 10) || 20, 100);
  const pg = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (pg - 1) * lim;

  try {
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total
         FROM antennas a
         ${joinBand}
         ${where}`,
      params
    );
    const total = countRows[0]?.total || 0;

    const [rows] = await pool.query(
      `SELECT a.*
         FROM antennas a
         ${joinBand}
         ${where}
         ORDER BY a.${by} ${order}
         LIMIT ? OFFSET ?`,
      [...params, lim, offset]
    );

    // attach children in bulk
    const ids = rows.map((r) => r.id);
    let byIdBands = new Map();
    let byIdGt = new Map();

    if (ids.length) {
      const [brows] = await pool.query(
        "SELECT antenna_id, band, uplink, downlink FROM antenna_bands WHERE antenna_id IN (?) ORDER BY id",
        [ids]
      );
      const [grows] = await pool.query(
        "SELECT antenna_id, band, gt_db_k AS gt FROM antenna_gt WHERE antenna_id IN (?) ORDER BY id",
        [ids]
      );
      byIdBands = brows.reduce((m, r) => {
        (m.get(r.antenna_id) || m.set(r.antenna_id, []).get(r.antenna_id)).push({
          band: r.band, uplink: r.uplink, downlink: r.downlink,
        });
        return m;
      }, new Map());
      byIdGt = grows.reduce((m, r) => {
        (m.get(r.antenna_id) || m.set(r.antenna_id, []).get(r.antenna_id)).push({
          band: r.band, gt: r.gt,
        });
        return m;
      }, new Map());
    }

    const data = rows.map((r) => ({
      ...r,
      bands: byIdBands.get(r.id) || [],
      receive_gt: byIdGt.get(r.id) || [],
    }));



    res.json({ data, pagination: { total, page: pg, limit: lim, pages: Math.ceil(total / lim) } });
  } catch (err) {
    console.error("List antennas error:", err);
    try {
      req.audit?.log?.({
        action: "ANTENNA_LIST",
        targetType: "antenna",
        targetId: null,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch { }
    res.status(500).json({ message: "Internal server error" });
  }
});

/* ------------------------------- READ ONE ------------------------------ */
router.get("/:id", authRequired, async (req, res) => {
  const id = req.params.id;
  try {
    const [rows] = await pool.query("SELECT * FROM antennas WHERE id = ?", [id]);
    if (!rows.length) return res.status(404).json({ message: "Antenna not found" });

    const [b] = await pool.query(
      "SELECT band, uplink, downlink FROM antenna_bands WHERE antenna_id = ? ORDER BY id",
      [id]
    );
    const [g] = await pool.query(
      "SELECT band, gt_db_k AS gt FROM antenna_gt WHERE antenna_id = ? ORDER BY id",
      [id]
    );

    /* try { req.audit?.log?.({ action: "ANTENNA_GET", targetType: "antenna", targetId: String(id), statusCode: 200, metadata: {} }); } catch { } */
    res.json({ ...rows[0], bands: b, receive_gt: g });
  } catch (err) {
    console.error("Get antenna error:", err);
    try { req.audit?.log?.({ action: "ANTENNA_GET", targetType: "antenna", targetId: String(id), statusCode: 500, metadata: { error: String(err?.message || err) } }); } catch { }
    res.status(500).json({ message: "Internal server error" });
  }
});

/* ------------------------------- UPDATE ------------------------------- */
router.put("/:id", authRequired, async (req, res) => {
  const id = req.params.id;
  const {
    antenna_type,
    location,
    size_m,
    eirp_dbw,
    tx_polarization,
    rx_polarization,

    travel_range,
    tracking_velocity,
    tracking_acceleration,
    tracking_modes,
    added_by,

    bands,
    receive_gt,
  } = req.body || {};

  if (!antenna_type) return res.status(400).json({ message: "antenna_type is required" });

  const conn = await pool.getConnection();
  try {
    // Capture old value before update
    const [prevRows] = await pool.query("SELECT * FROM antennas WHERE id = ?", [id]);
    const oldValue = prevRows[0] || null;

    await conn.beginTransaction();

    const [upd] = await conn.query(
      `UPDATE antennas
          SET antenna_type = ?,
            location = ?, 
              size_m = ?,
              eirp_dbw = ?,
              tx_polarization = ?,
              rx_polarization = ?,
              travel_range = ?,
              tracking_velocity = ?,
              tracking_acceleration = ?,
              tracking_modes = ?,
              added_by = COALESCE(?, added_by)
        WHERE id = ?`,
      [
        String(antenna_type).trim(),
        location ? String(location).trim() : null,
        toNum(size_m),
        toNum(eirp_dbw),
        tx_polarization ? String(tx_polarization).trim() : null,
        rx_polarization ? String(rx_polarization).trim() : null,
        travel_range ? String(travel_range).trim() : null,
        tracking_velocity ? String(tracking_velocity).trim() : null,
        tracking_acceleration ? String(tracking_acceleration).trim() : null,
        tracking_modes ? String(tracking_modes).trim() : null,
        added_by ? String(added_by).trim() : null,
        id,
      ]
    );
    if (!upd.affectedRows) {
      await conn.rollback();
      return res.status(404).json({ message: "Antenna not found" });
    }

    // Replace child rows for simplicity
    await conn.query("DELETE FROM antenna_bands WHERE antenna_id = ?", [id]);
    if (Array.isArray(receive_gt)) {
      await conn.query("DELETE FROM antenna_gt WHERE antenna_id = ?", [id]);
    }

    if (Array.isArray(bands) && bands.length) {
      const values = bands
        .map((b) => [id, String(b.band || "").trim(), b.uplink ? String(b.uplink).trim() : null, b.downlink ? String(b.downlink).trim() : null])
        .filter((row) => row[1]);
      if (values.length) {
        await conn.query("INSERT INTO antenna_bands (antenna_id, band, uplink, downlink) VALUES ?", [values]);
      }
    }

    if (Array.isArray(receive_gt) && receive_gt.length) {
      const values = receive_gt
        .map((g) => [id, String(g.band || "").trim(), toNum(g.gt)])
        .filter((row) => row[1]);
      if (values.length) {
        await conn.query("INSERT INTO antenna_gt (antenna_id, band, gt_db_k) VALUES ?", [values]);
      }
    }

    await conn.commit();

    const [row] = await conn.query("SELECT * FROM antennas WHERE id = ?", [id]);
    const [b] = await conn.query("SELECT band, uplink, downlink FROM antenna_bands WHERE antenna_id = ? ORDER BY id", [id]);
    const [g] = await conn.query("SELECT band, gt_db_k AS gt FROM antenna_gt WHERE antenna_id = ? ORDER BY id", [id]);

    try { req.audit?.log?.({ action: "ANTENNA_UPDATE", targetType: "antenna", targetId: String(id), statusCode: 200, metadata: { oldValue, newValue: row[0], targetLabel: antenna_type } }); } catch { }
    res.json({ ...row[0], bands: b, receive_gt: g });
  } catch (err) {
    await conn.rollback();
    console.error("Update antenna error:", err);
    try { req.audit?.log?.({ action: "ANTENNA_UPDATE", targetType: "antenna", targetId: String(id), statusCode: 500, metadata: { error: String(err?.message || err) } }); } catch { }
    res.status(500).json({ message: "Internal server error" });
  } finally {
    conn.release();
  }
});

/* ------------------------------- DELETE ------------------------------- */
router.delete("/:id", authRequired, async (req, res) => {
  const id = req.params.id;
  try {
    // Capture old value before delete
    const [prevRows] = await pool.query("SELECT * FROM antennas WHERE id = ?", [id]);
    const oldValue = prevRows[0] || null;
    const [r] = await pool.query("DELETE FROM antennas WHERE id = ?", [id]);
    if (!r.affectedRows) return res.status(404).json({ message: "Antenna not found" });

    try { req.audit?.log?.({ action: "ANTENNA_DELETE", targetType: "antenna", targetId: String(id), statusCode: 204, metadata: { oldValue, targetLabel: oldValue?.antenna_type } }); } catch { }
    res.status(204).send();
  } catch (err) {
    console.error("Delete antenna error:", err);
    try { req.audit?.log?.({ action: "ANTENNA_DELETE", targetType: "antenna", targetId: String(id), statusCode: 500, metadata: { error: String(err?.message || err) } }); } catch { }
    res.status(500).json({ message: "Internal server error" });
  }
});

/* --------- Small helper: list just the antenna names for dropdown ------- */
router.get("/names/unique", authRequired, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT DISTINCT antenna_type AS name FROM antennas ORDER BY name ASC"
    );
    res.json(rows.map((r) => r.name).filter(Boolean));
  } catch (err) {
    console.error("Fetch antenna names error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
