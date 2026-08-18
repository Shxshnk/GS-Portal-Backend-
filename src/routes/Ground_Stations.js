

// src/routes/Ground_Stations.js
const express = require("express");
const router = express.Router();
const { pool } = require("../db");
const { authRequired } = require("../middleware/auth");

const ALLOWED_SORT = new Set([
  "id",
  "supporting_partner",
  "ground_station",
  "added_by",
  "antenna",
  "station_latitude",
  "station_longitude",
]);

function sanitizeSort(sortBy = "id", sortOrder = "asc") {
  const by = ALLOWED_SORT.has(String(sortBy)) ? String(sortBy) : "id";
  const order = String(sortOrder).toLowerCase() === "desc" ? "DESC" : "ASC";
  return { by, order };
}

// helpers
const toNullableNumber = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/* ------------------------------- CREATE ------------------------------- */
router.post("/", authRequired, async (req, res) => {
  try {
    const {
      supporting_partner,
      ground_station,
      added_by,

      // NEW fields
      antenna,
      station_latitude,
      station_longitude,
    } = req.body || {};

    if (!supporting_partner || !ground_station || !added_by) {
      try {
        req.audit?.log?.({
          action: "GROUND_STATION_CREATE",
          targetType: "ground_station",
          targetId: null,
          statusCode: 400,
          metadata: { reason: "missing_fields" },
        });
      } catch { }
      return res
        .status(400)
        .json({ message: "supporting_partner, ground_station, and added_by are required" });
    }

    const lat = toNullableNumber(station_latitude);
    const lng = toNullableNumber(station_longitude);

    const [result] = await pool.query(
      `INSERT INTO ground_stations
       (supporting_partner, ground_station, added_by, antenna, station_latitude, station_longitude)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        supporting_partner.trim(),
        ground_station.trim(),
        added_by.trim(),
        antenna ? String(antenna).trim() : null,
        lat,
        lng,
      ]
    );

    const [rows] = await pool.query(
      `SELECT id, supporting_partner, ground_station, added_by, antenna, station_latitude, station_longitude
         FROM ground_stations
        WHERE id = ?`,
      [result.insertId]
    );
    const newValue = rows[0] || null;
    try {
      req.audit?.log?.({
        action: "GROUND_STATION_CREATE",
        targetType: "ground_station",
        targetId: String(result.insertId),
        statusCode: 201,
        metadata: {
          newValue,
          targetLabel: newValue?.ground_station || newValue?.supporting_partner,
        },
      });
    } catch { }

    res.status(201).json(rows[0]);
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      try {
        req.audit?.log?.({
          action: "GROUND_STATION_CREATE",
          targetType: "ground_station",
          targetId: null,
          statusCode: 409,
          metadata: { reason: "duplicate" },
        });
      } catch { }
      return res
        .status(409)
        .json({ message: "A record with this supporting_partner and ground_station already exists." });
    }
    console.error("Create ground station error:", err);
    try {
      req.audit?.log?.({
        action: "GROUND_STATION_CREATE",
        targetType: "ground_station",
        targetId: null,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch { }
    res.status(500).json({ message: "Internal server error" });
  }
});

/* -------------------------------- LIST -------------------------------- */
router.get("/", authRequired, async (req, res) => {
  try {
    const {
      q,
      partner,
      station,
      antenna: antennaQ,
      page = 1,
      limit = 20,
      sort_by = "id",
      sort_order = "asc",
    } = req.query;

    const { by, order } = sanitizeSort(sort_by, sort_order);

    const filters = [];
    const params = [];

    if (partner) {
      filters.push("supporting_partner = ?");
      params.push(partner);
    }
    if (station) {
      filters.push("ground_station LIKE ?");
      params.push(`%${station}%`);
    }
    if (antennaQ) {
      filters.push("antenna = ?");
      params.push(antennaQ);
    }
    if (q) {
      filters.push(
        "(supporting_partner LIKE ? OR ground_station LIKE ? OR added_by LIKE ? OR antenna LIKE ? OR " +
        "CAST(station_latitude AS CHAR) LIKE ? OR CAST(station_longitude AS CHAR) LIKE ?)"
      );
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const lim = Math.min(parseInt(limit, 10) || 20, 100);
    const pg = Math.max(parseInt(page, 10) || 1, 1);
    const offset = (pg - 1) * lim;

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM ground_stations ${where}`,
      params
    );
    const total = countRows[0].total;

    const [rows] = await pool.query(
      `SELECT id, supporting_partner, ground_station, added_by, antenna, station_latitude, station_longitude
         FROM ground_stations
         ${where}
         ORDER BY ${by} ${order}
         LIMIT ? OFFSET ?`,
      [...params, lim, offset]
    );



    res.json({
      data: rows,
      pagination: { total, page: pg, limit: lim, pages: Math.ceil(total / lim) },
    });
  } catch (err) {
    console.error("List ground stations error:", err);
    try {
      req.audit?.log?.({
        action: "GROUND_STATION_LIST",
        targetType: "ground_station",
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
    const [rows] = await pool.query(
      `SELECT id, supporting_partner, ground_station, added_by, antenna, station_latitude, station_longitude
         FROM ground_stations
        WHERE id = ?`,
      [id]
    );
    if (!rows.length) {
      try {
        req.audit?.log?.({
          action: "GROUND_STATION_GET",
          targetType: "ground_station",
          targetId: String(id),
          statusCode: 404,
          metadata: { reason: "not_found" },
        });
      } catch { }
      return res.status(404).json({ message: "Ground station not found" });
    }



    res.json(rows[0]);
  } catch (err) {
    console.error("Get ground station error:", err);
    try {
      req.audit?.log?.({
        action: "GROUND_STATION_GET",
        targetType: "ground_station",
        targetId: String(id),
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch { }
    res.status(500).json({ message: "Internal server error" });
  }
});

/* -------------------------------- UPDATE ------------------------------- */
router.put("/:id", authRequired, async (req, res) => {
  const id = req.params.id;
  try {
    const {
      supporting_partner,
      ground_station,
      added_by,

      // NEW fields (optional)
      antenna,
      station_latitude,
      station_longitude,
    } = req.body || {};

    if (!supporting_partner || !ground_station || !added_by) {
      try {
        req.audit?.log?.({
          action: "GROUND_STATION_UPDATE",
          targetType: "ground_station",
          targetId: String(id),
          statusCode: 400,
          metadata: { reason: "missing_fields" },
        });
      } catch { }
      return res
        .status(400)
        .json({ message: "supporting_partner, ground_station, and added_by are required" });
    }

    const lat = toNullableNumber(station_latitude);
    const lng = toNullableNumber(station_longitude);

    // Capture old value before update
    const [prevRows] = await pool.query(
      `SELECT id, supporting_partner, ground_station, added_by, antenna, station_latitude, station_longitude
         FROM ground_stations
        WHERE id = ?`,
      [id]
    );
    const oldValue = prevRows[0] || null;

    const [result] = await pool.query(
      `UPDATE ground_stations
          SET supporting_partner = ?,
              ground_station     = ?,
              added_by           = ?,
              antenna            = ?,
              station_latitude   = ?,
              station_longitude  = ?
        WHERE id = ?`,
      [
        supporting_partner.trim(),
        ground_station.trim(),
        added_by.trim(),
        antenna ? String(antenna).trim() : null,
        lat,
        lng,
        id,
      ]
    );

    if (result.affectedRows === 0) {
      try {
        req.audit?.log?.({
          action: "GROUND_STATION_UPDATE",
          targetType: "ground_station",
          targetId: String(id),
          statusCode: 404,
          metadata: { reason: "not_found" },
        });
      } catch { }
      return res.status(404).json({ message: "Ground station not found" });
    }

    const [rows] = await pool.query(
      `SELECT id, supporting_partner, ground_station, added_by, antenna, station_latitude, station_longitude
         FROM ground_stations
        WHERE id = ?`,
      [id]
    );
    const newValue = rows[0] || null;

    try {
      req.audit?.log?.({
        action: "GROUND_STATION_UPDATE",
        targetType: "ground_station",
        targetId: String(id),
        statusCode: 200,
        metadata: {
          oldValue,
          newValue,
          targetLabel: newValue?.ground_station || newValue?.supporting_partner,
        },
      });
    } catch { }

    res.json(rows[0]);
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      try {
        req.audit?.log?.({
          action: "GROUND_STATION_UPDATE",
          targetType: "ground_station",
          targetId: String(req.params.id),
          statusCode: 409,
          metadata: { reason: "duplicate" },
        });
      } catch { }
      return res
        .status(409)
        .json({ message: "A record with this supporting_partner and ground_station already exists." });
    }
    console.error("Update ground station error:", err);
    try {
      req.audit?.log?.({
        action: "GROUND_STATION_UPDATE",
        targetType: "ground_station",
        targetId: String(req.params.id),
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch { }
    res.status(500).json({ message: "Internal server error" });
  }
});

/* -------------------------------- DELETE ------------------------------- */
router.delete("/:id", authRequired, async (req, res) => {
  const id = req.params.id;
  try {
    // Capture old value before delete
    const [prevRows] = await pool.query(
      `SELECT id, supporting_partner, ground_station, added_by, antenna, station_latitude, station_longitude FROM ground_stations WHERE id = ?`,
      [id]
    );
    const oldValue = prevRows[0] || null;
    const [result] = await pool.query(`DELETE FROM ground_stations WHERE id = ?`, [id]);
    if (result.affectedRows === 0) {
      try {
        req.audit?.log?.({
          action: "GROUND_STATION_DELETE",
          targetType: "ground_station",
          targetId: String(id),
          statusCode: 404,
          metadata: { reason: "not_found" },
        });
      } catch { }
      return res.status(404).json({ message: "Ground station not found" });
    }

    try {
      req.audit?.log?.({
        action: "GROUND_STATION_DELETE",
        targetType: "ground_station",
        targetId: String(id),
        statusCode: 204,
        metadata: { oldValue, targetLabel: oldValue?.ground_station || oldValue?.supporting_partner },
      });
    } catch { }

    res.status(204).send();
  } catch (err) {
    console.error("Delete ground station error:", err);
    try {
      req.audit?.log?.({
        action: "GROUND_STATION_DELETE",
        targetType: "ground_station",
        targetId: String(id),
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch { }
    res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;