require('dotenv').config({path: '.env'});
const DiscoveryService = require('../src/modules/monitoring/services/DiscoveryService');
const SnmpPollerAdapter = require('../src/modules/monitoring/adapters/SnmpPollerAdapter');
const SnmpConfigHelper = require('../src/modules/monitoring/utils/SnmpConfigHelper');
const SnmpEngine = require('../src/modules/monitoring/snmp_engine/index');
const { pool } = require('../src/db');

async function verify() {
  const ip = '192.168.5.4';
  
  // 1. DISCOVERY SETUP
  const config = {
    cidr: ip,
    discoveryMode: 'SNMP',
    snmpVersion: 'v2c',
    community: 'public',
    port: 161,
    timeout: 1000,
    retries: 1
  };
  const discoveryConfig = SnmpConfigHelper.resolveConfig(config);
  
  // 2. POLLER SETUP
  const [rows] = await pool.query('SELECT * FROM monitoring_devices WHERE ip_address = ?', [ip]);
  const dbDevice = rows[0] || {};
  const device = {
    id: dbDevice.id,
    ipAddress: dbDevice.ip_address || ip,
    snmpVersion: dbDevice.snmp_version || 'v2c',
    credentials: dbDevice.credentials ? (typeof dbDevice.credentials === 'string' ? JSON.parse(dbDevice.credentials) : dbDevice.credentials) : { community: 'public' }
  };
  const pollerConfig = SnmpConfigHelper.resolveConfig(device, {});

  console.log(`\n==============================================`);
  console.log(`SESSION CREATION COMPARISON`);
  console.log(`==============================================`);
  console.log(`Parameter      | DiscoveryService       | SnmpPollerAdapter`);
  console.log(`---------------+------------------------+------------------------`);
  console.log(`Host           | ${ip.padEnd(22)} | ${pollerConfig.host.padEnd(22)}`);
  console.log(`Port           | ${String(discoveryConfig.port).padEnd(22)} | ${String(pollerConfig.port).padEnd(22)}`);
  console.log(`Version        | ${String(discoveryConfig.version).padEnd(22)} | ${String(pollerConfig.version).padEnd(22)}`);
  console.log(`Community      | ${String(discoveryConfig.credentials.community).padEnd(22)} | ${String(pollerConfig.credentials.community).padEnd(22)}`);
  console.log(`Timeout        | ${String(discoveryConfig.timeout).padEnd(22)} | ${String(pollerConfig.timeout).padEnd(22)}`);
  console.log(`Retries        | ${String(discoveryConfig.retries).padEnd(22)} | ${String(pollerConfig.retries).padEnd(22)}`);
  console.log(`Transport      | UDP (Default)          | UDP (Default)`);
  
  console.log(`\n==============================================`);
  console.log(`EXECUTING GET sysName (1.3.6.1.2.1.1.5.0)`);
  console.log(`==============================================`);

  const engine1 = new SnmpEngine({ timeout: discoveryConfig.timeout, retries: discoveryConfig.retries });
  const res1 = await engine1.getMany({
    host: ip,
    port: discoveryConfig.port,
    version: discoveryConfig.version,
    credentials: discoveryConfig.credentials,
    oids: ['1.3.6.1.2.1.1.5.0']
  });
  console.log(`Discovery Result:`, res1);

  const engine2 = new SnmpEngine({ timeout: pollerConfig.timeout, retries: pollerConfig.retries });
  const res2 = await engine2.getMany({
    host: pollerConfig.host,
    port: pollerConfig.port,
    version: pollerConfig.version,
    credentials: pollerConfig.credentials,
    oids: ['1.3.6.1.2.1.1.5.0']
  });
  console.log(`Poller Result:   `, res2);

  process.exit(0);
}
verify();
