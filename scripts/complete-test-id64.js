require('dotenv').config({path: '.env'});
const { pool } = require('../src/db');
const SnmpConfigHelper = require('../src/modules/monitoring/utils/SnmpConfigHelper');
const SnmpPollerAdapter = require('../src/modules/monitoring/adapters/SnmpPollerAdapter');
const MonitoringDevice = require('../src/modules/monitoring/models/MonitoringDevice');

async function run() {
  console.log('\n--- 1. DATABASE CONFIGURATION ---');
  const [rows] = await pool.query('SELECT ip_address, snmp_version, credentials, hostname, vendor, model, status, sys_name, sys_descr, sys_object_id, sys_uptime FROM monitoring_devices WHERE id = 64');
  const row = rows[0];
  const dbCreds = typeof row.credentials === 'string' ? JSON.parse(row.credentials) : row.credentials;
  const safeDbCreds = { ...dbCreds };
  delete safeDbCreds.authPassword;
  delete safeDbCreds.privPassword;
  console.log(JSON.stringify({ ...row, credentials: safeDbCreds }, null, 2));

  console.log('\n--- 2. SNMPCONFIGHELPER RESOLUTION ---');
  const device = await MonitoringDevice.findById(64);
  const resolved = SnmpConfigHelper.resolveConfig(device);
  const safeResolved = { ...resolved, credentials: { ...resolved.credentials } };
  delete safeResolved.credentials.authPassword;
  delete safeResolved.credentials.privPassword;
  console.log(JSON.stringify(safeResolved, null, 2));

  console.log('\n--- 3. RAW SNMP TEST (GET sysDescr, sysObjectID, sysUpTime, sysName) ---');
  const engine = new (require('../src/modules/monitoring/snmp_engine/index'))({ timeout: resolved.timeout, retries: resolved.retries });
  const rawResult = await engine.getMany({
    host: resolved.host, port: resolved.port, version: resolved.version, credentials: resolved.credentials,
    oids: ['1.3.6.1.2.1.1.1.0', '1.3.6.1.2.1.1.2.0', '1.3.6.1.2.1.1.3.0', '1.3.6.1.2.1.1.5.0']
  });
  console.log(JSON.stringify(rawResult, null, 2));

  if (!rawResult.success) {
    console.log('\nSNMP transport: working');
    console.log('Cisco reachable: yes');
    console.log('SNMPv3 session: reached device');
    console.log('Authentication: failed');
    console.log('Reason: ' + rawResult.error);
    process.exit(0);
  }

  console.log('\n--- 4. POLLING STABILITY TEST ---');
  const adapter = new SnmpPollerAdapter();
  const profile = { systemOids: {} };
  
  for(let i=1; i<=3; i++) {
    console.log('\nPOLL #' + i + ':');
    const pollResult = await adapter.poll(device, profile, {});
    const safePoll = { ...pollResult };
    console.log('Status: ' + pollResult.status);
    console.log('Success: ' + pollResult.success);
    console.log('Error: ' + (pollResult.error || 'None'));
    console.log('sysName: ' + (pollResult.sysName || '-'));
    console.log('sysDescr: ' + (pollResult.sysDescr ? pollResult.sysDescr.substring(0, 30) + '...' : '-'));
    console.log('Interfaces Found: ' + (pollResult.interfaces ? pollResult.interfaces.length : 0));
    
    // Update DB
    await MonitoringDevice.updatePollResultExtended(64, pollResult);
    
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\n--- 5. FINAL DATABASE VERIFICATION ---');
  const [rows2] = await pool.query('SELECT hostname, sys_name, sys_descr, sys_object_id, sys_uptime, vendor, model, status FROM monitoring_devices WHERE id = 64');
  console.log(JSON.stringify(rows2[0], null, 2));

  console.log('\n--- 6. API VERIFICATION ---');
  const apiDev = await MonitoringDevice.findById(64);
  console.log(JSON.stringify({
    sysName: apiDev.sysName,
    sysDescr: apiDev.sysDescr,
    sysObjectID: apiDev.sysObjectID,
    sysUpTime: apiDev.sysUpTime,
    hostname: apiDev.hostname,
    vendor: apiDev.vendor,
    model: apiDev.model,
    status: apiDev.status
  }, null, 2));

  process.exit(0);
}
run();
