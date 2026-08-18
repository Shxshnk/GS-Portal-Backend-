// src/routes/Satellites.js
const express = require("express");
const router = express.Router();
const { pool } = require("../db");
const { authRequired } = require("../middleware/auth");

/* Helpers */
function toCSV(rows) {
  if (!rows || rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map((h) => esc(r[h])).join(","));
  return lines.join("\n");
}
function sendExport(res, rows, format, baseName) {
  if (String(format).toLowerCase() === "json") {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.set("Pragma", "no-cache");
    res.set("Vary", "Authorization");
    return res.json({ total: rows.length, data: rows });
  }
  const csv = toCSV(rows);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
  const filename = `${baseName}_${stamp}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.set("Pragma", "no-cache");
  res.set("Vary", "Authorization");
  res.send(csv);
}
const ALLOWED_FIELDS = [
  "satellite_id",
  "satellite_name",
  "norad_id",
  "itu_name",
  "station_name",
  "polarization",
  "remarks",
  "added_by",
];

/* Export */
router.get("/satellites/export", authRequired, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.set("Pragma", "no-cache");
    res.set("Vary", "Authorization");

    const { format = "csv" } = req.query;
    const [rows] = await pool.query(
      `SELECT satellite_id, satellite_name, norad_id, itu_name, station_name, polarization,
              remarks, added_by, created_at, updated_at
       FROM satellites
       ORDER BY id DESC`
    );
    try { req.audit?.log?.({ action: "SATELLITE_EXPORT", targetType: "satellite", statusCode: 200, metadata: { format, count: rows.length } }); } catch { }
    return sendExport(res, rows, format, "satellites");
  } catch (err) {
    console.error("Export satellites error:", err);
    try { req.audit?.log?.({ action: "SATELLITE_EXPORT", targetType: "satellite", statusCode: 500, metadata: { error: String(err?.message || err) } }); } catch { }
    res.status(500).json({ message: "Failed to export satellites" });
  }
});

/* List */
router.get("/satellites", authRequired, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.set("Pragma", "no-cache");
    res.set("Vary", "Authorization");

    const q = String(req.query.q || "").trim();
    let sql = "SELECT * FROM satellites";
    const params = [];
    if (q) {
      sql += " WHERE satellite_id LIKE ? OR satellite_name LIKE ? OR station_name LIKE ? OR polarization LIKE ? OR norad_id LIKE ? OR itu_name LIKE ?";
      for (let i = 0; i < 6; i++) params.push(`%${q}%`);
    }
    sql += " ORDER BY id DESC";
    const [rows] = await pool.query(sql, params);
    try { req.audit?.log?.({ action: "SATELLITE_LIST", targetType: "satellite", statusCode: 200, metadata: { q, count: rows.length } }); } catch { }
    res.json(rows);
  } catch (err) {
    console.error("List satellites error:", err);
    try { req.audit?.log?.({ action: "SATELLITE_LIST", targetType: "satellite", statusCode: 500, metadata: { error: String(err?.message || err) } }); } catch { }
    res.status(500).json({ message: "Failed to fetch satellites" });
  }
});

/* Next ID (optional helper) */
router.get("/satellites/next-id", authRequired, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.set("Pragma", "no-cache");
    res.set("Vary", "Authorization");

    const raw = String(req.query.name || req.query.prefix || "").trim();
    const prefix = (raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 3) || "SAT");
    const [cntRows] = await pool.query("SELECT COUNT(*) AS cnt FROM satellites WHERE satellite_id LIKE ?", [`${prefix}-%`]);
    let n = Number(cntRows?.[0]?.cnt || 0) + 1;

    let next;
    for (let tries = 0; tries < 10; tries++) {
      next = `${prefix}-${String(n).padStart(3, "0")}`;
      const [exists] = await pool.query("SELECT 1 FROM satellites WHERE satellite_id=? LIMIT 1", [next]);
      if (!exists.length) break;
      n++;
    }
    try { req.audit?.log?.({ action: "SATELLITE_NEXT_ID", targetType: "satellite", statusCode: 200, metadata: { prefix, next } }); } catch { }
    res.json({ prefix, next });
  } catch (err) {
    console.error("Next satellite id error:", err);
    res.status(500).json({ message: "Failed to compute next Satellite ID" });
  }
});

/* Get one */
router.get("/satellites/:id", authRequired, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.set("Pragma", "no-cache");
    res.set("Vary", "Authorization");

    const id = req.params.id;
    const idIsNum = /^\d+$/.test(id);
    const [rows] = await pool.query(
      idIsNum ? "SELECT * FROM satellites WHERE id=?" : "SELECT * FROM satellites WHERE satellite_id=?",
      [id]
    );
    if (!rows.length) {
      try { req.audit?.log?.({ action: "SATELLITE_GET", targetType: "satellite", targetId: id, statusCode: 404 }); } catch { }
      return res.status(404).json({ message: "Not found" });
    }
    try { req.audit?.log?.({ action: "SATELLITE_GET", targetType: "satellite", targetId: rows[0].id, statusCode: 200 }); } catch { }
    res.json(rows[0]);
  } catch (err) {
    console.error("Get satellite error:", err);
    try { req.audit?.log?.({ action: "SATELLITE_GET", targetType: "satellite", targetId: req.params.id, statusCode: 500, metadata: { error: String(err?.message || err) } }); } catch { }
    res.status(500).json({ message: "Failed to fetch satellite" });
  }
});

/* Create */
router.post("/satellites", authRequired, async (req, res) => {
  try {
    const body = req.body || {};
    const required = ["satellite_id", "satellite_name", "station_name", "polarization"];
    for (const k of required) {
      if (!String(body[k] ?? "").trim()) {
        try { req.audit?.log?.({ action: "SATELLITE_CREATE", targetType: "satellite", statusCode: 400, metadata: { reason: "missing_field", field: k } }); } catch { }
        return res.status(400).json({ message: `Field '${k}' is required` });
      }
    }
    const payload = {};
    for (const k of ALLOWED_FIELDS) if (body[k] !== undefined) payload[k] = body[k];
    if (!payload.added_by) payload.added_by = req.user?.username || "Unknown";

    const [result] = await pool.query("INSERT INTO satellites SET ?", [payload]);
    const [row] = await pool.query("SELECT * FROM satellites WHERE id=?", [result.insertId]);
    const newValue = row[0] || null;
    try { req.audit?.log?.({ action: "SATELLITE_CREATE", targetType: "satellite", targetId: newValue?.id || null, statusCode: 201, metadata: { newValue, targetLabel: newValue?.satellite_id || newValue?.satellite_name } }); } catch { }
    res.status(201).json(row[0]);
  } catch (err) {
    console.error("Create satellite error:", err);
    if (err && err.code === "ER_DUP_ENTRY") {
      try { req.audit?.log?.({ action: "SATELLITE_CREATE", targetType: "satellite", statusCode: 409, metadata: { reason: "duplicate_satellite_id" } }); } catch { }
      return res.status(409).json({ message: "Satellite ID must be unique" });
    }
    try { req.audit?.log?.({ action: "SATELLITE_CREATE", targetType: "satellite", statusCode: 500, metadata: { error: String(err?.message || err) } }); } catch { }
    res.status(500).json({ message: "Failed to create satellite" });
  }
});

/* Update */
router.put("/satellites/:id", authRequired, async (req, res) => {
  try {
    const id = req.params.id;
    const idIsNum = /^\d+$/.test(id);
    const updates = {};
    for (const k of ALLOWED_FIELDS) if (req.body[k] !== undefined) updates[k] = req.body[k];
    if (!Object.keys(updates).length) {
      try { req.audit?.log?.({ action: "SATELLITE_UPDATE", targetType: "satellite", targetId: id, statusCode: 400, metadata: { reason: "no_fields" } }); } catch { }
      return res.status(400).json({ message: "No fields to update" });
    }
    // Capture old value before update
    const [oldRows] = await pool.query(
      idIsNum ? "SELECT * FROM satellites WHERE id=?" : "SELECT * FROM satellites WHERE satellite_id=?",
      [id]
    );
    const oldValue = oldRows[0] || null;
    const [result] = await pool.query(
      idIsNum ? "UPDATE satellites SET ? WHERE id=?" : "UPDATE satellites SET ? WHERE satellite_id=?",
      [updates, id]
    );
    if (result.affectedRows === 0) {
      try { req.audit?.log?.({ action: "SATELLITE_UPDATE", targetType: "satellite", targetId: id, statusCode: 404 }); } catch { }
      return res.status(404).json({ message: "Not found" });
    }
    const [rows] = await pool.query(
      idIsNum ? "SELECT * FROM satellites WHERE id=?" : "SELECT * FROM satellites WHERE satellite_id=?",
      [id]
    );
    const newValue = rows[0] || null;
    try { req.audit?.log?.({ action: "SATELLITE_UPDATE", targetType: "satellite", targetId: newValue?.id || null, statusCode: 200, metadata: { oldValue, newValue, targetLabel: newValue?.satellite_id || newValue?.satellite_name } }); } catch { }
    res.json(rows[0]);
  } catch (err) {
    console.error("Update satellite error:", err);
    if (err && err.code === "ER_DUP_ENTRY") {
      try { req.audit?.log?.({ action: "SATELLITE_UPDATE", targetType: "satellite", targetId: req.params.id, statusCode: 409, metadata: { reason: "duplicate_satellite_id" } }); } catch { }
      return res.status(409).json({ message: "Satellite ID must be unique" });
    }
    try { req.audit?.log?.({ action: "SATELLITE_UPDATE", targetType: "satellite", targetId: req.params.id, statusCode: 500, metadata: { error: String(err?.message || err) } }); } catch { }
    res.status(500).json({ message: "Failed to update satellite" });
  }
});

/* Delete */
router.delete("/satellites/:id", authRequired, async (req, res) => {
  try {
    const id = req.params.id;
    const idIsNum = /^\d+$/.test(id);
    // Capture old value before delete
    const [oldRows] = await pool.query(
      idIsNum ? "SELECT * FROM satellites WHERE id=?" : "SELECT * FROM satellites WHERE satellite_id=?",
      [id]
    );
    const oldValue = oldRows[0] || null;
    const [result] = await pool.query(
      idIsNum ? "DELETE FROM satellites WHERE id=?" : "DELETE FROM satellites WHERE satellite_id=?",
      [id]
    );
    if (result.affectedRows === 0) {
      try { req.audit?.log?.({ action: "SATELLITE_DELETE", targetType: "satellite", targetId: id, statusCode: 404 }); } catch { }
      return res.status(404).json({ message: "Not found" });
    }
    try { req.audit?.log?.({ action: "SATELLITE_DELETE", targetType: "satellite", targetId: id, statusCode: 200, metadata: { oldValue, targetLabel: oldValue?.satellite_id || oldValue?.satellite_name } }); } catch { }
    res.json({ message: "Deleted" });
  } catch (err) {
    console.error("Delete satellite error:", err);
    try { req.audit?.log?.({ action: "SATELLITE_DELETE", targetType: "satellite", targetId: req.params.id, statusCode: 500, metadata: { error: String(err?.message || err) } }); } catch { }
    res.status(500).json({ message: "Failed to delete satellite" });
  }
});

module.exports = router;
