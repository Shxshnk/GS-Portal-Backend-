// src/routes/Categories.js
const express = require("express");
const router = express.Router();

// 🔧 make this robust to either export style from src/db.js
const db = require("../db");
const pool = db.pool || db;   // <-- use the actual mysql2/promise pool

// GET /api/categories
router.get("/", async (_req, res, next) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name FROM categories ORDER BY name"
    );
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
