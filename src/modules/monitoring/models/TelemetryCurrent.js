// src/modules/monitoring/models/TelemetryCurrent.js
const { pool } = require("../../../db");

const TABLE_NAME = "monitoring_telemetry_current";

function normalizeTelemetryCurrent(row) {
  if (!row) return null;
  return {
    deviceId: row.device_id,
    metricName: row.metric_name,
    oid: row.oid,
    rawValue: row.raw_value,
    convertedValue: row.converted_value,
    unit: row.unit,
    timestamp: row.timestamp,
  };
}

class TelemetryCurrent {
  static async ensureTable() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        device_id INT NOT NULL,
        metric_name VARCHAR(100) NOT NULL,
        oid VARCHAR(255) NULL,
        raw_value VARCHAR(255) NULL,
        converted_value DOUBLE NULL,
        unit VARCHAR(50) NULL,
        timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (device_id, metric_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  }

  static async upsert(payload) {
    const values = [
      payload.deviceId,
      payload.metricName,
      payload.oid || null,
      payload.rawValue || null,
      payload.convertedValue ?? null,
      payload.unit || null,
    ];

    await pool.query(
      `INSERT INTO ${TABLE_NAME}
       (device_id, metric_name, oid, raw_value, converted_value, unit)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         oid = VALUES(oid),
         raw_value = VALUES(raw_value),
         converted_value = VALUES(converted_value),
         unit = VALUES(unit)`,
      values
    );
  }

  static async listByDeviceId(deviceId) {
    const [rows] = await pool.query(
      `SELECT * FROM ${TABLE_NAME} WHERE device_id = ? ORDER BY metric_name ASC`,
      [Number(deviceId)]
    );
    return rows.map(normalizeTelemetryCurrent);
  }

  static async findByDeviceAndMetric(deviceId, metricName) {
    const [rows] = await pool.query(
      `SELECT * FROM ${TABLE_NAME} WHERE device_id = ? AND metric_name = ?`,
      [Number(deviceId), String(metricName)]
    );
    return normalizeTelemetryCurrent(rows[0]);
  }
}

module.exports = TelemetryCurrent;
