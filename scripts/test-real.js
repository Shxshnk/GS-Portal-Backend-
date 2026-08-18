require('dotenv').config({path: '.env'});
const { pool } = require('../src/db');
const EncryptionService = require('../src/modules/monitoring/services/EncryptionService');
const snmp = require('net-snmp');

async function run() {
  const [rows] = await pool.query('SELECT ip_address, snmp_version, credentials FROM monitoring_devices WHERE id = 64');
  if (rows.length === 0) { console.log('Device 64 not found in DB'); process.exit(1); }
  const row = rows[0];
  const creds = typeof row.credentials === 'string' ? JSON.parse(row.credentials) : row.credentials;

  console.log('--- 1. Exact SNMP config sent by Polling (Decrypted) ---');
  const decryptedAuth = EncryptionService.decrypt(creds.authPassword);
  const decryptedPriv = EncryptionService.decrypt(creds.privPassword);
  
  const safeConfig = {
    host: row.ip_address, port: creds.port, version: row.snmp_version,
    username: creds.username, securityLevel: creds.securityLevel,
    authProtocol: creds.authProtocol, privProtocol: creds.privProtocol,
    timeout: creds.timeout, retries: creds.retries
  };
  console.log(JSON.stringify(safeConfig, null, 2));

  console.log('\n--- 2. Exact net-snmp session creation parameters ---');
  const user = {
    name: creds.username,
    level: snmp.SecurityLevel.authPriv,
    authProtocol: snmp.AuthProtocols.sha,
    authKey: decryptedAuth,
    privProtocol: snmp.PrivProtocols.des,
    privKey: decryptedPriv
  };
  console.log('{ host: ' + row.ip_address + ', port: ' + creds.port + ', timeout: ' + creds.timeout + ', retries: ' + creds.retries + ' }');
  console.log('User config: (password hidden) { name: ' + creds.username + ', level: authPriv, authProtocol: SHA, privProtocol: DES }');

  console.log('\n--- 3. RAW SNMP RESPONSE ---');
  const session = snmp.createV3Session(row.ip_address, user, {
    port: creds.port, timeout: creds.timeout, retries: creds.retries
  });
  
  session.get(['1.3.6.1.2.1.1.5.0', '1.3.6.1.2.1.1.1.0', '1.3.6.1.2.1.1.2.0', '1.3.6.1.2.1.1.3.0'], (error, varbinds) => {
    if (error) {
      console.log('success: false');
      console.log('error:', error.message || error.toString());
      process.exit(0);
    } else {
      console.log('success: true');
      for (const vb of varbinds) {
        if (!snmp.isVarbindError(vb)) {
          console.log(vb.oid + ' = ' + vb.value.toString());
        }
      }
      process.exit(0);
    }
  });
}
run();
