// src/routes/ShedulePasses.js
"use strict";

const express = require("express");
const multer = require("multer");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const router = express.Router();

/* =============================================================================
   Allowed GS & Regions
   ========================================================================== */
const GS_IDS = new Set(["gs1", "gs2"]);

const ALLOWED_REGIONS = new Set(
  (process.env.GS_ALLOWED_REGIONS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);
// Default 5 if env missing
if (ALLOWED_REGIONS.size === 0) {
  ["us-west-2", "af-south-1", "me-south-1", "eu-west-1", "sa-east-1"].forEach(
    (r) => ALLOWED_REGIONS.add(r)
  );
}

/* =============================================================================
   Env-driven bucket map
   GS1_BUCKET_us_west_2=...
   GS1_BUCKET_af_south_1=...
   (dash -> underscore)
   ========================================================================== */
function readBucketFromEnv(gs, region) {
  if (!gs || !region) return "";
  const regionKey = String(region).replace(/-/g, "_"); // sa-east-1 -> sa_east_1
  const key = `${String(gs).toUpperCase()}_BUCKET_${regionKey}`;
  return (process.env[key] || "").trim();
}

/* =============================================================================
   Multer (memory, csv/txt only)
   ========================================================================== */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: (Number(process.env.UPLOAD_MAX_SIZE_MB) || 30) * 1024 * 1024, // MB
  },
  fileFilter: (_req, file, cb) => {
    try {
      const name = (file.originalname || "").toLowerCase();
      const type = (file.mimetype || "").toLowerCase();
      const ok =
        name.endsWith(".csv") ||
        name.endsWith(".txt") ||
        type === "text/csv" ||
        type === "text/plain";
      if (!ok) return cb(new Error("Only .csv or .txt files are allowed"));
      cb(null, true);
    } catch (e) {
      cb(e);
    }
  },
});

/* =============================================================================
   Helpers
   ========================================================================== */
const normalizePrefix = (p) => {
  if (!p) return "";
  const core = String(p).replace(/^\/+|\/+$/g, "");
  return core ? core + "/" : "";
};
const S3_PREFIX = normalizePrefix(process.env.S3_PREFIX || "contacts/");

const safeKeyPart = (name = "") =>
  String(name).split(/[\\/]/).pop().replace(/[^\w.\-]+/g, "_");

/** Normalize extensions so we don't end up with ".txt.txt" or ".csv.csv" */
function normalizeExt(name = "", contentType = "") {
  let result = name || "";
  const lower = String(result).toLowerCase();

  // collapse doubled extensions
  if (lower.endsWith(".txt.txt")) result = result.slice(0, -4);
  if (lower.endsWith(".csv.csv")) result = result.slice(0, -4);

  // coerce to expected ext by content type
  if (contentType === "text/plain") {
    if (!/\.txt$/i.test(result)) {
      result = result.replace(/\.(csv|tsv)$/i, "");
      result += ".txt";
    }
  } else if (contentType === "text/csv") {
    if (!/\.csv$/i.test(result)) {
      result = result.replace(/\.(txt|tsv)$/i, "");
      result += ".csv";
    }
  }
  return result;
}

const buildKey = (originalName) =>
  S3_PREFIX + safeKeyPart(originalName || "upload.csv");

function credsFor(gs) {
  if (gs === "gs1") {
    return {
      accessKeyId: process.env.GS1_AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.GS1_AWS_SECRET_ACCESS_KEY,
    };
  }
  if (gs === "gs2") {
    return {
      accessKeyId: process.env.GS2_AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.GS2_AWS_SECRET_ACCESS_KEY,
    };
  }
  return null;
}

function makeS3(gs, region) {
  const creds = credsFor(gs);
  if (!creds?.accessKeyId || !creds?.secretAccessKey) return null;
  return new S3Client({ region, credentials: creds });
}

const s3Url = (bucket, region, key) =>
  `https://${bucket}.s3.${region}.amazonaws.com/${encodeURIComponent(key)}`;

/* =============================================================================
   Public ping (useful for UI sanity checks)
   GET /api/pass-schedule/ping?gs=gs1&region=sa-east-1
   ========================================================================== */
router.get("/ping", (req, res) => {
  const gs = String(req.query.gs || "");
  const region = String(req.query.region || "");
  const envKey = `${gs.toUpperCase()}_BUCKET_${region.replace(/-/g, "_")}`;
  res.json({
    ok: true,
    prefix: S3_PREFIX,
    allowGs: [...GS_IDS],
    allowRegions: [...ALLOWED_REGIONS],
    envKey,
    bucketFromEnv: readBucketFromEnv(gs, region) || null,
  });
});

/* =============================================================================
   Bulk upload
   POST /api/pass-schedule/bulk?gs=gs1|gs2&region=<allowed>&bucket=<optional>
   Body: multipart/form-data with "file"
   NOTE: Public (no auth) — add auth middleware if needed.
   ========================================================================== */
router.post("/bulk", upload.single("file"), async (req, res) => {
  const gs = String(req.query.gs || "").toLowerCase();
  const region = String(req.query.region || "").toLowerCase();
  const bucketParam = String(req.query.bucket || "").trim();

  try {
    // ---- Validate inputs
    if (!GS_IDS.has(gs)) {
      return res.status(400).json({ error: "Invalid gs. Use gs1 or gs2." });
    }
    if (!ALLOWED_REGIONS.has(region)) {
      return res.status(400).json({ error: "Invalid region selected." });
    }
    if (!req.file) {
      return res.status(400).json({ error: "file is required (.csv or .txt)" });
    }

    // ---- Resolve bucket (query param wins over env)
    const bucketFromEnv = readBucketFromEnv(gs, region);
    const Bucket = bucketParam || bucketFromEnv;
    if (!Bucket) {
      return res.status(400).json({
        error:
          "No bucket configured for this GS & region. Provide ?bucket=... or set env mapping.",
        details: {
          expectedEnvKey: `${gs.toUpperCase()}_BUCKET_${region.replace(/-/g, "_")}`,
          gs,
          region,
        },
      });
    }

    // ---- S3 client in target region
    const s3 = makeS3(gs, region);
    if (!s3) {
      return res
        .status(500)
        .json({ error: "AWS credentials not configured for this GS." });
    }

    // ---- Decide content type first
    let ContentType = "application/octet-stream";
    const lower = (req.file.originalname || "").toLowerCase();
    const mt = (req.file.mimetype || "").toLowerCase();
    if (mt === "text/csv" || lower.endsWith(".csv")) ContentType = "text/csv";
    else if (mt === "text/plain" || lower.endsWith(".txt")) ContentType = "text/plain";

    // ---- Normalize filename to avoid ".txt.txt" / ".csv.csv"
    const normalizedName = normalizeExt(req.file.originalname, ContentType);

    // ---- Final S3 key
    const Key = buildKey(normalizedName);

    // ---- Debug (safe)
    try {
      const ak = credsFor(gs)?.accessKeyId || "";
      console.log("[S3 DEBUG]", {
        gs,
        region,
        bucket: Bucket,
        key: Key,
        accessKeyId_last4: ak.slice(-4),
        size: req.file.size,
        contentType: ContentType,
      });
    } catch {}

    // ---- Upload
    await s3.send(
      new PutObjectCommand({
        Bucket,
        Key,
        Body: req.file.buffer,
        ContentType,
        ...(process.env.S3_ACL ? { ACL: process.env.S3_ACL } : {}),
      })
    );

    // ---- Best-effort audit hook (if present)
    try {
      req.audit?.log?.({
        action: "S3_UPLOAD",
        targetType: "s3_object",
        targetId: `${Bucket}/${Key}`,
        metadata: {
          gs,
          region,
          size: req.file.size,
          name: normalizedName,
        },
      });
    } catch {}

    return res.json({
      ok: true,
      gs,
      region,
      bucket: Bucket,
      key: Key,
      url: s3Url(Bucket, region, Key),
      size: req.file.size,
      name: normalizedName,
      prefix: S3_PREFIX,
    });
  } catch (err) {
    const meta = err?.$metadata || {};
    const httpStatus = meta.httpStatusCode || 500;
    const headers = meta.httpHeaders || {};
    const amzRegion = headers?.["x-amz-bucket-region"] || null;

    console.error("S3 upload failed:", {
      name: err?.name,
      code: err?.Code || err?.code,
      message: err?.message,
      httpStatus,
      amzRegion,
    });

    try {
      req.audit?.log?.({
        action: "S3_UPLOAD_FAIL",
        targetType: "s3_object",
        targetId: null,
        statusCode: httpStatus,
        metadata: {
          name: err?.name,
          code: err?.Code || err?.code,
          message: err?.message,
          httpStatus,
          amzRegion,
        },
      });
    } catch {}

    return res.status(httpStatus).json({
      error: `Upload to S3 failed (${err?.Code || err?.code || err?.name || "Error"})`,
      details: {
        status: httpStatus,
        code: err?.Code || err?.code || null,
        amzRegion,
      },
    });
  }
});

module.exports = router;
