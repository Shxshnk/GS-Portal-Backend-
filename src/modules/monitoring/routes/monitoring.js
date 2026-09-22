// src/modules/monitoring/routes/monitoring.js
const express = require("express");
const MonitoringService = require("../services/MonitoringService");
const MonitoringPollingService = require("../services/MonitoringPollingService");
const OidProfile = require("../models/OidProfile");
const MonitoringProfile = require("../models/MonitoringProfile");
const DeviceInterface = require("../models/DeviceInterface");
const TelemetryService = require("../services/TelemetryService");
const MonitoringSettings = require("../models/MonitoringSettings");
const DiscoveryService = require("../services/DiscoveryService");
const DiscoverySession = require("../models/DiscoverySession");
const DashboardService = require("../services/DashboardService");

const router = express.Router();

function sendError(res, error, fallbackMessage) {
  const statusCode = error.statusCode || 500;
  return res.status(statusCode).json({
    success: false,
    error: error.message || fallbackMessage,
  });
}

// Global Poller Engine status query
router.get("/status", async (req, res) => {
  try {
    const status = MonitoringPollingService.getStatus();
    return res.json({ success: true, status });
  } catch (error) {
    console.error("[monitoring] get status error:", error);
    return sendError(res, error, "Failed to get monitoring status");
  }
});

// Settings Management
router.get("/settings", async (req, res) => {
  try {
    const settings = await MonitoringSettings.list();
    return res.json({ success: true, settings });
  } catch (error) {
    console.error("[monitoring] get settings error:", error);
    return sendError(res, error, "Failed to get monitoring settings");
  }
});

router.put("/settings", async (req, res) => {
  try {
    const payload = req.body || {};
    for (const [key, val] of Object.entries(payload)) {
      await MonitoringSettings.setVal(key, String(val));
    }
    const settings = await MonitoringSettings.list();
    return res.json({ success: true, settings });
  } catch (error) {
    console.error("[monitoring] update settings error:", error);
    return sendError(res, error, "Failed to update settings");
  }
});

// Profiles list endpoints
router.get("/oid-profiles", async (req, res) => {
  try {
    const profiles = await OidProfile.list();
    return res.json({ success: true, profiles });
  } catch (error) {
    console.error("[monitoring] list oid profiles error:", error);
    return sendError(res, error, "Failed to list OID profiles");
  }
});

router.get("/profiles", async (req, res) => {
  try {
    const profiles = await MonitoringProfile.list();
    return res.json({ success: true, profiles });
  } catch (error) {
    console.error("[monitoring] list monitoring profiles error:", error);
    return sendError(res, error, "Failed to list monitoring profiles");
  }
});

// Telemetry historical and current feeds
router.get("/devices/:id/telemetry/current", async (req, res) => {
  try {
    const telemetry = await TelemetryService.getLiveMetrics(req.params.id);
    return res.json({ success: true, telemetry });
  } catch (error) {
    console.error("[monitoring] get current telemetry error:", error);
    return sendError(res, error, "Failed to fetch live parameters");
  }
});

router.get("/devices/:id/telemetry/history", async (req, res) => {
  try {
    const metricName = req.query.metric || "cpu_util";
    const { startTime, endTime, interval, hours } = req.query;
    const options = { 
      limitHours: hours ? parseInt(hours, 10) : (startTime || endTime ? null : 24),
      startTime,
      endTime,
      interval 
    };
    const telemetry = await TelemetryService.getHistoricalMetrics(req.params.id, metricName, options);
    return res.json({ success: true, history: telemetry });
  } catch (error) {
    console.error("[monitoring] get historical telemetry error:", error);
    return sendError(res, error, "Failed to fetch historical metrics");
  }
});

router.get("/devices/:id/dashboard", async (req, res) => {
  try {
    let { startTime, endTime, hours } = req.query;
    
    if (!startTime && !endTime) {
      const limitHours = hours ? parseInt(hours, 10) : 24;
      const end = new Date();
      const start = new Date(end.getTime() - limitHours * 60 * 60 * 1000);
      startTime = start.toISOString();
      endTime = end.toISOString();
    }
    
    const dashboard = await DashboardService.getDashboardPayload(req.params.id, startTime, endTime);
    return res.json({ success: true, dashboard });
  } catch (error) {
    console.error("[monitoring] get dashboard error:", error);
    return sendError(res, error, "Failed to fetch dashboard payload");
  }
});

router.get("/devices/:id/poll-history", async (req, res) => {
  try {
    const { pool } = require("../../../db");
    const [rows] = await pool.query(
      `SELECT timestamp, 
              MAX(CASE WHEN metric_name = 'status' THEN raw_value END) as status,
              MAX(CASE WHEN metric_name = 'availability' THEN converted_value END) as availability,
              MAX(CASE WHEN metric_name = 'health_score' THEN converted_value END) as healthScore,
              MAX(CASE WHEN metric_name = 'response_time' THEN converted_value END) as responseTime,
              MAX(CASE WHEN metric_name = 'poll_duration' THEN converted_value END) as pollDuration,
              MAX(CASE WHEN metric_name = 'error' THEN raw_value END) as error
       FROM monitoring_telemetry_history
       WHERE device_id = ?
         AND metric_name IN ('status', 'availability', 'health_score', 'response_time', 'poll_duration', 'error')
       GROUP BY timestamp
       ORDER BY timestamp DESC
       LIMIT 100`,
      [Number(req.params.id)]
    );
    return res.json({ success: true, history: rows });
  } catch (error) {
    console.error("[monitoring] get device poll history error:", error);
    return sendError(res, error, "Failed to fetch poll history");
  }
});

router.get("/devices/:id/interfaces", async (req, res) => {
  try {
    const interfaces = await DeviceInterface.listByDeviceId(req.params.id);
    return res.json({ success: true, interfaces });
  } catch (error) {
    console.error("[monitoring] get interfaces error:", error);
    return sendError(res, error, "Failed to list discovered interfaces");
  }
});

router.get("/devices/:id/hardware", async (req, res) => {
  try {
    const DeviceHardware = require("../models/DeviceHardware");
    const hardware = await DeviceHardware.listByDeviceId(req.params.id);
    return res.json({ success: true, hardware });
  } catch (error) {
    console.error("[monitoring] get hardware error:", error);
    return sendError(res, error, "Failed to list device hardware");
  }
});

router.get("/devices/:id/sensors", async (req, res) => {
  try {
    const DeviceSensor = require("../models/DeviceSensor");
    const sensors = await DeviceSensor.listByDeviceId(req.params.id);
    return res.json({ success: true, sensors });
  } catch (error) {
    console.error("[monitoring] get sensors error:", error);
    return sendError(res, error, "Failed to list device sensors");
  }
});

router.post("/devices/:id/query-oid", async (req, res) => {
  try {
    const SnmpEngine = require("../snmp_engine");
    const SnmpPollerAdapter = require("../adapters/SnmpPollerAdapter");
    const MonitoringDevice = require("../models/MonitoringDevice");

    const device = await MonitoringDevice.findById(req.params.id);
    if (!device) return res.status(404).json({ success: false, error: "Device not found" });

    const adapter = new SnmpPollerAdapter();
    const credentials = adapter.getDecryptedCredentials(device);

    const engine = new SnmpEngine({ timeout: 3000, retries: 1 });
    const operation = req.body.operation || "get";
    const oid = req.body.oid;

    let result;
    const startTime = Date.now();

    if (operation === "getnext") {
      result = await engine.getNext({
        host: device.ipAddress,
        port: device.port || 161,
        version: device.snmpVersion,
        credentials,
        oid,
      });
    } else if (operation === "getbulk") {
      result = await engine.getBulk({
        host: device.ipAddress,
        port: device.port || 161,
        version: device.snmpVersion,
        credentials,
        nonRepeaters: req.body.nonRepeaters || 0,
        maxRepetitions: req.body.maxRepetitions || 20,
        oids: [oid],
      });
    } else if (operation === "walk") {
      result = await engine.walk({
        host: device.ipAddress,
        port: device.port || 161,
        version: device.snmpVersion,
        credentials,
        oid,
      });
    } else {
      result = await engine.get({
        host: device.ipAddress,
        port: device.port || 161,
        version: device.snmpVersion,
        credentials,
        oid,
      });
    }

    const duration = Date.now() - startTime;
    return res.json({ success: true, result, duration });
  } catch (error) {
    console.error("[monitoring] query OID error:", error);
    return sendError(res, error, "Failed to query OID");
  }
});

// Bulk Device Actions
router.post("/devices/bulk-poll", async (req, res) => {
  try {
    const ids = req.body.ids || [];
    const results = await MonitoringService.bulkPoll(ids);
    return res.json({ success: true, results });
  } catch (error) {
    console.error("[monitoring] bulk poll error:", error);
    return sendError(res, error, "Failed to complete bulk polling");
  }
});

router.post("/devices/bulk-delete", async (req, res) => {
  try {
    const ids = req.body.ids || [];
    const result = await MonitoringService.bulkDelete(ids);
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("[monitoring] bulk delete error:", error);
    return sendError(res, error, "Failed to delete devices");
  }
});

// Standard CRUD Device items
router.post("/devices", async (req, res) => {
  try {
    const device = await MonitoringService.addDevice(req.body || {});
    return res.status(201).json({ success: true, device });
  } catch (error) {
    console.error("[monitoring] add device error:", error);
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ success: false, error: "IP Address must be unique" });
    }
    return sendError(res, error, "Failed to add device");
  }
});

router.put("/devices/:id", async (req, res) => {
  try {
    const device = await MonitoringService.updateDevice(req.params.id, req.body || {});
    if (!device) return res.status(404).json({ success: false, error: "Device not found" });
    return res.json({ success: true, device });
  } catch (error) {
    console.error("[monitoring] update device error:", error);
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ success: false, error: "IP Address must be unique" });
    }
    return sendError(res, error, "Failed to update device");
  }
});

router.delete("/devices/:id", async (req, res) => {
  try {
    const deleted = await MonitoringService.deleteDevice(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, error: "Device not found" });
    return res.json({ success: true, message: "Device deleted" });
  } catch (error) {
    console.error("[monitoring] delete device error:", error);
    return sendError(res, error, "Failed to delete device");
  }
});

router.get("/devices/:id", async (req, res) => {
  try {
    const device = await MonitoringService.getDevice(req.params.id);
    if (!device) return res.status(404).json({ success: false, error: "Device not found" });
    return res.json({ success: true, device });
  } catch (error) {
    console.error("[monitoring] get device error:", error);
    return sendError(res, error, "Failed to get device");
  }
});

router.get("/devices/:id/telemetry-history", async (req, res) => {
  try {
    const { id } = req.params;
    const { metric, startTime, endTime, interval, limitHours } = req.query;
    
    const options = { 
      limitHours: limitHours ? parseInt(limitHours, 10) : (startTime || endTime ? null : 24),
      startTime,
      endTime,
      interval 
    };
    
    const TelemetryService = require("../services/TelemetryService");
    const history = await TelemetryService.getHistoricalMetrics(id, metric, options);
    
    return res.json({ success: true, history });
  } catch (error) {
    console.error("[monitoring] get telemetry history error:", error);
    return sendError(res, error, "Failed to get telemetry history");
  }
});

router.get("/devices", async (req, res) => {
  try {
    const devices = await MonitoringService.listDevices(req.query.q || req.query.search || "");
    return res.json({ success: true, devices });
  } catch (error) {
    console.error("[monitoring] list devices error:", error);
    return sendError(res, error, "Failed to list devices");
  }
});

router.post("/devices/test-connection", async (req, res) => {
  try {
    const connection = await MonitoringService.testConnection(req.body || {});
    return res.json({ success: true, connection });
  } catch (error) {
    console.error("[monitoring] test connection error:", error);
    return sendError(res, error, "Failed to test connection");
  }
});

// Discovery Endpoints
router.post("/discovery/start", async (req, res) => {
  try {
    const scan = await DiscoveryService.startScan(req.body || {});
    return res.json({ success: true, scan });
  } catch (error) {
    console.error("[monitoring] start discovery error:", error);
    return sendError(res, error, "Failed to start discovery scan");
  }
});

router.post("/discovery/stop", async (req, res) => {
  try {
    const scan = DiscoveryService.stopScan();
    return res.json({ success: true, scan });
  } catch (error) {
    console.error("[monitoring] stop discovery error:", error);
    return sendError(res, error, "Failed to stop discovery scan");
  }
});

router.post("/discovery/pause", async (req, res) => {
  try {
    const scan = DiscoveryService.pauseScan();
    return res.json({ success: true, scan });
  } catch (error) {
    console.error("[monitoring] pause discovery error:", error);
    return sendError(res, error, "Failed to pause discovery scan");
  }
});

router.post("/discovery/resume", async (req, res) => {
  try {
    const scan = DiscoveryService.resumeScan();
    return res.json({ success: true, scan });
  } catch (error) {
    console.error("[monitoring] resume discovery error:", error);
    return sendError(res, error, "Failed to resume discovery scan");
  }
});

router.get("/discovery/status", async (req, res) => {
  try {
    const status = DiscoveryService.getStatus();
    return res.json({ success: true, status });
  } catch (error) {
    console.error("[monitoring] get discovery status error:", error);
    return sendError(res, error, "Failed to fetch discovery status");
  }
});

router.get("/discovery/history", async (req, res) => {
  try {
    const history = await DiscoverySession.list();
    return res.json({ success: true, history });
  } catch (error) {
    console.error("[monitoring] get discovery history error:", error);
    return sendError(res, error, "Failed to fetch discovery history");
  }
});

router.get("/discovery/stats", async (req, res) => {
  try {
    const stats = await DiscoverySession.getSummaryStats();
    return res.json({ success: true, stats });
  } catch (error) {
    console.error("[monitoring] get discovery stats error:", error);
    return sendError(res, error, "Failed to fetch discovery stats");
  }
});

// AWS Credential Profiles Endpoints
router.get("/aws/profiles", async (req, res) => {
  try {
    const AwsCredentialProfile = require("../aws/AwsCredentialProfile");
    const profiles = await AwsCredentialProfile.list();
    return res.json({ success: true, profiles });
  } catch (error) {
    console.error("[monitoring] list aws profiles error:", error);
    return sendError(res, error, "Failed to list AWS profiles");
  }
});

router.post("/aws/profiles", async (req, res) => {
  try {
    const { profileName, accessKey, secretKey, region } = req.body;
    if (!profileName || !accessKey || !secretKey || !region) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }
    const AwsCredentialProfile = require("../aws/AwsCredentialProfile");
    const profile = await AwsCredentialProfile.create(req.body);
    return res.status(201).json({ success: true, profile });
  } catch (error) {
    console.error("[monitoring] create aws profile error:", error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: "A profile with this name already exists" });
    }
    return sendError(res, error, "Failed to create AWS profile");
  }
});

router.put("/aws/profiles/:id", async (req, res) => {
  try {
    const AwsCredentialProfile = require("../aws/AwsCredentialProfile");
    const { id } = req.params;
    
    // If secretKey is completely masked, we should remove it from the payload so we don't overwrite it with asterisks.
    if (req.body.secretKey === "****************") {
       delete req.body.secretKey;
    }
    
    const profile = await AwsCredentialProfile.updateById(id, req.body);
    if (!profile) {
      return res.status(404).json({ success: false, error: "Profile not found" });
    }
    return res.json({ success: true, profile });
  } catch (error) {
    console.error("[monitoring] update aws profile error:", error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: "A profile with this name already exists" });
    }
    return sendError(res, error, "Failed to update AWS profile");
  }
});

router.delete("/aws/profiles/:id", async (req, res) => {
  try {
    const { id } = req.params;
    // Check if any devices are using this profile
    const MonitoringDevice = require("../models/MonitoringDevice");
    const { pool } = require("../../../db");
    const [rows] = await pool.query("SELECT COUNT(*) as count FROM monitoring_devices WHERE profile_id = ? AND provider = 'AWS'", [id]);
    if (rows[0].count > 0) {
      return res.status(400).json({ success: false, error: "Cannot delete profile because it is assigned to one or more AWS devices." });
    }

    const AwsCredentialProfile = require("../aws/AwsCredentialProfile");
    const deleted = await AwsCredentialProfile.deleteById(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: "Profile not found" });
    }
    return res.json({ success: true });
  } catch (error) {
    console.error("[monitoring] delete aws profile error:", error);
    return sendError(res, error, "Failed to delete AWS profile");
  }
});

// AWS Discovery Endpoints
router.post("/aws/discovery/start", async (req, res) => {
  try {
    const AWSDiscoveryEngine = require("../aws/AWSDiscoveryEngine");
    const { profileId, resourceType = "EC2" } = req.body;
    
    const summary = await AWSDiscoveryEngine.discover({ profileId, resourceType });
    return res.json({ success: true, results: summary });
  } catch (error) {
    console.error("[monitoring] aws discovery error:", error);
    return sendError(res, error, "Failed to start AWS discovery");
  }
});

router.post("/aws/register", async (req, res) => {
  try {
    const MonitoringDevice = require("../models/MonitoringDevice");
    const instances = Array.isArray(req.body) ? req.body : [req.body];
    const registered = [];
    
    for (const instance of instances) {
      if (instance.provider === "AWS" && instance.instanceId) {
        const existing = await MonitoringDevice.findByProviderAndInstanceId(instance.provider, instance.instanceId);
        if (existing) {
          const updated = await MonitoringDevice.updateById(existing.id, instance);
          registered.push(updated);
          continue;
        }
      }
      const device = await MonitoringDevice.create(instance);
      registered.push(device);
    }
    
    return res.status(201).json({ success: true, registered });
  } catch (error) {
    console.error("[monitoring] aws register error:", error);
    return sendError(res, error, "Failed to register AWS instances");
  }
});


// Append dashboard route to monitoring.js
const GroundStationMonitoringService = require("../services/GroundStationMonitoringService");

router.get("/ground-stations/dashboard", async (req, res) => {
  try {
    const timeRange = req.query.timeRange || "15m";
    const stat = req.query.stat || "Average";
    const dashboardData = await GroundStationMonitoringService.getDashboardData(timeRange, stat);
    return res.json({ success: true, dashboard: dashboardData });
  } catch (error) {
    console.error("[monitoring] GET /ground-stations/dashboard error:", error);
    return sendError(res, error, "Failed to fetch Ground Station Dashboard");
  }
});

module.exports = router;

