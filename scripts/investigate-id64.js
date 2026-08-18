require('dotenv').config({path: '.env'});
const { pool } = require('../src/db');
const SnmpPollerAdapter = require('../src/modules/monitoring/adapters/SnmpPollerAdapter');
const MonitoringDevice = require('../src/modules/monitoring/models/MonitoringDevice');
const SnmpConfigHelper = require('../src/modules/monitoring/utils/SnmpConfigHelper');

async function run() {
  console.log('1. DATABASE VERIFICATION (ID 64)');
  const [rows] = await pool.query('SELECT ip_address, snmp_version, credentials, hostname, vendor, model, status FROM monitoring_devices WHERE id = 64');
  if (rows.length === 0) {
    console.log('Device 64 not found!');
    process.exit(1);
  }
  const row = rows[0];
  const creds = typeof row.credentials === 'string' ? JSON.parse(row.credentials) : row.credentials;
  
  // Safe print
  const safeCreds = { ...creds };
  delete safeCreds.authPassword;
  delete safeCreds.privPassword;
  
  console.log({
    ip_address: row.ip_address,
    snmp_version: row.snmp_version,
    credentials: safeCreds,
    hostname: row.hostname,
    vendor: row.vendor,
    model: row.model,
    status: row.status
  });

  console.log('\n2. SNMPCONFIGHELPER VERIFICATION');
  const device = await MonitoringDevice.findById(64);
  const resolved = SnmpConfigHelper.resolveConfig(device);
  
  const safeResolved = { ...resolved, credentials: { ...resolved.credentials } };
  delete safeResolved.credentials.authPassword;
  delete safeResolved.credentials.privPassword;
  console.log(safeResolved);

  console.log('\n3. DIRECT SNMP TEST (Using Adapter)');
  // We'll use SnmpPollerAdapter to poll it and capture the exact result
  const result = await SnmpPollerAdapter.poll(device);
  
  console.log('\n[ADAPTER POLL RESULT]');
  console.log(JSON.stringify(result, null, 2));

  process.exit(0);
}

run();
