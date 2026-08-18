require('dotenv').config({path: '.env'});
const fs = require('fs');
const path = require('path');
const snmp = require('net-snmp');
const { pool } = require('../src/db');
const MonitoringDevice = require('../src/modules/monitoring/models/MonitoringDevice');
const SnmpPollerAdapter = require('../src/modules/monitoring/adapters/SnmpPollerAdapter');
const SnmpEngine = require('../src/modules/monitoring/snmp_engine');

// Hook into net-snmp parser
const originalParseVarbinds = SnmpEngine.prototype._parseVarbinds;
let capturedRawVarbinds = [];
let capturedParsedValues = {};

SnmpEngine.prototype._parseVarbinds = function(varbinds) {
  varbinds.forEach(vb => {
    let errorType = null;
    let isError = snmp.isVarbindError(vb);
    if (isError) errorType = snmp.ObjectType[vb.type] || vb.type;
    let val = vb.value;
    if (Buffer.isBuffer(val)) val = val.toString('utf8');
    
    capturedRawVarbinds.push({
      oid: vb.oid ? vb.oid.join('.') : 'Unknown',
      type: snmp.ObjectType[vb.type] || vb.type,
      value: val,
      isError: isError,
      errorType: errorType
    });
  });

  const parsed = originalParseVarbinds.call(this, varbinds);
  Object.assign(capturedParsedValues, parsed);
  return parsed;
};

// Map required fields to DB columns and API props
const FIELDS_MAP = {
  sysName: { oid: '1.3.6.1.2.1.1.5.0', dbCol: 'sys_name', apiProp: 'sysName' },
  sysDescr: { oid: '1.3.6.1.2.1.1.1.0', dbCol: 'sys_descr', apiProp: 'sysDescr' },
  sysObjectID: { oid: '1.3.6.1.2.1.1.2.0', dbCol: 'sys_object_id', apiProp: 'sysObjectID' },
  sysUpTime: { oid: '1.3.6.1.2.1.1.3.0', dbCol: 'sys_uptime', apiProp: 'sysUpTime' },
  hostname: { oid: '1.3.6.1.2.1.1.5.0', dbCol: 'hostname', apiProp: 'hostname' },
  vendor: { oid: null, dbCol: 'vendor', apiProp: 'vendor' },
  model: { oid: null, dbCol: 'model', apiProp: 'model' },
  serialNumber: { oid: null, dbCol: 'serial_number', apiProp: 'serialNumber' },
  interfaces: { oid: null, dbCol: null, apiProp: 'interfaces' }, // length comparison
  cpuUtil: { oid: null, dbCol: null, apiProp: 'cpuUtil' }, // Telemetry history comparison
  memUtil: { oid: null, dbCol: null, apiProp: 'memUtil' }
};

const SnmpConfigHelper = require('../src/modules/monitoring/utils/SnmpConfigHelper');

async function traceDevice(device) {
  capturedRawVarbinds = [];
  capturedParsedValues = {};

  const adapter = new SnmpPollerAdapter();
  const snmpConfig = SnmpConfigHelper.resolveConfig(device);
  
  const config = {
    ip: snmpConfig.host,
    version: snmpConfig.version,
    community: snmpConfig.credentials?.community,
    port: snmpConfig.port,
    timeout: snmpConfig.timeout,
    retries: snmpConfig.retries
  };

  const profile = { systemOids: {} };
  const settings = { default_timeout: 1000, default_retries: 1 };
  
  // 1. Poll Device (Hooks will capture Varbinds and Parsed)
  const pollResult = await adapter.poll(device, profile, settings, { doEnvPoll: true, doHwPoll: true });

  // 2. Database
  await MonitoringDevice.updatePollResultExtended(device.id, pollResult);
  const dbRow = await pool.query('SELECT * FROM monitoring_devices WHERE id = ?', [device.id]).then(r => r[0][0]);
  
  // Also get telemetry current for cpu/mem
  const cpuRow = await pool.query("SELECT converted_value FROM monitoring_telemetry_current WHERE device_id = ? AND metric_name = 'cpu_util'", [device.id]).then(r => r[0][0]);
  const memRow = await pool.query("SELECT converted_value FROM monitoring_telemetry_current WHERE device_id = ? AND metric_name = 'mem_util'", [device.id]).then(r => r[0][0]);

  // 3. API
  const apiDevice = await MonitoringDevice.findById(device.id);

  return {
    config,
    rawVarbinds: [...capturedRawVarbinds],
    parsedValues: { ...capturedParsedValues },
    pollResult,
    dbRow: { ...dbRow, cpuUtil: cpuRow?.converted_value, memUtil: memRow?.converted_value },
    apiDevice
  };
}

function getComparisonValues(fieldKey, trace) {
  const map = FIELDS_MAP[fieldKey];
  let raw = "N/A";
  let parsed = "N/A";
  
  if (map.oid) {
    const rawVb = trace.rawVarbinds.find(v => v.oid === map.oid);
    if (rawVb) {
      raw = rawVb.isError ? `Exception: ${rawVb.errorType}` : rawVb.value;
    } else {
      raw = "Missing";
    }
    parsed = trace.parsedValues[map.oid] !== undefined ? trace.parsedValues[map.oid] : "Missing";
  } else if (fieldKey === 'interfaces') {
    raw = `Walked ${trace.rawVarbinds.filter(v => v.oid.startsWith('1.3.6.1.2.1.2.2.1')).length} varbinds`;
    parsed = "N/A";
  }

  let pr = trace.pollResult[map.apiProp] !== undefined ? trace.pollResult[map.apiProp] : "Missing";
  if (fieldKey === 'cpuUtil') {
    const cpuTelem = trace.pollResult.telemetry?.find(t => t.metricName === 'cpu_util');
    pr = cpuTelem ? cpuTelem.convertedValue : "Missing";
  } else if (fieldKey === 'memUtil') {
    const memTelem = trace.pollResult.telemetry?.find(t => t.metricName === 'mem_util');
    pr = memTelem ? memTelem.convertedValue : "Missing";
  } else if (fieldKey === 'interfaces') {
    pr = Array.isArray(trace.pollResult.interfaces) ? `Array(${trace.pollResult.interfaces.length})` : "Missing";
  }

  let db = "N/A";
  if (map.dbCol) {
    db = trace.dbRow[map.dbCol] !== null ? trace.dbRow[map.dbCol] : "NULL";
  } else if (fieldKey === 'cpuUtil') {
    db = trace.dbRow.cpuUtil !== undefined ? trace.dbRow.cpuUtil : "NULL";
  } else if (fieldKey === 'memUtil') {
    db = trace.dbRow.memUtil !== undefined ? trace.dbRow.memUtil : "NULL";
  }

  let api = trace.apiDevice[map.apiProp];
  if (fieldKey === 'interfaces') {
    api = Array.isArray(api) ? `Array(${api.length})` : "Missing";
  }
  if (api === null || api === undefined) api = "null";

  return { raw, parsed, pr, db, api };
}

(async () => {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log("Usage: node scripts/verify-varbinds.js <ROUTER_DEVICE_ID> <SWITCH_DEVICE_ID>");
    process.exit(1);
  }

  const routerId = Number(args[0]);
  const switchId = Number(args[1]);

  const routerDevice = await MonitoringDevice.findById(routerId);
  const switchDevice = await MonitoringDevice.findById(switchId);

  if (!routerDevice || !switchDevice) {
    console.error(`Both devices must exist in the database.`);
    process.exit(1);
  }

  console.log(`Starting automated trace for Router (ID: ${routerId}) and Switch (ID: ${switchId})...`);
  
  const rTrace = await traceDevice(routerDevice);
  const sTrace = await traceDevice(switchDevice);

  // Generate Reports
  const reportObj = {
    timestamp: new Date().toISOString(),
    router: rTrace,
    switch: sTrace
  };
  
  fs.writeFileSync(path.join(__dirname, '../reports/Telemetry_Verification_Report.json'), JSON.stringify(reportObj, null, 2));

  let md = `# End-to-End Telemetry Verification Report\n\n`;
  
  for (const [name, trace] of Object.entries({ 'Working Router': rTrace, 'Target Switch': sTrace })) {
    md += `## ${name} (${trace.config.ip})\n\n`;
    md += `### SNMP Session Configuration\n`;
    md += `- IP: ${trace.config.ip}\n`;
    md += `- Version: ${trace.config.version}\n`;
    md += `- Community: ${trace.config.community}\n`;
    md += `- Port: ${trace.config.port}\n`;
    md += `- Timeout: ${trace.config.timeout}\n`;
    md += `- Retries: ${trace.config.retries}\n\n`;
    
    md += `### Complete Raw Varbinds (Sample of 10)\n`;
    md += `*Note: Full raw varbinds saved in JSON report*\n`;
    md += "```json\n" + JSON.stringify(trace.rawVarbinds.slice(0, 10), null, 2) + "\n```\n\n";
    
    md += `### Parsed Values (Sample)\n`;
    const parsedSample = Object.fromEntries(Object.entries(trace.parsedValues).slice(0, 10));
    md += "```json\n" + JSON.stringify(parsedSample, null, 2) + "\n```\n\n";

    md += `### pollResult Object (Before DB)\n`;
    const prCopy = { ...trace.pollResult, interfaces: `[Array of ${trace.pollResult.interfaces?.length || 0} interfaces]` };
    md += "```json\n" + JSON.stringify(prCopy, null, 2) + "\n```\n\n";

    md += `### Database Row\n`;
    md += "```json\n" + JSON.stringify(trace.dbRow, null, 2) + "\n```\n\n";

    md += `### REST API Payload\n`;
    const apiCopy = { ...trace.apiDevice, interfaces: `[Array of ${trace.apiDevice.interfaces?.length || 0} interfaces]` };
    md += "```json\n" + JSON.stringify(apiCopy, null, 2) + "\n```\n\n";
  }

  md += `## End-to-End Comparison Table\n\n`;
  
  let firstFailureLayer = null;
  let hasException = false;

  for (const [name, trace] of Object.entries({ 'Working Router': rTrace, 'Target Switch': sTrace })) {
    md += `### ${name} (${trace.config.ip})\n\n`;
    md += `| Field | Raw SNMP | Parsed | pollResult | Database | API |\n`;
    md += `|---|---|---|---|---|---|\n`;

    for (const field of Object.keys(FIELDS_MAP)) {
      const vals = getComparisonValues(field, trace);
      md += `| ${field} | ${vals.raw} | ${vals.parsed} | ${vals.pr} | ${vals.db} | ${vals.api} |\n`;

      if (name === 'Target Switch' && !firstFailureLayer) {
        if (vals.raw.startsWith('Exception')) hasException = true;
        
        if (vals.raw !== 'Missing' && !vals.raw.startsWith('Exception')) {
          if (String(vals.parsed) === 'Missing' && FIELDS_MAP[field].oid) firstFailureLayer = 'Parser (Dropped)';
          else if (String(vals.pr) === 'Missing' || String(vals.pr) === 'null') firstFailureLayer = 'pollResult (Adapter Logic)';
          else if (String(vals.db) === 'NULL') firstFailureLayer = 'Database (Persistence)';
          else if (String(vals.api) === 'null') firstFailureLayer = 'API (Serialization)';
        }
      }
    }
    md += `\n`;
  }

  md += `## Evidence-Based Conclusion\n\n`;
  
  if (sTrace.rawVarbinds.length === 0) {
    md += `**Conclusion C: Switch never replies.**\n\n`;
    md += `Root cause = timeout/network.`;
  } else if (hasException) {
    md += `**Conclusion A: Device SNMP configuration issue.**\n\n`;
    md += `Root cause = Switch returns NoSuchObject / NoSuchInstance, meaning MIB view restricts access to these OIDs.`;
  } else if (firstFailureLayer === 'Parser (Dropped)') {
    md += `**Conclusion B: Parser bug.**\n\n`;
    md += `Root cause = Parser drops valid varbinds.`;
  } else if (firstFailureLayer === 'Database (Persistence)') {
    md += `**Conclusion C: Database persistence bug.**\n\n`;
    md += `Root cause = Database layer failed to save valid pollResult fields.`;
  } else if (firstFailureLayer === 'API (Serialization)') {
    md += `**Conclusion D: API serialization bug.**\n\n`;
    md += `Root cause = API layer dropped values from the database row.`;
  } else if (firstFailureLayer === 'pollResult (Adapter Logic)') {
    md += `**Conclusion B: Parser bug (pollResult logic).**\n\n`;
    md += `Root cause = SnmpPollerAdapter failed to map parsed values to pollResult.`;
  } else {
    md += `**Conclusion E: Frontend mapping bug.**\n\n`;
    md += `Root cause = API delivered data correctly. If UI is missing data, it's a React frontend issue.`;
  }

  fs.writeFileSync(path.join(__dirname, '../reports/Telemetry_Verification_Report.md'), md);
  
  console.log(`Verification complete. Reports generated at:`);
  console.log(`- reports/Telemetry_Verification_Report.md`);
  console.log(`- reports/Telemetry_Verification_Report.json`);
  
  process.exit(0);
})();
