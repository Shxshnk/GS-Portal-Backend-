// src/modules/monitoring/services/DiscoveryService.js
const { exec } = require("child_process");
const dns = require('dns');
const util = require('util');
const dnsReverse = util.promisify(dns.reverse);
const SnmpEngine = require("../snmp_engine");
const DiscoverySession = require("../models/DiscoverySession");
const MonitoringDevice = require("../models/MonitoringDevice");
const SnmpConfigHelper = require("../utils/SnmpConfigHelper");

let activeScan = {
  id: null,
  sessionName: "",
  cidr: "",
  mode: "SNMP + Ping",
  status: "idle", // idle, running, paused, stopped, completed
  totalIps: 0,
  scannedIps: 0,
  discoveredDevices: [],
  startTime: null,
  endTime: null,
  currentIp: "",
  elapsedTime: 0,
  remainingTime: 0,
  scanSpeed: 0,
  reachableCount: 0,
  unreachableCount: 0,
  activeWorkers: 0,
  events: [],
};

let scanIntervalTimer = null;
let pausePromiseResolve = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cidrToIps(cidr) {
  const parts = cidr.split("/");
  if (parts.length === 1) {
    if (parts[0].includes("-")) {
      const rangeParts = parts[0].split("-");
      return ipRangeToIps(rangeParts[0].trim(), rangeParts[1].trim());
    }
    return [parts[0].trim()];
  }
  const ip = parts[0];
  const subnet = parseInt(parts[1], 10);
  
  const ipParts = ip.split(".").map(Number);
  const ipNum = (ipParts[0] << 24) + (ipParts[1] << 16) + (ipParts[2] << 8) + ipParts[3];
  
  const mask = subnet === 0 ? 0 : (~0 << (32 - subnet));
  const startIp = ipNum & mask;
  const endIp = ipNum | ~mask;
  
  const ips = [];
  const skipBorder = subnet < 31;
  const low = skipBorder ? startIp + 1 : startIp;
  const high = skipBorder ? endIp - 1 : endIp;
  
  for (let i = low; i <= high; i++) {
    ips.push([
      (i >>> 24) & 255,
      (i >>> 16) & 255,
      (i >>> 8) & 255,
      i & 255
    ].join("."));
  }
  return ips;
}

function ipRangeToIps(startIp, endIp) {
  const startParts = startIp.split(".").map(Number);
  const endParts = endIp.split(".").map(Number);
  const startNum = (startParts[0] << 24) + (startParts[1] << 16) + (startParts[2] << 8) + startParts[3];
  const endNum = (endParts[0] << 24) + (endParts[1] << 16) + (endParts[2] << 8) + endParts[3];
  
  const ips = [];
  for (let i = startNum; i <= endNum; i++) {
    ips.push([
      (i >>> 24) & 255,
      (i >>> 16) & 255,
      (i >>> 8) & 255,
      i & 255
    ].join("."));
  }
  return ips;
}

function pingIp(ip, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const isWin = process.platform === "win32";
    const timeoutSec = Math.max(1, Math.round(timeoutMs / 1000));
    const cmd = isWin 
      ? `ping -n 1 -w ${timeoutMs} ${ip}` 
      : `ping -c 1 -W ${timeoutSec} ${ip}`;
       
    exec(cmd, (error, stdout) => {
      if (error) {
        resolve(false);
      } else {
        const success = isWin 
          ? stdout.toLowerCase().includes("reply from") && !stdout.toLowerCase().includes("destination host unreachable")
          : stdout.toLowerCase().includes("1 packets transmitted, 1 received") || stdout.toLowerCase().includes("1 received");
        resolve(success);
      }
    });
  });
}

function classifyDevice(sysDescr, sysObjectID) {
  const desc = String(sysDescr || "").toLowerCase();
  const oid = String(sysObjectID || "");
  
  let vendor = "Generic";
  let model = "SNMP Device";
  let deviceType = "Other";
  
  // 1. sysObjectID priority
  if (oid.startsWith("1.3.6.1.4.1.9.")) {
    vendor = "Cisco";
    deviceType = "Switch";
    if (desc.includes("router")) deviceType = "Router";
    if (desc.includes("catalyst")) model = "Catalyst";
  } else if (oid.startsWith("1.3.6.1.4.1.2636.")) {
    vendor = "Juniper";
    deviceType = "Router";
  } else if (oid.startsWith("1.3.6.1.4.1.318.")) {
    vendor = "APC";
    deviceType = "UPS";
  } else if (oid.startsWith("1.3.6.1.4.1.12356.")) {
    vendor = "Fortinet";
    deviceType = "Firewall";
  }
  
  // 2. sysDescr fallback
  if (vendor === "Generic") {
    if (desc.includes("cisco")) {
      vendor = "Cisco";
      deviceType = "Switch";
      if (desc.includes("router")) deviceType = "Router";
      if (desc.includes("catalyst")) model = "Catalyst";
    } else if (desc.includes("juniper")) {
      vendor = "Juniper";
      deviceType = "Router";
    } else if (desc.includes("linux")) {
      vendor = "Linux";
      deviceType = "Server";
    } else if (desc.includes("windows")) {
      vendor = "Windows";
      deviceType = "Server";
    } else if (desc.includes("ups") || desc.includes("apc")) {
      vendor = "APC";
      deviceType = "UPS";
    } else if (desc.includes("safran") || desc.includes("orion")) {
      vendor = "Safran";
      deviceType = "Ground Station Controller";
      model = "Orion";
    }
  }

  // 3. Prevent generic if Cisco OID
  if (vendor === "Generic" && oid && oid.includes("1.3.6.1.4.1.9.")) {
      vendor = "Cisco";
  }
  
  return { vendor, model, deviceType };
}

class DiscoveryService {
  static async startScan(config) {
    if (activeScan.status === "running" || activeScan.status === "paused") {
      throw new Error("A discovery scan is already active");
    }

    const cidr = config.cidr || "192.168.1.0/24";
    let targetIps = [];
    try {
      targetIps = cidrToIps(cidr);
    } catch (e) {
      throw new Error("Invalid CIDR or IP range string format");
    }

    if (targetIps.length === 0) {
      throw new Error("No IPs found in the specified range");
    }

    // Reset scanner state
    activeScan = {
      id: "scan_" + Date.now(),
      sessionName: config.discoveryName || "Discovery Session",
      cidr,
      mode: config.discoveryMode || "SNMP + Ping",
      status: "running",
      totalIps: targetIps.length,
      scannedIps: 0,
      discoveredDevices: [],
      startTime: Date.now(),
      endTime: null,
      currentIp: "",
      elapsedTime: 0,
      remainingTime: 0,
      scanSpeed: 0,
      reachableCount: 0,
      unreachableCount: 0,
      activeWorkers: 0,
      events: [{ timestamp: Date.now(), type: 'info', message: `Started Discovery Session targeting ${targetIps.length} IPs in ${cidr}` }],
      existingIps: new Set(),
    };

    try {
      const devices = await MonitoringDevice.list();
      activeScan.existingIps = new Set(devices.map((d) => d.ipAddress));
    } catch (e) {
      console.error("[discovery] Failed to fetch existing IPs:", e);
    }

    // Background timer to update elapsed and remaining times
    if (scanIntervalTimer) clearInterval(scanIntervalTimer);
    scanIntervalTimer = setInterval(() => {
      if (activeScan.status === "running") {
        activeScan.elapsedTime = Math.round((Date.now() - activeScan.startTime) / 1000);
        if (activeScan.scannedIps > 0) {
          activeScan.scanSpeed = Number((activeScan.scannedIps / activeScan.elapsedTime).toFixed(1));
          const remainingIps = activeScan.totalIps - activeScan.scannedIps;
          activeScan.remainingTime = activeScan.scanSpeed > 0 ? Math.round(remainingIps / activeScan.scanSpeed) : 0;
        }
      }
    }, 1000);

    // Launch worker thread execution
    this.runScanner(targetIps, config);

    return activeScan;
  }

  static async runScanner(ips, config) {
    const concurrency = Math.max(1, parseInt(config.concurrentWorkers || 10));
    const delay = Math.max(0, parseInt(config.delayBetweenRequests || 0));

    // Resolve unified SNMP configuration
    const snmpConfig = SnmpConfigHelper.resolveConfig(config);
    const engine = new SnmpEngine({ timeout: snmpConfig.timeout, retries: snmpConfig.retries });

    let index = 0;

    const worker = async () => {
      while (index < ips.length) {
        if (activeScan.status === "stopped" || activeScan.status === "completed") {
          break;
        }

        // Pause hook check
        if (activeScan.status === "paused") {
          await new Promise((resolve) => {
            pausePromiseResolve = resolve;
          });
        }

        const ip = ips[index++];
        activeScan.currentIp = ip;

        try {
          let reachable = false;
          let snmpSuccess = false;
          let sysName = "";
          let sysDescr = "";
          let sysObjectID = "";
          let sysUpTime = "";
          let responseTime = 0;

          const startPing = Date.now();

          // 1. Run Ping check if configured
          if (activeScan.mode.includes("Ping")) {
            reachable = await pingIp(ip, snmpConfig.timeout);
            responseTime = Date.now() - startPing;
          }

          // 2. Run SNMP check if configured (and reachable is true or Ping is bypassed)
          if (activeScan.mode.includes("SNMP") && (!activeScan.mode.includes("Ping") || reachable)) {
            const startSnmp = Date.now();
            
            // 7. Add structured diagnostic logging around the actual SNMP request
            console.log("\n[SNMP DISCOVERY CONFIG]");
            console.log(`host: ${snmpConfig.host || ip}`);
            console.log(`port: ${snmpConfig.port}`);
            console.log(`version: ${snmpConfig.version}`);
            if (snmpConfig.version === 'v3' || snmpConfig.version === '3') {
              console.log(`username: ${snmpConfig.credentials.username}`);
              console.log(`securityLevel: ${snmpConfig.credentials.securityLevel}`);
              console.log(`authProtocol: ${snmpConfig.credentials.authProtocol}`);
              console.log(`privProtocol: ${snmpConfig.credentials.privProtocol}`);
            } else {
              console.log(`community: ${snmpConfig.credentials.community}`);
            }
            console.log(`timeout: ${snmpConfig.timeout}`);
            console.log(`retries: ${snmpConfig.retries}`);
            
            const systemOids = [
              "1.3.6.1.2.1.1.5.0", // sysName
              "1.3.6.1.2.1.1.1.0", // sysDescr
              "1.3.6.1.2.1.1.2.0", // sysObjectID
            ];

            // 8. Add logging immediately before engine.getMany()
            console.log(`\n[SNMP DISCOVERY] GET sysName/sysDescr/sysObjectID`);
            console.log(`[SNMP DISCOVERY] Target: ${ip}`);
            console.log(`[SNMP DISCOVERY] Version: ${snmpConfig.version}`);
            if (snmpConfig.version === 'v3' || snmpConfig.version === '3') {
              console.log(`[SNMP DISCOVERY] Username: ${snmpConfig.credentials.username}`);
            }

            const result = await engine.getMany({
              host: ip,
              port: snmpConfig.port,
              version: snmpConfig.version,
              credentials: snmpConfig.credentials,
              oids: systemOids,
            });

            // 9. Log the raw response
            console.log("\n[SNMP RAW RESPONSE]");
            console.log(`success: ${result.success}`);
            console.log(`error: ${result.error || null}`);
            console.log(`returned OIDs: ${result.values ? Object.keys(result.values).length : 0}`);
            if (result.values) {
              console.log(JSON.stringify(result.values, null, 2));
            }

            snmpSuccess = result.success;

            if (snmpSuccess) {
              reachable = true;
              sysName = result.values?.[systemOids[0]] ?? "";
              sysDescr = result.values?.[systemOids[1]] ?? "";
              sysObjectID = result.values?.[systemOids[2]] ?? "";
              responseTime = Date.now() - startSnmp;
              
              const classification = classifyDevice(sysDescr, sysObjectID);
              console.log(`[discovery] SNMP SUCCESS for ${ip}:`);
              console.log(`  - sysName: ${sysName}`);
              console.log(`  - sysDescr: ${sysDescr}`);
              console.log(`  - sysObjectID: ${sysObjectID}`);
              console.log(`  - Classified Vendor: ${classification.vendor}`);
              console.log(`  - Classified Model: ${classification.model}`);
              console.log(`  - Classified Type: ${classification.deviceType}`);
              console.log(`  - SNMP Version: ${snmpConfig.version}`);
            } else {
              // 6. Ensure DiscoveryService does NOT silently downgrade a failed SNMPv3 request. Log the exact SNMP failure reason.
              console.log(`\n[discovery] SNMP FAILURE for ${ip}: ${result.error || "Timeout or Host Unreachable"}`);
              activeScan.events.push({ timestamp: Date.now(), type: 'warning', message: `SNMP query failed for ${ip}: ${result.error || "Timeout"}` });
            }
          }

          if (reachable) {
            activeScan.reachableCount++;
            
            const classification = classifyDevice(sysDescr, sysObjectID);

            let dnsHostname = "";
            try {
              const hostnames = await dnsReverse(ip);
              if (hostnames && hostnames.length > 0) dnsHostname = hostnames[0];
            } catch(e) {}

            const finalHostname = sysName || dnsHostname || ip;

            const discoveredNode = {
              id: activeScan.discoveredDevices.length + 1,
              hostname: finalHostname,
              ipAddress: ip,
              vendor: classification.vendor,
              model: classification.model,
              deviceType: classification.deviceType,
              sysName: sysName,
              sysDescr: sysDescr,
              sysObjectID: sysObjectID,
              responseTime: responseTime,
              snmpVersion: snmpSuccess ? snmpConfig.version : "None",
              status: "Reachable",
              discoverySource: activeScan.sessionName,
              isDuplicate: activeScan.existingIps ? activeScan.existingIps.has(ip) : false,
            };

            activeScan.discoveredDevices.push(discoveredNode);
            activeScan.events.push({ timestamp: Date.now(), type: 'success', message: `Discovered ${discoveredNode.deviceType} at ${ip} (${finalHostname})` });
            if (activeScan.events.length > 50) activeScan.events.shift();

            // Auto-registration trigger
            if (config.autoRegisterDevices && snmpSuccess) {
              await MonitoringDevice.create({
                deviceName: discoveredNode.hostname,
                ipAddress: ip,
                vendor: discoveredNode.vendor,
                model: discoveredNode.model,
                deviceType: discoveredNode.deviceType,
                sys_name: discoveredNode.sysName,
                sys_descr: discoveredNode.sysDescr,
                sys_object_id: discoveredNode.sysObjectID,
                snmpVersion: snmpConfig.version,
                status: "ONLINE",
                profileId: config.autoAssignProfile ? parseInt(config.autoAssignProfile) : null,
                credentials: snmpConfig.credentials,
              });
            }
          } else {
            activeScan.unreachableCount++;
          }
        } catch (e) {
          console.error(`[discovery] Error scanning IP ${ip}:`, e);
          activeScan.unreachableCount++;
        }

        activeScan.scannedIps++;

        if (delay > 0) {
          await sleep(delay);
        }
      }
      activeScan.activeWorkers = Math.max(0, activeScan.activeWorkers - 1);
    };

    activeScan.activeWorkers = concurrency;
    // Fork workers
    const workers = [];
    for (let w = 0; w < concurrency; w++) {
      workers.push(worker());
    }

    await Promise.all(workers);

    // Scan cycle complete
    if (activeScan.status === "running") {
      activeScan.status = "completed";
      activeScan.endTime = Date.now();
      activeScan.elapsedTime = Math.round((activeScan.endTime - activeScan.startTime) / 1000);
      activeScan.events.push({ timestamp: Date.now(), type: 'info', message: `Discovery completed. Found ${activeScan.discoveredDevices.length} devices.` });
      
      // Save session to history table
      await DiscoverySession.create({
        sessionName: activeScan.sessionName,
        cidr: activeScan.cidr,
        mode: activeScan.mode,
        status: "Completed",
        totalIps: activeScan.totalIps,
        scannedIps: activeScan.scannedIps,
        devicesFound: activeScan.discoveredDevices.length,
        reachableCount: activeScan.reachableCount,
        unreachableCount: activeScan.unreachableCount,
        startTime: activeScan.startTime,
        endTime: activeScan.endTime,
        durationSeconds: activeScan.elapsedTime,
      });
    }

    if (scanIntervalTimer) clearInterval(scanIntervalTimer);
  }

  static stopScan() {
    activeScan.status = "stopped";
    activeScan.endTime = Date.now();
    activeScan.elapsedTime = Math.round((activeScan.endTime - activeScan.startTime) / 1000);
    activeScan.events.push({ timestamp: Date.now(), type: 'error', message: `Discovery session stopped by operator` });
    if (scanIntervalTimer) clearInterval(scanIntervalTimer);
    return activeScan;
  }

  static pauseScan() {
    if (activeScan.status === "running") {
      activeScan.status = "paused";
      activeScan.events.push({ timestamp: Date.now(), type: 'warning', message: `Discovery session paused` });
    }
    return activeScan;
  }

  static resumeScan() {
    if (activeScan.status === "paused") {
      activeScan.status = "running";
      activeScan.events.push({ timestamp: Date.now(), type: 'info', message: `Discovery session resumed` });
      if (pausePromiseResolve) {
        pausePromiseResolve();
        pausePromiseResolve = null;
      }
    }
    return activeScan;
  }

  static getStatus() {
    return activeScan;
  }
}

module.exports = DiscoveryService;
