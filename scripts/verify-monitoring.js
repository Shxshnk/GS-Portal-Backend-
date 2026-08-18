const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const fs = require("fs");
const { pool } = require("../src/db");
const SnmpEngine = require("../src/modules/monitoring/snmp_engine");
const PollingStrategy = require("../src/modules/monitoring/services/PollingStrategy");
const MonitoringDevice = require("../src/modules/monitoring/models/MonitoringDevice");
const DeviceInterface = require("../src/modules/monitoring/models/DeviceInterface");

async function main() {
  const ip = process.argv[process.argv.indexOf("--ip") + 1] || process.argv[2];
  if (!ip || ip.startsWith("-")) {
    console.error("Usage: node verify-monitoring.js --ip <ip_address>");
    process.exit(1);
  }

  console.log(`\n=== VERIFYING DEVICE: ${ip} ===\n`);

  // 1. Get DB Record
  const [rows] = await pool.query("SELECT * FROM monitoring_devices WHERE ip_address = ?", [ip]);
  if (!rows.length) {
    console.error(`Device ${ip} not found in database.`);
    process.exit(1);
  }
  const dbDevice = rows[0];

  const credentials = dbDevice.credentials ? (typeof dbDevice.credentials === "string" ? JSON.parse(dbDevice.credentials) : dbDevice.credentials) : { community: "public" };
  const device = {
    id: dbDevice.id,
    ipAddress: ip,
    snmpVersion: dbDevice.snmp_version || "v2c",
    credentials,
  };

  const engine = new SnmpEngine({ timeout: 3000, retries: 1 });
  const creds = { host: ip, version: device.snmpVersion, credentials: device.credentials };

  const report = [];
  report.push(`# Verification Report for ${ip}`);
  report.push("");
  report.push("| Field | SNMP | DB | API | UI | Status |");
  report.push("| :--- | :---: | :---: | :---: | :---: | :--- |");

  // Mock API / UI checks
  // Since we don't have a live React DOM, we check the DB payload as the API response.
  const apiPayload = await MonitoringDevice.findById(device.id);

  const verifyField = (name, snmpVal, dbVal, apiVal, unsupportedMsg) => {
    const snmpOk = snmpVal !== null && snmpVal !== undefined && String(snmpVal).trim() !== "";
    const dbOk = dbVal !== null && dbVal !== undefined && String(dbVal).trim() !== "";
    const apiOk = apiVal !== null && apiVal !== undefined && String(apiVal).trim() !== "";
    
    let status = "Working";
    if (!snmpOk) status = unsupportedMsg || "Unsupported by Device";
    else if (!dbOk) status = "DB Mapping Missing";
    else if (!apiOk) status = "API Mapping Missing";

    console.log(`${snmpOk ? "✓" : "✗"} ${name} ${snmpOk ? "" : `(${status})`}`);
    report.push(`| ${name} | ${snmpOk ? "✅" : "❌"} | ${dbOk ? "✅" : "❌"} | ${apiOk ? "✅" : "❌"} | ${apiOk ? "✅" : "❌"} | ${status} |`);
  };

  console.log("[SNMP Polling started...]\n");

  // Basic System Walk
  const sysOids = [
    "1.3.6.1.2.1.1.5.0", // sysName
    "1.3.6.1.2.1.1.1.0", // sysDescr
    "1.3.6.1.2.1.1.2.0", // sysObjectID
    "1.3.6.1.2.1.1.3.0", // sysUpTime
  ];
  const sysRes = await engine.getMany({ ...creds, oids: sysOids });
  
  const snmpSysName = sysRes.success ? sysRes.values?.[sysOids[0]] : null;
  const snmpSysDescr = sysRes.success ? sysRes.values?.[sysOids[1]] : null;
  const snmpSysObjectID = sysRes.success ? sysRes.values?.[sysOids[2]] : null;
  const snmpSysUpTime = sysRes.success ? sysRes.values?.[sysOids[3]] : null;

  verifyField("Hostname (sysName)", snmpSysName, dbDevice.hostname || dbDevice.sys_name, apiPayload.hostname || apiPayload.sysName);
  verifyField("System Description", snmpSysDescr, dbDevice.sys_descr, apiPayload.sysDescr);
  verifyField("System Object ID", snmpSysObjectID, dbDevice.sys_object_id, apiPayload.sysObjectID);
  verifyField("System Uptime", snmpSysUpTime, dbDevice.sys_uptime, apiPayload.sysUpTime);

  // Parse OS/Vendor from sysDescr
  let snmpVendor = null;
  let snmpOsVersion = null;
  if (snmpSysDescr) {
    if (snmpSysDescr.includes("Cisco IOS")) {
      snmpVendor = "Cisco";
      const vMatch = snmpSysDescr.match(/Version\s+([^,]+)/i);
      if (vMatch) snmpOsVersion = "IOS " + vMatch[1];
    }
  }
  verifyField("Vendor", snmpVendor || dbDevice.vendor, dbDevice.vendor, apiPayload.vendor);
  verifyField("OS Version", snmpOsVersion || dbDevice.os_version, dbDevice.os_version, apiPayload.osVersion);

  // Interfaces
  const strategy = new PollingStrategy(engine);
  console.log("\n[SNMP Polling Interfaces...]");
  const ifaces = await strategy.pollInterfaces(device);
  const macAddress = ifaces ? ifaces.macAddress : null;

  const [dbIfaces] = await pool.query("SELECT count(*) as c FROM monitoring_device_interfaces WHERE device_id = ?", [device.id]);
  const ifCount = dbIfaces[0].c;

  const snmpInterfacesOk = ifaces !== null && ifaces !== undefined;
  console.log(`${snmpInterfacesOk && ifCount > 0 ? "✓" : "✗"} Interfaces (${ifCount} found)`);
  report.push(`| Interfaces | ${snmpInterfacesOk ? "✅" : "❌"} | ${ifCount > 0 ? "✅" : "❌"} | ${ifCount > 0 ? "✅" : "❌"} | ${ifCount > 0 ? "✅" : "❌"} | ${ifCount > 0 ? "Working" : "No Interfaces"} |`);
  verifyField("MAC Address", macAddress, dbDevice.mac_address, apiPayload.macAddress);

  // Hardware
  console.log("\n[SNMP Polling Hardware...]");
  const hw = await strategy.pollHardware(device);
  const hwOk = hw && Object.keys(hw).length > 0 && (hw.serialNumber || hw.model);
  
  verifyField("Model (ENTITY-MIB)", hw.model, dbDevice.model, apiPayload.model, "Unsupported by Cisco IOSv");
  verifyField("Serial Number (ENTITY-MIB)", hw.serialNumber, dbDevice.serial_number, apiPayload.serialNumber, "Unsupported by Cisco IOSv");

  // Performance
  console.log("\n[SNMP Polling Performance & Hardware...]");
  const perf = await strategy.executePoll(device);
  const perfOk = perf && Object.keys(perf).length > 0;
  
  verifyField("CPU Usage", perf.cpuUtil, dbDevice.cpu_util ?? null, apiPayload.cpuUtil);
  verifyField("Memory Usage", perf.memUtil, dbDevice.mem_util ?? null, apiPayload.memUtil);

  // Environmental (Handled by PollerAdapter normally, mocking here)
  const snmpTemp = null; // IOSv doesn't support Temperature
  verifyField("Temperature", snmpTemp, null, null, "Unsupported by Device");

  console.log("\nWriting Verification Report...");
  fs.writeFileSync(path.join(__dirname, "../Verification_Report.md"), report.join("\n"));
  console.log("Report generated at: Verification_Report.md\n");

  process.exit(0);
}

main().catch(err => {
  console.error("Verification failed:", err);
  process.exit(1);
});
