// src/modules/monitoring/services/VendorAdapters.js

const OIDS = {
  // Standard MIB-II
  sysDescr: "1.3.6.1.2.1.1.1.0",
  sysObjectID: "1.3.6.1.2.1.1.2.0",
  sysUpTime: "1.3.6.1.2.1.1.3.0",
  sysName: "1.3.6.1.2.1.1.5.0",
  
  // Interfaces (ifTable)
  ifNumber: "1.3.6.1.2.1.2.1.0",
  ifIndex: "1.3.6.1.2.1.2.2.1.1",
  ifDescr: "1.3.6.1.2.1.2.2.1.2",
  ifType: "1.3.6.1.2.1.2.2.1.3",
  ifMtu: "1.3.6.1.2.1.2.2.1.4",
  ifSpeed: "1.3.6.1.2.1.2.2.1.5",
  ifPhysAddress: "1.3.6.1.2.1.2.2.1.6",
  ifAdminStatus: "1.3.6.1.2.1.2.2.1.7",
  ifOperStatus: "1.3.6.1.2.1.2.2.1.8",
  ifInOctets: "1.3.6.1.2.1.2.2.1.10",
  ifInDiscards: "1.3.6.1.2.1.2.2.1.13",
  ifInErrors: "1.3.6.1.2.1.2.2.1.14",
  ifOutOctets: "1.3.6.1.2.1.2.2.1.16",
  ifOutDiscards: "1.3.6.1.2.1.2.2.1.19",
  ifOutErrors: "1.3.6.1.2.1.2.2.1.20",

  // IFX-MIB (64-bit and extended)
  ifName: "1.3.6.1.2.1.31.1.1.1.1",
  ifHCInOctets: "1.3.6.1.2.1.31.1.1.1.6",
  ifHCOutOctets: "1.3.6.1.2.1.31.1.1.1.10",
  ifAlias: "1.3.6.1.2.1.31.1.1.1.18",

  // Host Resources MIB (Standard Servers/Linux/Windows)
  hrSystemUptime: "1.3.6.1.2.1.25.1.1.0",
  hrProcessorLoad: "1.3.6.1.2.1.25.3.3.1.2",
  hrMemorySize: "1.3.6.1.2.1.25.2.2.0",

  // Cisco Specific
  ciscoCPUTotal5min: "1.3.6.1.4.1.9.9.109.1.1.1.1.5",
  ciscoMemoryPoolUsed: "1.3.6.1.4.1.9.9.48.1.1.1.5",
  ciscoMemoryPoolFree: "1.3.6.1.4.1.9.9.48.1.1.1.6",
  ciscoEnvMonTemperatureStatusValue: "1.3.6.1.4.1.9.9.13.1.3.1.3",

  // Fortinet Specific
  fgSysCpuUsage: "1.3.6.1.4.1.12356.101.4.1.3.0",
  fgSysMemUsage: "1.3.6.1.4.1.12356.101.4.1.4.0",

  // Entity MIB (Hardware)
  entPhysicalDescr: "1.3.6.1.2.1.47.1.1.1.1.2",
  entPhysicalSerialNum: "1.3.6.1.2.1.47.1.1.1.1.11",
  entPhysicalModelName: "1.3.6.1.2.1.47.1.1.1.1.13",
};

class BaseAdapter {
  constructor(engine) {
    this.engine = engine;
  }

  async getPerformanceMetrics(device) {
    // Default uses Host Resources MIB
    const result = await this.engine.walk({
      host: device.ipAddress,
      version: device.snmpVersion,
      credentials: device.credentials,
      oid: OIDS.hrProcessorLoad
    });
    
    let cpu = 0;
    if (result.success && Object.keys(result.values).length > 0) {
      let total = 0;
      let count = 0;
      for (const val of Object.values(result.values)) {
        total += Number(val);
        count++;
      }
      cpu = count > 0 ? (total / count) : 0;
    }

    return {
      cpuUtil: cpu,
      memUtil: 0, // Fallback requires complex hrStorageTable parsing
    };
  }
}

class CiscoAdapter extends BaseAdapter {
  async getPerformanceMetrics(device) {
    // Walk Cisco CPU and Memory
    const cpuResult = await this.engine.walk({ host: device.ipAddress, version: device.snmpVersion, credentials: device.credentials, oid: OIDS.ciscoCPUTotal5min });
    const memUsedResult = await this.engine.walk({ host: device.ipAddress, version: device.snmpVersion, credentials: device.credentials, oid: OIDS.ciscoMemoryPoolUsed });
    const memFreeResult = await this.engine.walk({ host: device.ipAddress, version: device.snmpVersion, credentials: device.credentials, oid: OIDS.ciscoMemoryPoolFree });

    let cpu = 0;
    if (cpuResult.success && Object.values(cpuResult.values).length > 0) {
      cpu = Number(Object.values(cpuResult.values)[0]);
    }

    let memUtil = 0;
    if (memUsedResult.success && memFreeResult.success) {
      const used = Number(Object.values(memUsedResult.values)[0] || 0);
      const free = Number(Object.values(memFreeResult.values)[0] || 0);
      if (used + free > 0) {
        memUtil = (used / (used + free)) * 100;
      }
    }

    return { cpuUtil: cpu, memUtil: memUtil };
  }
}

class FortinetAdapter extends BaseAdapter {
  async getPerformanceMetrics(device) {
    const res = await this.engine.getMany({ 
      host: device.ipAddress, 
      version: device.snmpVersion, 
      credentials: device.credentials, 
      oids: [OIDS.fgSysCpuUsage, OIDS.fgSysMemUsage] 
    });
    
    if (res.success) {
      return {
        cpuUtil: Number(res.values?.[OIDS.fgSysCpuUsage] ?? 0),
        memUtil: Number(res.values?.[OIDS.fgSysMemUsage] ?? 0)
      };
    }
    return { cpuUtil: 0, memUtil: 0 };
  }
}

class VendorAdapterFactory {
  static getAdapter(vendor, engine) {
    const v = String(vendor || "").toLowerCase();
    if (v.includes("cisco")) return new CiscoAdapter(engine);
    if (v.includes("fortinet")) return new FortinetAdapter(engine);
    return new BaseAdapter(engine);
  }
}

module.exports = {
  OIDS,
  VendorAdapterFactory
};
