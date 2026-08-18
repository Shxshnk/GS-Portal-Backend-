const express = require("express");
const router = express.Router();
const { pool } = require("../db");
const { v4: uuidv4 } = require("uuid");
const { authRequired } = require("../middleware/auth");

/* GET role pages */
router.get("/:roleId/pages", authRequired, async (req, res) => {
  const { roleId } = req.params;
  try {
    const [rows] = await pool.query(
      "SELECT page_key, access_level FROM role_page_access WHERE role_id = ?",
      [roleId]
    );

    const viewerPages = rows.filter(r => r.access_level === 'viewer').map(r => r.page_key);
    const editorPages = rows.filter(r => r.access_level === 'editor').map(r => r.page_key);

    // If a page has 'editor' access, ensure it's also marked as 'viewer' for the frontend state
    const combinedViewerPages = Array.from(new Set([...viewerPages, ...editorPages]));

    res.json({ viewerPages: combinedViewerPages, editorPages });
  } catch (err) {
    console.error("GET /roles/:id/pages failed:", err);
    res.status(500).json({ error: "Failed to load role pages" });
  }
});

/* SAVE role pages */
router.post("/:roleId/pages", authRequired, async (req, res) => {
  const { roleId } = req.params;
  const viewerPages = Array.isArray(req.body.viewerPages) ? req.body.viewerPages : [];
  const editorPages = Array.isArray(req.body.editorPages) ? req.body.editorPages : [];

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      "DELETE FROM role_page_access WHERE role_id = ?",
      [roleId]
    );

    const rows = [];
    const addedPages = new Set();

    // Editor pages imply viewer access, we insert them as 'editor'
    for (const p of editorPages) {
      if (!addedPages.has(p)) {
        rows.push([uuidv4(), roleId, p, 'editor']);
        addedPages.add(p);
      }
    }

    // Insert any remaining viewer-only pages
    for (const p of viewerPages) {
      if (!addedPages.has(p)) {
        rows.push([uuidv4(), roleId, p, 'viewer']);
        addedPages.add(p);
      }
    }

    if (rows.length) {
      await conn.query(
        "INSERT INTO role_page_access (id, role_id, page_key, access_level) VALUES ?",
        [rows]
      );
    }

    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    console.error("POST /roles/:id/pages failed:", e);
    res.status(500).json({ error: "Failed to save role pages" });
  } finally {
    conn.release();
  }
});

module.exports = router;
