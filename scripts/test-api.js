require('dotenv').config({path: '.env'});
const MonitoringService = require('../src/modules/monitoring/services/MonitoringService');
const MonitoringDevice = require('../src/modules/monitoring/models/MonitoringDevice');

async function run() {
  const payload = {
    deviceName: 'TestDevice',
    ipAddress: '10.0.0.99',
    vendor: 'Cisco',
    model: 'Switch',
    snmpVersion: 'v2c',
    deviceType: 'Switch',
    status: 'ONLINE',
    sysName: 'Core-R2.commedia.local',
    sysDescr: 'Cisco IOS Software',
    sysObjectID: '1.3.6.1.4.1.9.1.1',
    credentials: {
      community: 'public',
      port: 161,
      timeout: 2500,
      retries: 1
    }
  };

  try {
    const newDevice = await MonitoringService.addDevice(payload);
    console.log('API Result:', newDevice);
    
    // Check DB directly
    const { pool } = require('../src/db');
    const [rows] = await pool.query('SELECT * FROM monitoring_devices WHERE id = ?', [newDevice.id]);
    console.log('DB Row:', rows[0]);

  } catch(e) {
    console.log('Error:', e);
  }
  process.exit(0);
}
run();
