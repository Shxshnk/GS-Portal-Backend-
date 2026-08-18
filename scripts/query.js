require('dotenv').config({path: '.env'});
const { pool } = require('../src/db');
async function run() {
  const [rows] = await pool.query('SELECT id, ip_address, hostname, sys_name, sys_descr, sys_object_id, vendor, model FROM monitoring_devices ORDER BY id DESC LIMIT 1');
  console.log(rows);
  process.exit(0);
}
run();
