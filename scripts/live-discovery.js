require('dotenv').config({path: '.env'});
const DiscoveryService = require('../src/modules/monitoring/services/DiscoveryService');

async function runLive() {
  console.log('Starting live discovery on 192.168.5.4...');
  const config = {
    sessionName: 'Live Trace',
    cidr: '192.168.5.4/32',
    mode: 'SNMP + Ping',
    snmpVersion: 'v2c',
    port: 161,
    community: 'public',
    timeout: 2000,
    retries: 2,
    concurrentWorkers: 1,
    delayBetweenRequests: 0,
    autoRegisterDevices: false
  };

  DiscoveryService.startScan(config);

  // Poll until complete
  const timer = setInterval(() => {
    const status = DiscoveryService.getStatus();
    if (status.status === 'completed' || status.status === 'stopped' || status.status === 'idle') {
      clearInterval(timer);
      console.log('Discovery finished.');
      const node = status.discoveredDevices.find(d => d.ipAddress === '192.168.5.4');
      if (node) {
        console.log('=== REAL DISCOVERED NODE JSON ===');
        console.log(JSON.stringify(node, null, 2));
      } else {
        console.log('Device 192.168.5.4 was not discovered (not even pingable).');
      }
      process.exit(0);
    }
  }, 1000);
}

runLive();
