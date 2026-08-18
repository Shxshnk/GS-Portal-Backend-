
//p3//
// src/routes/Tickets.js
const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const multer = require("multer");
const archiver = require("archiver"); // ensure: npm i archiver

const { pool } = require("../db");
const { authRequired } = require("../middleware/auth");

/* ----------------------------- helpers ----------------------------- */
function notEmptyStr(v) {
  return typeof v === "string" && v.trim() !== "";
}

async function withTx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    try { await conn.rollback(); } catch {}
    throw e;
  } finally {
    conn.release();
  }
}

/* --------------------------- create ticket -------------------------- */
// POST /api/tickets
router.post("/", authRequired, async (req, res, next) => {
  try {
    const { type, priority, description, categories, target_user_id, title } = req.body;
    const requester_id = req.user.id;

    if (!["request", "issue"].includes(type)) {
      return res.status(400).json({ error: "type must be 'request' or 'issue'" });
    }
    if (!["P1", "P2", "P3"].includes(priority || "")) {
      return res.status(400).json({ error: "priority must be P1/P2/P3" });
    }
    if (!notEmptyStr(target_user_id)) {
      return res.status(400).json({ error: "target_user_id is required" });
    }
    if (String(target_user_id) === String(requester_id)) {
      return res.status(400).json({ error: "cannot send to self" });
    }

    const result = await withTx(async (conn) => {
      // lock counter row for this type
      const [ctr] = await conn.query(
        "SELECT last_no, prefix FROM ticket_counters WHERE type=? FOR UPDATE",
        [type]
      );
      if (!ctr.length) throw new Error("counter missing for type " + type);

      const nextNo = ctr[0].last_no + 1;
      await conn.query("UPDATE ticket_counters SET last_no=? WHERE type=?", [nextNo, type]);
      const ticket_no = `${ctr[0].prefix}-${String(nextNo).padStart(3, "0")}`;

    //   const initialStatus = type === "request" ? "Submitted" : "New";
      const initialStatus = "Submitted";

      const [ins] = await conn.query(
        `INSERT INTO tickets
         (ticket_no, type, title, description, priority, status, requester_id, target_user_id, assignee_id)
         VALUES (?,?,?,?,?,?,?,?,NULL)`,
        [
          ticket_no,
          type,
          notEmptyStr(title) ? title.trim() : null,
          notEmptyStr(description) ? description.trim() : null,
          priority,
          initialStatus,
          requester_id,
          target_user_id,
        ]
      );
      const ticket_id = ins.insertId;

      // categories (optional)
      if (Array.isArray(categories) && categories.length) {
        const values = categories
          .map((c) => Number(c))
          .filter((n) => Number.isInteger(n) && n > 0)
          .map((category_id) => [ticket_id, category_id]);
        if (values.length) {
          await conn.query(
            "INSERT INTO ticket_categories (ticket_id, category_id) VALUES ?",
            [values]
          );
        }
      }

      // status history
      await conn.query(
        "INSERT INTO ticket_status_history (ticket_id, actor_id, from_status, to_status, note) VALUES (?,?,?,?,?)",
        [ticket_id, requester_id, null, initialStatus, "Ticket created"]
      );

      return { ticket_id, ticket_no, status: initialStatus };
    });

    res.json(result);
  } catch (e) {
    next(e);
  }
});

/* ----------------------------- list tickets ----------------------------- */
// GET /api/tickets?type=&scope=&q=&page=&size=&status=
router.get("/", authRequired, async (req, res, next) => {
  try {
    const me = req.user.id;
    const {
      type = "request",
      scope = "inbox",
      status = null,
      q = null,
      page = 1,
      size = 20,
    } = req.query;

    if (!["request", "issue"].includes(type)) {
      return res.status(400).json({ error: "invalid type" });
    }
    if (!["inbox", "sent", "all"].includes(scope)) {
      return res.status(400).json({ error: "invalid scope" });
    }

    const limit = Math.min(Math.max(parseInt(size, 10) || 20, 1), 100);
    const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

    const where = ["t.type = ?"];
    const params = [type];

    if (scope === "inbox") {
      where.push("t.target_user_id = ?");
      params.push(me);
    } else if (scope === "sent") {
      where.push("t.requester_id = ?");
      params.push(me);
    }

    if (status) {
      where.push("t.status = ?");
      params.push(status);
    }
    if (q) {
      where.push(
        "(t.ticket_no LIKE ? OR COALESCE(t.title,'') LIKE ? OR COALESCE(t.description,'') LIKE ?)"
      );
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    const whereSQL = where.length ? ` WHERE ${where.join(" AND ")}` : "";

    const [rows] = await pool.query(
      `
      SELECT
        t.id, t.ticket_no, t.type, t.title, t.description, t.priority, t.status, t.created_at,
        t.requester_id, ru.full_name AS requester_name,
        t.target_user_id, tu.full_name AS target_name,
        t.assignee_id, au.full_name AS assignee_name,

        /* attachment count for UI */
        (SELECT COUNT(*) FROM ticket_attachments ta WHERE ta.ticket_id = t.id) AS attachments_count,

        (
          SELECT h.note
          FROM ticket_status_history h
          WHERE h.ticket_id = t.id
          ORDER BY h.changed_at DESC
          LIMIT 1
        ) AS last_note,
        GROUP_CONCAT(c.name ORDER BY c.name SEPARATOR ', ') AS categories
      FROM tickets t
      JOIN users ru ON ru.id = t.requester_id
      JOIN users tu ON tu.id = t.target_user_id
      LEFT JOIN users au ON au.id = t.assignee_id
      LEFT JOIN ticket_categories tc ON tc.ticket_id = t.id
      LEFT JOIN categories c ON c.id = tc.category_id
      ${whereSQL}
      GROUP BY t.id
      ORDER BY t.created_at DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    res.json({ rows, page: Number(page), size: limit });
  } catch (e) {
    next(e);
  }
});

/* ----------------------------- ticket detail ---------------------------- */
// GET /api/tickets/:id
router.get("/:id", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "bad id" });

    const [[tkt]] = await pool.query(
      `
      SELECT t.*, ru.full_name AS requester_name, tu.full_name AS target_name,
             au.full_name AS assignee_name
      FROM tickets t
      JOIN users ru ON ru.id = t.requester_id
      JOIN users tu ON tu.id = t.target_user_id
      LEFT JOIN users au ON au.id = t.assignee_id
      WHERE t.id = ?`,
      [id]
    );
    if (!tkt) return res.status(404).json({ error: "not found" });

    const [cats] = await pool.query(
      `SELECT c.id, c.name
       FROM ticket_categories tc JOIN categories c ON c.id = tc.category_id
       WHERE tc.ticket_id = ? ORDER BY c.name`,
      [id]
    );

    const [atts] = await pool.query(
      `SELECT id, filename, stored_path, mime_type, file_size, created_at
       FROM ticket_attachments WHERE ticket_id = ? ORDER BY created_at`,
      [id]
    );

    const [comments] = await pool.query(
      `SELECT c.id, c.body, c.author_id, u.full_name AS author_name, c.created_at
       FROM ticket_comments c JOIN users u ON u.id = c.author_id
       WHERE c.ticket_id = ? ORDER BY c.created_at`,
      [id]
    );

    const [hist] = await pool.query(
      `SELECT from_status, to_status, note, changed_at, u.full_name AS actor_name
       FROM ticket_status_history h JOIN users u ON u.id = h.actor_id
       WHERE h.ticket_id = ? ORDER BY h.changed_at`,
      [id]
    );

    res.json({ ticket: tkt, categories: cats, attachments: atts, comments, history: hist });
  } catch (e) {
    next(e);
  }
});

/* ----------------------- update status/assignee/text ---------------------- */
// PATCH /api/tickets/:id
router.patch("/:id", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "bad id" });

    const {
      status = null,
      assignee_id = null,
      title = null,
      description = null,
      note = null,
      priority = null,
    } = req.body;
    const actor_id = req.user.id;

    const out = await withTx(async (conn) => {
      const [[t]] = await conn.query(
        "SELECT status, requester_id, target_user_id, assignee_id FROM tickets WHERE id=? FOR UPDATE",
        [id]
      );
      if (!t) throw new Error("not found");

      // permission: only receiver, assignee, or sender may update
      const isReceiver = String(t.target_user_id) === String(actor_id);
      const isAssignee = t.assignee_id && String(t.assignee_id) === String(actor_id);
      const isSender = String(t.requester_id) === String(actor_id);
      if (!isReceiver && !isAssignee && !isSender) {
        return { forbidden: true };
      }

      const fields = [];
      const params = [];

      if (status && status !== t.status) {
        fields.push("status=?", "status_changed_at=CURRENT_TIMESTAMP");
        params.push(status);
      }
      if (priority && ["P1", "P2", "P3"].includes(priority)) {
        fields.push("priority=?");
        params.push(priority);
      }
      if (notEmptyStr(assignee_id)) {
        fields.push("assignee_id=?");
        params.push(assignee_id);
      }
      if (title !== null) {
        fields.push("title=?");
        params.push(notEmptyStr(title) ? title.trim() : null);
      }
      if (description !== null) {
        fields.push("description=?");
        params.push(notEmptyStr(description) ? description.trim() : null);
      }

      if (!fields.length && !note) return { updated: false };

      if (fields.length) {
        fields.push("updated_at=CURRENT_TIMESTAMP");
        await conn.query(`UPDATE tickets SET ${fields.join(", ")} WHERE id=?`, [...params, id]);
      }

      // history row if there's a status change OR a note
      if (status || note) {
        await conn.query(
          "INSERT INTO ticket_status_history (ticket_id, actor_id, from_status, to_status, note) VALUES (?,?,?,?,?)",
          [id, actor_id, t.status, status || t.status, notEmptyStr(note) ? note.trim() : null]
        );
      }

      return { updated: true };
    });

    if (out.forbidden) return res.status(403).json({ error: "Only recipient/assignee can update" });
    res.json(out);
  } catch (e) {
    next(e);
  }
});

/* --------------------------- replace categories --------------------------- */
router.put("/:id/categories", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { categories = [] } = req.body;
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "bad id" });

    const ids = Array.isArray(categories)
      ? categories.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0)
      : [];

    await withTx(async (conn) => {
      await conn.query("DELETE FROM ticket_categories WHERE ticket_id = ?", [id]);
      if (ids.length) {
        const values = ids.map((c) => [id, c]);
        await conn.query("INSERT INTO ticket_categories (ticket_id, category_id) VALUES ?", [
          values,
        ]);
      }
    });

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* -------------------------------- comments -------------------------------- */
router.post("/:id/comments", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { body } = req.body;
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "bad id" });
    if (!notEmptyStr(body)) return res.status(400).json({ error: "body is required" });

    const author_id = req.user.id;
    const [ins] = await pool.query(
      "INSERT INTO ticket_comments (ticket_id, author_id, body) VALUES (?,?,?)",
      [id, author_id, body.trim()]
    );
    res.json({ id: ins.insertId });
  } catch (e) {
    next(e);
  }
});

/* ------------------------------ attachments ------------------------------ */
const uploadStorage = multer.diskStorage({
  destination: async function (req, file, cb) {
    try {
      const ticketId = req.params.id;
      const dir = path.join(__dirname, "..", "uploads", "tickets", String(ticketId));
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename: function (req, file, cb) {
    const ts = Date.now();
    const safe = file.originalname.replace(/[^\w.\-]+/g, "_");
    cb(null, `${ts}__${safe}`);
  },
});

const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 20 * 1024 * 1024, files: 10 }, // 20MB each, up to 10 files
});

// POST /api/tickets/:id/attachments
router.post("/:id/attachments", authRequired, upload.array("files"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "bad id" });

    const uploader_id = req.user.id;
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "no files uploaded" });

    const values = files.map((f) => [
      id,
      uploader_id,
      f.originalname,
      path.relative(path.join(__dirname, ".."), f.path).replace(/\\/g, "/"),
      f.mimetype,
      f.size,
    ]);

    await pool.query(
      `INSERT INTO ticket_attachments
       (ticket_id, uploader_id, filename, stored_path, mime_type, file_size)
       VALUES ?`,
      [values]
    );

    res.json({ uploaded: files.length });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/tickets/:id/attachments/:attId
router.delete("/:id/attachments/:attId", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const attId = Number(req.params.attId);
    if (!Number.isInteger(id) || !Number.isInteger(attId)) {
      return res.status(400).json({ error: "bad id" });
    }

    const [[row]] = await pool.query(
      "SELECT stored_path FROM ticket_attachments WHERE id=? AND ticket_id=?",
      [attId, id]
    );
    if (!row) return res.status(404).json({ error: "not found" });

    await withTx(async (conn) => {
      await conn.query("DELETE FROM ticket_attachments WHERE id=? AND ticket_id=?", [attId, id]);
    });

    const abs = path.join(__dirname, "..", row.stored_path);
    try { await fsp.unlink(abs); } catch {}
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ------------------------ downloads (single/all) ------------------------ */
// GET /api/tickets/:id/attachments/:attId/download
router.get("/:id/attachments/:attId/download", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const attId = Number(req.params.attId);
    if (!Number.isInteger(id) || !Number.isInteger(attId)) {
      return res.status(400).json({ error: "bad id" });
    }

    const [[t]] = await pool.query(
      "SELECT requester_id, target_user_id, assignee_id FROM tickets WHERE id=?",
      [id]
    );
    if (!t) return res.status(404).json({ error: "not found" });

    const me = String(req.user.id);
    const allowed =
      me === String(t.requester_id) ||
      me === String(t.target_user_id) ||
      (t.assignee_id && me === String(t.assignee_id));
    if (!allowed) return res.status(403).json({ error: "forbidden" });

    const [[att]] = await pool.query(
      "SELECT filename, stored_path, mime_type FROM ticket_attachments WHERE id=? AND ticket_id=?",
      [attId, id]
    );
    if (!att) return res.status(404).json({ error: "not found" });

    const abs = path.join(__dirname, "..", att.stored_path);
    if (!fs.existsSync(abs)) return res.status(404).json({ error: "file missing" });

    res.setHeader("Content-Type", att.mime_type || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${path.basename(att.filename || "file")}"`
    );
    fs.createReadStream(abs).pipe(res);
  } catch (e) {
    next(e);
  }
});

// GET /api/tickets/:id/attachments/download (zip all)
router.get("/:id/attachments/download", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "bad id" });

    const [[t]] = await pool.query(
      "SELECT ticket_no, requester_id, target_user_id, assignee_id FROM tickets WHERE id=?",
      [id]
    );
    if (!t) return res.status(404).json({ error: "not found" });

    const me = String(req.user.id);
    const allowed =
      me === String(t.requester_id) ||
      me === String(t.target_user_id) ||
      (t.assignee_id && me === String(t.assignee_id));
    if (!allowed) return res.status(403).json({ error: "forbidden" });

    const [atts] = await pool.query(
      "SELECT filename, stored_path FROM ticket_attachments WHERE ticket_id=? ORDER BY id",
      [id]
    );
    if (!atts.length) return res.status(404).json({ error: "no attachments" });

    const zipName = `${(t.ticket_no || "ticket")}_attachments.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => next(err));
    archive.pipe(res);

    atts.forEach((a, i) => {
      const abs = path.join(__dirname, "..", a.stored_path);
      if (fs.existsSync(abs)) {
        const name = a.filename ? path.basename(a.filename) : `file_${i + 1}`;
        archive.file(abs, { name });
      }
    });

    archive.finalize();
  } catch (e) {
    next(e);
  }
});



//delete apis//

const PURGE_OK =
  process.env.ALLOW_TICKET_PURGE === "true" || process.env.NODE_ENV !== "production";

/** delete a set of ticket ids (and collect their file paths) inside 1 transaction */
async function deleteTicketsAndCollectFiles(ids = []) {
  if (!ids.length) return { filePaths: [], ids: [] };

  return withTx(async (conn) => {
    // collect file paths first
    const [atts] = await conn.query(
      "SELECT stored_path, ticket_id FROM ticket_attachments WHERE ticket_id IN (?)",
      [ids]
    );

    // delete children
    await conn.query("DELETE FROM ticket_attachments WHERE ticket_id IN (?)", [ids]);
    await conn.query("DELETE FROM ticket_categories WHERE ticket_id IN (?)", [ids]);
    await conn.query("DELETE FROM ticket_comments WHERE ticket_id IN (?)", [ids]);
    await conn.query("DELETE FROM ticket_status_history WHERE ticket_id IN (?)", [ids]);

    // delete tickets
    await conn.query("DELETE FROM tickets WHERE id IN (?)", [ids]);

    return { filePaths: atts.map((a) => a.stored_path), ids };
  });
}

/** Remove files from disk and the per-ticket upload directory */
async function deleteFilesForTickets(filePaths = [], ids = []) {
  // delete individual files (ignore errors)
  await Promise.allSettled(
    filePaths.map((p) => fsp.unlink(path.join(__dirname, "..", p)))
  );
  // delete each ticket's upload folder
  await Promise.allSettled(
    ids.map((id) =>
      fsp.rm(path.join(__dirname, "..", "uploads", "tickets", String(id)), {
        recursive: true,
        force: true,
      })
    )
  );
}

/* DELETE /api/tickets/:id  -> delete a single ticket */
router.delete("/:id", authRequired, async (req, res, next) => {
  try {
    if (!PURGE_OK) return res.status(403).json({ error: "Ticket purge disabled" });

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "bad id" });

    // (Optional) permission check could go here if you need to restrict further.

    const { filePaths, ids } = await deleteTicketsAndCollectFiles([id]);
    await deleteFilesForTickets(filePaths, ids);

    res.json({ ok: true, deleted: ids.length });
  } catch (e) {
    next(e);
  }
});

/* DELETE /api/tickets?type=issue|request  -> bulk delete all tickets of a type */
router.delete("/", authRequired, async (req, res, next) => {
  try {
    if (!PURGE_OK) return res.status(403).json({ error: "Ticket purge disabled" });

    const type = String(req.query.type || "");
    if (!["issue", "request"].includes(type))
      return res.status(400).json({ error: "query param 'type' must be 'issue' or 'request'" });

    // gather all ids first
    const [rows] = await pool.query("SELECT id FROM tickets WHERE type=?", [type]);
    const ids = rows.map((r) => r.id);
    if (!ids.length) return res.json({ ok: true, deleted: 0 });

    const { filePaths, ids: deletedIds } = await deleteTicketsAndCollectFiles(ids);
    await deleteFilesForTickets(filePaths, deletedIds);

    res.json({ ok: true, deleted: deletedIds.length, type });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
