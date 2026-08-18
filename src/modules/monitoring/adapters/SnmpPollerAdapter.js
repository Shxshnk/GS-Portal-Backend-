// src/modules/monitoring/adapters/SnmpPollerAdapter.js
const IPollerAdapter = require("./IPollerAdapter");
const SnmpEngine = require("../snmp_engine");
const EncryptionService = require("../services/EncryptionService");
const PollingStrategy = require("../services/PollingStrategy");
const SnmpConfigHelper = require("../utils/SnmpConfigHelper");

class SnmpPollerAdapter extends IPollerAdapter {
  constructor() {
    super();
  }

  async testConnection(device) {
    const snmpConfig = SnmpConfigHelper.resolveConfig(device);
    const engine = new SnmpEngine({ timeout: snmpConfig.timeout, retries: snmpConfig.retries });

    const startTime = Date.now();
    const systemOids = [
      "1.3.6.1.2.1.1.5.0", // sysName
      "1.3.6.1.2.1.1.1.0", // sysDescr
      "1.3.6.1.2.1.1.3.0", // sysUpTime
      "1.3.6.1.2.1.1.2.0", // sysObjectID
    ];

    const result = await engine.getMany({
      host: snmpConfig.host,
      port: snmpConfig.port,
      version: snmpConfig.version,
      credentials: snmpConfig.credentials,
      oids: systemOids,
    });

    const responseTime = Date.now() - startTime;

    if (!result.success) {
      return {
        success: false,
        error: result.error || "SNMP Connection failed",
      };
    }

    return {
      success: true,
      responseTime,
      sysName: result.values?.[systemOids[0]] ?? null,
      sysDescr: result.values?.[systemOids[1]] ?? null,
      sysUpTime: result.values?.[systemOids[2]] ?? null,
      sysObjectID: result.values?.[systemOids[3]] ?? null,
    };
  }

  async poll(device, profile, settings, options = { doEnvPoll: true, doHwPoll: true }) {
    const snmpConfig = SnmpConfigHelper.resolveConfig(device, settings);
    const engine = new SnmpEngine({ timeout: snmpConfig.timeout, retries: snmpConfig.retries });

    console.log(`\nResolved SNMP Config (AFTER FIX)`);
    console.log(`Device ID: ${device.id}`);
    console.log(`IP Address: ${snmpConfig.host}`);
    console.log(`SNMP Version: ${snmpConfig.version}`);
    console.log(`Community: ${snmpConfig.credentials?.community}`);
    console.log(`Port: ${snmpConfig.port}`);
    console.log(`Timeout: ${snmpConfig.timeout}`);
    console.log(`Retries: ${snmpConfig.retries}\n`);



    const systemOids = profile.systemOids || {};
    const cpuOids = profile.cpuOids || {};
    const memoryOids = profile.memoryOids || {};
    const tempOids = profile.tempOids || {};
    const interfaceOids = profile.interfaceOids || {};

    const startedAt = Date.now();
    const pollResult = {
      success: false,
      status: "OFFLINE",
      responseTime: null,
      pollDuration: null,
      sysName: null,
      sysDescr: null,
      sysObjectID: null,
      sysUpTime: null,
      telemetry: [],
      interfaces: [],
      error: null,
    };

    try {
      // 1. Query System metrics
      const sysOidList = [
        systemOids.sysName || "1.3.6.1.2.1.1.5.0",
        systemOids.sysDescr || "1.3.6.1.2.1.1.1.0",
        systemOids.sysObjectID || "1.3.6.1.2.1.1.2.0",
        systemOids.sysUpTime || "1.3.6.1.2.1.1.3.0"
      ];

      console.log(`[PRIMARY SNMP START]\ndeviceId=${device.id}`);
      const sysResponse = await engine.getMany({ host: snmpConfig.host, port: snmpConfig.port, version: snmpConfig.version, credentials: snmpConfig.credentials, oids: sysOidList });
      console.log(`[PRIMARY SNMP RESULT]\ndeviceId=${device.id}\nsuccess=${sysResponse.success}`);

      const responseTime = Date.now() - startedAt;
      pollResult.responseTime = responseTime;

      // DO NOT mark OFFLINE here yet. Some devices (like Cisco IOSv) actively suppress MIB-II sysName
      let sysNameSuppressedOrOffline = false;
      if (!sysResponse.success) {
        pollResult.error = sysResponse.error || "SNMP System query failed";
        sysNameSuppressedOrOffline = true;
      } else {
        pollResult.sysName = sysResponse.values?.[sysOidList[0]] || null;
        pollResult.sysDescr = sysResponse.values?.[sysOidList[1]] || null;
        pollResult.sysObjectID = sysResponse.values?.[sysOidList[2]] || null;
        pollResult.sysUpTime = sysResponse.values?.[sysOidList[3]] || null;
        pollResult.hostname = pollResult.sysName;
      }

      // Extract OS Version and Vendor from sysDescr if not already set cleanly
      if (pollResult.sysDescr) {
        if (pollResult.sysDescr.includes("Cisco IOS")) {
          pollResult.vendor = "Cisco";
          const vMatch = pollResult.sysDescr.match(/Version\s+([^,]+)/i);
          if (vMatch) pollResult.osVersion = "IOS " + vMatch[1];
        } else if (pollResult.sysDescr.includes("Linux")) {
          pollResult.osVersion = "Linux";
        } else if (pollResult.sysDescr.toLowerCase().includes("forti")) {
          pollResult.vendor = "Fortinet";
        }
      }

      // Log system uptime in telemetry
      if (pollResult.sysUpTime) {
        // sysUpTime is returned as timeticks, e.g. "12345" or raw string
        const uptimeTicks = parseInt(pollResult.sysUpTime) || 0;
        pollResult.telemetry.push({
          metricName: "uptime",
          oid: sysOidList[3],
          rawValue: pollResult.sysUpTime,
          convertedValue: uptimeTicks / 100, // converted to seconds
          unit: "seconds"
        });
      }

      // 2. Query Performance metrics: CPU, Memory, Temperature
      const performanceOids = [];
      const cpuKey = Object.keys(cpuOids)[0];
      const memKey = Object.keys(memoryOids)[0];
      const tempKey = Object.keys(tempOids)[0];

      if (cpuKey && cpuOids[cpuKey]) performanceOids.push(cpuOids[cpuKey]);
      if (memKey && memoryOids[memKey]) performanceOids.push(memoryOids[memKey]);
      if (options.doEnvPoll && tempKey && tempOids[tempKey]) performanceOids.push(tempOids[tempKey]);

      // If Linux server, check ssCpuIdle (cpu_idle) which is common, or cisco memory keys
      const hasSecondaryMem = Object.keys(memoryOids).length > 1;
      if (hasSecondaryMem) {
        const memKeys = Object.keys(memoryOids);
        if (memoryOids[memKeys[1]]) performanceOids.push(memoryOids[memKeys[1]]);
      }

      if (performanceOids.length > 0) {
        const perfResponse = await engine.getMany({ host: snmpConfig.host, port: snmpConfig.port, version: snmpConfig.version, credentials: snmpConfig.credentials, oids: performanceOids });
        if (perfResponse.success) {
          // Process CPU
          if (cpuKey && cpuOids[cpuKey]) {
            const rawCpu = perfResponse.values?.[cpuOids[cpuKey]] ?? null;
            if (rawCpu !== undefined) {
              let cpuVal = parseFloat(rawCpu) || 0;
              // If Linux idle time, CPU util is 100 - idle
              if (cpuKey === "cpu_idle") {
                cpuVal = 100 - cpuVal;
              }
              pollResult.telemetry.push({
                metricName: "cpu_util",
                oid: cpuOids[cpuKey],
                rawValue: rawCpu,
                convertedValue: cpuVal,
                unit: "%"
              });
            }
          }

          // Process Memory
          if (memKey && memoryOids[memKey]) {
            const rawMem1 = perfResponse.values?.[memoryOids[memKey]] ?? null;
            if (rawMem1 !== undefined) {
              const memVal1 = parseFloat(rawMem1) || 0;
              if (hasSecondaryMem) {
                // E.g., Cisco memFree and memUsed, or Linux memTotal and memAvail
                const memKeys = Object.keys(memoryOids);
                const rawMem2 = perfResponse.values?.[memoryOids[memKeys[1]]] ?? null;
                if (rawMem2 !== undefined) {
                  const memVal2 = parseFloat(rawMem2) || 0;
                  let util = 0;
                  if (memKey === "mem_used" && memKeys[1] === "mem_free") {
                    util = (memVal1 / (memVal1 + memVal2)) * 100;
                  } else if (memKey === "mem_total" && memKeys[1] === "mem_avail") {
                    util = ((memVal1 - memVal2) / memVal1) * 100;
                  }
                  pollResult.telemetry.push({
                    metricName: "mem_util",
                    oid: memoryOids[memKey],
                    rawValue: `${rawMem1}/${rawMem2}`,
                    convertedValue: util,
                    unit: "%"
                  });
                }
              } else {
                // If only one memory metric is defined, store it directly
                pollResult.telemetry.push({
                  metricName: "mem_util",
                  oid: memoryOids[memKey],
                  rawValue: rawMem1,
                  convertedValue: memVal1,
                  unit: "KB"
                });
              }
            }
          }

          // Process Temperature
          if (tempKey && tempOids[tempKey]) {
            const rawTemp = perfResponse.values?.[tempOids[tempKey]] ?? null;
            if (rawTemp !== undefined) {
              pollResult.telemetry.push({
                metricName: "temperature",
                oid: tempOids[tempKey],
                rawValue: rawTemp,
                convertedValue: parseFloat(rawTemp) || 0,
                unit: "C"
              });
            }
          }
        }
      }

      // Evaluate final success based ONLY on primary system poll
      if (sysNameSuppressedOrOffline && pollResult.telemetry.length === 0) {
        pollResult.success = false;
        pollResult.status = "OFFLINE";
      } else {
        pollResult.success = true;
        pollResult.status = "ONLINE";
        if (sysNameSuppressedOrOffline) {
          pollResult.error = null; // We got telemetry, so it's online despite suppressing sysName
        }
      }
    } catch (error) {
      pollResult.success = false;
      pollResult.status = "OFFLINE";
      pollResult.error = String(error?.message || error || "SNMP internal error during primary poll");
    }

    // 4. Advanced CNMS Polling (Hardware, Vendor specific Performance, Interfaces)
    // IMPORTANT: Interface Walk is completely separated from Primary Poll.
    if (pollResult.success) {
      try {
        const strategy = new PollingStrategy(engine);
        const tempDevice = {
          ...device,
          ipAddress: snmpConfig.host,
          snmpVersion: snmpConfig.version,
          credentials: snmpConfig.credentials
        };
        
        const advancedPerf = await strategy.executePoll(tempDevice, options);
        
        if (advancedPerf.cpuUtil !== undefined && advancedPerf.cpuUtil !== 0) {
          pollResult.telemetry.push({ metricName: "cpu_util", convertedValue: advancedPerf.cpuUtil, unit: "%" });
        }
        if (advancedPerf.memUtil !== undefined && advancedPerf.memUtil !== 0) {
          pollResult.telemetry.push({ metricName: "mem_util", convertedValue: advancedPerf.memUtil, unit: "%" });
        }
        
        if (advancedPerf.serialNumber) pollResult.serialNumber = advancedPerf.serialNumber;
        if (advancedPerf.model) pollResult.model = advancedPerf.model;
        if (advancedPerf.macAddress) pollResult.macAddress = advancedPerf.macAddress;
        
      } catch (advancedError) {
        // Do NOT mutate core status! Just record the interface/hardware failure.
        console.log(`[INTERFACE WALK RESULT]\ndeviceId=${device.id}\nsuccess=false\nerror=${advancedError.message || advancedError}`);
      }
    }

    // Extract core metrics for Device Overview DB update
    for (const t of pollResult.telemetry) {
      if (t.metricName === "cpu_util" && pollResult.cpuUtil === undefined) pollResult.cpuUtil = t.convertedValue;
      if (t.metricName === "mem_util" && pollResult.memUtil === undefined) pollResult.memUtil = t.convertedValue;
      if (t.metricName === "total_ram" && pollResult.totalRam === undefined) pollResult.totalRam = t.convertedValue;
      if (t.metricName === "cpu_cores" && pollResult.cpuCores === undefined) pollResult.cpuCores = t.convertedValue;
      if (t.metricName === "boot_time" && pollResult.bootTime === undefined) pollResult.bootTime = t.rawValue;
    }

    pollResult.pollDuration = Date.now() - startedAt;
    return pollResult;
  }

}

module.exports = SnmpPollerAdapter;
