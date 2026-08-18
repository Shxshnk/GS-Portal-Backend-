require('dotenv').config({path: '.env'});
const { pool } = require('../src/db');
async function run() {
  const [rows] = await pool.query('SELECT credentials FROM monitoring_devices WHERE ip_address = \'192.168.5.4\'');
  console.log(rows);
  process.exit(0);
}
run();
