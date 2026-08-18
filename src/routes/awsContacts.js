const express = require("express");
const {
  GroundStationClient,
  ListSatellitesCommand,
  ListMissionProfilesCommand,
  ListGroundStationsCommand,
  ListContactsCommand,
} = require("@aws-sdk/client-groundstation");

const router = express.Router();

/* ------------ utils ------------ */
const ok = (v) => v !== undefined && v !== null && String(v).trim() !== "";
const isArn = (s) => typeof s === "string" && s.startsWith("arn:");
const toIso = (v) => {
  const d = new Date(v);
  return Number.isNaN(+d) ? null : d.toISOString();
};

/** Pick credentials based on gs=gs1|gs2; fall back to global AWS_* if present */
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

const gsClient = (region, gs) => {
  const cfg = { region };
  const creds = credsFor(gs);
  if (creds) cfg.credentials = creds;
  return new GroundStationClient(cfg);
};

/* Normalize NORAD/catalog number from multiple possible keys */
function noradOf(s) {
  return (
    s.catalogNumber ??
    s.norad ??
    s.noradSatelliteID ??
    s.noradSatelliteId ??
    s.satelliteCatalogNumber ??
    null
  );
}

/* Friendly labels 62459/62460 -> SPADEX SD1/SD2 */
function friendlySatLabel(s) {
  const num = noradOf(s);
  const name = (s.name || s.satelliteName || "").toUpperCase();
  let alias = "";
  if (String(num) === "62459" || /SD1/.test(name)) alias = "SPADEX-SD1";
  if (String(num) === "62460" || /SD2/.test(name)) alias = "SPADEX-SD2";
  return num ? `${num}${alias ? ` (${alias})` : ""}` : alias || s.satelliteArn || s.arn || s.id;
}

/* Mappers */
const mapSatellite = (s) => ({
  id: s.satelliteId ?? noradOf(s) ?? s.satelliteArn ?? s.arn ?? s.id,
  label: friendlySatLabel(s),
  arn: s.satelliteArn ?? s.arn ?? null,
  catalogNumber: noradOf(s),
});

const mapMissionProfile = (m) => ({
  id: m.missionProfileArn ?? m.arn ?? m.id,
  arn: m.missionProfileArn ?? m.arn ?? null,
  name: m.name ?? m.missionProfileId ?? String(m.id || ""),
});

const mapGroundStation = (g) => ({
  id: g.groundStationName ?? g.name ?? g.id,
  label:
    g.groundStationName && g.region
      ? `${g.groundStationName} (${g.region})`
      : g.groundStationName ?? g.name ?? String(g.id || ""),
  region: g.region ?? null,
});

/* Limit GS to these five */
const WANTED_GS = new Set(["Bahrain 1", "Cape Town 1", "Hawaii 1", "Ireland 1", "Punta Arenas 1"]);

/* ------------ OPTIONS ------------ */
/** GET /api/aws-contacts/options?region=<region>&gs=gs1|gs2 */
router.get("/options", async (req, res) => {
  const region = String(req.query.region || "").trim();
  if (!region) return res.status(400).json({ error: "region is required" });
  const gs = String(req.query.gs || "").trim(); // optional

  try {
    const client = gsClient(region, gs);

    const [sat, mp, gsOut] = await Promise.all([
      client.send(new ListSatellitesCommand({})).catch((e) => {
        console.error("[GS] ListSatellites failed:", e?.message || e);
        return { satellites: [] };
      }),
      client.send(new ListMissionProfilesCommand({})).catch((e) => {
        console.error("[GS] ListMissionProfiles failed:", e?.message || e);
        return { missionProfileList: [] };
      }),
      client.send(new ListGroundStationsCommand({})).catch((e) => {
        console.error("[GS] ListGroundStations failed:", e?.message || e);
        return { groundStationList: [] };
      }),
    ]);

    const allSat = (sat.satellites || sat.satelliteList || []).map(mapSatellite);

    // Prefer SPADEX birds; fall back to all if none
    let satFiltered = allSat.filter((s) => {
      const num = String(s.catalogNumber || "");
      const lbl = String(s.label || "").toUpperCase();
      return (
        num === "62459" ||
        num === "62460" ||
        /SPADEX[-\s]?SD1/.test(lbl) ||
        /SPADEX[-\s]?SD2/.test(lbl) ||
        /(62459|62460)/.test(lbl)
      );
    });
    if (satFiltered.length === 0) satFiltered = allSat;

    // Mission profiles: keep SPADEX-related if present; else all
    const allMp = (mp.missionProfileList || []).map(mapMissionProfile);
    let mpFiltered = allMp.filter((m) => /spadex[-\s]?sd1|spadex[-\s]?sd2/i.test(m.name || ""));
    if (mpFiltered.length === 0) mpFiltered = allMp;

    // Ground stations -> only the five we want
    const allGs = (gsOut.groundStationList || []).map(mapGroundStation);
    const gsFiltered = allGs
      .filter((g) => WANTED_GS.has((g.id || g.label || "").replace(/\s+\(.+$/, "")))
      .sort((a, b) => (a.id || "").localeCompare(b.id || ""));

    res.json({ satellites: satFiltered, missionProfiles: mpFiltered, groundStations: gsFiltered });
  } catch (err) {
    console.error("AWS Contacts OPTIONS error:", err?.message || err);
    res.status(500).json({ error: "Failed to load AWS Ground Station options" });
  }
});

/* Resolve non-ARN satellite input to ARN */
async function resolveSatelliteArn(region, input) {
  if (!ok(input)) return null;
  if (isArn(input)) return input;
  const client = gsClient(region); // resolution does not require GS-specific creds
  const sat = await client.send(new ListSatellitesCommand({})).catch(() => ({ satellites: [] }));
  const allSat = (sat.satellites || sat.satelliteList || []).map(mapSatellite);
  const s = allSat.find(
    (x) =>
      String(x.id) === String(input) ||
      String(x.catalogNumber) === String(input) ||
      String(x.label).includes(String(input))
  );
  return s?.arn || null;
}

/* Robust extractor for maximum elevation in degrees */
function extractMaxElevationDeg(c) {
  if (typeof c.maximumElevationDegrees === "number") return c.maximumElevationDegrees;
  if (typeof c.maximumElevationDeg === "number") return c.maximumElevationDeg;
  if (typeof c.maximumElevation === "number") return c.maximumElevation;

  const me =
    c.maximumElevation ||
    c.maximum_elevation ||
    c.maximumElevationAngle ||
    c.maxElevation ||
    c.maximumElevationObj ||
    null;

  if (!me) return undefined;

  if (typeof me === "number") return me;
  if (typeof me.value === "number") return me.value;
  if (typeof me.degrees === "number") return me.degrees;
  if (typeof me.amount === "number" && String(me.unit || "").toLowerCase().includes("deg"))
    return me.amount;

  return undefined;
}

/* ------------ LIST ------------ */
/** POST /api/aws-contacts/list  { region, gs?, filters, pageToken? } */
router.post("/list", async (req, res) => {
  const region = String(req.body.region || "").trim();
  if (!region) return res.status(400).json({ error: "region is required" });
  const gs = String(req.body.gs || "").trim(); // optional

  const filters = req.body.filters || {};
  const startIso = toIso(filters.startTime);
  const endIso = toIso(filters.endTime);
  if (!startIso || !endIso) return res.status(400).json({ error: "startTime and endTime are required" });

  const statusList =
    Array.isArray(filters.statusList) && filters.statusList.length
      ? filters.statusList.map(String).filter(Boolean)
      : undefined;

  const includesAvailable = !!statusList?.includes("AVAILABLE");

  const missionProfileArn = ok(filters.missionProfileArn) ? String(filters.missionProfileArn) : undefined;

  let satelliteArn = ok(filters.satellite) ? String(filters.satellite) : undefined;
  if (satelliteArn && !isArn(satelliteArn)) {
    satelliteArn = await resolveSatelliteArn(region, satelliteArn);
  }

  if (includesAvailable && (!satelliteArn || !missionProfileArn)) {
    return res.status(400).json({
      error: "List contacts with status AVAILABLE requires both satelliteArn and missionProfileArn.",
    });
  }

  const groundStation = ok(filters.groundStation) ? String(filters.groundStation) : undefined;

  try {
    const client = gsClient(region, gs);

    // Fetch satellites here to build lookup so we can resolve satelliteArn -> catalogNumber/label
    const satResp = await client.send(new ListSatellitesCommand({})).catch((e) => {
      console.error("[GS] ListSatellites failed in list:", e?.message || e);
      return { satellites: [] };
    });
    const allSatList = (satResp.satellites || satResp.satelliteList || []).map(mapSatellite);
    const satByArn = {};
    const satById = {};
    allSatList.forEach((s) => {
      if (s.arn) satByArn[String(s.arn)] = s;
      if (s.id) satById[String(s.id)] = s;
    });

    const out = await client.send(
      new ListContactsCommand({
        startTime: new Date(startIso),
        endTime: new Date(endIso),
        maxResults: 50,
        nextToken: req.body.pageToken || undefined,
        ...(satelliteArn ? { satelliteArn } : {}),
        ...(missionProfileArn ? { missionProfileArn } : {}),
        ...(groundStation ? { groundStation } : {}),
        ...(statusList ? { statusList } : {}),
      })
    );

    console.log("[awsContacts] listed contacts:", (out.contactList || out.contacts || []).map(c => ({ contactId: c.contactId, status: c.contactStatus || c.status, startTime: c.startTime })));

    const items = (out.contactList || out.contacts || []).map((c) => {
      const maxElev = extractMaxElevationDeg(c);

      // compute catalogNumber and friendly label. AWS sometimes returns satelliteArn but not catalogNumber.
      let catalogNumber =
        c.catalogNumber ??
        noradOf(c) ??
        (c.satelliteArn && satByArn[String(c.satelliteArn)] ? satByArn[String(c.satelliteArn)].catalogNumber : undefined) ??
        (c.satelliteId && satById[String(c.satelliteId)] ? satById[String(c.satelliteId)].catalogNumber : undefined) ??
        undefined;

      let catalogLabel =
        catalogNumber ? (String(catalogNumber) === "62459" ? "62459 (SPADEX-SD1)" : String(catalogNumber) === "62460" ? "62460 (SPADEX-SD2)" : String(catalogNumber)) : undefined;

      // fallback: if label available in satellite lookup use that
      if ((!catalogLabel || catalogLabel === "undefined") && c.satelliteArn && satByArn[String(c.satelliteArn)]) {
        catalogLabel = satByArn[String(c.satelliteArn)].label;
        if (!catalogNumber) catalogNumber = satByArn[String(c.satelliteArn)].catalogNumber;
      }
      if ((!catalogLabel || catalogLabel === "undefined") && c.satelliteId && satById[String(c.satelliteId)]) {
        catalogLabel = satById[String(c.satelliteId)].label;
        if (!catalogNumber) catalogNumber = satById[String(c.satelliteId)].catalogNumber;
      }

      // final fallback: use whatever visible fields
      if (!catalogLabel) {
        catalogLabel = c.catalogNumber ?? noradOf(c) ?? c.satelliteArn ?? c.satelliteId ?? "—";
      }

      return {
        // IMPORTANT: real AWS contactId (used for reserve/cancel)
        contactId: c.contactId || null,
        // Also include a stable id field for UI rows (fallback if contactId missing)
        id: c.contactId || (c.startTime ? `${c.startTime}:${Math.random().toString(36).slice(2,6)}` : null),

        // keep status + other info
        status: c.contactStatus ?? c.status,
        satellite: c.catalogNumber ?? noradOf(c) ?? c.satelliteArn ?? c.satelliteId ?? "",
        satelliteArn: c.satelliteArn ?? null,
        catalogNumber: catalogNumber ?? null,
        catalogLabel,
        groundStation: c.groundStation ?? c.groundStationName ?? "",
        orbit: c.orbit ?? c.orbitNumber ?? c.orbitNum ?? null,
        startTime: c.startTime ? new Date(c.startTime).toISOString() : null,
        endTime: c.endTime ? new Date(c.endTime).toISOString() : null,
        maximumElevationDeg: typeof maxElev === "number" ? maxElev : undefined,
        // preserve raw AWS object for debugging if needed
        _raw: c,
      };
    });

    res.json({ items, nextToken: out.nextToken || null });
  } catch (err) {
    console.error("AWS Contacts LIST error:", {
      name: err?.name,
      message: err?.message,
      http: err?.$metadata?.httpStatusCode,
    });
    res.status(err?.$metadata?.httpStatusCode || 500).json({
      error: "Failed to list contacts",
      details: err?.message || String(err),
    });
  }
});

module.exports = router;
