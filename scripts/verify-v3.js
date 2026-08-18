require('dotenv').config({path: '.env'});
const DiscoveryService = require('../src/modules/monitoring/services/DiscoveryService');

async function runLive() {
  console.log('Testing SNMPv3 Discovery on 192.168.5.4...');
  
  const config = {
    sessionName: 'Live V3 Trace',
    cidr: '192.168.5.4/32',
    mode: 'SNMP + Ping',
    snmpVersion: 'v3',
    v3Username: 'cnmsuser2',
    v3SecurityLevel: 'authPriv',
    v3AuthProtocol: 'SHA',
    v3AuthPassword: 'cnmsuser2', // Guessing based on username
    v3PrivProtocol: 'DES',
    v3PrivPassword: 'cnmsuser2', // Guessing based on username
    port: 161,
    timeout: 3000,
    retries: 2,
    concurrentWorkers: 1,
    delayBetweenRequests: 0,
    autoRegisterDevices: false
  };

  DiscoveryService.startScan(config);

  const timer = setInterval(() => {
    const status = DiscoveryService.getStatus();
    if (status.status === 'completed' || status.status === 'stopped' || status.status === 'idle') {
      clearInterval(timer);
      console.log('Discovery finished.');
      const node = status.discoveredDevices.find(d => d.ipAddress === '192.168.5.4');
      if (node) {
        console.log('=== REAL DISCOVERED NODE JSON ===');
        console.log(JSON.stringify(node, null, 2));
      }
      process.exit(0);
    }
  }, 1000);
}

runLive();
