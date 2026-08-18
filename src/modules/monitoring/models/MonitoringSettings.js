// src/modules/monitoring/models/MonitoringSettings.js
const { pool } = require("../../../db");

const TABLE_NAME = "monitoring_settings";

class MonitoringSettings {
  static async ensureTable() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        setting_key VARCHAR(100) PRIMARY KEY,
        setting_value TEXT NOT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await this.seedDefaults();
  }

  static async seedDefaults() {
    const defaults = {
      default_poll_interval: "10", // seconds
      default_timeout: "2500", // ms
      default_retries: "1",
      max_concurrent_polls: "10",
      telemetry_retention_days: "30",
      snmp_default_community: "public",
      snmp_default_version: "v2c",
      cli_snmpget_path: "snmpget",
      cli_snmpwalk_path: "snmpwalk",
      cli_snmpset_path: "snmpset",
      cli_snmpbulkget_path: "snmpbulkget",
      cli_snmpgetnext_path: "snmpgetnext"
    };

    const [rows] = await pool.query(`SELECT COUNT(*) as count FROM ${TABLE_NAME}`);
    if (rows[0].count > 0) return;

    for (const [key, val] of Object.entries(defaults)) {
      await pool.query(
        `INSERT INTO ${TABLE_NAME} (setting_key, setting_value) VALUES (?, ?)`,
        [key, val]
      );
    }
  }

  static async getVal(key, fallback = "") {
    try {
      const [rows] = await pool.query(
        `SELECT setting_value FROM ${TABLE_NAME} WHERE setting_key = ?`,
        [String(key)]
      );
      return rows[0] ? rows[0].setting_value : fallback;
    } catch (_) {
      return fallback;
    }
  }

  static async getNumber(key, fallback = 0) {
    const val = await this.getVal(key, fallback);
    const parsed = Number(val);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  static async setVal(key, value) {
    await pool.query(
      `INSERT INTO ${TABLE_NAME} (setting_key, setting_value)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [String(key), String(value)]
    );
  }

  static async list() {
    const [rows] = await pool.query(`SELECT * FROM ${TABLE_NAME} ORDER BY setting_key ASC`);
    const settings = {};
    for (const r of rows) {
      settings[r.setting_key] = r.setting_value;
    }
    return settings;
  }
}

module.exports = MonitoringSettings;
