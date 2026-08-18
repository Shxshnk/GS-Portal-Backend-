require('dotenv').config({path: '.env'});
const { pool } = require('../src/db');
async function run() {
  const [rows] = await pool.query('SELECT id, ip_address, snmp_version, credentials FROM monitoring_devices');
  console.log(rows);
  process.exit(0);
}
run();
