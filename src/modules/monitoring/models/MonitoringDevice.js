// src/modules/monitoring/models/MonitoringDevice.js
const { pool } = require("../../../db");

const TABLE_NAME = "monitoring_devices";

function normalizeDevice(row) {
  if (!row) return null;

  let credentials = null;
  try {
    if (row.credentials && typeof row.credentials === "object") {
      credentials = row.credentials;
    } else {
      credentials = row.credentials ? JSON.parse(row.credentials) : null;
    }
  } catch (_) {
    credentials = null;
  }

  const provider = row.provider || "SNMP";

  return {
    id: row.id,
    deviceName: row.device_name,
    hostname: row.hostname,
    ipAddress: row.ip_address,
    macAddress: row.mac_address,
    vendor: row.vendor,
    model: row.model,
    serialNumber: row.serial_number,
    firmware: row.firmware,
    osVersion: row.os_version,
    deviceType: row.device_type,
    site: row.site,
    rack: row.rack,
    location: row.location,
    latitude: row.latitude ? Number(row.latitude) : null,
    longitude: row.longitude ? Number(row.longitude) : null,
    snmpVersion: row.snmp_version,
    credentials,
    status: row.status,
    lastPoll: row.last_poll,
    isActive: Boolean(row.is_active),
    sysName: row.sys_name,
    sysDescr: row.sys_descr,
    sysObjectID: row.sys_object_id,
    sysUpTime: row.sys_uptime,
    lastPollError: row.last_poll_error,
    availability: row.availability ? Number(row.availability) : 100.0,
    healthScore: row.health_score !== null && row.health_score !== undefined ? Number(row.health_score) : 100,
    responseTime: row.response_time !== null && row.response_time !== undefined ? Number(row.response_time) : null,
    pollDuration: row.poll_duration !== null && row.poll_duration !== undefined ? Number(row.poll_duration) : null,
    lastSuccessfulPoll: row.last_successful_poll,
    lastFailedPoll: row.last_failed_poll,
    pollCount: Number(row.poll_count || 0),
    errorCount: Number(row.error_count || 0),
    profileId: row.profile_id !== null && row.profile_id !== undefined ? Number(row.profile_id) : null,
    lifecycleState: row.lifecycle_state || "Configured",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cpuUtil: row.cpu_util !== null && row.cpu_util !== undefined ? Number(row.cpu_util) : null,
    memUtil: row.mem_util !== null && row.mem_util !== undefined ? Number(row.mem_util) : null,
    cpuCores: row.cpu_cores !== null && row.cpu_cores !== undefined ? Number(row.cpu_cores) : null,
    totalRam: row.total_ram !== null && row.total_ram !== undefined ? Number(row.total_ram) : null,
    bootTime: row.boot_time,
    provider: provider,
    protocol: provider === "AWS" ? "AWS" : provider === "REST API" ? "REST" : "SNMP",
    resourceType: row.resource_type || "Device",
    instanceId: row.instance_id,
    instanceName: row.instance_name,
    privateIp: row.private_ip,
    publicIp: row.public_ip,
    state: row.state,
    instanceType: row.instance_type,
    region: row.region,
    availabilityZone: row.availability_zone,
    cloudMetadata: row.cloud_metadata ? (typeof row.cloud_metadata === "string" ? JSON.parse(row.cloud_metadata) : row.cloud_metadata) : null,
  };
}

async function ensureColumn(existingFields, name, sql) {
  if (existingFields.has(name.toLowerCase())) return;
  try {
    await pool.query(sql);
  } catch (error) {
    if (error?.code !== "ER_DUP_FIELDNAME") throw error;
  }
}

class MonitoringDevice {
  static async ensureTable() {
    // Bootstrap relational tables
    const OidProfile = require("./OidProfile");
    const MonitoringProfile = require("./MonitoringProfile");
    const DeviceInterface = require("./DeviceInterface");
    const DeviceHardware = require("./DeviceHardware");
    const DeviceSensor = require("./DeviceSensor");
    const TelemetryCurrent = require("./TelemetryCurrent");
    const TelemetryHistory = require("./TelemetryHistory");
    const MonitoringSettings = require("./MonitoringSettings");
    const AwsCredentialProfile = require("../aws/AwsCredentialProfile");

    await OidProfile.ensureTable();
    await MonitoringProfile.ensureTable();
    await DeviceInterface.ensureTable();
    await DeviceHardware.ensureTable();
    await DeviceSensor.ensureTable();
    await TelemetryCurrent.ensureTable();
    await TelemetryHistory.ensureTable();
    await MonitoringSettings.ensureTable();
    await AwsCredentialProfile.ensureTable();

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        device_name VARCHAR(255) NOT NULL,
        ip_address VARCHAR(255) NOT NULL,
        vendor VARCHAR(255) NULL,
        model VARCHAR(255) NULL,
        snmp_version VARCHAR(20) NOT NULL DEFAULT 'v2c',
        credentials JSON NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'UNKNOWN',
        last_poll DATETIME NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        sys_name VARCHAR(255) NULL,
        sys_descr TEXT NULL,
        sys_object_id VARCHAR(255) NULL,
        sys_uptime VARCHAR(100) NULL,
        cpu_cores INT NULL,
        total_ram BIGINT NULL,
        boot_time DATETIME NULL,
        last_poll_error TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_monitoring_devices_ip_address (ip_address)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await this.ensureColumns();
  }

  static async ensureColumns() {
    const [columns] = await pool.query(`DESCRIBE ${TABLE_NAME}`);
    const fields = new Set(columns.map(c => c.Field.toLowerCase()));

    await ensureColumn(fields, "is_active", `ALTER TABLE ${TABLE_NAME} ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1`);
    await ensureColumn(fields, "sys_name", `ALTER TABLE ${TABLE_NAME} ADD COLUMN sys_name VARCHAR(255) NULL`);
    await ensureColumn(fields, "sys_descr", `ALTER TABLE ${TABLE_NAME} ADD COLUMN sys_descr TEXT NULL`);
    await ensureColumn(fields, "sys_object_id", `ALTER TABLE ${TABLE_NAME} ADD COLUMN sys_object_id VARCHAR(255) NULL`);
    await ensureColumn(fields, "sys_uptime", `ALTER TABLE ${TABLE_NAME} ADD COLUMN sys_uptime VARCHAR(100) NULL`);
    await ensureColumn(fields, "cpu_cores", `ALTER TABLE ${TABLE_NAME} ADD COLUMN cpu_cores INT NULL`);
    await ensureColumn(fields, "total_ram", `ALTER TABLE ${TABLE_NAME} ADD COLUMN total_ram BIGINT NULL`);
    await ensureColumn(fields, "boot_time", `ALTER TABLE ${TABLE_NAME} ADD COLUMN boot_time DATETIME NULL`);
    await ensureColumn(fields, "cpu_util", `ALTER TABLE ${TABLE_NAME} ADD COLUMN cpu_util DECIMAL(10,2) NULL`);
    await ensureColumn(fields, "mem_util", `ALTER TABLE ${TABLE_NAME} ADD COLUMN mem_util DECIMAL(10,2) NULL`);
    await ensureColumn(fields, "last_poll_error", `ALTER TABLE ${TABLE_NAME} ADD COLUMN last_poll_error TEXT NULL`);

    // Extended NMS Columns
    await ensureColumn(fields, "hostname", `ALTER TABLE ${TABLE_NAME} ADD COLUMN hostname VARCHAR(255) NULL`);
    await ensureColumn(fields, "mac_address", `ALTER TABLE ${TABLE_NAME} ADD COLUMN mac_address VARCHAR(100) NULL`);
    await ensureColumn(fields, "serial_number", `ALTER TABLE ${TABLE_NAME} ADD COLUMN serial_number VARCHAR(255) NULL`);
    await ensureColumn(fields, "firmware", `ALTER TABLE ${TABLE_NAME} ADD COLUMN firmware VARCHAR(100) NULL`);
    await ensureColumn(fields, "os_version", `ALTER TABLE ${TABLE_NAME} ADD COLUMN os_version VARCHAR(100) NULL`);
    await ensureColumn(fields, "device_type", `ALTER TABLE ${TABLE_NAME} ADD COLUMN device_type VARCHAR(100) NULL`);
    await ensureColumn(fields, "site", `ALTER TABLE ${TABLE_NAME} ADD COLUMN site VARCHAR(255) NULL`);
    await ensureColumn(fields, "rack", `ALTER TABLE ${TABLE_NAME} ADD COLUMN rack VARCHAR(100) NULL`);
    await ensureColumn(fields, "location", `ALTER TABLE ${TABLE_NAME} ADD COLUMN location VARCHAR(255) NULL`);
    await ensureColumn(fields, "latitude", `ALTER TABLE ${TABLE_NAME} ADD COLUMN latitude DECIMAL(10,8) NULL`);
    await ensureColumn(fields, "longitude", `ALTER TABLE ${TABLE_NAME} ADD COLUMN longitude DECIMAL(11,8) NULL`);
    await ensureColumn(fields, "availability", `ALTER TABLE ${TABLE_NAME} ADD COLUMN availability DOUBLE NOT NULL DEFAULT 100.0`);
    await ensureColumn(fields, "health_score", `ALTER TABLE ${TABLE_NAME} ADD COLUMN health_score INT NOT NULL DEFAULT 100`);
    await ensureColumn(fields, "response_time", `ALTER TABLE ${TABLE_NAME} ADD COLUMN response_time INT NULL`);
    await ensureColumn(fields, "poll_duration", `ALTER TABLE ${TABLE_NAME} ADD COLUMN poll_duration INT NULL`);
    await ensureColumn(fields, "last_successful_poll", `ALTER TABLE ${TABLE_NAME} ADD COLUMN last_successful_poll DATETIME NULL`);
    await ensureColumn(fields, "last_failed_poll", `ALTER TABLE ${TABLE_NAME} ADD COLUMN last_failed_poll DATETIME NULL`);
    await ensureColumn(fields, "poll_count", `ALTER TABLE ${TABLE_NAME} ADD COLUMN poll_count INT NOT NULL DEFAULT 0`);
    await ensureColumn(fields, "error_count", `ALTER TABLE ${TABLE_NAME} ADD COLUMN error_count INT NOT NULL DEFAULT 0`);
    await ensureColumn(fields, "profile_id", `ALTER TABLE ${TABLE_NAME} ADD COLUMN profile_id INT NULL`);
    await ensureColumn(fields, "lifecycle_state", `ALTER TABLE ${TABLE_NAME} ADD COLUMN lifecycle_state VARCHAR(50) NOT NULL DEFAULT 'Configured'`);

    // AWS & Cloud Resource Columns
    await ensureColumn(fields, "provider", `ALTER TABLE ${TABLE_NAME} ADD COLUMN provider VARCHAR(50) NOT NULL DEFAULT 'SNMP'`);
    await ensureColumn(fields, "resource_type", `ALTER TABLE ${TABLE_NAME} ADD COLUMN resource_type VARCHAR(100) NOT NULL DEFAULT 'Device'`);
    await ensureColumn(fields, "instance_id", `ALTER TABLE ${TABLE_NAME} ADD COLUMN instance_id VARCHAR(255) NULL`);
    await ensureColumn(fields, "instance_name", `ALTER TABLE ${TABLE_NAME} ADD COLUMN instance_name VARCHAR(255) NULL`);
    await ensureColumn(fields, "private_ip", `ALTER TABLE ${TABLE_NAME} ADD COLUMN private_ip VARCHAR(255) NULL`);
    await ensureColumn(fields, "public_ip", `ALTER TABLE ${TABLE_NAME} ADD COLUMN public_ip VARCHAR(255) NULL`);
    await ensureColumn(fields, "state", `ALTER TABLE ${TABLE_NAME} ADD COLUMN state VARCHAR(100) NULL`);
    await ensureColumn(fields, "instance_type", `ALTER TABLE ${TABLE_NAME} ADD COLUMN instance_type VARCHAR(100) NULL`);
    await ensureColumn(fields, "region", `ALTER TABLE ${TABLE_NAME} ADD COLUMN region VARCHAR(100) NULL`);
    await ensureColumn(fields, "availability_zone", `ALTER TABLE ${TABLE_NAME} ADD COLUMN availability_zone VARCHAR(100) NULL`);
    await ensureColumn(fields, "cloud_metadata", `ALTER TABLE ${TABLE_NAME} ADD COLUMN cloud_metadata JSON NULL`);
  }

  static async create(payload) {
    const values = [
      payload.deviceName,
      payload.hostname || null,
      payload.ipAddress,
      payload.macAddress || null,
      payload.vendor || null,
      payload.model || null,
      payload.serialNumber || null,
      payload.firmware || null,
      payload.osVersion || null,
      payload.deviceType || null,
      payload.site || null,
      payload.rack || null,
      payload.location || null,
      payload.latitude ?? null,
      payload.longitude ?? null,
      payload.sys_name || null,
      payload.sys_descr || null,
      payload.sys_object_id || null,
      payload.sys_uptime || null,
      payload.snmpVersion || "v2c",
      payload.credentials ? JSON.stringify(payload.credentials) : null,
      payload.status || "UNKNOWN",
      payload.isActive === false ? 0 : 1,
      payload.profileId || null,
      payload.lifecycleState || "Configured",
      (payload.snmpVersion === 'v3' || payload.snmpVersion === '3') ? '' : (payload.credentials?.community || 'public'),
      payload.provider || null,
      payload.resourceType || "Device",
      payload.instanceId || null,
      payload.instanceName || null,
      payload.privateIp || null,
      payload.publicIp || null,
      payload.state || null,
      payload.instanceType || null,
      payload.region || null,
      payload.availabilityZone || null,
      payload.cloudMetadata ? JSON.stringify(payload.cloudMetadata) : null,
    ];

    const [result] = await pool.query(
      `INSERT INTO ${TABLE_NAME}
       (device_name, hostname, ip_address, mac_address, vendor, model, serial_number, firmware, os_version, device_type, site, rack, location, latitude, longitude, sys_name, sys_descr, sys_object_id, sys_uptime, snmp_version, credentials, status, is_active, profile_id, lifecycle_state, community, provider, resource_type, instance_id, instance_name, private_ip, public_ip, state, instance_type, region, availability_zone, cloud_metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      values
    );

    return this.findById(result.insertId);
  }

  static async updateById(id, payload) {
    const updates = [];
    const values = [];

    const mapField = (field, key) => {
      if (payload[field] !== undefined) {
        updates.push(`${key} = ?`);
        values.push(payload[field] === "" ? null : payload[field]);
      }
    };

    mapField("deviceName", "device_name");
    mapField("hostname", "hostname");
    mapField("ipAddress", "ip_address");
    mapField("macAddress", "mac_address");
    mapField("vendor", "vendor");
    mapField("model", "model");
    mapField("serialNumber", "serial_number");
    mapField("firmware", "firmware");
    mapField("osVersion", "os_version");
    mapField("deviceType", "device_type");
    mapField("site", "site");
    mapField("rack", "rack");
    mapField("location", "location");
    mapField("latitude", "latitude");
    mapField("longitude", "longitude");
    mapField("snmpVersion", "snmp_version");
    mapField("status", "status");
    mapField("profileId", "profile_id");
    mapField("lifecycleState", "lifecycle_state");

    mapField("provider", "provider");
    mapField("resourceType", "resource_type");
    mapField("instanceId", "instance_id");
    mapField("instanceName", "instance_name");
    mapField("privateIp", "private_ip");
    mapField("publicIp", "public_ip");
    mapField("state", "state");
    mapField("instanceType", "instance_type");
    mapField("region", "region");
    mapField("availabilityZone", "availability_zone");

    if (payload.cloudMetadata !== undefined) {
      updates.push("cloud_metadata = ?");
      values.push(payload.cloudMetadata ? JSON.stringify(payload.cloudMetadata) : null);
    }

    if (payload.credentials !== undefined) {
      updates.push("credentials = ?");
      values.push(payload.credentials ? JSON.stringify(payload.credentials) : null);
      
      updates.push("community = ?");
      if (payload.snmpVersion === 'v3' || payload.snmpVersion === '3' || (payload.credentials && payload.credentials.securityLevel)) {
         values.push('');
      } else {
         values.push(payload.credentials?.community || 'public');
      }
    }
    if (payload.isActive !== undefined) {
      updates.push("is_active = ?");
      values.push(payload.isActive ? 1 : 0);
    }

    if (!updates.length) return this.findById(id);

    values.push(Number(id));
    const [result] = await pool.query(
      `UPDATE ${TABLE_NAME} SET ${updates.join(", ")} WHERE id = ?`,
      values
    );

    if (result.affectedRows === 0) return null;
    return this.findById(id);
  }

  static async updatePollResultExtended(id, result) {
    const values = [
      result.status,
      result.availability ?? 100.0,
      result.healthScore ?? 100,
      result.responseTime ?? null,
      result.pollDuration ?? null,
      result.sysName || null,
      result.sysDescr || null,
      result.sysObjectID || null,
      result.sysUpTime || null,
      result.error || null,
      result.cpuUtil ?? null,
      result.memUtil ?? null,
      result.cpuCores ?? null,
      result.totalRam ?? null,
      result.bootTime || null,
      result.firmware || null,
      result.osVersion || null,
      result.serialNumber || null,
      result.hostname || null,
      result.model || null,
      result.vendor || null,
      result.macAddress || null,
      Number(id),
    ];

    await pool.query(
      `UPDATE ${TABLE_NAME}
          SET status = ?,
              availability = ?,
              health_score = ?,
              response_time = ?,
              poll_duration = ?,
              sys_name = IFNULL(?, sys_name),
              sys_descr = IFNULL(?, sys_descr),
              sys_object_id = IFNULL(?, sys_object_id),
              sys_uptime = IFNULL(?, sys_uptime),
              last_poll_error = ?,
              cpu_util = ?,
              mem_util = ?,
              cpu_cores = ?,
              total_ram = ?,
              boot_time = ?,
              firmware = IFNULL(?, firmware),
              os_version = IFNULL(?, os_version),
              serial_number = IFNULL(?, serial_number),
              hostname = IFNULL(?, hostname),
              model = IFNULL(?, model),
              vendor = IFNULL(?, vendor),
              mac_address = IFNULL(?, mac_address),
              last_poll = CURRENT_TIMESTAMP,
              poll_count = poll_count + 1,
              error_count = error_count + IF(? IS NOT NULL, 1, 0),
              last_successful_poll = CASE WHEN ? IS NULL THEN CURRENT_TIMESTAMP ELSE last_successful_poll END,
              last_failed_poll = CASE WHEN ? IS NOT NULL THEN CURRENT_TIMESTAMP ELSE last_failed_poll END
        WHERE id = ?`,
      [...values.slice(0, 22), values[9], values[9], values[9], values[22]]
    );
    return this.findById(id);
  }

  static async updateConnectionResult(id, result) {
    const status = result.success ? "ONLINE" : "OFFLINE";
    await pool.query(
      `UPDATE ${TABLE_NAME}
          SET status = ?,
              last_poll = NOW(),
              last_successful_poll = IF(? = 'ONLINE', NOW(), last_successful_poll),
              last_failed_poll = IF(? = 'OFFLINE', NOW(), last_failed_poll),
              last_poll_error = ?,
              poll_count = poll_count + 1,
              error_count = error_count + IF(? = 'OFFLINE', 1, 0)
        WHERE id = ?`,
      [status, status, status, result.success ? null : result.error || "SNMP GET failed", status, Number(id)]
    );
    return this.findById(id);
  }

  static async deleteById(id) {
    const [result] = await pool.query(`DELETE FROM ${TABLE_NAME} WHERE id = ?`, [Number(id)]);
    return result.affectedRows > 0;
  }

  static async findById(id) {
    const [rows] = await pool.query(
      `SELECT d.*, 
              c_cpu.converted_value as cpu_util,
              c_mem.converted_value as mem_util
       FROM ${TABLE_NAME} d
       LEFT JOIN monitoring_telemetry_current c_cpu 
         ON c_cpu.device_id = d.id AND c_cpu.metric_name = 'cpu_util'
       LEFT JOIN monitoring_telemetry_current c_mem 
         ON c_mem.device_id = d.id AND c_mem.metric_name = 'mem_util'
       WHERE d.id = ?`,
      [Number(id)]
    );
    return normalizeDevice(rows[0]);
  }

  static async findByProviderAndInstanceId(provider, instanceId) {
    const [rows] = await pool.query(
      `SELECT * FROM ${TABLE_NAME} WHERE provider = ? AND instance_id = ?`,
      [provider, instanceId]
    );
    return normalizeDevice(rows[0]);
  }

  static async list(search = "") {
    const q = String(search || "").trim();
    const term = `%${q}%`;
    const [rows] = await pool.query(
      `SELECT d.*, 
              c_cpu.converted_value as cpu_util,
              c_mem.converted_value as mem_util
       FROM ${TABLE_NAME} d
       LEFT JOIN monitoring_telemetry_current c_cpu 
         ON c_cpu.device_id = d.id AND c_cpu.metric_name = 'cpu_util'
       LEFT JOIN monitoring_telemetry_current c_mem 
         ON c_mem.device_id = d.id AND c_mem.metric_name = 'mem_util'
       WHERE ? = ''
          OR d.device_name LIKE ?
          OR d.ip_address LIKE ?
          OR d.vendor LIKE ?
          OR d.model LIKE ?
          OR d.status LIKE ?
          OR d.sys_name LIKE ?
       ORDER BY d.id DESC`,
      [q, term, term, term, term, term, term]
    );
    return rows.map(normalizeDevice);
  }

  static async listActive() {
    const [rows] = await pool.query(
      `SELECT d.*, 
              c_cpu.converted_value as cpu_util,
              c_mem.converted_value as mem_util
       FROM ${TABLE_NAME} d
       LEFT JOIN monitoring_telemetry_current c_cpu 
         ON c_cpu.device_id = d.id AND c_cpu.metric_name = 'cpu_util'
       LEFT JOIN monitoring_telemetry_current c_mem 
         ON c_mem.device_id = d.id AND c_mem.metric_name = 'mem_util'
       WHERE d.is_active = 1
       ORDER BY d.id ASC`
    );
    return rows.map(normalizeDevice);
  }
}

module.exports = MonitoringDevice;
