// src/routes/awsManualContacts.js
"use strict";

/**
 * POST /api/aws-contacts/action
 * Body:
 * {
 *   action: "reserve" | "cancel",
 *   contactIds: Array<string | { startTime, endTime, satelliteArn?, groundStation?, missionProfileArn? }> ,
 *   gs?: "gs1"|"gs2",
 *   region: string,
 *   groundStation?: string (optional)
 * }
 *
 * Behavior:
 *  - Strings are treated as contactId attempts first; fallback logic tries AVAILABLE contacts (for reserve only).
 *  - Descriptor objects attempt to find a matching contact; if none, ReserveContact by params is attempted.
 *  - Cancel only works on real contactIds; if AWS reports "not found" we treat as already-cancelled.
 */

const express = require("express");
const router = express.Router();
const {
  GroundStationClient,
  ReserveContactCommand,
  CancelContactCommand,
  ListContactsCommand,
} = require("@aws-sdk/client-groundstation");

function credsFor(gs) {
  const key = String(gs || "").toLowerCase();
  if (key === "gs1") {
    if (process.env.GS1_AWS_ACCESS_KEY_ID && process.env.GS1_AWS_SECRET_ACCESS_KEY) {
      return {
        accessKeyId: process.env.GS1_AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.GS1_AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.GS1_AWS_SESSION_TOKEN || undefined,
      };
    }
  }
  if (key === "gs2") {
    if (process.env.GS2_AWS_ACCESS_KEY_ID && process.env.GS2_AWS_SECRET_ACCESS_KEY) {
      return {
        accessKeyId: process.env.GS2_AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.GS2_AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.GS2_AWS_SESSION_TOKEN || undefined,
      };
    }
  }
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    return {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN || undefined,
    };
  }
  return null;
}

function gsClient(region, gs) {
  if (!region) return null;
  const cfg = { region };
  const creds = credsFor(gs);
  if (creds) cfg.credentials = creds;
  return new GroundStationClient(cfg);
}

function toIso(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(+d)) return null;
  return d.toISOString();
}

/**
 * findMatchingContact: given client and descriptor {startTime,endTime, ...}
 * returns a contact object from AWS that contains contactId (or null).
 */
async function findMatchingContact(client, desc) {
  const startIso = toIso(desc.startTime);
  const endIso = toIso(desc.endTime);
  if (!startIso || !endIso) return null;

  // fuzz a bit (30s)
  const fuzzMs = 30 * 1000;
  const start = new Date(startIso);
  const end = new Date(endIso);
  const listStart = new Date(start.getTime() - fuzzMs);
  const listEnd = new Date(end.getTime() + fuzzMs);

  const params = {
    startTime: listStart,
    endTime: listEnd,
    maxResults: 50,
  };
  if (desc.satelliteArn) params.satelliteArn = desc.satelliteArn;
  if (desc.missionProfileArn) params.missionProfileArn = desc.missionProfileArn;
  if (desc.groundStation) params.groundStation = desc.groundStation;

  try {
    const out = await client.send(new ListContactsCommand(params));
    const list = out.contactList || out.contacts || [];
    if (!list.length) return null;

    // prefer exact time+matching contactId
    const targetStart = new Date(startIso).toISOString();
    const targetEnd = new Date(endIso).toISOString();
    const candidates = Array.isArray(list) ? list : [];

    const exact = candidates.find((c) => {
      const s = c.startTime ? new Date(c.startTime).toISOString() : null;
      const e = c.endTime ? new Date(c.endTime).toISOString() : null;
      return s === targetStart && e === targetEnd && !!c.contactId;
    });
    if (exact) return exact;

    // otherwise pick first that has contactId
    const withId = candidates.find((c) => c.contactId);
    if (withId) return withId;

    // no contactId available among matches — return null (caller may attempt Reserve with params)
    return null;
  } catch (err) {
    console.error("[findMatchingContact] ListContacts error:", err?.message || err);
    return null;
  }
}

/**
 * findContactById: attempts to find a contact object for a given contactId by scanning a reasonable window.
 * Returns contact object or null.
 */
async function findContactById(client, contactId) {
  if (!contactId) return null;

  // reasonable search window: past 7 days -> next 30 days
  const start = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const end = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  let nextToken = undefined;
  const maxPages = 12;
  let pages = 0;

  try {
    do {
      const out = await client.send(
        new ListContactsCommand({
          startTime: start,
          endTime: end,
          maxResults: 50,
          nextToken,
        })
      );
      const list = out.contactList || out.contacts || [];
      const found = list.find((c) => c.contactId === contactId);
      if (found) return found;
      nextToken = out.nextToken || null;
      pages++;
    } while (nextToken && pages < maxPages);
  } catch (err) {
    console.error("[findContactById] ListContacts error:", err?.message || err);
    return null;
  }
  return null;
}

/**
 * fallbackFindAvailable: when we can't resolve the requested id, try to find an AVAILABLE contact to schedule.
 * - prefer groundStation match if provided
 * - returns the chosen contact object (must have contactId) or null
 */
async function fallbackFindAvailable(client, opts = {}) {
  // window: now -> +30 days
  const start = new Date();
  const end = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const maxPages = 8;
  let nextToken = undefined;
  let pages = 0;

  try {
    do {
      const out = await client.send(
        new ListContactsCommand({
          startTime: start,
          endTime: end,
          maxResults: 50,
          nextToken,
          statusList: ["AVAILABLE"],
          ...(opts.groundStation ? { groundStation: opts.groundStation } : {}),
        })
      );
      const list = out.contactList || out.contacts || [];
      // pick first with contactId
      const found = list.find((c) => c.contactId);
      if (found) return found;
      nextToken = out.nextToken || null;
      pages++;
    } while (nextToken && pages < maxPages);
  } catch (err) {
    console.error("[fallbackFindAvailable] ListContacts error:", err?.message || err);
    return null;
  }
  return null;
}

router.post("/", async (req, res) => {
  const action = String(req.body.action || "").trim().toLowerCase();
  const items = Array.isArray(req.body.contactIds) ? req.body.contactIds : [];
  const gs = String(req.body.gs || "").trim();
  const region = String(req.body.region || "").trim();
  const groundStationFromReq = req.body.groundStation || undefined;

  if (!["reserve", "cancel"].includes(action)) {
    return res.status(400).json({ error: "action must be 'reserve' or 'cancel'" });
  }
  if (!region) {
    return res.status(400).json({ error: "region is required" });
  }
  if (!items.length) {
    return res.status(400).json({ error: "contactIds must be a non-empty array" });
  }

  const client = gsClient(region, gs);
  if (!client) {
    return res.status(500).json({ error: "AWS credentials not configured for the provided GS or region" });
  }

  const results = [];

  // process sequentially to avoid throttling
  for (const item of items) {
    try {
      let contact = null;
      let resolvedContactId = null;
      let resolvedFrom = null;

      if (typeof item === "string") {
        // First try: treat as real contactId
        resolvedContactId = item;
        // attempt to locate the contact for additional metadata (but we won't fail cancel just because it isn't found)
        contact = await findContactById(client, resolvedContactId);

        if (!contact) {
          // For RESERVE we may try fallback; for CANCEL we will not fail just because findContactById returned null.
          if (action === "reserve") {
            // fallback: find any AVAILABLE contact (optionally by groundStation)
            contact = await fallbackFindAvailable(client, { groundStation: groundStationFromReq });
            if (contact) {
              resolvedContactId = contact.contactId;
              resolvedFrom = "fallbackAvailable";
            } else {
              // For reserve: cannot proceed without either a contact or a fallback
              results.push({
                contactId: resolvedContactId,
                success: false,
                error:
                  "Could not locate a matching AWS contactId. (No available contacts found in fallback search.)",
              });
              continue;
            }
          } else {
            // For cancel: proceed — we'll attempt CancelContactCommand using the provided id
            resolvedFrom = "providedId";
          }
        } else {
          resolvedFrom = resolvedFrom || "foundById";
        }
      } else if (item && typeof item === "object") {
        // descriptor object, try to match by times and prefer a contact with contactId
        const found = await findMatchingContact(client, item);
        if (!found || !found.contactId) {
          // no matching contact with contactId — we will attempt to Reserve by parameters below (no contactId)
          contact = null;
          resolvedContactId = null;
          resolvedFrom = "descriptor_noContactId";
        } else {
          contact = found;
          resolvedContactId = found.contactId;
          resolvedFrom = "foundByDescriptor";
        }
      } else {
        results.push({ contactId: null, success: false, error: "Invalid item type" });
        continue;
      }

      if (action === "reserve") {
        // Reserve path: either use an existing contactId, OR call ReserveContact with parameters.
        if (contact && contact.contactId) {
          // we have a real contactId and must ensure status is AVAILABLE
          const status = (contact.contactStatus || contact.status || "").toUpperCase();
          if (status !== "AVAILABLE") {
            results.push({ contactId: contact.contactId, success: false, error: `Resolved contact status is '${status}', not AVAILABLE; not reserved.` });
            continue;
          }
          try {
            const out = await client.send(new ReserveContactCommand({ contactId: contact.contactId }));
            results.push({ contactId: contact.contactId, success: true, detail: out, resolvedFrom });
          } catch (err) {
            const msg = err?.message || String(err);
            console.error(`[awsManualContacts] reserve failed for ${contact.contactId}:`, msg);
            results.push({ contactId: contact.contactId, success: false, error: msg, resolvedFrom });
          }
          continue;
        }

        // No contact.contactId available — attempt to Reserve with parameters (descriptor).
        // Build parameters from item (if object) or from fallback contact info if available.
        let startTimeParam = null;
        let endTimeParam = null;
        let missionProfileArnParam = undefined;
        let satelliteArnParam = undefined;
        let groundStationParam = undefined;

        if (typeof item === "object" && item) {
          startTimeParam = toIso(item.startTime) || null;
          endTimeParam = toIso(item.endTime) || null;
          missionProfileArnParam = item.missionProfileArn || undefined;
          satelliteArnParam = item.satelliteArn || undefined;
          groundStationParam = item.groundStation || item.groundStationName || groundStationFromReq || undefined;
        } else if (contact) {
          startTimeParam = toIso(contact.startTime) || null;
          endTimeParam = toIso(contact.endTime) || null;
          missionProfileArnParam = contact.missionProfileArn || undefined;
          satelliteArnParam = contact.satelliteArn || undefined;
          groundStationParam = contact.groundStation || undefined;
        }

        // Validate required params for parameter-based Reserve
        if (!startTimeParam || !endTimeParam || !missionProfileArnParam || !satelliteArnParam) {
          results.push({
            contactId: null,
            success: false,
            error:
              "Not enough information to reserve by parameters (require startTime, endTime, satelliteArn and missionProfileArn).",
            descriptor: item,
          });
          continue;
        }

        try {
          const input = {
            startTime: new Date(startTimeParam),
            endTime: new Date(endTimeParam),
            missionProfileArn: missionProfileArnParam,
            satelliteArn: satelliteArnParam,
            ...(groundStationParam ? { groundStation: groundStationParam } : {}),
          };
          const out = await client.send(new ReserveContactCommand(input));
          const returnedId = out?.contactId || out?.contact?.contactId || null;
          results.push({ contactId: returnedId || null, success: true, detail: out, resolvedFrom: "reserveByParams" });
        } catch (err) {
          const msg = err?.message || String(err);
          console.error("[awsManualContacts] reserve by params failed:", msg, { startTimeParam, endTimeParam, missionProfileArnParam, satelliteArnParam, groundStationParam });
          results.push({ contactId: null, success: false, error: msg, resolvedFrom: "reserveByParams" });
        }

        continue;
      }

      // CANCEL path (action === 'cancel')
      // We can only cancel when we have a contactId (provided or resolved). Attempt cancel even if findContactById didn't find metadata.
      try {
        const realContactId = resolvedContactId || (contact && contact.contactId) || null;
        if (!realContactId) {
          results.push({ contactId: null, success: false, error: "Resolved contact has no contactId; cannot cancel." });
          continue;
        }

        try {
          const out = await client.send(new CancelContactCommand({ contactId: realContactId }));
          results.push({ contactId: realContactId, success: true, detail: out, resolvedFrom: resolvedFrom || "cancelById" });
        } catch (err) {
          // Detect AWS "not found" / already-deleted errors and treat as already-cancelled.
          const code = err?.name || err?.Code || err?.code || "";
          const msg = err?.message || String(err || "");
          console.error(`[awsManualContacts] cancel attempt for ${realContactId} failed:`, code, msg);

          // Common indicators that the contact is already gone:
          const indicatesNotFound =
            /not[\s_-]?found/i.test(code) ||
            /not[\s_-]?found/i.test(msg) ||
            /ResourceNotFound/i.test(code) ||
            /ResourceNotFound/i.test(msg) ||
            /does not exist/i.test(msg) ||
            /NoSuchEntity/i.test(code);

          if (indicatesNotFound) {
            // Treat as success (AWS already removed it). Frontend can remove the row.
            results.push({
              contactId: realContactId,
              success: true,
              detail: null,
              status: "NOT_FOUND",
              treatAsCancelled: true,
              resolvedFrom: resolvedFrom || "cancelById_notFound",
            });
          } else {
            // Real failure -> return error
            results.push({ contactId: realContactId, success: false, error: msg, status: code || "FAILED" });
          }
        }
      } catch (err) {
        const msg = err?.message || String(err);
        console.error(`[awsManualContacts] cancel flow unexpected error:`, msg);
        results.push({ contactId: null, success: false, error: msg });
      }
    } catch (err) {
      const msg = err?.message || String(err);
      console.error("[awsManualContacts] unexpected error for item:", item, msg);
      results.push({ contactId: null, success: false, error: msg });
    }
  }

  return res.json({ ok: true, action, region, gs: gs || null, results });
});

module.exports = router;
