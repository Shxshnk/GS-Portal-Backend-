
//p3//
// src/routes/audit-logs.js
const express = require("express");
const router = express.Router();
const { pool } = require("../db");
const { authRequired } = require("../middleware/auth");

/** Optional: restrict viewing logs to Admins */
async function requireAdmin(req, res, next) {
  try {
    const [[row]] = await pool.query(
      `SELECT r.name AS roleName
         FROM users u
         JOIN roles r ON r.id = u.role_id
        WHERE u.id = ?
        LIMIT 1`,
      [req.user.id]
    );

    if (!row || row.roleName?.toLowerCase() !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    next();
  } catch (e) {
    console.error("requireAdmin failed:", e);
    return res.status(500).json({ error: "Auth check failed" });
  }
}


// allow sorting only by real columns
const SAFE_SORT = new Set(["created_at", "action", "status_code", "http_method", "route"]);
function sortClause(sort_by = "created_at", sort_order = "desc") {
  const col = SAFE_SORT.has(String(sort_by)) ? String(sort_by) : "created_at";
  const dir = String(sort_order).toLowerCase() === "asc" ? "ASC" : "DESC";
  return `al.${col} ${dir}`;
}

/* ---------- EXISTING RICH ENDPOINTS ---------- */

/**
 * GET /api/audit-logs
 * Filters: page, pageSize, actorId, action, targetType, targetId, statusCode,
 *          dateFrom, dateTo, q, sort_by, sort_order
 */
router.get("/", authRequired, requireAdmin, async (req, res) => {
  try {
    const {
      page = 1, pageSize = 50,
      actorId, action, targetType, targetId, statusCode,
      dateFrom, dateTo, q,
      sort_by, sort_order,
    } = req.query;

    const limit = Math.min(parseInt(pageSize, 10) || 50, 200);
    const offset = ((parseInt(page, 10) || 1) - 1) * limit;

    const where = [];
    const params = [];

    if (actorId) { where.push("al.actor_user_id = ?"); params.push(actorId); }
    if (action) { where.push("al.action = ?"); params.push(action); }
    if (targetType) { where.push("al.target_type = ?"); params.push(targetType); }
    if (targetId) { where.push("al.target_id = ?"); params.push(targetId); }
    if (statusCode) { where.push("al.status_code = ?"); params.push(parseInt(statusCode, 10)); }

    if (dateFrom) { where.push("DATE(al.created_at) >= ?"); params.push(dateFrom); }
    if (dateTo) { where.push("DATE(al.created_at) <= ?"); params.push(dateTo); }

    if (q) {
      // search action/target/route/http_method plus metadata JSON text
      where.push(`(
        al.action LIKE ? OR
        al.target_type LIKE ? OR
        al.target_id LIKE ? OR
        al.route LIKE ? OR
        al.http_method LIKE ? OR
        JSON_UNQUOTE(JSON_EXTRACT(al.metadata, '$')) LIKE ?
      )`);
      for (let i = 0; i < 6; i++) params.push(`%${q}%`);
    }

    const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const orderSQL = `ORDER BY ${sortClause(sort_by, sort_order)}`;

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total
         FROM audit_logs al
         ${whereSQL}`,
      params
    );

    const [rows] = await pool.query(
      `SELECT
         al.id,
         al.created_at        AS createdAt,
         DATE_FORMAT(CONVERT_TZ(al.created_at, '+00:00', '+05:30'), '%Y-%m-%d %H:%i:%s') AS createdAtIST,
         al.request_id        AS requestId,
         al.actor_user_id     AS actorUserId,
         u.username           AS actorUsername,
         u.email              AS actorEmail,
         al.action,
         al.route,
         al.http_method       AS httpMethod,
         al.target_type       AS targetType,
         al.target_id         AS targetId,
         al.status_code       AS statusCode,
         al.ip,
         al.user_agent        AS userAgent,
         al.metadata
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.actor_user_id
       ${whereSQL}
       ${orderSQL}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({ data: rows, page: Number(page), pageSize: limit, total });
  } catch (err) {
    console.error("GET /audit-logs failed:", err);
    res.status(500).json({ error: "Failed to fetch audit logs" });
  }
});

/** GET /api/audit-logs/actions */
router.get("/actions", authRequired, requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(`SELECT DISTINCT action FROM audit_logs ORDER BY action ASC`);
    res.json(rows.map(r => r.action));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch actions" });
  }
});

/** Export (rich) */
router.get("/export", authRequired, requireAdmin, async (req, res) => {
  try {
    const where = [];
    const params = [];
    const { actorId, action, targetType, targetId, statusCode, dateFrom, dateTo, q } = req.query;

    if (actorId) { where.push("al.actor_user_id = ?"); params.push(actorId); }
    if (action) { where.push("al.action = ?"); params.push(action); }
    if (targetType) { where.push("al.target_type = ?"); params.push(targetType); }
    if (targetId) { where.push("al.target_id = ?"); params.push(targetId); }
    if (statusCode) { where.push("al.status_code = ?"); params.push(parseInt(statusCode, 10)); }
    if (dateFrom) { where.push("DATE(al.created_at) >= ?"); params.push(dateFrom); }
    if (dateTo) { where.push("DATE(al.created_at) <= ?"); params.push(dateTo); }
    if (q) {
      where.push(`(
        al.action LIKE ? OR
        al.target_type LIKE ? OR
        al.target_id LIKE ? OR
        al.route LIKE ? OR
        al.http_method LIKE ? OR
        JSON_UNQUOTE(JSON_EXTRACT(al.metadata, '$')) LIKE ?
      )`);
      for (let i = 0; i < 6; i++) params.push(`%${q}%`);
    }
    const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [rows] = await pool.query(
      `SELECT
        //  al.created_at,
        DATE_FORMAT(CONVERT_TZ(al.created_at, '+00:00', '+05:30'), '%d/%m/%Y %H:%i:%s') AS created_at,

         al.action,
         al.route,
         al.http_method,
         al.target_type,
         al.target_id,
         al.status_code,
         al.request_id,
         al.ip,
         COALESCE(u.username,'') AS actor_username,
         COALESCE(u.email,'')    AS actor_email,
         JSON_UNQUOTE(JSON_EXTRACT(al.metadata,'$')) AS metadata
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.actor_user_id
       ${whereSQL}
       ORDER BY al.created_at DESC
       LIMIT 100000`,
      params
    );

    const format = String(req.query.format || "csv").toLowerCase();
    if (format === "json") return res.json({ total: rows.length, data: rows });

    const headers = Object.keys(rows[0] || {
      created_at: "", action: "", route: "", http_method: "",
      target_type: "", target_id: "", status_code: "", request_id: "", ip: "",
      actor_username: "", actor_email: "", metadata: ""
    });
    const esc = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const csv = [headers.join(",")]
      .concat(rows.map(r => headers.map(h => esc(r[h])).join(",")))
      .join("\n");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="audit_logs_${ts}.csv"`);
    res.send(csv);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to export audit logs" });
  }
});

/* ---------- NEW: SIMPLE (lean) ENDPOINTS ---------- */

/** Derive a human “module” name from target_type/route */
const MODULE_SQL = `
  TRIM(BOTH '/' FROM (
    CASE
      WHEN al.target_type IS NOT NULL AND al.target_type <> '' THEN al.target_type
      WHEN al.route LIKE '/api/satellites%'      THEN 'satellite'
      WHEN al.route LIKE '/api/passes%'          THEN 'pass'
      WHEN al.route LIKE '/api/ground-stations%' THEN 'ground_station'
      WHEN al.route LIKE '/api/polarizations%'   THEN 'polarization'
      WHEN al.route LIKE '/api/licenses%'        THEN 'license'
      WHEN al.route LIKE '/api/documents%'       THEN 'document'
      WHEN al.route LIKE '/api/entities%'        THEN 'entity'
      WHEN al.route LIKE '/api/users%'           THEN 'user'
      ELSE 'misc'
    END
  ))
`;

/** Clean typical IP artefacts when reading historical rows */
const IP_SQL = `
  REPLACE(REPLACE(al.ip, '::ffff:', ''), '::1', '127.0.0.1')
`;

/**
 * GET /api/audit-logs/simple
 * Returns: { dateTimeIST, user, module, action, ip }
 */
router.get("/simple", authRequired, requireAdmin, async (req, res) => {
  try {
    const { page = 1, pageSize = 50, q, dateFrom, dateTo, type } = req.query;
    const limit = Math.min(parseInt(pageSize, 10) || 50, 200);
    const offset = ((parseInt(page, 10) || 1) - 1) * limit;

    const where = [];
    const params = [];

    if (dateFrom) { where.push("DATE(al.created_at) >= ?"); params.push(dateFrom); }
    if (dateTo) { where.push("DATE(al.created_at) <= ?"); params.push(dateTo); }

    const EVENT_SQL = "(al.action LIKE '%CREATE%' OR al.action LIKE '%UPDATE%' OR al.action LIKE '%EDIT%' OR al.action LIKE '%DELETE%' OR al.action LIKE '%APPROVE%' OR al.action LIKE '%REJECT%' OR al.action LIKE '%SUPPORT%' OR al.action LIKE '%CANCEL%' OR al.action LIKE '%UPLOAD%' OR al.action LIKE '%IMPORT%' OR al.action LIKE '%ASSIGN%' OR al.action LIKE '%REVOKE%' OR al.action LIKE '%REQUEST%' OR al.action LIKE '%PUBLISH%') AND al.action NOT LIKE '%_LIST' AND al.action NOT LIKE '%_GET' AND al.action NOT LIKE '%_EXPORT' AND al.action NOT LIKE '%_STATS'";
    if (type === "event") {
      where.push(EVENT_SQL);
    } else if (type === "access") {
      where.push("(al.action LIKE '%LOGIN%' OR al.action LIKE '%LOGOUT%')");
    }

    if (q) {
      where.push(`(
        COALESCE(u.username, u.email, JSON_UNQUOTE(JSON_EXTRACT(al.metadata, '$.username'))) LIKE ? OR
        (CASE
           WHEN al.route LIKE '/api/satellites%'      THEN 'Satellites'
           WHEN al.route LIKE '/api/passes%'          THEN 'Passes'
           WHEN al.route LIKE '/api/visibility-schedule%' THEN 'Visibility Schedule'
           WHEN al.route LIKE '/api/ground-stations%' THEN 'Ground Stations'
           WHEN al.route LIKE '/api/polarizations%'   THEN 'Polarizations'
           WHEN al.route LIKE '/api/licenses%'        THEN 'Licenses'
           WHEN al.route LIKE '/api/documents%'       THEN 'Documents'
           WHEN al.route LIKE '/api/entities%'        THEN 'Entities'
           WHEN al.route LIKE '/api/users%'           THEN 'Users'
           WHEN al.route LIKE '/api/roles%'           THEN 'Roles'
           WHEN al.route LIKE '/api/auth%'            THEN 'Auth'
           WHEN al.target_type IS NOT NULL AND al.target_type <> '' THEN al.target_type
           ELSE 'System'
         END) LIKE ? OR
        al.action LIKE ?
      )`);
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total
         FROM audit_logs al
         LEFT JOIN users u ON u.id = al.actor_user_id
         ${whereSQL}`,
      params
    );

    // Send UTC timestamp. Client will render IST.
    const [rows] = await pool.query(
      `SELECT
         UNIX_TIMESTAMP(al.created_at) AS tsUtc,
         COALESCE(u.username, u.email, JSON_UNQUOTE(JSON_EXTRACT(al.metadata, '$.username')), '') AS user,
         TRIM(BOTH '/' FROM (
           CASE
             WHEN al.route LIKE '/api/satellites%'      THEN 'Satellites'
             WHEN al.route LIKE '/api/passes%'          THEN 'Passes'
             WHEN al.route LIKE '/api/visibility-schedule%' THEN 'Visibility Schedule'
             WHEN al.route LIKE '/api/ground-stations%' THEN 'Ground Stations'
             WHEN al.route LIKE '/api/polarizations%'   THEN 'Polarizations'
             WHEN al.route LIKE '/api/licenses%'        THEN 'Licenses'
             WHEN al.route LIKE '/api/documents%'       THEN 'Documents'
             WHEN al.route LIKE '/api/entities%'        THEN 'Entities'
             WHEN al.route LIKE '/api/users%'           THEN 'Users'
             WHEN al.route LIKE '/api/roles%'           THEN 'Roles'
             WHEN al.route LIKE '/api/auth%'            THEN 'Auth'
             WHEN al.target_type IS NOT NULL AND al.target_type <> '' THEN al.target_type
             ELSE 'System'
           END
         )) AS module,
         al.action AS action,
         JSON_UNQUOTE(JSON_EXTRACT(al.metadata, '$')) AS remarks
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.actor_user_id
       ${whereSQL}
       ORDER BY al.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({ page: Number(page), pageSize: limit, total, data: rows });
  } catch (err) {
    console.error("GET /audit-logs/simple failed:", err);
    res.status(500).json({ error: "Failed to fetch audit logs (simple)" });
  }
});

/** GET /api/audit-logs/simple/export  (CSV) */
router.get("/simple/export", authRequired, requireAdmin, async (req, res) => {
  try {
    const { q, dateFrom, dateTo, type } = req.query;

    const where = [];
    const params = [];
    if (dateFrom) { where.push("DATE(al.created_at) >= ?"); params.push(dateFrom); }
    if (dateTo) { where.push("DATE(al.created_at) <= ?"); params.push(dateTo); }

    const EVENT_SQL = "(al.action LIKE '%CREATE%' OR al.action LIKE '%UPDATE%' OR al.action LIKE '%EDIT%' OR al.action LIKE '%DELETE%' OR al.action LIKE '%APPROVE%' OR al.action LIKE '%REJECT%' OR al.action LIKE '%SUPPORT%' OR al.action LIKE '%CANCEL%' OR al.action LIKE '%UPLOAD%' OR al.action LIKE '%IMPORT%' OR al.action LIKE '%ASSIGN%' OR al.action LIKE '%REVOKE%' OR al.action LIKE '%REQUEST%' OR al.action LIKE '%PUBLISH%') AND al.action NOT LIKE '%_LIST' AND al.action NOT LIKE '%_GET' AND al.action NOT LIKE '%_EXPORT' AND al.action NOT LIKE '%_STATS'";
    if (type === "event") {
      where.push(EVENT_SQL);
    } else if (type === "access") {
      where.push("(al.action LIKE '%LOGIN%' OR al.action LIKE '%LOGOUT%')");
    }
    if (q) {
      where.push(`(
        COALESCE(u.username, u.email, JSON_UNQUOTE(JSON_EXTRACT(al.metadata, '$.username'))) LIKE ? OR
        (CASE
           WHEN al.route LIKE '/api/satellites%'      THEN 'Satellites'
           WHEN al.route LIKE '/api/passes%'          THEN 'Passes'
           WHEN al.route LIKE '/api/visibility-schedule%' THEN 'Visibility Schedule'
           WHEN al.route LIKE '/api/ground-stations%' THEN 'Ground Stations'
           WHEN al.route LIKE '/api/polarizations%'   THEN 'Polarizations'
           WHEN al.route LIKE '/api/licenses%'        THEN 'Licenses'
           WHEN al.route LIKE '/api/documents%'       THEN 'Documents'
           WHEN al.route LIKE '/api/entities%'        THEN 'Entities'
           WHEN al.route LIKE '/api/users%'           THEN 'Users'
           WHEN al.route LIKE '/api/roles%'           THEN 'Roles'
           WHEN al.route LIKE '/api/auth%'            THEN 'Auth'
           WHEN al.target_type IS NOT NULL AND al.target_type <> '' THEN al.target_type
           ELSE 'System'
         END) LIKE ? OR
        al.action LIKE ?
      )`);
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

    // IST = UTC + 330 minutes; use DATE_ADD to avoid tz tables.
    const [rows] = await pool.query(
      `SELECT
        
        DATE_FORMAT(CONVERT_TZ(al.created_at, '+00:00', '+05:30'), '%d/%m/%Y %H:%i:%s') AS "Date & Time (IST)",

         COALESCE(u.username, u.email, JSON_UNQUOTE(JSON_EXTRACT(al.metadata, '$.username')), '') AS "User",
         TRIM(BOTH '/' FROM (
           CASE
             WHEN al.route LIKE '/api/satellites%'      THEN 'Satellites'
             WHEN al.route LIKE '/api/passes%'          THEN 'Passes'
             WHEN al.route LIKE '/api/visibility-schedule%' THEN 'Visibility Schedule'
             WHEN al.route LIKE '/api/ground-stations%' THEN 'Ground Stations'
             WHEN al.route LIKE '/api/polarizations%'   THEN 'Polarizations'
             WHEN al.route LIKE '/api/licenses%'        THEN 'Licenses'
             WHEN al.route LIKE '/api/documents%'       THEN 'Documents'
             WHEN al.route LIKE '/api/entities%'        THEN 'Entities'
             WHEN al.route LIKE '/api/users%'           THEN 'Users'
             WHEN al.route LIKE '/api/roles%'           THEN 'Roles'
             WHEN al.route LIKE '/api/auth%'            THEN 'Auth'
             WHEN al.target_type IS NOT NULL AND al.target_type <> '' THEN al.target_type
             ELSE 'System'
           END
         )) AS "Module",
         al.action AS "Action"
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.actor_user_id
       ${whereSQL}
       ORDER BY al.created_at DESC
       LIMIT 100000`,
      params
    );

    const headers = rows.length ? Object.keys(rows[0]) : ["Date & Time (IST)", "User", "Module", "Action"];
    const esc = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const csv = [headers.join(",")]
      .concat(rows.map(r => headers.map(h => esc(r[h])).join(",")))
      .join("\n");

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="audit_logs_simple_${ts}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error("GET /audit-logs/simple/export failed:", err);
    res.status(500).json({ error: "Failed to export simple audit logs" });
  }
});

module.exports = router;
