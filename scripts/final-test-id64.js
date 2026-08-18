require('dotenv').config({path: '.env'});
const { pool } = require('../src/db');
const EncryptionService = require('../src/modules/monitoring/services/EncryptionService');
const SnmpConfigHelper = require('../src/modules/monitoring/utils/SnmpConfigHelper');
const SnmpPollerAdapter = require('../src/modules/monitoring/adapters/SnmpPollerAdapter');
const MonitoringDevice = require('../src/modules/monitoring/models/MonitoringDevice');

async function run() {
  console.log('\n--- 1. DATABASE VERIFICATION (ID 64) ---');
  const [rows] = await pool.query('SELECT ip_address, snmp_version, credentials, hostname, vendor, model, status FROM monitoring_devices WHERE id = 64');
  const row = rows[0];
  const dbCreds = typeof row.credentials === 'string' ? JSON.parse(row.credentials) : row.credentials;
  const safeDbCreds = { ...dbCreds };
  delete safeDbCreds.authPassword;
  delete safeDbCreds.privPassword;
  console.log({
    ip_address: row.ip_address,
    snmp_version: row.snmp_version,
    credentials: safeDbCreds,
    hostname: row.hostname,
    vendor: row.vendor,
    model: row.model,
    status: row.status
  });

  console.log('\n--- 2. SNMPCONFIGHELPER VERIFICATION ---');
  const device = await MonitoringDevice.findById(64);
  const resolved = SnmpConfigHelper.resolveConfig(device);
  
  const safeResolved = { ...resolved, credentials: { ...resolved.credentials } };
  delete safeResolved.credentials.authPassword;
  delete safeResolved.credentials.privPassword;
  console.log(safeResolved);

  console.log('\n--- 3. SNMP SESSION & DIRECT TEST ---');
  const adapter = new SnmpPollerAdapter();
  const profile = { systemOids: {} };
  
  // Actually run the poll!
  const result = await adapter.poll(device, profile, {});
  
  console.log('\n--- POLL RESULT ---');
  console.log(JSON.stringify(result, null, 2));

  process.exit(0);
}

run();
