// src/modules/monitoring/services/PollingStrategy.js
const { OIDS, VendorAdapterFactory } = require("./VendorAdapters");
const DeviceInterface = require("../models/DeviceInterface");
const DeviceHardware = require("../models/DeviceHardware");
const DeviceSensor = require("../models/DeviceSensor");
const TelemetryHistory = require("../models/TelemetryHistory");

class PollingStrategy {
  constructor(engine) {
    this.engine = engine;
  }

  async executePoll(device, options = { doEnvPoll: true, doHwPoll: true }) {
    const adapter = VendorAdapterFactory.getAdapter(device.vendor, this.engine);
    
    // 1. Performance Polling
    const perf = await adapter.getPerformanceMetrics(device);
    
    if (perf.cpuUtil !== undefined) {
      await TelemetryHistory.insert({
        deviceId: device.id,
        metricName: "cpu_util",
        convertedValue: perf.cpuUtil,
        unit: "%"
      });
    }
    if (perf.memUtil !== undefined) {
      await TelemetryHistory.insert({
        deviceId: device.id,
        metricName: "mem_util",
        convertedValue: perf.memUtil,
        unit: "%"
      });
    }

    // 2. Interfaces Polling
    await this.pollInterfaces(device);

    let hw = {};
    if (options.doHwPoll) {
      hw = await this.pollHardware(device);
    }

    return { ...perf, ...hw }; // Return perf to update device summary
  }

  async pollInterfaces(device) {
    const SnmpConfigHelper = require("../utils/SnmpConfigHelper");
    const snmpConfig = SnmpConfigHelper.resolveConfig(device);
    const creds = { host: snmpConfig.host, port: snmpConfig.port, version: snmpConfig.version, credentials: snmpConfig.credentials };
    
    console.log(`[INTERFACE WALK START]\ndeviceId=${device.id}`);
    
    const MonitoringSettings = require("../models/MonitoringSettings");
    const timeoutMs = await MonitoringSettings.getNumber("interface_walk_timeout", 15000);
    
    let walks;
    try {
      const walkPromise = Promise.all([
        this.engine.walk({ ...creds, oid: OIDS.ifIndex }),
        this.engine.walk({ ...creds, oid: OIDS.ifDescr }),
        this.engine.walk({ ...creds, oid: OIDS.ifName }),
        this.engine.walk({ ...creds, oid: OIDS.ifAlias }),
        this.engine.walk({ ...creds, oid: OIDS.ifType }),
        this.engine.walk({ ...creds, oid: OIDS.ifMtu }),
        this.engine.walk({ ...creds, oid: OIDS.ifSpeed }),
        this.engine.walk({ ...creds, oid: OIDS.ifPhysAddress }),
        this.engine.walk({ ...creds, oid: OIDS.ifAdminStatus }),
        this.engine.walk({ ...creds, oid: OIDS.ifOperStatus }),
        this.engine.walk({ ...creds, oid: OIDS.ifInOctets }),
        this.engine.walk({ ...creds, oid: OIDS.ifOutOctets }),
        this.engine.walk({ ...creds, oid: OIDS.ifHCInOctets }),
        this.engine.walk({ ...creds, oid: OIDS.ifHCOutOctets }),
        this.engine.walk({ ...creds, oid: OIDS.ifInErrors }),
        this.engine.walk({ ...creds, oid: OIDS.ifOutErrors }),
        this.engine.walk({ ...creds, oid: OIDS.ifInDiscards }),
        this.engine.walk({ ...creds, oid: OIDS.ifOutDiscards }),
      ]);
      
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Interface walk timed out")), timeoutMs));
      
      walks = await Promise.race([walkPromise, timeoutPromise]);
    } catch (err) {
      console.log(`[INTERFACE WALK RESULT]\ndeviceId=${device.id}\nsuccess=false\nerror=${err.message}`);
      throw err; // throw to abort interface upsert, caught by SnmpPollerAdapter
    }

    const [
      idxRes, descrRes, nameRes, aliasRes, typeRes, mtuRes, speedRes,
      physRes, adminRes, operRes, inRes, outRes, hcInRes, hcOutRes,
      inErrRes, outErrRes, inDiscRes, outDiscRes
    ] = walks;

    if (!idxRes.success && !descrRes.success) {
      console.log(`[INTERFACE WALK RESULT]\ndeviceId=${device.id}\nsuccess=false\nerror=Both ifIndex and ifDescr failed`);
      return {}; 
    }

    const indexes = idxRes.success ? Object.keys(idxRes.values || {}).map(k => k.split(".").pop()) : Object.keys(descrRes.values || {}).map(k => k.split(".").pop());

    let primaryMac = null;
    const processedIndexes = new Set();

    for (const idxStr of indexes) {
      const idx = Number(idxStr);
      if (!idx || isNaN(idx) || idx <= 0) continue;
      if (processedIndexes.has(idx)) continue;
      processedIndexes.add(idx);

      const ifName = nameRes.values?.[OIDS.ifName + "." + idx];
      const ifAlias = aliasRes.values?.[OIDS.ifAlias + "." + idx];
      const ifDescr = descrRes.values?.[OIDS.ifDescr + "." + idx];

      // Enforce display priority: ifName -> ifAlias -> ifDescr
      let displayName = "";
      if (ifName && String(ifName).trim() !== "") displayName = String(ifName);
      else if (ifAlias && String(ifAlias).trim() !== "") displayName = String(ifAlias);
      else if (ifDescr && String(ifDescr).trim() !== "") displayName = String(ifDescr);

      if (!displayName || displayName.trim() === "") continue; // Discard blank interfaces

      const admin = adminRes.values?.[OIDS.ifAdminStatus + "." + idx] === "1" ? "up" : "down";
      const oper = operRes.values?.[OIDS.ifOperStatus + "." + idx] === "1" ? "up" : "down";
      
      const speed = speedRes.values?.[OIDS.ifSpeed + "." + idx];
      const type = typeRes.values?.[OIDS.ifType + "." + idx];
      const mtu = mtuRes.values?.[OIDS.ifMtu + "." + idx];
      const mac = physRes.values?.[OIDS.ifPhysAddress + "." + idx];

      const hcIn = hcInRes.values?.[OIDS.ifHCInOctets + "." + idx];
      const hcOut = hcOutRes.values?.[OIDS.ifHCOutOctets + "." + idx];
      
      const inOctets = inRes.values?.[OIDS.ifInOctets + "." + idx];
      const outOctets = outRes.values?.[OIDS.ifOutOctets + "." + idx];

      const rx = hcIn || inOctets || 0;
      const tx = hcOut || outOctets || 0;

      const inErrors = inErrRes.values?.[OIDS.ifInErrors + "." + idx] || 0;
      const outErrors = outErrRes.values?.[OIDS.ifOutErrors + "." + idx] || 0;
      const inDiscards = inDiscRes.values?.[OIDS.ifInDiscards + "." + idx] || 0;
      const outDiscards = outDiscRes.values?.[OIDS.ifOutDiscards + "." + idx] || 0;

      // Ensure proper Hex MAC decoding if it's not string
      let formattedMac = mac;
      if (formattedMac && formattedMac.length > 10 && formattedMac.includes(" ")) {
         formattedMac = formattedMac.replace(/\s+/g, ':').toLowerCase();
      }
      
      if (formattedMac && !primaryMac && formattedMac.length >= 11) {
         primaryMac = formattedMac;
      }

      await DeviceInterface.upsert({
        deviceId: device.id,
        interfaceIndex: Number(idx),
        interfaceName: displayName,
        alias: ifAlias || null,
        description: ifDescr || null,
        type: type ? String(type) : null,
        mac: formattedMac || null,
        mtu: mtu ? Number(mtu) : null,
        adminStatus: admin,
        operStatus: oper,
        speed: speed ? String(speed) : null,
        inputTraffic: Number(rx),
        outputTraffic: Number(tx),
        hcInOctets: hcIn ? Number(hcIn) : null,
        hcOutOctets: hcOut ? Number(hcOut) : null,
        inErrors: Number(inErrors),
        outErrors: Number(outErrors),
        inDiscards: Number(inDiscards),
      });
    }

    console.log(`[INTERFACE WALK RESULT]\ndeviceId=${device.id}\nsuccess=true\ninterfacesFound=${indexes.length}`);

    return { macAddress: primaryMac };
  }

  async pollHardware(device) {
    const descrRes = await this.engine.walk({ host: device.ipAddress, version: device.snmpVersion, credentials: device.credentials, oid: OIDS.entPhysicalDescr });
    const serialRes = await this.engine.walk({ host: device.ipAddress, version: device.snmpVersion, credentials: device.credentials, oid: OIDS.entPhysicalSerialNum });
    const modelRes = await this.engine.walk({ host: device.ipAddress, version: device.snmpVersion, credentials: device.credentials, oid: OIDS.entPhysicalModelName });

    if (!descrRes.success) return {};

    let mainSerial = null;
    let mainModel = null;

    for (const [key, descr] of Object.entries(descrRes.values || {})) {
      const idx = key.split(".").pop();
      const serial = serialRes.values?.[OIDS.entPhysicalSerialNum + "." + idx] || null;
      const model = modelRes.values?.[OIDS.entPhysicalModelName + "." + idx] || null;

      // Capture chassis serial (usually idx 1 or first one found)
      if (idx === "1" || !mainSerial) {
        if (serial) mainSerial = serial;
        if (model) mainModel = model;
      }

      if (descr && String(descr).trim() !== "") {
        await DeviceHardware.upsert({
          deviceId: device.id,
          componentName: descr,
          serialNumber: serial,
          modelName: model,
        });
      }
    }

    return { serialNumber: mainSerial, model: mainModel };
  }
}

module.exports = PollingStrategy;
