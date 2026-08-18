require("dotenv").config({ path: ".env" });
const { pool } = require("../src/db");
const SnmpPollerAdapter = require("../src/modules/monitoring/adapters/SnmpPollerAdapter");

async function main() {
  const [rows] = await pool.query("SELECT * FROM monitoring_devices WHERE ip_address = '192.168.121.152'");
  const device = rows[0];
  device.credentials = device.credentials ? (typeof device.credentials === 'string' ? JSON.parse(device.credentials) : device.credentials) : null;
  
  const adapter = new SnmpPollerAdapter();
  const profile = {
    timeout: 3000,
    retries: 1,
    systemOids: {},
    cpuOids: { cpu_usage: "1.3.6.1.4.1.9.9.109.1.1.1.1.7.1" },
    memoryOids: { mem_used: "1.3.6.1.4.1.9.9.48.1.1.1.6.1", mem_free: "1.3.6.1.4.1.9.9.48.1.1.1.5.1" },
    tempOids: {},
    interfaceOids: {}
  };
  
  console.log("Polling...");
  const result = await adapter.poll(device, profile, {});
  console.log("Result:", JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch(console.error);
