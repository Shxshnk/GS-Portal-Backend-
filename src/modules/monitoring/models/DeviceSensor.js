// src/modules/monitoring/models/DeviceSensor.js
const { pool } = require("../../../db");

const TABLE_NAME = "monitoring_device_sensors";

function normalizeSensor(row) {
  if (!row) return null;
  return {
    id: row.id,
    deviceId: row.device_id,
    sensorName: row.sensor_name,
    sensorType: row.sensor_type, // 'temperature', 'voltage', 'fan', etc.
    sensorValue: row.sensor_value,
    unit: row.unit,
    status: row.status, // 'ok', 'warning', 'critical'
    lastUpdated: row.last_updated,
  };
}

class DeviceSensor {
  static async ensureTable() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        device_id INT NOT NULL,
        sensor_name VARCHAR(255) NOT NULL,
        sensor_type VARCHAR(50) NOT NULL,
        sensor_value DOUBLE NOT NULL DEFAULT 0,
        unit VARCHAR(50) NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'unknown',
        last_updated DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_device_sensor_name (device_id, sensor_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  }

  static async upsert(payload) {
    const values = [
      payload.deviceId,
      payload.sensorName,
      payload.sensorType,
      payload.sensorValue ?? 0,
      payload.unit || null,
      payload.status || "unknown",
    ];

    await pool.query(
      `INSERT INTO ${TABLE_NAME}
       (device_id, sensor_name, sensor_type, sensor_value, unit, status)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         sensor_value = VALUES(sensor_value),
         status = VALUES(status)`,
      values
    );
  }

  static async listByDeviceId(deviceId) {
    const [rows] = await pool.query(
      `SELECT * FROM ${TABLE_NAME} WHERE device_id = ? ORDER BY sensor_name ASC`,
      [Number(deviceId)]
    );
    return rows.map(normalizeSensor);
  }

  static async deleteByDeviceId(deviceId) {
    await pool.query(`DELETE FROM ${TABLE_NAME} WHERE device_id = ?`, [Number(deviceId)]);
  }
}

module.exports = DeviceSensor;
