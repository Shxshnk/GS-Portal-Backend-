// src/modules/monitoring/models/DeviceHardware.js
const { pool } = require("../../../db");

const TABLE_NAME = "monitoring_device_hardware";

function normalizeHardware(row) {
  if (!row) return null;
  return {
    id: row.id,
    deviceId: row.device_id,
    componentName: row.component_name,
    componentType: row.component_type,
    serialNumber: row.serial_number,
    firmwareVersion: row.firmware_version,
    modelName: row.model_name,
    lastUpdated: row.last_updated,
  };
}

class DeviceHardware {
  static async ensureTable() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        device_id INT NOT NULL,
        component_name VARCHAR(255) NOT NULL,
        component_type VARCHAR(100) NULL,
        serial_number VARCHAR(100) NULL,
        firmware_version VARCHAR(100) NULL,
        model_name VARCHAR(255) NULL,
        last_updated DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_device_hardware_name (device_id, component_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  }

  static async upsert(payload) {
    const values = [
      payload.deviceId,
      payload.componentName,
      payload.componentType || null,
      payload.serialNumber || null,
      payload.firmwareVersion || null,
      payload.modelName || null,
    ];

    await pool.query(
      `INSERT INTO ${TABLE_NAME}
       (device_id, component_name, component_type, serial_number, firmware_version, model_name)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         component_type = VALUES(component_type),
         serial_number = VALUES(serial_number),
         firmware_version = VALUES(firmware_version),
         model_name = VALUES(model_name)`,
      values
    );
  }

  static async listByDeviceId(deviceId) {
    const [rows] = await pool.query(
      `SELECT * FROM ${TABLE_NAME} WHERE device_id = ? ORDER BY component_name ASC`,
      [Number(deviceId)]
    );
    return rows.map(normalizeHardware);
  }

  static async deleteByDeviceId(deviceId) {
    await pool.query(`DELETE FROM ${TABLE_NAME} WHERE device_id = ?`, [Number(deviceId)]);
  }
}

module.exports = DeviceHardware;
