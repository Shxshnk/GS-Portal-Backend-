const express = require("express");
const router = express.Router();
const { pool } = require("../db");
const { authRequired } = require("../middleware/auth");

/* ---------------- CREATE REQUEST ---------------- */
router.post("/", authRequired, async (req, res) => {
  const payload = req.body?.payload;

  if (
    !payload ||
    !payload.antenna_type ||
    !payload.location ||
    !payload.size_m ||
    !payload.eirp_dbw
  ) {
    return res.status(400).json({
      message: "Invalid or incomplete antenna payload",
    });
  }

  try {
    const requestedBy = req.user?.username || "unknown";

    await pool.query(
      `INSERT INTO antenna_requests (payload, requested_by)
       VALUES (?, ?)`,
      [JSON.stringify(payload), requestedBy]
    );

    res.status(201).json({
      message: "Antenna sent for approval",
    });
  } catch (err) {
    console.error("Create antenna request error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});


/* ---------------- LIST REQUESTS (ADMIN ONLY) ---------------- */
router.get("/", authRequired, async (req, res) => {
  const role = String(
    req.user?.role || req.user?.roleType || req.user?.roleName || ""
  ).toLowerCase();
  if (!["admin", "superadmin"].includes(role)) {
    return res.status(403).json({ message: "Forbidden" });
  }


  const { status = "PENDING" } = req.query;

  try {
    const [rows] = await pool.query(
      `SELECT id, payload, status, requested_by, created_at
       FROM antenna_requests
       WHERE status = ?
       ORDER BY created_at DESC`,
      [status]
    );

    res.json({
      data: rows.map((r) => {
        let payload = {};
        try {
          payload = JSON.parse(r.payload || "{}");
        } catch {
          payload = {};
        }

        return {
          request_id: r.id,
          payload,                // ✅ FULL ORIGINAL PAYLOAD
          status: r.status || "PENDING",
          requested_by: r.requested_by,
          created_at: r.created_at,
        };

      }),
    });




  } catch (err) {
    console.error("List antenna requests error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

/* ---------------- APPROVE (ADMIN ONLY) ---------------- */
router.post("/:id/approve", authRequired, async (req, res) => {
  const role = String(
    req.user?.role || req.user?.roleType || req.user?.roleName || ""
  ).toLowerCase();
  if (!["admin", "superadmin"].includes(role)) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const id = req.params.id;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [[row]] = await conn.query(
      "SELECT payload FROM antenna_requests WHERE id = ? AND status = 'PENDING' FOR UPDATE",
      [id]
    );


    if (!row) {
      await conn.rollback();
      return res.status(404).json({ message: "Request not found" });
    }

    let data;
    try {
      data = typeof row.payload === "string"
        ? JSON.parse(row.payload)
        : row.payload;
    } catch (e) {
      console.error("Invalid JSON payload:", row.payload);
      return res.status(400).json({ message: "Invalid antenna payload" });
    }


    /* ---- insert antenna ---- */
    const [ins] = await conn.query(
      `INSERT INTO antennas
       (antenna_type, location, size_m, eirp_dbw,
        tx_polarization, rx_polarization,
        travel_range, tracking_velocity,
        tracking_acceleration, tracking_modes, added_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.antenna_type,
        data.location || null,
        Number.isFinite(Number(data.size_m)) ? Number(data.size_m) : null,
        Number.isFinite(Number(data.eirp_dbw)) ? Number(data.eirp_dbw) : null,
        data.tx_polarization || null,
        data.rx_polarization || null,
        data.travel_range || null,
        data.tracking_velocity || null,
        data.tracking_acceleration || null,
        data.tracking_modes || null,
        data.added_by || "Admin",
      ]
    );

    const antennaId = ins.insertId;

    /* ---- copy bands ---- */
    if (Array.isArray(data.bands) && data.bands.length) {
      const values = data.bands
        .map((b) => [
          antennaId,
          String(b.band || "").trim(),
          b.uplink ? 1 : 0,
          b.downlink ? 1 : 0,
        ])
        .filter((v) => v[1]);

      if (values.length) {
        await conn.query(
          "INSERT INTO antenna_bands (antenna_id, band, uplink, downlink) VALUES ?",
          [values]
        );
      }
    }

    /* ---- copy receive_gt ---- */
    if (Array.isArray(data.receive_gt) && data.receive_gt.length) {
      const values = data.receive_gt
        .map((g) => [
          antennaId,
          String(g.band || "").trim(),
          Number(g.gt) || null
          ,
        ])
        .filter((v) => v[1]);

      if (values.length) {
        await conn.query(
          "INSERT INTO antenna_gt (antenna_id, band, gt_db_k) VALUES ?",
          [values]
        );
      }
    }

    /* ---- mark approved ---- */
    await conn.query(
      `UPDATE antenna_requests
       SET status='APPROVED', reviewed_by=?, reviewed_at=NOW()
       WHERE id=?`,
      [req.user?.username || "admin", id]
    );

    await conn.commit();

    res.json({
      message: "Antenna approved",
      antenna_id: antennaId,
    });
  } catch (err) {
    await conn.rollback();
    console.error("Approve antenna request error:", err);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    conn.release();
  }
});

/* ---------------- REJECT (ADMIN ONLY) ---------------- */
router.post("/:id/reject", authRequired, async (req, res) => {
  const role = String(
    req.user?.role || req.user?.roleType || req.user?.roleName || ""
  ).toLowerCase();
  if (!["admin", "superadmin"].includes(role)) {
    return res.status(403).json({ message: "Forbidden" });
  }


  try {
    await pool.query(
      `UPDATE antenna_requests
       SET status='REJECTED', reviewed_by=?, reviewed_at=NOW()
       WHERE id=?`,
      [req.user?.username || "admin", req.params.id]
    );

    res.json({ message: "Antenna rejected" });
  } catch (err) {
    console.error("Reject antenna request error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
