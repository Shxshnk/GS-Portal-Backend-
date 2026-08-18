// src/routes/License.js
const express = require("express");
const router = express.Router();
const { pool } = require("../db");
const { authRequired } = require("../middleware/auth");

/* -------------------- helpers -------------------- */
function normalizeSortLicenses(sortBy, sortOrder) {
  const allowed = new Set([
    "id",
    "license_req_no",
    "satellite_name",
    "station_name",
    "status",
    "applied_date",
    "receipt_date",
    "validity_expiry",
    "created_at",
    "updated_at",
  ]);
  const sb = allowed.has(String(sortBy)) ? sortBy : "id";
  const so = String(sortOrder).toLowerCase() === "desc" ? "DESC" : "ASC";
  return { sb, so };
}

function toStr(v) {
  return (v ?? "").toString().trim();
}

function formatBandsForCSV(raw) {
  if (!raw) return "";
  return raw
    .split("||")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [band = "", uplink = "", downlink = ""] = chunk
        .split("|")
        .map((x) => (x ?? "").trim());
      const bits = [];
      if (uplink) bits.push(`Uplink: ${uplink}`);
      if (downlink) bits.push(`Downlink: ${downlink}`);
      return bits.length ? `${band} (${bits.join(", ")})` : band;
    })
    .join(" || ");
}

/* shape guard for bands */
function normalizeBands(input) {
  if (!input) return [];
  const arr = Array.isArray(input) ? input : [input];
  return arr
    .map((b) => ({
      band_name: toStr(b.band_name),
      uplink: toStr(b.uplink),
      downlink: toStr(b.downlink),
    }))
    .filter((b) => b.band_name && b.uplink && b.downlink);
}

// strip any id-like columns from CSV only
function stripIdColumns(rows) {
  const toRemove = new Set(["id", "license_id", "band_id"]);
  return rows.map((r) => {
    const c = { ...r };
    for (const k of toRemove) delete c[k];
    return c;
  });
}

// tiny CSV encoder
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

// helper: send CSV or JSON
function sendExport(res, rows, format, baseName) {
  if (String(format).toLowerCase() === "json") {
    return res.json({ total: rows.length, data: rows });
  }
  // CSV: remove id columns
  const rowsNoIds = stripIdColumns(rows);
  const csv = toCSV(rowsNoIds);
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "")
    .replace("T", "_");
  const filename = `${baseName}_${stamp}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
}

/* -------------------- EXPORT -------------------- */
/**
 * GET /licenses/export?format=csv|json&shape=wide|long
 */
router.get("/licenses/export", authRequired, async (req, res) => {
  try {
    // prevent caches from serving stale data
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.set("Pragma", "no-cache");

    const { format = "csv", shape = "long" } = req.query;
    const fmt = String(format).toLowerCase();
    const shp = String(shape).toLowerCase();

    if (shp === "wide") {
      const [rows] = await pool.query(`
        SELECT
          l.id,
          l.license_req_no,
          l.satellite_name,
          l.station_name,
          l.applied_date,
          l.receipt_date,
          l.validity_expiry,
          l.status,
          l.remarks,
          l.added_by,
          l.created_at,
          l.updated_at,
          COALESCE(
            GROUP_CONCAT(CONCAT_WS('|', lb.band_name, lb.uplink, lb.downlink)
              ORDER BY lb.id SEPARATOR ' || '
            ), ''
          ) AS bands
        FROM licenses l
        LEFT JOIN license_bands lb ON lb.license_id = l.id
        GROUP BY l.id
        ORDER BY l.id DESC
      `);

      const out =
        fmt === "csv"
          ? rows.map((r) => ({ ...r, bands: formatBandsForCSV(r.bands) }))
          : rows;

      try {
        req.audit?.log?.({
          action: "LICENSE_EXPORT",
          targetType: "license",
          targetId: null,
          statusCode: 200,
          metadata: { shape: "wide", format: fmt, count: out.length },
        });
      } catch {}
      return sendExport(res, out, fmt, "licenses_wide");
    }

    // shape = long
    const [rows] = await pool.query(`
      SELECT
        l.id AS license_id,
        l.license_req_no,
        l.satellite_name,
        l.station_name,
        l.applied_date,
        l.receipt_date,
        l.validity_expiry,
        l.status,
        l.remarks,
        l.added_by,
        l.created_at,
        l.updated_at,
        lb.id AS band_id,
        COALESCE(lb.band_name, '') AS band_name,
        COALESCE(lb.uplink, '') AS uplink,
        COALESCE(lb.downlink, '') AS downlink
      FROM licenses l
      LEFT JOIN license_bands lb ON lb.license_id = l.id
      ORDER BY l.id DESC, lb.id ASC
    `);

    try {
      req.audit?.log?.({
        action: "LICENSE_EXPORT",
        targetType: "license",
        targetId: null,
        statusCode: 200,
        metadata: { shape: "long", format: fmt, count: rows.length },
      });
    } catch {}

    return sendExport(res, rows, fmt, "licenses_long");
  } catch (err) {
    console.error("Export licenses error:", err);
    try {
      req.audit?.log?.({
        action: "LICENSE_EXPORT",
        targetType: "license",
        targetId: null,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch {}
    res.status(500).json({ message: "Failed to export licenses" });
  }
});

/* -------------------- LIST -------------------- */
/**
 * GET /licenses
 * Query: limit, offset, search, sort_by, sort_order, include_bands(0|1)
 */
router.get("/licenses", authRequired, async (req, res) => {
  try {
    // prevent caches from serving stale data
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.set("Pragma", "no-cache");

    const {
      limit = 50,
      offset = 0,
      search = "",
      sort_by = "id",
      sort_order = "desc",
      include_bands = "0",
    } = req.query;

    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
    const off = Math.max(parseInt(offset, 10) || 0, 0);
    const { sb, so } = normalizeSortLicenses(sort_by, sort_order);

    const params = [];
    let where = "";
    if (search) {
      where =
        "WHERE (license_req_no LIKE ? OR satellite_name LIKE ? OR station_name LIKE ? OR status LIKE ?)";
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM licenses ${where}`,
      params
    );

    const [rows] = await pool.query(
      `SELECT * FROM licenses ${where} ORDER BY ${sb} ${so} LIMIT ? OFFSET ?`,
      [...params, lim, off]
    );

    if (String(include_bands) === "1" && rows.length) {
      const ids = rows.map((r) => r.id);
      const [bands] = await pool.query(
        `SELECT * FROM license_bands WHERE license_id IN (?) ORDER BY id ASC`,
        [ids]
      );
      const byLicense = new Map();
      for (const b of bands) {
        if (!byLicense.has(b.license_id)) byLicense.set(b.license_id, []);
        byLicense.get(b.license_id).push(b);
      }
      for (const r of rows) r.bands = byLicense.get(r.id) || [];
    }

    try {
      req.audit?.log?.({
        action: "LICENSE_LIST",
        targetType: "license",
        targetId: null,
        statusCode: 200,
        metadata: {
          total,
          limit: lim,
          offset: off,
          search,
          sort_by: sb,
          sort_order: so,
          include_bands: String(include_bands) === "1",
        },
      });
    } catch {}

    res.json({ total, data: rows });
  } catch (err) {
    console.error("List licenses error:", err);
    try {
      req.audit?.log?.({
        action: "LICENSE_LIST",
        targetType: "license",
        targetId: null,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch {}
    res.status(500).json({ message: "Failed to list licenses" });
  }
});

/* -------------------- READ ONE -------------------- */
router.get("/licenses/:id", authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM licenses WHERE id=?`, [
      req.params.id,
    ]);
    if (!rows.length) {
      try {
        req.audit?.log?.({
          action: "LICENSE_GET",
          targetType: "license",
          targetId: req.params.id,
          statusCode: 404,
        });
      } catch {}
      return res.status(404).json({ message: "Not found" });
    }

    const license = rows[0];

    if (String(req.query.include_bands) === "1") {
      const [bands] = await pool.query(
        `SELECT * FROM license_bands WHERE license_id=? ORDER BY id ASC`,
        [license.id]
      );
      license.bands = bands;
    }

    try {
      req.audit?.log?.({
        action: "LICENSE_GET",
        targetType: "license",
        targetId: req.params.id,
        statusCode: 200,
        metadata: { include_bands: String(req.query.include_bands) === "1" },
      });
    } catch {}

    res.json(license);
  } catch (err) {
    console.error("Get license error:", err);
    try {
      req.audit?.log?.({
        action: "LICENSE_GET",
        targetType: "license",
        targetId: req.params.id,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch {}
    res.status(500).json({ message: "Failed to retrieve license" });
  }
});

/* -------------------- CREATE -------------------- */
router.post("/licenses", authRequired, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const now = new Date().toISOString();
    const body = req.body || {};

    const license_req_no = toStr(body.license_req_no);
    if (!license_req_no) {
      try {
        req.audit?.log?.({
          action: "LICENSE_CREATE",
          targetType: "license",
          targetId: null,
          statusCode: 400,
          metadata: { reason: "license_req_no_required" },
        });
      } catch {}
      conn.release();
      return res.status(400).json({ message: "license_req_no is required" });
    }

    const cols = [
      "license_req_no",
      "satellite_name",
      "station_name",
      "applied_date",
      "receipt_date",
      "validity_expiry",
      "status",
      "remarks",
      "added_by",
      "created_at",
      "updated_at",
      "is_deleted",
    ];

    const values = [
      license_req_no,
      toStr(body.satellite_name),
      toStr(body.station_name),
      toStr(body.applied_date),
      toStr(body.receipt_date),
      toStr(body.validity_expiry),
      toStr(body.status || "Pending"),
      toStr(body.remarks),
      toStr(body.added_by) || req.user?.username || "Unknown",
      now,
      now,
      "0",
    ];

    const placeholders = cols.map(() => "?").join(",");

    await conn.beginTransaction();

    const [r] = await conn.query(
      `INSERT INTO licenses (${cols.join(",")}) VALUES (${placeholders})`,
      values
    );

    const licenseId = r.insertId;

    const bands = normalizeBands(body.bands);
    if (bands.length) {
      const bandCols = [
        "license_id",
        "band_name",
        "uplink",
        "downlink",
        "created_at",
        "updated_at",
        "is_deleted",
      ];
      const bandValues = [];
      const bandPlaceholders = [];

      for (const b of bands) {
        bandPlaceholders.push("(?,?,?,?,?,?,?)");
        bandValues.push(
          licenseId,
          b.band_name,
          b.uplink,
          b.downlink,
          now,
          now,
          "0"
        );
      }

      await conn.query(
        `INSERT INTO license_bands (${bandCols.join(",")}) VALUES ${bandPlaceholders.join(",")}`,
        bandValues
      );
    }

    await conn.commit();

    const [rows] = await pool.query(`SELECT * FROM licenses WHERE id=?`, [
      licenseId,
    ]);
    const out = rows[0];

    if (bands.length) {
      const [bs] = await pool.query(
        `SELECT * FROM license_bands WHERE license_id=? ORDER BY id ASC`,
        [licenseId]
      );
      out.bands = bs;
    }

    try {
      req.audit?.log?.({
        action: "LICENSE_CREATE",
        targetType: "license",
        targetId: String(licenseId),
        statusCode: 201,
        metadata: { newValue: out, targetLabel: license_req_no, bandsCount: bands.length },
      });
    } catch {}

    res.status(201).json(out);
  } catch (err) {
    await conn.rollback();
    if (err?.code === "ER_DUP_ENTRY") {
      try {
        req.audit?.log?.({
          action: "LICENSE_CREATE",
          targetType: "license",
          targetId: null,
          statusCode: 409,
          metadata: { reason: "duplicate_license_req_no" },
        });
      } catch {}
      conn.release();
      return res
        .status(409)
        .json({ message: "License request number already exists" });
    }
    console.error("Create license error:", err);
    try {
      req.audit?.log?.({
        action: "LICENSE_CREATE",
        targetType: "license",
        targetId: null,
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch {}
    conn.release();
    res.status(500).json({ message: "Failed to create license" });
  } finally {
    if (conn) try { conn.release(); } catch {}
  }
});

/* -------------------- UPDATE -------------------- */
router.put("/licenses/:id", authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    try {
      req.audit?.log?.({
        action: "LICENSE_UPDATE",
        targetType: "license",
        targetId: req.params.id,
        statusCode: 400,
        metadata: { reason: "invalid_id" },
      });
    } catch {}
    return res.status(400).json({ message: "Invalid id" });
  }

  const {
    satellite_name = "",
    station_name = "",
    applied_date = "",
    receipt_date = "",
    validity_expiry = "",
    status = "",
    remarks = "",
    added_by = "",
    bands = [],
  } = req.body || {};
  const resolvedAddedBy = String(added_by || req.user?.username || "Unknown");

  const now = new Date().toISOString();

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Capture old value before update
    const [[oldLicense]] = await pool.query(`SELECT * FROM licenses WHERE id=?`, [id]);
    const oldValue = oldLicense || null;

    await conn.query(
      `UPDATE licenses
         SET satellite_name=?, station_name=?, applied_date=?, receipt_date=?,
             validity_expiry=?, status=?, remarks=?, added_by=?, updated_at=?
       WHERE id=?`,
      [
        String(satellite_name),
        String(station_name),
        String(applied_date),
        String(receipt_date),
        String(validity_expiry),
        String(status),
        String(remarks),
        resolvedAddedBy,
        now,
        id,
      ]
    );

    await conn.query(`DELETE FROM license_bands WHERE license_id=?`, [id]);

    let bandsCount = 0;
    if (Array.isArray(bands) && bands.length) {
      const values = bands.map((b) => [
        id,
        String(b.band_name ?? ""),
        String(b.uplink ?? ""),
        String(b.downlink ?? ""),
        now,
        now,
        "0",
      ]);
      bandsCount = values.length;
      await conn.query(
        `INSERT INTO license_bands
         (license_id, band_name, uplink, downlink, created_at, updated_at, is_deleted)
         VALUES ?`,
        [values]
      );
    }

    await conn.commit();

    const [[row]] = await conn.query(`SELECT * FROM licenses WHERE id=?`, [id]);

    try {
      req.audit?.log?.({
        action: "LICENSE_UPDATE",
        targetType: "license",
        targetId: String(id),
        statusCode: 200,
        metadata: { oldValue, newValue: row, targetLabel: row?.license_req_no, bandsReplaced: bandsCount },
      });
    } catch {}

    res.json(row);
  } catch (err) {
    await conn.rollback();
    console.error("Update license error:", err);
    try {
      req.audit?.log?.({
        action: "LICENSE_UPDATE",
        targetType: "license",
        targetId: String(id),
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch {}
    res.status(500).json({ message: "Failed to update license" });
  } finally {
    conn.release();
  }
});

/* -------------------- DELETE -------------------- */
router.delete("/licenses/:id", authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    try {
      req.audit?.log?.({
        action: "LICENSE_DELETE",
        targetType: "license",
        targetId: req.params.id,
        statusCode: 400,
        metadata: { reason: "invalid_id" },
      });
    } catch {}
    return res.status(400).json({ message: "Invalid id" });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Capture old value before delete
    const [[oldLicense]] = await pool.query(`SELECT * FROM licenses WHERE id=?`, [id]);
    const oldValue = oldLicense || null;
    await conn.query(`DELETE FROM license_bands WHERE license_id=?`, [id]);
    const [r] = await conn.query(`DELETE FROM licenses WHERE id=?`, [id]);
    await conn.commit();

    if (r.affectedRows === 0) {
      try {
        req.audit?.log?.({
          action: "LICENSE_DELETE",
          targetType: "license",
          targetId: String(id),
          statusCode: 404,
        });
      } catch {}
      return res.status(404).json({ message: "Not found" });
    }

    try {
      req.audit?.log?.({
        action: "LICENSE_DELETE",
        targetType: "license",
        targetId: String(id),
        statusCode: 204,
        metadata: { oldValue, targetLabel: oldValue?.license_req_no },
      });
    } catch {}

    res.status(204).send();
  } catch (err) {
    await conn.rollback();
    console.error("Delete license error:", err);
    try {
      req.audit?.log?.({
        action: "LICENSE_DELETE",
        targetType: "license",
        targetId: String(id),
        statusCode: 500,
        metadata: { error: String(err?.message || err) },
      });
    } catch {}
    res.status(500).json({ message: "Failed to delete license" });
  } finally {
    conn.release();
  }
});

module.exports = router;
