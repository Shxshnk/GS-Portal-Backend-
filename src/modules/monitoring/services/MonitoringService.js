// src/modules/monitoring/services/MonitoringService.js
const MonitoringDevice = require("../models/MonitoringDevice");
const PollingScheduler = require("./PollingScheduler");
const EncryptionService = require("./EncryptionService");

function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

function trimString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return !["false", "0", "no", "off"].includes(String(value || "").trim().toLowerCase());
}

function normalizeSnmpPayload(payload = {}, partial = false) {
  const normalized = {};

  const deviceName = firstDefined(payload.deviceName, payload.device_name, payload.name);
  if (deviceName !== undefined) normalized.deviceName = trimString(deviceName);

  const hostname = firstDefined(payload.hostname);
  if (hostname !== undefined) normalized.hostname = trimString(hostname);

  const sysName = firstDefined(payload.sysName, payload.sys_name);
  if (sysName !== undefined) normalized.sys_name = trimString(sysName);

  const sysDescr = firstDefined(payload.sysDescr, payload.sys_descr);
  if (sysDescr !== undefined) normalized.sys_descr = trimString(sysDescr);

  const sysObjectID = firstDefined(payload.sysObjectID, payload.sys_object_id);
  if (sysObjectID !== undefined) normalized.sys_object_id = trimString(sysObjectID);

  const sysUpTime = firstDefined(payload.sysUpTime, payload.sys_uptime);
  if (sysUpTime !== undefined) normalized.sys_uptime = trimString(sysUpTime);

  const ipAddress = firstDefined(payload.ipAddress, payload.ip_address, payload.host);
  if (ipAddress !== undefined) normalized.ipAddress = trimString(ipAddress);

  const macAddress = firstDefined(payload.macAddress, payload.mac_address);
  if (macAddress !== undefined) normalized.macAddress = trimString(macAddress);

  const vendor = firstDefined(payload.vendor);
  if (vendor !== undefined) normalized.vendor = trimString(vendor);

  const model = firstDefined(payload.model);
  if (model !== undefined) normalized.model = trimString(model);

  const serialNumber = firstDefined(payload.serialNumber, payload.serial_number);
  if (serialNumber !== undefined) normalized.serialNumber = trimString(serialNumber);

  const firmware = firstDefined(payload.firmware, payload.firmwareVersion, payload.firmware_version);
  if (firmware !== undefined) normalized.firmware = trimString(firmware);

  const osVersion = firstDefined(payload.osVersion, payload.os_version);
  if (osVersion !== undefined) normalized.osVersion = trimString(osVersion);

  const deviceType = firstDefined(payload.deviceType, payload.device_type);
  if (deviceType !== undefined) normalized.deviceType = trimString(deviceType);

  const site = firstDefined(payload.site);
  if (site !== undefined) normalized.site = trimString(site);

  const rack = firstDefined(payload.rack);
  if (rack !== undefined) normalized.rack = trimString(rack);

  const location = firstDefined(payload.location);
  if (location !== undefined) normalized.location = trimString(location);

  const latitude = firstDefined(payload.latitude);
  if (latitude !== undefined) normalized.latitude = latitude !== null ? Number(latitude) : null;

  const longitude = firstDefined(payload.longitude);
  if (longitude !== undefined) normalized.longitude = longitude !== null ? Number(longitude) : null;

  const snmpVersion = firstDefined(payload.snmpVersion, payload.snmp_version);
  if (snmpVersion !== undefined) normalized.snmpVersion = trimString(snmpVersion) || "v2c";
  else if (!partial) normalized.snmpVersion = "v2c";

  const credentials = firstDefined(payload.credentials);
  if (credentials !== undefined) {
    normalized.credentials = normalizeCredentials(credentials, payload, normalized.snmpVersion);
  } else if (!partial) {
    normalized.credentials = normalizeCredentials(null, payload, normalized.snmpVersion);
  }

  const profileId = firstDefined(payload.profileId, payload.profile_id);
  if (profileId !== undefined) normalized.profileId = profileId ? Number(profileId) : null;

  const lifecycleState = firstDefined(payload.lifecycleState, payload.lifecycle_state);
  if (lifecycleState !== undefined) normalized.lifecycleState = trimString(lifecycleState) || "Configured";

  const status = firstDefined(payload.status);
  if (status !== undefined) normalized.status = (trimString(status) || "UNKNOWN").toUpperCase();
  else if (!partial) normalized.status = "UNKNOWN";

  const isActive = firstDefined(payload.isActive, payload.is_active);
  if (isActive !== undefined) normalized.isActive = normalizeBoolean(isActive);

  return normalized;
}

function normalizeAwsPayload(payload = {}, partial = false) {
  const normalized = {};
  
  normalized.provider = "AWS";
  normalized.protocol = "AWS";

  const deviceName = firstDefined(payload.deviceName, payload.device_name, payload.name, payload.instanceName, payload.instance_name);
  if (deviceName !== undefined) normalized.deviceName = trimString(deviceName);

  const ipAddress = firstDefined(payload.ipAddress, payload.ip_address, payload.privateIp, payload.publicIp);
  if (ipAddress !== undefined) normalized.ipAddress = trimString(ipAddress);

  if (payload.instanceId !== undefined) normalized.instanceId = payload.instanceId;
  if (payload.instanceName !== undefined) normalized.instanceName = payload.instanceName;
  if (payload.privateIp !== undefined) normalized.privateIp = payload.privateIp;
  if (payload.publicIp !== undefined) normalized.publicIp = payload.publicIp;
  if (payload.state !== undefined) normalized.state = payload.state;
  if (payload.platform !== undefined) normalized.platform = payload.platform;
  if (payload.instanceType !== undefined) normalized.instanceType = payload.instanceType;
  if (payload.architecture !== undefined) normalized.architecture = payload.architecture;
  if (payload.region !== undefined) normalized.region = payload.region;
  if (payload.availabilityZone !== undefined) normalized.availabilityZone = payload.availabilityZone;
  if (payload.vpcId !== undefined) normalized.vpcId = payload.vpcId;
  if (payload.subnetId !== undefined) normalized.subnetId = payload.subnetId;
  if (payload.launchTime !== undefined) normalized.launchTime = payload.launchTime;
  if (payload.tags !== undefined) normalized.tags = payload.tags;
  if (payload.cloudMetadata !== undefined) normalized.cloudMetadata = payload.cloudMetadata;

  const profileId = firstDefined(payload.profileId, payload.profile_id);
  if (profileId !== undefined) normalized.profileId = profileId ? Number(profileId) : null;

  const status = firstDefined(payload.status);
  if (status !== undefined) normalized.status = (trimString(status) || "UNKNOWN").toUpperCase();
  else if (!partial) normalized.status = "UNKNOWN";

  const isActive = firstDefined(payload.isActive, payload.is_active);
  if (isActive !== undefined) normalized.isActive = normalizeBoolean(isActive);

  return normalized;
}

function normalizeRestPayload(payload = {}, partial = false) {
  const normalized = normalizeSnmpPayload(payload, partial);
  normalized.provider = "REST API";
  normalized.protocol = "REST";
  return normalized;
}

function normalizePayload(payload = {}, partial = false) {
  const provider = firstDefined(payload.provider, payload.discoverySource);
  
  if (provider === "AWS") {
    return normalizeAwsPayload(payload, partial);
  } else if (provider === "REST API" || provider === "REST") {
    return normalizeRestPayload(payload, partial);
  } else {
    const normalized = normalizeSnmpPayload(payload, partial);
    normalized.provider = "SNMP";
    normalized.protocol = "SNMP";
    return normalized;
  }
}

function normalizeCredentials(credentials, payload = {}, snmpVersion = "v2c") {
  const creds = (credentials && typeof credentials === "object" && !Array.isArray(credentials)) 
    ? { ...credentials } 
    : {};

  const result = {
    port: creds.port !== undefined ? Number(creds.port) : 161,
    timeout: creds.timeout !== undefined ? Number(creds.timeout) : 2500,
    retries: creds.retries !== undefined ? Number(creds.retries) : 1,
    pollInterval: creds.pollInterval !== undefined ? (creds.pollInterval !== null ? Number(creds.pollInterval) : null) : null,
    maxOidsPerRequest: creds.maxOidsPerRequest !== undefined ? (creds.maxOidsPerRequest !== null ? Number(creds.maxOidsPerRequest) : null) : null,
    maxRepetitions: creds.maxRepetitions !== undefined ? (creds.maxRepetitions !== null ? Number(creds.maxRepetitions) : null) : null,
    preferredOperation: creds.preferredOperation !== undefined ? trimString(creds.preferredOperation) : null,
    enableBulkWalk: creds.enableBulkWalk !== undefined ? Boolean(creds.enableBulkWalk) : null,
    enableInterfaceDiscovery: creds.enableInterfaceDiscovery !== undefined ? Boolean(creds.enableInterfaceDiscovery) : null,
    enableHistoricalTelemetry: creds.enableHistoricalTelemetry !== undefined ? Boolean(creds.enableHistoricalTelemetry) : null,
    enablePerformancePolling: creds.enablePerformancePolling !== undefined ? Boolean(creds.enablePerformancePolling) : null,
    enableEnvironmentalPolling: creds.enableEnvironmentalPolling !== undefined ? Boolean(creds.enableEnvironmentalPolling) : null,
  };

  if (snmpVersion === "v3" || snmpVersion === "3") {
    // Encrypt sensitive passwords
    if (creds.authPassword && creds.authPassword !== "********") {
      creds.authPassword = EncryptionService.encrypt(creds.authPassword);
    }
    if (creds.privPassword && creds.privPassword !== "********") {
      creds.privPassword = EncryptionService.encrypt(creds.privPassword);
    }
    
    return {
      ...result,
      username: trimString(creds.username || payload.username),
      securityLevel: trimString(creds.securityLevel || payload.securityLevel || "noAuthNoPriv"),
      authProtocol: trimString(creds.authProtocol || payload.authProtocol || "MD5"),
      authPassword: creds.authPassword || "",
      privProtocol: trimString(creds.privProtocol || payload.privProtocol || "DES"),
      privPassword: creds.privPassword || "",
      contextName: trimString(creds.contextName || payload.contextName),
      contextEngineId: trimString(creds.contextEngineId || creds.engineId || payload.contextEngineId || payload.engineId),
    };
  }

  // Fallback to community string config
  const community = firstDefined(creds.community, payload.community, payload.snmpCommunity);
  return {
    ...result,
    community: trimString(community) || "public",
  };
}

function validateDevice(payload, partial = false) {
  if (payload.provider === "AWS" || payload.provider === "REST API" || payload.provider === "REST") {
    if (!partial || payload.deviceName !== undefined) {
      if (!payload.deviceName) return "Device/Instance Name is required";
    }
    return null; // AWS/REST devices don't need SNMP validation
  }

  if (!partial || payload.deviceName !== undefined) {
    if (!payload.deviceName) return "Device Name is required";
  }
  if (!partial || payload.ipAddress !== undefined) {
    if (!payload.ipAddress) return "IP Address is required";
  }
  if (!partial || payload.snmpVersion !== undefined) {
    if (!["v1", "1", "v2c", "2c", "v3", "3"].includes(String(payload.snmpVersion || "").toLowerCase())) {
      return "SNMP Version must be v1, v2c or v3";
    }
  }
  return null;
}

function maskDeviceCredentials(device) {
  if (!device) return null;
  const clone = { ...device };
  if (clone.credentials) {
    clone.credentials = { ...clone.credentials };
    if (clone.credentials.authPassword) clone.credentials.authPassword = "********";
    if (clone.credentials.privPassword) clone.credentials.privPassword = "********";
  }
  return clone;
}

class MonitoringService {
  static async ensureReady() {
    await MonitoringDevice.ensureTable();
  }

  static async addDevice(payload) {
    await this.ensureReady();
    const normalized = normalizePayload(payload);
    const error = validateDevice(normalized);
    if (error) {
      const validationError = new Error(error);
      validationError.statusCode = 400;
      throw validationError;
    }
    const device = await MonitoringDevice.create(normalized);
    return maskDeviceCredentials(device);
  }

  static async updateDevice(id, payload) {
    await this.ensureReady();
    
    // For partial updates, retrieve existing SNMP version first to resolve credentials mapping
    const existing = await MonitoringDevice.findById(id);
    if (!existing) return null;

    const snmpVersion = payload.snmpVersion || payload.snmp_version || existing.snmpVersion;
    const normalized = normalizePayload(payload, true);
    
    // Process password carryover if password is sent as mask "********"
    if (normalized.credentials && (snmpVersion === "v3" || snmpVersion === "3")) {
      if (normalized.credentials.authPassword === "********") {
        normalized.credentials.authPassword = existing.credentials?.authPassword || "";
      }
      if (normalized.credentials.privPassword === "********") {
        normalized.credentials.privPassword = existing.credentials?.privPassword || "";
      }
    }

    const error = validateDevice(normalized, true);
    if (error) {
      const validationError = new Error(error);
      validationError.statusCode = 400;
      throw validationError;
    }

    const device = await MonitoringDevice.updateById(id, normalized);
    return maskDeviceCredentials(device);
  }

  static async deleteDevice(id) {
    await this.ensureReady();
    return MonitoringDevice.deleteById(id);
  }

  static async getDevice(id) {
    await this.ensureReady();
    const device = await MonitoringDevice.findById(id);
    return maskDeviceCredentials(device);
  }

  static async listDevices(search) {
    await this.ensureReady();
    const list = await MonitoringDevice.list(search);
    return list.map(maskDeviceCredentials);
  }

  static async testConnection(payload) {
    await this.ensureReady();

    const deviceId = firstDefined(payload.id, payload.deviceId, payload.device_id);
    const device = deviceId ? await MonitoringDevice.findById(deviceId) : null;
    const combined = { ...(device || {}), ...(payload || {}) };
    
    const snmpVersion = combined.snmpVersion || "v2c";
    const normalized = normalizePayload(combined);

    // Keep passwords if they weren't edited
    if (normalized.credentials && (snmpVersion === "v3" || snmpVersion === "3")) {
      if (normalized.credentials.authPassword === "********") {
        normalized.credentials.authPassword = device?.credentials?.authPassword || "";
      }
      if (normalized.credentials.privPassword === "********") {
        normalized.credentials.privPassword = device?.credentials?.privPassword || "";
      }
    }

    const error = validateDevice(normalized);
    if (error) {
      const validationError = new Error(error);
      validationError.statusCode = 400;
      throw validationError;
    }

    // Load SnmpPollerAdapter to test connection
    const IPollerAdapter = require("../adapters/IPollerAdapter");
    const adapter = IPollerAdapter.getAdapter("snmp");

    const result = await adapter.testConnection(normalized);

    if (deviceId && result.success) {
      await MonitoringDevice.updateConnectionResult(deviceId, result);
    }

    return {
      success: result.success,
      status: result.success ? "Success" : "Failure",
      responseTime: result.responseTime || null,
      sysName: result.sysName || null,
      sysDescr: result.sysDescr || null,
      sysUpTime: result.sysUpTime || null,
      sysObjectID: result.sysObjectID || null,
      error: result.success ? null : result.error || "SNMP GET failed",
    };
  }

  static async bulkPoll(deviceIds = []) {
    await this.ensureReady();
    const results = [];
    for (const id of deviceIds) {
      try {
        const device = await MonitoringDevice.findById(id);
        if (device && device.isActive) {
          const res = await PollingScheduler.pollDevice(device);
          results.push({ id, success: res.success, status: res.status });
        }
      } catch (err) {
        results.push({ id, success: false, error: err.message });
      }
    }
    return results;
  }

  static async bulkDelete(deviceIds = []) {
    await this.ensureReady();
    let count = 0;
    for (const id of deviceIds) {
      const deleted = await MonitoringDevice.deleteById(id);
      if (deleted) count++;
    }
    return { deletedCount: count };
  }
}

module.exports = MonitoringService;
