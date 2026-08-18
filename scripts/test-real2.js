require('dotenv').config({path: '.env'});
const SnmpConfigHelper = require('../src/modules/monitoring/utils/SnmpConfigHelper');
const SnmpPollerAdapter = require('../src/modules/monitoring/adapters/SnmpPollerAdapter');
const MonitoringDevice = require('../src/modules/monitoring/models/MonitoringDevice');

async function run() {
  console.log('\n--- RESOLUTION ---');
  const device = await MonitoringDevice.findById(64);
  const resolved = SnmpConfigHelper.resolveConfig(device);
  const safeResolved = { ...resolved, credentials: { ...resolved.credentials } };
  delete safeResolved.credentials.authPassword;
  delete safeResolved.credentials.privPassword;
  console.log(JSON.stringify(safeResolved, null, 2));

  console.log('\n--- RAW SNMP TEST ---');
  const engine = new (require('../src/modules/monitoring/snmp_engine/index'))({ timeout: resolved.timeout, retries: resolved.retries });
  const rawResult = await engine.getMany({
    host: resolved.host, port: resolved.port, version: resolved.version, credentials: resolved.credentials,
    oids: ['1.3.6.1.2.1.1.1.0', '1.3.6.1.2.1.1.2.0', '1.3.6.1.2.1.1.3.0', '1.3.6.1.2.1.1.5.0']
  });
  console.log(JSON.stringify(rawResult, null, 2));
  process.exit(0);
}
run();
