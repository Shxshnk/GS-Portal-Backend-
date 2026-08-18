require('dotenv').config({path: '.env'});
const { pool } = require('../src/db');
async function run() {
  const [rows] = await pool.query('SELECT ip_address, snmp_version, credentials FROM monitoring_devices WHERE id = 64');
  console.log(rows);
  process.exit(0);
}
run();
