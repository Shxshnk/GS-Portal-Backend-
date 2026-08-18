// // src/middleware/audit.js
// const { v4: uuidv4 } = require("uuid");
// const onFinished = require("on-finished");

// /**
//  * Factory: pass your pool so the middleware can write logs.
//  * Usage: const audit = makeAudit(pool); app.use(audit.attach);
//  */
// function makeAudit(pool) {
//   // attaches per-request context & a logger
//   function attach(req, res, next) {
//     const ctx = {
//       requestId: uuidv4(),
//       method: req.method,
//       route: (req.originalUrl || req.url || "").split("?")[0],
//       ip: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null,
//       ua: req.get("user-agent") || null,
//       startedAt: Date.now(),
//     };

//     // expose context
//     res.locals.auditCtx = ctx;

//     // expose logger to routes: req.audit.log({...})
//     req.audit = {
//       log: async ({ action, targetType = null, targetId = null, metadata = null, statusCode = null }) => {
//         try {
//           const actorUserId = req.user?.id || null; // will be set by authRequired (when present)
//           const code = statusCode ?? res.statusCode ?? null;

//           await pool.query(
//             `INSERT INTO audit_logs
//               (id, request_id, actor_user_id, action, target_type, target_id, metadata,
//                http_method, route, status_code, ip, user_agent)
//              VALUES (UUID(), ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?, ?)`,
//             [
//               ctx.requestId,
//               actorUserId,
//               action,
//               targetType,
//               targetId,
//               metadata ? JSON.stringify(metadata) : null,
//               ctx.method,
//               ctx.route,
//               code,
//               ctx.ip,
//               ctx.ua,
//             ]
//           );
//         } catch (err) {
//           // never block the request because logging failed
//           console.error("audit log failed:", err?.message || err);
//         }
//       },
//     };

//     // optional: auto-log request end as a heartbeat entry (comment out if too noisy)
//     // onFinished(res, async () => {
//     //   await req.audit.log({ action: "REQUEST", metadata: { ms: Date.now() - ctx.startedAt } });
//     // });

//     next();
//   }

//   return { attach };
// }

// module.exports = makeAudit;

// src/middleware/audit.js
const { v4: uuidv4 } = require("uuid");

/** Normalize various IP forms into something friendly */
function cleanIp(raw) {
  if (!raw) return null;
  let ip = String(raw).trim();

  // X-Forwarded-For can be a list; take first hop
  if (ip.includes(",")) ip = ip.split(",")[0].trim();

  // IPv6-mapped IPv4 -> plain IPv4
  if (ip.startsWith("::ffff:")) ip = ip.replace("::ffff:", "");

  // localhost IPv6 -> IPv4
  if (ip === "::1") ip = "127.0.0.1";

  return ip;
}

/**
 * Factory: pass your pool so the middleware can write logs.
 * Usage in index.js:
 *   const makeAudit = require("./middleware/audit");
 *   const audit = makeAudit(pool);
 *   app.use(audit.attach);
 */
function makeAudit(pool) {
  function attach(req, res, next) {
    const ctx = {
      requestId: uuidv4(),
      method: req.method,
      route: (req.originalUrl || req.url || "").split("?")[0],
      // index.js should have: app.set("trust proxy", true)
      ip: cleanIp(req.headers["x-forwarded-for"] || req.ip || req.socket?.remoteAddress),
      ua: req.get("user-agent") || null,
      startedAt: Date.now(),
    };

    // expose context if needed elsewhere
    res.locals.auditCtx = ctx;

    // expose logger to routes: await req.audit.log({ action, targetType, targetId, metadata })
    req.audit = {
      log: async ({ action, targetType = null, targetId = null, metadata = null, statusCode = null }) => {
        try {
          const actorUserId = req.user?.id || null; // set by auth middleware on protected routes
          const code = statusCode ?? res.statusCode ?? null;

          let finalMetadata = metadata || {};
          if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body && Object.keys(req.body).length > 0) {
            const bodyCopy = { ...req.body };
            delete bodyCopy.password;
            if (Object.keys(bodyCopy).length > 0) {
              finalMetadata = { ...finalMetadata, payload: bodyCopy };
            }
          }
          if (Object.keys(finalMetadata).length === 0) finalMetadata = null;

          await pool.query(
            `INSERT INTO audit_logs
              (id, request_id, actor_user_id, action, target_type, target_id, metadata,
               http_method, route, status_code, ip, user_agent)
             VALUES (UUID(), ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?, ?)`,
            [
              ctx.requestId,
              actorUserId,
              action,
              targetType,
              targetId,
              finalMetadata ? JSON.stringify(finalMetadata) : null,
              ctx.method,
              ctx.route,
              code,
              ctx.ip,
              ctx.ua,
            ]
          );
        } catch (err) {
          // never block the request just because logging failed
          console.error("audit log failed:", err?.message || err);
        }
      },
    };

    next();
  }

  return { attach };
}

module.exports = makeAudit;
