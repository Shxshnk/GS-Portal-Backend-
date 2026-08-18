// src/modules/monitoring/models/DeviceInterface.js
const { pool } = require("../../../db");

const TABLE_NAME = "monitoring_device_interfaces";

function normalizeInterface(row) {
  if (!row) return null;
  return {
    id: row.id,
    deviceId: row.device_id,
    interfaceIndex: row.interface_index,
    interfaceName: row.interface_name,
    alias: row.alias,
    description: row.description,
    type: row.interface_type,
    mac: row.mac,
    mtu: row.mtu,
    speed: row.speed,
    duplex: row.duplex,
    adminStatus: row.admin_status,
    operStatus: row.oper_status,
    lastChange: row.last_change,
    inputTraffic: row.input_traffic,
    outputTraffic: row.output_traffic,
    hcInOctets: row.hc_in_octets,
    hcOutOctets: row.hc_out_octets,
    inErrors: row.in_errors,
    outErrors: row.out_errors,
    inDiscards: row.in_discards,
    outDiscards: row.out_discards,
    crcErrors: row.crc_errors,
    bandwidthUtilization: row.bandwidth_utilization,
    rxRate: row.rx_rate,
    txRate: row.tx_rate,
    lastUpdated: row.last_updated,
  };
}

class DeviceInterface {
  static async ensureTable() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        device_id INT NOT NULL,
        interface_index INT NULL,
        interface_name VARCHAR(255) NOT NULL,
        alias VARCHAR(255) NULL,
        description VARCHAR(500) NULL,
        interface_type VARCHAR(100) NULL,
        mac VARCHAR(100) NULL,
        mtu INT NULL,
        speed VARCHAR(100) NULL,
        duplex VARCHAR(50) NULL,
        admin_status VARCHAR(50) NOT NULL DEFAULT 'unknown',
        oper_status VARCHAR(50) NOT NULL DEFAULT 'unknown',
        last_change VARCHAR(100) NULL,
        input_traffic DOUBLE NOT NULL DEFAULT 0,
        output_traffic DOUBLE NOT NULL DEFAULT 0,
        hc_in_octets DOUBLE NULL,
        hc_out_octets DOUBLE NULL,
        in_errors INT NOT NULL DEFAULT 0,
        out_errors INT NOT NULL DEFAULT 0,
        in_discards INT NOT NULL DEFAULT 0,
        out_discards INT NOT NULL DEFAULT 0,
        crc_errors INT NOT NULL DEFAULT 0,
        bandwidth_utilization DOUBLE NULL,
        rx_rate DOUBLE NULL,
        tx_rate DOUBLE NULL,
        last_updated DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_device_interface_name (device_id, interface_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  }

  static async upsert(payload) {
    const values = [
      payload.deviceId,
      payload.interfaceIndex || null,
      payload.interfaceName,
      payload.alias || null,
      payload.description || null,
      payload.type || null,
      payload.mac || null,
      payload.mtu || null,
      payload.speed || null,
      payload.duplex || null,
      payload.adminStatus || "unknown",
      payload.operStatus || "unknown",
      payload.lastChange || null,
      payload.inputTraffic ?? 0,
      payload.outputTraffic ?? 0,
      payload.hcInOctets || null,
      payload.hcOutOctets || null,
      payload.inErrors ?? 0,
      payload.outErrors ?? 0,
      payload.inDiscards ?? 0,
      payload.outDiscards ?? 0,
      payload.crcErrors ?? 0,
      payload.bandwidthUtilization || null,
      payload.rxRate || null,
      payload.txRate || null,
    ];

    await pool.query(
      `INSERT INTO ${TABLE_NAME}
       (device_id, interface_index, interface_name, alias, description, interface_type, mac, mtu, speed, duplex, admin_status, oper_status, last_change, input_traffic, output_traffic, hc_in_octets, hc_out_octets, in_errors, out_errors, in_discards, out_discards, crc_errors, bandwidth_utilization, rx_rate, tx_rate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         interface_index = VALUES(interface_index),
         alias = VALUES(alias),
         description = VALUES(description),
         interface_type = VALUES(interface_type),
         mac = VALUES(mac),
         mtu = VALUES(mtu),
         speed = VALUES(speed),
         duplex = VALUES(duplex),
         admin_status = VALUES(admin_status),
         oper_status = VALUES(oper_status),
         last_change = VALUES(last_change),
         input_traffic = VALUES(input_traffic),
         output_traffic = VALUES(output_traffic),
         hc_in_octets = VALUES(hc_in_octets),
         hc_out_octets = VALUES(hc_out_octets),
         in_errors = VALUES(in_errors),
         out_errors = VALUES(out_errors),
         in_discards = VALUES(in_discards),
         out_discards = VALUES(out_discards),
         crc_errors = VALUES(crc_errors),
         bandwidth_utilization = VALUES(bandwidth_utilization),
         rx_rate = VALUES(rx_rate),
         tx_rate = VALUES(tx_rate)`,
      values
    );
  }

  static async listByDeviceId(deviceId) {
    const [rows] = await pool.query(
      `SELECT * FROM ${TABLE_NAME} WHERE device_id = ? ORDER BY interface_name ASC`,
      [Number(deviceId)]
    );
    return rows.map(normalizeInterface);
  }

  static async deleteByDeviceId(deviceId) {
    await pool.query(`DELETE FROM ${TABLE_NAME} WHERE device_id = ?`, [Number(deviceId)]);
  }
}

module.exports = DeviceInterface;
