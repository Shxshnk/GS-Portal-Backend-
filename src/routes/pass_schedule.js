// const express = require("express");
// const router = express.Router();
// const multer = require("multer");
// const path = require("path");
// const fs = require("fs");
// const { pool } = require("../db");

// // ---------- multer config ----------
// const PASS_DIR = path.join(__dirname, "..", "..", "uploads", "Pass_schedule");

// const storage = multer.diskStorage({
//   destination: (_req, _file, cb) => cb(null, PASS_DIR),
//   filename: (_req, file, cb) => {
//     const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
//     cb(null, `${Date.now()}_${safe}`);
//   },
// });

// const upload = multer({ storage });

// // ---------- helpers ----------
// function relPathFor(fileName) {
//   return path.join("uploads", "Pass_schedule", fileName);
// }

// async function getById(id) {
//   const [rows] = await pool.query("SELECT * FROM passes_schedule WHERE id = ?", [id]);
//   return rows[0];
// }

// function removeIfExists(absPath) {
//   try {
//     fs.unlinkSync(absPath);
//   } catch (_) {
//     /* ignore */
//   }
// }

// // ---------- CRUD & download ----------

// // List
// router.get("/", async (_req, res) => {
//   try {
//     const [rows] = await pool.query(
//       `SELECT id, document_name, remarks, file_path, created_at, updated_at
//        FROM passes_schedule
//        ORDER BY created_at DESC`
//     );
//     res.json(rows);
//   } catch (e) {
//     res.status(500).json({ error: "Failed to fetch pass schedule files" });
//   }
// });

// // Upload / Create
// router.post("/", upload.single("file"), async (req, res) => {
//   try {
//     if (!req.file) return res.status(400).json({ error: "File is required" });

//     const fileName = req.file.filename;
//     const document_name = req.file.originalname;
//     const { remarks } = req.body;
//     const file_path = relPathFor(fileName);

//     const [r] = await pool.query(
//       `INSERT INTO passes_schedule (document_name, remarks, file_path)
//        VALUES (?, ?, ?)`,
//       [document_name, remarks || null, file_path]
//     );

//     res.status(201).json({
//       id: r.insertId,
//       document_name,
//       remarks: remarks || null,
//       file_path,
//     });
//   } catch (e) {
//     res.status(500).json({ error: "Failed to upload pass schedule file" });
//   }
// });

// // Update (metadata only OR replace file)
// router.put("/:id", upload.single("file"), async (req, res) => {
//   const { id } = req.params;
//   try {
//     const current = await getById(id);
//     if (!current) return res.status(404).json({ error: "Not found" });

//     let document_name = current.document_name;
//     let file_path = current.file_path;

//     if (req.file) {
//       const absOld = path.join(__dirname, "..", "..", current.file_path);
//       removeIfExists(absOld);

//       const newFileName = req.file.filename;
//       document_name = req.file.originalname;
//       file_path = relPathFor(newFileName);
//     }

//     const remarks = req.body.remarks ?? current.remarks;

//     await pool.query(
//       `UPDATE passes_schedule
//          SET document_name = ?, remarks = ?, file_path = ?
//        WHERE id = ?`,
//       [document_name, remarks, file_path, id]
//     );

//     res.json({ id, document_name, remarks, file_path });
//   } catch (e) {
//     res.status(500).json({ error: "Failed to update pass schedule file" });
//   }
// });

// // Delete
// router.delete("/:id", async (req, res) => {
//   const { id } = req.params;
//   try {
//     const current = await getById(id);
//     if (!current) return res.status(404).json({ error: "Not found" });

//     const abs = path.join(__dirname, "..", "..", current.file_path);
//     removeIfExists(abs);

//     await pool.query("DELETE FROM passes_schedule WHERE id = ?", [id]);
//     res.json({ ok: true });
//   } catch (e) {
//     res.status(500).json({ error: "Failed to delete pass schedule file" });
//   }
// });

// // Download
// router.get("/:id/download", async (req, res) => {
//   const { id } = req.params;
//   try {
//     const row = await getById(id);
//     if (!row) return res.status(404).json({ error: "Not found" });

//     const abs = path.join(__dirname, "..", "..", row.file_path);
//     return res.download(abs, row.document_name);
//   } catch (e) {
//     res.status(500).json({ error: "Failed to download" });
//   }
// });

// module.exports = router;

// src/routes/pass_schedule.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { pool } = require("../db");
const { authRequired } = require("../middleware/auth");

// ---------- multer config ----------
const PASS_DIR = path.join(process.cwd(), "uploads", "Pass_schedule");
fs.mkdirSync(PASS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PASS_DIR),
  filename: (_req, file, cb) => {
    const safe = (file.originalname || "file")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(-180); // avoid super long names
    cb(null, `${Date.now()}_${safe}`);
  },
});
const upload = multer({ storage });

// ---------- helpers ----------
function relPathFor(fileName) {
  // store relative path used by static /uploads mount
  return path.join("uploads", "Pass_schedule", fileName);
}
async function getById(id) {
  const [rows] = await pool.query("SELECT * FROM passes_schedule WHERE id = ?", [id]);
  return rows[0];
}
function removeIfExists(absPath) {
  try { fs.unlinkSync(absPath); } catch (_) { /* ignore */ }
}

// ---------- CRUD & download ----------

// List
router.get("/", authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, document_name, remarks, file_path, added_by, created_at, updated_at
       FROM passes_schedule
       ORDER BY created_at DESC`
    );

    try {
      req.audit?.log?.({
        action: "PASS_SCHEDULE_LIST",
        targetType: "pass_schedule",
        targetId: null,
        statusCode: 200,
        metadata: { count: rows.length },
      });
    } catch {}

    res.json(rows);
  } catch (e) {
    console.error("List pass_schedule failed:", e);
    try {
      req.audit?.log?.({
        action: "PASS_SCHEDULE_LIST",
        targetType: "pass_schedule",
        targetId: null,
        statusCode: 500,
        metadata: { error: String(e?.message || e) },
      });
    } catch {}
    res.status(500).json({ error: "Failed to fetch pass schedule files" });
  }
});

// Upload / Create
router.post("/", authRequired, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      try {
        req.audit?.log?.({
          action: "PASS_SCHEDULE_CREATE",
          targetType: "pass_schedule",
          targetId: null,
          statusCode: 400,
          metadata: { reason: "file_missing" },
        });
      } catch {}
      return res.status(400).json({ error: "File is required" });
    }

    const fileName = req.file.filename;
    const document_name = req.file.originalname;
    const { remarks } = req.body;
    const file_path = relPathFor(fileName);

    const [r] = await pool.query(
      `INSERT INTO passes_schedule (document_name, remarks, file_path, added_by)
       VALUES (?, ?, ?, ?)`,
      [document_name, remarks || null, file_path, req.user?.username || null]
    );

    const payload = {
      id: r.insertId,
      document_name,
      remarks: remarks || null,
      file_path,
    };

    try {
      req.audit?.log?.({
        action: "PASS_SCHEDULE_CREATE",
        targetType: "pass_schedule",
        targetId: String(payload.id),
        statusCode: 201,
        metadata: {
          document_name,
          remarks: remarks || null,
          file_path,
          size: req.file.size,
          mimetype: req.file.mimetype,
        },
      });
    } catch {}

    res.status(201).json(payload);
  } catch (e) {
    console.error("Create pass_schedule failed:", e);
    try {
      req.audit?.log?.({
        action: "PASS_SCHEDULE_CREATE",
        targetType: "pass_schedule",
        targetId: null,
        statusCode: 500,
        metadata: { error: String(e?.message || e) },
      });
    } catch {}
    res.status(500).json({ error: "Failed to upload pass schedule file" });
  }
});

// Update (metadata only OR replace file)
router.put("/:id", authRequired, upload.single("file"), async (req, res) => {
  const { id } = req.params;
  try {
    const current = await getById(id);
    if (!current) {
      try {
        req.audit?.log?.({
          action: "PASS_SCHEDULE_UPDATE",
          targetType: "pass_schedule",
          targetId: String(id),
          statusCode: 404,
          metadata: { reason: "not_found" },
        });
      } catch {}
      return res.status(404).json({ error: "Not found" });
    }

    let document_name = current.document_name;
    let file_path = current.file_path;

    if (req.file) {
      // replace file
      const absOld = path.join(process.cwd(), current.file_path);
      removeIfExists(absOld);

      const newFileName = req.file.filename;
      document_name = req.file.originalname;
      file_path = relPathFor(newFileName);
    }

    const remarks = req.body.remarks ?? current.remarks;

    await pool.query(
      `UPDATE passes_schedule
         SET document_name = ?, remarks = ?, file_path = ?, added_by = ?
       WHERE id = ?`,
      [document_name, remarks, file_path, req.user?.username || current.added_by, id]
    );

    const payload = { id, document_name, remarks, file_path };

    try {
      req.audit?.log?.({
        action: "PASS_SCHEDULE_UPDATE",
        targetType: "pass_schedule",
        targetId: String(id),
        statusCode: 200,
        metadata: {
          replaced_file: !!req.file,
          document_name,
          remarks,
          file_path,
          ...(req.file
            ? { new_size: req.file.size, new_mimetype: req.file.mimetype }
            : {}),
        },
      });
    } catch {}

    res.json(payload);
  } catch (e) {
    console.error("Update pass_schedule failed:", e);
    try {
      req.audit?.log?.({
        action: "PASS_SCHEDULE_UPDATE",
        targetType: "pass_schedule",
        targetId: String(req.params.id),
        statusCode: 500,
        metadata: { error: String(e?.message || e) },
      });
    } catch {}
    res.status(500).json({ error: "Failed to update pass schedule file" });
  }
});

// Delete
router.delete("/:id", authRequired, async (req, res) => {
  const { id } = req.params;
  try {
    const current = await getById(id);
    if (!current) {
      try {
        req.audit?.log?.({
          action: "PASS_SCHEDULE_DELETE",
          targetType: "pass_schedule",
          targetId: String(id),
          statusCode: 404,
          metadata: { reason: "not_found" },
        });
      } catch {}
      return res.status(404).json({ error: "Not found" });
    }

    const abs = path.join(process.cwd(), current.file_path);
    removeIfExists(abs);

    await pool.query("DELETE FROM passes_schedule WHERE id = ?", [id]);

    try {
      req.audit?.log?.({
        action: "PASS_SCHEDULE_DELETE",
        targetType: "pass_schedule",
        targetId: String(id),
        statusCode: 200,
        metadata: { file_path: current.file_path },
      });
    } catch {}

    res.json({ ok: true });
  } catch (e) {
    console.error("Delete pass_schedule failed:", e);
    try {
      req.audit?.log?.({
        action: "PASS_SCHEDULE_DELETE",
        targetType: "pass_schedule",
        targetId: String(req.params.id),
        statusCode: 500,
        metadata: { error: String(e?.message || e) },
      });
    } catch {}
    res.status(500).json({ error: "Failed to delete pass schedule file" });
  }
});

// Download
router.get("/:id/download", authRequired, async (req, res) => {
  const { id } = req.params;
  try {
    const row = await getById(id);
    if (!row) {
      try {
        req.audit?.log?.({
          action: "PASS_SCHEDULE_DOWNLOAD",
          targetType: "pass_schedule",
          targetId: String(id),
          statusCode: 404,
          metadata: { reason: "not_found" },
        });
      } catch {}
      return res.status(404).json({ error: "Not found" });
    }

    const abs = path.join(process.cwd(), row.file_path);

    try {
      req.audit?.log?.({
        action: "PASS_SCHEDULE_DOWNLOAD",
        targetType: "pass_schedule",
        targetId: String(id),
        statusCode: 200,
        metadata: { file_path: row.file_path },
      });
    } catch {}

    return res.download(abs, row.document_name);
  } catch (e) {
    console.error("Download pass_schedule failed:", e);
    try {
      req.audit?.log?.({
        action: "PASS_SCHEDULE_DOWNLOAD",
        targetType: "pass_schedule",
        targetId: String(req.params.id),
        statusCode: 500,
        metadata: { error: String(e?.message || e) },
      });
    } catch {}
    res.status(500).json({ error: "Failed to download" });
  }
});

module.exports = router;

