// const express = require("express");
// const router = express.Router();
// const multer = require("multer");
// const path = require("path");
// const fs = require("fs");
// const { pool } = require("../db");

// // ---------- multer config ----------
// const DOCUMENTS_DIR = path.join(__dirname, "..", "..", "uploads", "Documents");

// const storage = multer.diskStorage({
//   destination: (_req, _file, cb) => cb(null, DOCUMENTS_DIR),
//   filename: (_req, file, cb) => {
//     const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
//     cb(null, `${Date.now()}_${safe}`);
//   },
// });

// const upload = multer({ storage });

// // ---------- helpers ----------
// function relPathFor(fileName) {
//   // what we store in DB (used later to build download path)
//   return path.join("uploads", "Documents", fileName);
// }

// async function getById(id) {
//   const [rows] = await pool.query("SELECT * FROM documents WHERE id = ?", [id]);
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
//       `SELECT id, document_name, doc_type, remarks, file_path, created_at, updated_at
//        FROM documents
//        ORDER BY created_at DESC`
//     );
//     res.json(rows);
//   } catch (e) {
//     res.status(500).json({ error: "Failed to fetch documents" });
//   }
// });

// // Upload / Create
// router.post("/", upload.single("file"), async (req, res) => {
//   try {
//     const { doc_type, remarks } = req.body;
//     if (!req.file) return res.status(400).json({ error: "File is required" });
//     if (!doc_type) return res.status(400).json({ error: "doc_type is required" });

//     const fileName = req.file.filename;
//     const document_name = req.file.originalname;
//     const file_path = relPathFor(fileName);

//     const [r] = await pool.query(
//       `INSERT INTO documents (document_name, doc_type, remarks, file_path)
//        VALUES (?, ?, ?, ?)`,
//       [document_name, doc_type, remarks || null, file_path]
//     );

//     res.status(201).json({
//       id: r.insertId,
//       document_name,
//       doc_type,
//       remarks: remarks || null,
//       file_path,
//     });
//   } catch (e) {
//     res.status(500).json({ error: "Failed to upload document" });
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

//     // If a new file provided, replace & delete old one
//     if (req.file) {
//       const absOld = path.join(__dirname, "..", "..", current.file_path);
//       removeIfExists(absOld);

//       const newFileName = req.file.filename;
//       document_name = req.file.originalname;
//       file_path = relPathFor(newFileName);
//     }

//     const doc_type = req.body.doc_type ?? current.doc_type;
//     const remarks = req.body.remarks ?? current.remarks;

//     await pool.query(
//       `UPDATE documents
//          SET document_name = ?, doc_type = ?, remarks = ?, file_path = ?
//        WHERE id = ?`,
//       [document_name, doc_type, remarks, file_path, id]
//     );

//     res.json({ id, document_name, doc_type, remarks, file_path });
//   } catch (e) {
//     res.status(500).json({ error: "Failed to update document" });
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

//     await pool.query("DELETE FROM documents WHERE id = ?", [id]);
//     res.json({ ok: true });
//   } catch (e) {
//     res.status(500).json({ error: "Failed to delete document" });
//   }
// });

// // Download
// router.get("/:id/download", async (req, res) => {
//   const { id } = req.params;
//   try {
//     const row = await getById(id);
//     if (!row) return res.status(404).json({ error: "Not found" });

//     const abs = path.join(__dirname, "..", "..", row.file_path);
//     // res.download sets correct headers & filename
//     return res.download(abs, row.document_name);
//   } catch (e) {
//     res.status(500).json({ error: "Failed to download" });
//   }
// });

// module.exports = router;


// src/routes/Documents.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { pool } = require("../db");
const { authRequired } = require("../middleware/auth");

/* ----------------------- multer / filesystem setup ----------------------- */
const DOCUMENTS_DIR = path.join(process.cwd(), "uploads", "Documents");
fs.mkdirSync(DOCUMENTS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, DOCUMENTS_DIR),
  filename: (_req, file, cb) => {
    const safe = (file.originalname || "file")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(-180); // keep path short-ish
    cb(null, `${Date.now()}_${safe}`);
  },
});

const upload = multer({ storage });

/* -------------------------------- helpers -------------------------------- */
function relPathFor(fileName) {
  // path stored in DB
  return path.join("uploads", "Documents", fileName);
}

async function getById(id) {
  const [rows] = await pool.query(
    "SELECT id, document_name, doc_type, remarks, file_path, created_at, updated_at FROM documents WHERE id = ?",
    [id]
  );
  return rows[0];
}

function removeIfExists(absPath) {
  try {
    fs.unlinkSync(absPath);
  } catch (_) { }
}

/* --------------------------------- LIST ---------------------------------- */
// GET /api/documents
router.get("/", authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, document_name, doc_type, remarks, file_path, added_by, created_at, updated_at
       FROM documents
       ORDER BY created_at DESC`
    );

    try {
      req.audit?.log?.({
        action: "DOCUMENT_LIST",
        targetType: "document",
        targetId: null,
        statusCode: 200,
        metadata: { count: rows.length },
      });
    } catch { }

    res.json(rows);
  } catch (e) {
    console.error(e);
    try {
      req.audit?.log?.({
        action: "DOCUMENT_LIST",
        targetType: "document",
        targetId: null,
        statusCode: 500,
        metadata: { error: String(e?.message || e) },
      });
    } catch { }
    res.status(500).json({ error: "Failed to fetch documents" });
  }
});

/* -------------------------------- CREATE --------------------------------- */
// POST /api/documents  (multipart/form-data: file, doc_type, [remarks])
router.post("/", authRequired, upload.single("file"), async (req, res) => {
  if (!req.file) {
    try {
      req.audit?.log?.({
        action: "DOCUMENT_CREATE",
        targetType: "document",
        targetId: null,
        statusCode: 400,
        metadata: { reason: "file_required" },
      });
    } catch { }
    return res.status(400).json({ error: "File is required" });
  }
  const { doc_type, remarks } = req.body || {};
  if (!doc_type) {
    try {
      req.audit?.log?.({
        action: "DOCUMENT_CREATE",
        targetType: "document",
        targetId: null,
        statusCode: 400,
        metadata: { reason: "doc_type_required" },
      });
    } catch { }
    return res.status(400).json({ error: "doc_type is required" });
  }

  try {
    const fileName = req.file.filename;
    const document_name = req.file.originalname;
    const file_path = relPathFor(fileName);

    const [r] = await pool.query(
      `INSERT INTO documents (document_name, doc_type, remarks, file_path, added_by)
       VALUES (?, ?, ?, ?, ?)`,
      [document_name, doc_type, remarks || null, file_path, req.user?.username || null]
    );

    try {
      req.audit?.log?.({
        action: "DOCUMENT_CREATE",
        targetType: "document",
        targetId: String(r.insertId),
        statusCode: 201,
        metadata: { newValue: { id: r.insertId, document_name, doc_type, file_path }, targetLabel: document_name },
      });
    } catch { }

    res.status(201).json({
      id: r.insertId,
      document_name,
      doc_type,
      remarks: remarks || null,
      file_path,
      added_by: req.user?.username || null,
    });
  } catch (e) {
    console.error(e);
    try {
      req.audit?.log?.({
        action: "DOCUMENT_CREATE",
        targetType: "document",
        targetId: null,
        statusCode: 500,
        metadata: { error: String(e?.message || e) },
      });
    } catch { }
    res.status(500).json({ error: "Failed to upload document" });
  }
});

/* -------------------------------- UPDATE --------------------------------- */
// PUT /api/documents/:id  (multipart: optional file + doc_type/remarks)
router.put("/:id", authRequired, upload.single("file"), async (req, res) => {
  const { id } = req.params;

  try {
    const current = await getById(id);
    if (!current) {
      try {
        req.audit?.log?.({
          action: "DOCUMENT_UPDATE",
          targetType: "document",
          targetId: id,
          statusCode: 404,
          metadata: { reason: "not_found" },
        });
      } catch { }
      return res.status(404).json({ error: "Not found" });
    }

    let document_name = current.document_name;
    let file_path = current.file_path;
    let replacedFile = false;

    // Replace file if new file provided
    if (req.file) {
      const absOld = path.join(process.cwd(), current.file_path);
      removeIfExists(absOld);

      const newFileName = req.file.filename;
      document_name = req.file.originalname;
      file_path = relPathFor(newFileName);
      replacedFile = true;
    }

    const doc_type = req.body.doc_type ?? current.doc_type;
    const remarks = req.body.remarks ?? current.remarks;

    await pool.query(
      `UPDATE documents
         SET document_name = ?, doc_type = ?, remarks = ?, file_path = ?, added_by = ?
       WHERE id = ?`,
      [document_name, doc_type, remarks, file_path, req.user?.username || current.added_by, id]
    );

    try {
      req.audit?.log?.({
        action: "DOCUMENT_UPDATE",
        targetType: "document",
        targetId: id,
        statusCode: 200,
        metadata: {
          oldValue: current,
          newValue: { id, document_name, doc_type, remarks, file_path, added_by: req.user?.username || current.added_by },
          targetLabel: document_name,
          replacedFile,
        },
      });
    } catch { }

    res.json({ id, document_name, doc_type, remarks, file_path });
  } catch (e) {
    console.error(e);
    try {
      req.audit?.log?.({
        action: "DOCUMENT_UPDATE",
        targetType: "document",
        targetId: req.params.id,
        statusCode: 500,
        metadata: { error: String(e?.message || e) },
      });
    } catch { }
    res.status(500).json({ error: "Failed to update document" });
  }
});

/* -------------------------------- DELETE --------------------------------- */
// DELETE /api/documents/:id
router.delete("/:id", authRequired, async (req, res) => {
  const { id } = req.params;
  try {
    const current = await getById(id);
    if (!current) {
      try {
        req.audit?.log?.({
          action: "DOCUMENT_DELETE",
          targetType: "document",
          targetId: id,
          statusCode: 404,
          metadata: { reason: "not_found" },
        });
      } catch { }
      return res.status(404).json({ error: "Not found" });
    }

    const abs = path.join(process.cwd(), current.file_path);
    removeIfExists(abs);

    const [r] = await pool.query("DELETE FROM documents WHERE id = ?", [id]);

    try {
      req.audit?.log?.({
        action: "DOCUMENT_DELETE",
        targetType: "document",
        targetId: id,
        statusCode: 200,
        metadata: { oldValue: current, targetLabel: current.document_name },
      });
    } catch { }

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    try {
      req.audit?.log?.({
        action: "DOCUMENT_DELETE",
        targetType: "document",
        targetId: req.params.id,
        statusCode: 500,
        metadata: { error: String(e?.message || e) },
      });
    } catch { }
    res.status(500).json({ error: "Failed to delete document" });
  }
});

/* ------------------------------- DOWNLOAD -------------------------------- */
// GET /api/documents/:id/download
router.get("/:id/download", authRequired, async (req, res) => {
  const { id } = req.params;
  try {
    const row = await getById(id);
    if (!row) {
      try {
        req.audit?.log?.({
          action: "DOCUMENT_DOWNLOAD",
          targetType: "document",
          targetId: id,
          statusCode: 404,
          metadata: { reason: "not_found" },
        });
      } catch { }
      return res.status(404).json({ error: "Not found" });
    }

    const abs = path.join(process.cwd(), row.file_path);
    // Optional: stat for size in audit
    let size = null;
    try { size = fs.statSync(abs).size; } catch { }

    try {
      req.audit?.log?.({
        action: "DOCUMENT_DOWNLOAD",
        targetType: "document",
        targetId: id,
        statusCode: 200,
        metadata: { file_path: row.file_path, size },
      });
    } catch { }

    return res.download(abs, row.document_name);
  } catch (e) {
    console.error(e);
    try {
      req.audit?.log?.({
        action: "DOCUMENT_DOWNLOAD",
        targetType: "document",
        targetId: req.params.id,
        statusCode: 500,
        metadata: { error: String(e?.message || e) },
      });
    } catch { }
    res.status(500).json({ error: "Failed to download" });
  }
});

module.exports = router;
