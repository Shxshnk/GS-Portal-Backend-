require('dotenv').config({path: '.env'});

async function runTest() {
  const payload = {
    deviceName: 'Core-R1.lab.local',
    hostname: 'Core-R1.lab.local',
    ipAddress: '192.168.121.150',
    vendor: 'Cisco',
    model: 'IOSv',
    deviceType: 'Router',
    sysName: 'Core-R1.lab.local',
    sysDescr: 'Cisco IOS Software, IOSv Software (VIOS-ADVENTERPRISEK9-M)',
    sysObjectID: '1.3.6.1.4.1.9.1.123',
    sysUpTime: '3 days, 4 hours',
    macAddress: '00:11:22:33:44:55',
    osVersion: 'IOS 15.8(3)M2',
    snmpVersion: 'v2c',
    status: 'ONLINE',
    credentials: {
      community: 'public',
      port: 161
    }
  };

  try {
    console.log('SENDING PAYLOAD:\n', JSON.stringify(payload, null, 2));
    
    const MonitoringService = require('../src/modules/monitoring/services/MonitoringService');
    const { pool } = require('../src/db');
    
    // Call the service directly
    const device = await MonitoringService.addDevice(payload);
    
    console.log('\nAPI RESPONSE (MonitoringService.addDevice):');
    console.log(JSON.stringify(device, null, 2));
    
    console.log('\nDATABASE ROW:');
    const row = await pool.query('SELECT * FROM monitoring_devices WHERE id = ?', [device.id]).then(r => r[0][0]);
    console.log(JSON.stringify(row, null, 2));
    
  } catch (err) {
    console.error('ERROR:', err.message);
  }
  process.exit(0);
}

runTest();
