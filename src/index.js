// src/index.js
require("dotenv").config({ override: true });

const { v1 } = require("uuid");

const express = require("express");
const cors = require("cors");
const path = require("path");

/* ---------- crash visibility ---------- */
process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));
process.on("uncaughtException", (e) => console.error("[uncaughtException]", e));

/* ---------- DB (optional) ---------- */
let pool = null;
try {
  ({ pool } = require("./db")); // must export { pool }
} catch (e) {
  console.warn("[boot] DB pool not loaded (ok if unused):", e?.message || e);
}

/* ---------- middleware ---------- */
const makeAudit = (() => {
  try { return require("./middleware/audit"); }
  catch { return () => ({ attach: (_req, _res, next) => next() }); }
})();
const { authRequired } = (() => {
  try { return require("./middleware/auth"); }
  catch { return { authRequired: (_req, _res, next) => next() }; }
})();
const audit = makeAudit(pool);

/* ---------- routers ---------- */
const authRouter = require("./routes/Auth");
const usersRouter = require("./routes/Users");
const assignmentsRouter = require("./routes/assignments");
const entitiesRouter = require("./routes/Entities");
const designationsRouter = require("./routes/Designations");
const rolesRouter = require("./routes/Roles");
const rolePageAccessRouter = require("./routes/rolePageAccess");

const documentsRouter = require("./routes/Documents");
const passScheduleRouter = require("./routes/pass_schedule");
const passesRouter = require("./routes/passes");
const groundStationsRouter = require("./routes/Ground_Stations");
const polarizationRouter = require("./routes/Polarization");
const operationsRouter = require("./routes/Operations");
const satellitesRouter = require("./routes/Satellites");
const licenseRouter = require("./routes/License");
const auditLogsRouter = require("./routes/audit-logs");
const ticketsRouter = require("./routes/Tickets");
const categoriesRouter = require("./routes/Categories");
const antennasRoute = require("./routes/Antennas");
const visibilityScheduleRouter = require("./routes/VisibilitySchedule");
const monitoringRouter = require("./modules/monitoring/routes/monitoring");
const MonitoringPollingService = require("./modules/monitoring/services/MonitoringPollingService");

// Public S3 uploader
const schedulePassesPublic = require("./routes/ShedulePasses");
const tleUpdatePublic = require("./routes/TleUpdate");
const awsManualRouter = require("./routes/awsManualContacts");
// AWS Ground Station read-only router
let awsContactsRouter = null;
try {
  awsContactsRouter = require("./routes/awsContacts");
} catch (e) {
  console.warn(
    "[boot] awsContacts router NOT loaded:",
    e?.message || e
  );
}

const app = express();
app.set("trust proxy", true);

/* ---------- CORS ---------- */
const DEFAULT_ALLOW = ["http://localhost:5173", "http://127.0.0.1:5173"];
const envAllow = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ALLOW_LIST = Array.from(new Set([...DEFAULT_ALLOW, ...envAllow]));

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);            // curl/postman
    return ALLOW_LIST.includes(origin)
      ? cb(null, true)
      : cb(new Error("CORS blocked"), false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
};
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

/* ---------- parsers ---------- */
const maxMb = Number(process.env.UPLOAD_MAX_SIZE_MB || 30);
app.use(express.json({ limit: `${maxMb}mb` }));
app.use(express.urlencoded({ extended: true, limit: `${maxMb}mb` }));

/* ---------- audit ---------- */
app.use(audit.attach);

/* ---------- health ---------- */
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/api/db/health", async (_req, res) => {
  if (!pool) return res.json({ db: null, ok: 1 });
  try {
    const [r] = await pool.query("SELECT 1 AS ok");
    res.json({ db: process.env.DB_NAME, ok: r[0].ok });
  } catch (e) {
    console.error("[db/health] error:", e?.message || e);
    res.status(500).json({ error: "DB connection failed" });
  }
});

/* ---------- static ---------- */
const uploadsDir = path.join(process.cwd(), "uploads");
app.use("/uploads", express.static(uploadsDir));
app.use("/api/uploads", express.static(uploadsDir));

/* ---------- OPEN routes ---------- */
app.use("/api/auth", authRouter);
app.use("/api/pass-schedule", schedulePassesPublic);
app.use("/api/tle-update", tleUpdatePublic);
app.use("/api/aws-contacts/action", awsManualRouter);
// Mount AWS Contacts iff the file loaded successfully.
if (awsContactsRouter) {
  app.use("/api/aws-contacts", awsContactsRouter);
  app.get("/api/aws-contacts/ping", (_req, res) =>
    res.json({ ok: true, msg: "awsContacts router mounted" })
  );
}

/* ---------- PROTECTED routes ---------- */
app.use("/api/users", authRequired, usersRouter);
app.use("/api/assignments", authRequired, assignmentsRouter);
app.use("/api/entities", authRequired, entitiesRouter);
app.use("/api", authRequired, designationsRouter);
app.use("/api/roles", authRequired, rolesRouter);
app.use("/api/roles", authRequired, rolePageAccessRouter);

// app.use("/api/page-access",      authRequired, require("./routes/pageAccess"));
app.use("/api/documents", authRequired, documentsRouter);
app.use("/api/pass-schedule", authRequired, passScheduleRouter);
app.use("/api/passes", authRequired, passesRouter);
app.use("/api/ground-stations", authRequired, groundStationsRouter);
app.use("/api/polarizations", authRequired, polarizationRouter);
app.use("/api", authRequired, operationsRouter);
app.use("/api", authRequired, satellitesRouter);
app.use("/api", authRequired, licenseRouter);
app.use("/api/audit-logs", authRequired, auditLogsRouter);
app.use("/api/tickets", authRequired, ticketsRouter);
app.use("/api/categories", authRequired, categoriesRouter);
app.use("/api/antennas", antennasRoute);
app.use("/api/antenna-requests", require("./routes/AntennaRequests"));
app.use("/api/visibility-schedule", authRequired, visibilityScheduleRouter);
app.use("/api/monitoring", authRequired, monitoringRouter);

/* ---------- 404 & errors ---------- */
app.use((req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, _req, res, _next) => {
  console.error("[error]", err);
  if (String(err?.message || "").includes("CORS blocked")) {
    return res.status(403).json({ error: "CORS blocked" });
  }
  res.status(500).json({ error: "Internal server error" });
});

/* ---------- start ---------- */
const port = Number(process.env.PORT || 4000);
let server = null;
function start() {
  if (server?.listening) return server;
  console.log(`[boot] NODE_ENV=${process.env.NODE_ENV || "development"} | PORT=${port}`);
  console.log("[boot] CORS allowlist:", ALLOW_LIST.join(", "));
  if (awsContactsRouter) console.log("[boot] Routers -> AWS Contacts: ENABLED");
  MonitoringPollingService.start();

  server = app.listen(port, "0.0.0.0", () =>
    console.log(`API running at http://127.0.0.1:${port}`)
  );
  server.on("error", (e) => console.error("[server error]", e));
  return server;
}
start();

module.exports = app;



