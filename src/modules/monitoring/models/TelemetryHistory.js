// src/modules/monitoring/models/TelemetryHistory.js
const { pool } = require("../../../db");

const TABLE_NAME = "monitoring_telemetry_history";

function normalizeTelemetryHistory(row) {
  if (!row) return null;
  return {
    id: row.id,
    deviceId: row.device_id,
    metricName: row.metric_name,
    oid: row.oid,
    rawValue: row.raw_value,
    convertedValue: row.converted_value,
    unit: row.unit,
    timestamp: row.timestamp,
    source: row.source,
    collectionMode: row.collection_mode,
  };
}

class TelemetryHistory {
  static async ensureTable() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        device_id INT NOT NULL,
        metric_name VARCHAR(100) NOT NULL,
        oid VARCHAR(255) NULL,
        raw_value VARCHAR(255) NULL,
        converted_value DOUBLE NULL,
        unit VARCHAR(50) NULL,
        timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        source VARCHAR(50) NOT NULL DEFAULT 'SNMP',
        collection_mode VARCHAR(50) NOT NULL DEFAULT 'POLLING',
        INDEX idx_monitoring_telemetry_history_device_metric_time (device_id, metric_name, timestamp)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  }

  static async insert(payload) {
    const values = [
      payload.deviceId,
      payload.metricName,
      payload.oid || null,
      payload.rawValue || null,
      payload.convertedValue ?? null,
      payload.unit || null,
      payload.source || "SNMP",
      payload.collectionMode || "POLLING",
    ];

    await pool.query(
      `INSERT INTO ${TABLE_NAME}
       (device_id, metric_name, oid, raw_value, converted_value, unit, source, collection_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      values
    );
  }

  static async queryHistory(deviceId, metricName, options = {}) {
    let sql = `SELECT * FROM ${TABLE_NAME} WHERE device_id = ? AND metric_name = ?`;
    const params = [Number(deviceId), String(metricName)];

    if (options.startTime) {
      sql += ` AND timestamp >= ?`;
      params.push(new Date(options.startTime));
    } else if (options.limitHours) {
      sql += ` AND timestamp >= NOW() - INTERVAL ? HOUR`;
      params.push(Number(options.limitHours));
    }

    if (options.endTime) {
      sql += ` AND timestamp <= ?`;
      params.push(new Date(options.endTime));
    }

    sql += ` ORDER BY timestamp ASC`;

    const [rows] = await pool.query(sql, params);
    return rows.map(normalizeTelemetryHistory);
  }

  static async queryHistoryForMetrics(deviceId, metricNames = [], options = {}) {
    if (!Array.isArray(metricNames) || metricNames.length === 0) return [];
    
    // Create placeholders for IN clause
    const placeholders = metricNames.map(() => '?').join(',');
    
    let sql = `SELECT * FROM ${TABLE_NAME} WHERE device_id = ? AND metric_name IN (${placeholders})`;
    const params = [Number(deviceId), ...metricNames.map(String)];

    if (options.startTime) {
      sql += ` AND timestamp >= ?`;
      params.push(new Date(options.startTime));
    } else if (options.limitHours) {
      sql += ` AND timestamp >= NOW() - INTERVAL ? HOUR`;
      params.push(Number(options.limitHours));
    }

    if (options.endTime) {
      sql += ` AND timestamp <= ?`;
      params.push(new Date(options.endTime));
    }

    sql += ` ORDER BY timestamp ASC`;

    const [rows] = await pool.query(sql, params);
    return rows.map(normalizeTelemetryHistory);
  }

  static async pruneOldData(retentionDays) {
    const days = Number(retentionDays);
    if (!Number.isFinite(days) || days <= 0) return;
    await pool.query(
      `DELETE FROM ${TABLE_NAME} WHERE timestamp < NOW() - INTERVAL ? DAY`,
      [days]
    );
  }
}

module.exports = TelemetryHistory;
