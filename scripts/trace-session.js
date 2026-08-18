require('dotenv').config({path: '.env'});
const DiscoveryService = require('../src/modules/monitoring/services/DiscoveryService');
const SnmpPollerAdapter = require('../src/modules/monitoring/adapters/SnmpPollerAdapter');
const SnmpEngine = require('../src/modules/monitoring/snmp_engine/index');
const { pool } = require('../src/db');

const originalCreateSession = SnmpEngine.prototype._createSession;
SnmpEngine.prototype._createSession = function(host, port, version, credentials) {
  console.log(`[SnmpEngine Intercept] _createSession Called by: ${this.context || 'Unknown'}`);
  console.log(`  - Host: ${host}`);
  console.log(`  - Port: ${port}`);
  console.log(`  - Version: ${version}`);
  console.log(`  - Credentials (Community): ${credentials?.community}`);
  console.log(`  - Timeout: ${this.timeout}`);
  console.log(`  - Retries: ${this.retries}`);
  console.log(`  - Transport: UDP (net-snmp default)`);
  return originalCreateSession.call(this, host, port, version, credentials);
};

const originalGetMany = SnmpEngine.prototype.getMany;
SnmpEngine.prototype.getMany = async function(params) {
  console.log(`[SnmpEngine Intercept] getMany Called with OIDs:`, params.oids);
  return originalGetMany.call(this, params);
};

async function runTrace() {
  const ip = '192.168.5.4';
  console.log(`=========================================`);
  console.log(`1. TRACING DISCOVERY (Target: ${ip})`);
  console.log(`=========================================`);
  
  SnmpEngine.prototype.context = 'DiscoveryService';
  
  try {
    const scanConfig = {
      cidr: ip,
      discoveryMode: 'SNMP',
      snmpVersion: 'v2c',
      community: 'public',
      port: 161,
      timeout: 1000,
      retries: 1,
      concurrentWorkers: 1,
      delayBetweenRequests: 0,
      autoRegisterDevices: false
    };
    
    const scan = await DiscoveryService.startScan(scanConfig);
    
    let status = scan;
    while(status.status === 'running') {
      await new Promise(r => setTimeout(r, 500));
      status = DiscoveryService.getStatus();
    }
  } catch (e) {
    console.log('Discovery error:', e.message);
  }

  console.log(`\n=========================================`);
  console.log(`2. TRACING POLLING SCHEDULER (Target: ${ip})`);
  console.log(`=========================================`);
  
  SnmpEngine.prototype.context = 'SnmpPollerAdapter';
  
  try {
    const [rows] = await pool.query('SELECT * FROM monitoring_devices WHERE ip_address = ?', [ip]);
    if (rows.length === 0) {
      console.log(`Device ${ip} not found in database. Cannot trace polling.`);
    } else {
      const dbDevice = rows[0];
      const device = {
        id: dbDevice.id,
        ipAddress: dbDevice.ip_address,
        snmpVersion: dbDevice.snmp_version,
        credentials: dbDevice.credentials ? (typeof dbDevice.credentials === 'string' ? JSON.parse(dbDevice.credentials) : dbDevice.credentials) : {},
        community: dbDevice.community
      };
      
      const profile = { systemOids: {} };
      const settings = {};
      
      const poller = new SnmpPollerAdapter();
      const result = await poller.poll(device, profile, settings, { doEnvPoll: false, doHwPoll: false });
      
      console.log(`Poll Result Status: ${result.status}`);
      console.log(`Poll Result Error: ${result.error}`);
    }
  } catch(e) {
     console.log('Polling error:', e.message);
  }

  process.exit(0);
}

runTrace();
