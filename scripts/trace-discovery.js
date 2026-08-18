require('dotenv').config({path: '.env'});
const snmp = require('net-snmp');
const SnmpEngine = require('../src/modules/monitoring/snmp_engine');
const DiscoveryService = require('../src/modules/monitoring/services/DiscoveryService');

const originalParseVarbinds = SnmpEngine.prototype._parseVarbinds;
let capturedRawVarbinds = [];

SnmpEngine.prototype._parseVarbinds = function(varbinds) {
  varbinds.forEach(vb => {
    let errorType = null;
    let isError = snmp.isVarbindError(vb);
    if (isError) errorType = snmp.ObjectType[vb.type] || vb.type;
    let val = vb.value;
    if (Buffer.isBuffer(val)) val = val.toString('utf8');
    
    capturedRawVarbinds.push({
      oid: vb.oid ? (Array.isArray(vb.oid) ? vb.oid.join('.') : String(vb.oid)) : 'Unknown',
      type: snmp.ObjectType[vb.type] || vb.type,
      value: val,
      isError: isError,
      errorType: errorType
    });
  });

  return originalParseVarbinds.call(this, varbinds);
};

(async () => {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log("Usage: node scripts/trace-discovery.js <IP> [community] [version] [port]");
    process.exit(1);
  }

  const ip = args[0];
  const community = args[1] || 'public';
  const version = args[2] || 'v2c';
  const port = parseInt(args[3] || '161');

  console.log(`\n=================================================`);
  console.log(`DISCOVERY TRACE FOR ${ip}`);
  console.log(`=================================================\n`);
  
  console.log(`Starting scan with config:`);
  console.log(JSON.stringify({ cidr: `${ip}/32`, community, snmpVersion: version, port, timeout: 2000, retries: 2 }, null, 2));
  
  await DiscoveryService.startScan({
    cidr: `${ip}/32`,
    community,
    snmpVersion: version,
    port,
    timeout: 2000,
    retries: 2,
    concurrentWorkers: 1
  });

  // Wait for scan to complete
  await new Promise(resolve => {
    const timer = setInterval(() => {
      const status = DiscoveryService.getStatus();
      if (status.status === 'completed' || status.status === 'stopped') {
        clearInterval(timer);
        resolve(status);
      }
    }, 500);
  });

  const status = DiscoveryService.getStatus();
  const device = status.discoveredDevices.find(d => d.ipAddress === ip);

  console.log(`\nRAW SNMP VARBINDS CAPTURED DURING DISCOVERY:`);
  console.log(JSON.stringify(capturedRawVarbinds, null, 2));

  console.log(`\nDISCOVERY RESULT JSON:`);
  console.log(JSON.stringify(device || { error: "Device not found in discovered list" }, null, 2));

  if (!device) {
    console.log(`\nCONCLUSION: Discovery never receives them because the IP timed out completely.`);
  } else if (capturedRawVarbinds.some(vb => vb.isError)) {
    console.log(`\nCONCLUSION: Discovery never receives them because the switch returned SNMP Exceptions (e.g. NoSuchObject).`);
  } else if (capturedRawVarbinds.every(vb => !vb.isError) && device.vendor === 'Generic') {
    console.log(`\nCONCLUSION: Discovery receives them but ignores them! Parser or Mapping bug in DiscoveryService.`);
  } else {
    console.log(`\nCONCLUSION: Discovery completed successfully and correctly classified the device.`);
  }

  process.exit(0);
})();
