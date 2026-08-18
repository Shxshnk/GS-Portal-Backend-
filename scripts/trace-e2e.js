require('dotenv').config({path: '.env'});
const MonitoringService = require('../src/modules/monitoring/services/MonitoringService');
const MonitoringDevice = require('../src/modules/monitoring/models/MonitoringDevice');
const { pool } = require('../src/db');

async function runTrace() {
  console.log("=========================================");
  console.log("E2E TRACE: Registration to Database");
  console.log("=========================================");

  // Mocking the exact payload that Discovery.tsx sends for a successful SNMP discovery
  const mockPayload = {
    deviceName: "Core-Switch",
    ipAddress: "192.168.5.4",
    macAddress: null,
    vendor: "Cisco",
    model: "Catalyst 9300",
    snmpVersion: "v2c",
    deviceType: "Switch",
    profileId: null,
    status: "ONLINE",
    sysName: "Core-Switch.local",
    sysDescr: "Cisco IOS Software, Catalyst 9300",
    sysObjectID: "1.3.6.1.4.1.9.1.2805",
    sysUpTime: "1234567",
    credentials: {
      community: "public",
      port: 161,
      timeout: 2000,
      retries: 2
    }
  };

  console.log("\n1. Exact POST /api/monitoring/devices request body:");
  console.log(JSON.stringify(mockPayload, null, 2));

  // We will intercept normalizePayload implicitly by intercepting MonitoringDevice.create
  const originalCreate = MonitoringDevice.create;
  
  MonitoringDevice.create = async function(payload) {
    console.log("\n3. Inside normalizePayload() output object (which is passed to MonitoringDevice.create):");
    console.log(JSON.stringify(payload, null, 2));

    const values = [
      payload.deviceName,
      payload.hostname || null,
      payload.ipAddress,
      payload.macAddress || null,
      payload.vendor || null,
      payload.model || null,
      payload.serialNumber || null,
      payload.firmware || null,
      payload.osVersion || null,
      payload.deviceType || null,
      payload.site || null,
      payload.rack || null,
      payload.location || null,
      payload.latitude ?? null,
      payload.longitude ?? null,
      payload.sys_name || null,
      payload.sys_descr || null,
      payload.sys_object_id || null,
      payload.sys_uptime || null,
      payload.snmpVersion || "v2c",
      payload.credentials ? JSON.stringify(payload.credentials) : null,
      payload.status || "UNKNOWN",
      payload.isActive === false ? 0 : 1,
      payload.profileId || null,
      payload.lifecycleState || "Configured",
      (payload.snmpVersion === 'v3' || payload.snmpVersion === '3') ? '' : (payload.credentials?.community || 'public'),
    ];

    console.log("\n4. Inside MonitoringDevice.create(), SQL INSERT parameters:");
    console.log(values);

    const res = await originalCreate.call(this, payload);
    
    console.log(`\n5. Immediately after INSERT, execute SELECT for ID ${res.id}:`);
    const [rows] = await pool.query('SELECT hostname, sys_name, sys_descr, sys_object_id, vendor, model FROM monitoring_devices WHERE id = ?', [res.id]);
    console.log(rows[0]);

    return res;
  };

  try {
    console.log("\n2. Inside MonitoringService.create() [addDevice], payload before normalization:");
    console.log(JSON.stringify(mockPayload, null, 2));
    
    const newDevice = await MonitoringService.addDevice(mockPayload);
    
    console.log(`\n6. Call GET /api/monitoring/devices/${newDevice.id} (MonitoringDevice.findById):`);
    const fetchedDevice = await MonitoringDevice.findById(newDevice.id);
    console.log(fetchedDevice);

  } catch(e) {
    console.error("Trace failed:", e);
  }

  process.exit(0);
}

runTrace();
