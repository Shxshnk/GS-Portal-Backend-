// src/routes/TleUpdate.js
"use strict";
const express = require("express");
const multer = require("multer");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const router = express.Router();

/* ---------------- Allowed GS & Regions (same defaults as pass-schedule) ---------------- */
const GS_IDS = new Set(["gs1", "gs2"]);
const ALLOWED_REGIONS = new Set(
  (process.env.GS_ALLOWED_REGIONS || "")
    .split(",").map((s) => s.trim()).filter(Boolean)
);
if (ALLOWED_REGIONS.size === 0) {
  ["us-west-2","af-south-1","me-south-1","eu-west-1","sa-east-1"]
    .forEach((r) => ALLOWED_REGIONS.add(r));
}

/* ---------------- Read TLE bucket from env ----------------
   Expect:
     GS1_TLE_BUCKET_us_west_2=...
     GS2_TLE_BUCKET_sa_east_1=...
------------------------------------------------------------ */
function readBucketFromEnv(gs, region) {
  if (!gs || !region) return "";
  const regionKey = String(region).replace(/-/g, "_");
  const key = `${String(gs).toUpperCase()}_TLE_BUCKET_${regionKey}`;
  return (process.env[key] || "").trim();
}

/* ---------------- Multer (txt/tle/json; memory storage) ---------------- */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (Number(process.env.UPLOAD_MAX_SIZE_MB) || 30) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    try {
      const name = (file.originalname || "").toLowerCase();
      const type = (file.mimetype || "").toLowerCase();
      const ok =
        name.endsWith(".txt") || name.endsWith(".tle") || name.endsWith(".json") ||
        type === "text/plain" || type === "application/json";
      if (!ok) return cb(new Error("Only .txt, .tle or .json files are allowed"));
      cb(null, true);
    } catch (e) { cb(e); }
  },
});

/* ---------------- Helpers ---------------- */
const normalizePrefix = (p) => {
  if (!p) return "";
  const core = String(p).replace(/^\/+|\/+$/g, "");
  return core ? core + "/" : "";
};
// ALWAYS store inside configs/ (can override with TLE_S3_PREFIX)
const S3_PREFIX = normalizePrefix(process.env.TLE_S3_PREFIX || "configs/");
const safeKeyPart = (name = "") => String(name).split(/[\\/]/).pop().replace(/[^\w.\-]+/g, "_");

function credsFor(gs) {
  if (gs === "gs1") {
    return {
      accessKeyId: process.env.GS1_AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.GS1_AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.GS1_AWS_SESSION_TOKEN || undefined,
    };
  }
  if (gs === "gs2") {
    return {
      accessKeyId: process.env.GS2_AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.GS2_AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.GS2_AWS_SESSION_TOKEN || undefined,
    };
  }
  return null;
}
function makeS3(gs, region) {
  const creds = credsFor(gs);
  if (!creds?.accessKeyId || !creds?.secretAccessKey) return null;
  return new S3Client({ region, credentials: creds });
}
const s3Url = (bucket, region, key) => `https://${bucket}.s3.${region}.amazonaws.com/${encodeURIComponent(key)}`;

/* ---------------- Debug/Ping ---------------- */
router.get("/ping", (req, res) => {
  const gs = String(req.query.gs || "");
  const region = String(req.query.region || "");
  const envKey = `${gs.toUpperCase()}_TLE_BUCKET_${region.replace(/-/g, "_")}`;
  res.json({
    ok: true,
    prefix: S3_PREFIX,
    allowGs: [...GS_IDS],
    allowRegions: [...ALLOWED_REGIONS],
    envKey,
    bucketFromEnv: readBucketFromEnv(gs, region) || null,
  });
});

/* ---------------- Upload to configs/ ----------------
   POST /api/tle-update/upload?gs=gs1|gs2&region=<allowed>&bucket=<optional>
   body: multipart/form-data { file }
----------------------------------------------------- */
router.post("/upload", upload.single("file"), async (req, res) => {
  const gs = String(req.query.gs || "").toLowerCase();
  const region = String(req.query.region || "").toLowerCase();
  const bucketParam = String(req.query.bucket || "").trim();

  try {
    if (!GS_IDS.has(gs)) return res.status(400).json({ error: "Invalid gs. Use gs1 or gs2." });
    if (!ALLOWED_REGIONS.has(region)) return res.status(400).json({ error: "Invalid region selected." });
    if (!req.file) return res.status(400).json({ error: "file is required (.txt, .tle or .json)" });

    const bucketFromEnv = readBucketFromEnv(gs, region);
    const Bucket = bucketParam || bucketFromEnv;
    if (!Bucket) {
      return res.status(400).json({
        error: "No TLE bucket configured for this GS & region. Provide ?bucket=... or set env mapping.",
        details: { expectedEnvKey: `${gs.toUpperCase()}_TLE_BUCKET_${region.replace(/-/g, "_")}`, gs, region },
      });
    }

    const s3 = makeS3(gs, region);
    if (!s3) return res.status(500).json({ error: "AWS credentials not configured for this GS." });

    const lower = (req.file.originalname || "").toLowerCase();
    const mt = (req.file.mimetype || "").toLowerCase();
    let ContentType = "application/octet-stream";
    if (mt === "application/json" || lower.endsWith(".json")) ContentType = "application/json";
    else if (mt === "text/plain" || lower.endsWith(".txt") || lower.endsWith(".tle")) ContentType = "text/plain";

    const Key = S3_PREFIX + safeKeyPart(req.file.originalname || "tle.txt");

    try {
      const ak = credsFor(gs)?.accessKeyId || "";
      console.log("[TLE UPLOAD]", { gs, region, bucket: Bucket, key: Key, accessKeyId_last4: ak.slice(-4), size: req.file.size, contentType: ContentType });
    } catch {}

    await s3.send(new PutObjectCommand({
      Bucket, Key, Body: req.file.buffer, ContentType,
      ...(process.env.S3_ACL ? { ACL: process.env.S3_ACL } : {}),
    }));

    return res.json({ ok: true, gs, region, bucket: Bucket, key: Key, url: s3Url(Bucket, region, Key), size: req.file.size, name: safeKeyPart(req.file.originalname || "tle.txt"), prefix: S3_PREFIX });
  } catch (err) {
    const meta = err?.$metadata || {};
    const httpStatus = meta.httpStatusCode || 500;
    const headers = meta.httpHeaders || {};
    const amzRegion = headers?.["x-amz-bucket-region"] || null;
    console.error("TLE upload failed:", { name: err?.name, code: err?.Code || err?.code, message: err?.message, httpStatus, amzRegion });
    return res.status(httpStatus).json({
      error: `Upload to S3 failed (${err?.Code || err?.code || err?.name || "Error"})`,
      details: { status: httpStatus, code: err?.Code || err?.code || null, amzRegion },
    });
  }
});

module.exports = router;
