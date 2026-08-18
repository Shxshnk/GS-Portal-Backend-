// src/modules/monitoring/models/MonitoringProfile.js
const { pool } = require("../../../db");
const OidProfile = require("./OidProfile");

const TABLE_NAME = "monitoring_profiles";

function normalizeProfile(row) {
  if (!row) return null;

  const parseJSON = (val) => {
    if (!val) return [];
    if (typeof val === "object") return val;
    try {
      return JSON.parse(val);
    } catch (_) {
      return [];
    }
  };

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    oidProfileId: row.oid_profile_id,
    pollInterval: row.poll_interval,
    timeout: row.timeout,
    retries: row.retries,
    healthRules: parseJSON(row.health_rules),
    telemetryRules: parseJSON(row.telemetry_rules),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class MonitoringProfile {
  static async ensureTable() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT NULL,
        oid_profile_id INT NOT NULL,
        poll_interval INT NOT NULL DEFAULT 30,
        timeout INT NOT NULL DEFAULT 2500,
        retries INT NOT NULL DEFAULT 1,
        health_rules JSON NULL,
        telemetry_rules JSON NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_monitoring_profiles_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await this.seedDefaults();
  }

  static async seedDefaults() {
    const [rows] = await pool.query(`SELECT COUNT(*) as count FROM ${TABLE_NAME}`);
    if (rows[0].count > 0) return;

    // Load OID profiles to resolve IDs
    const oids = await OidProfile.list();
    const findOidId = (name) => {
      const match = oids.find(o => o.name === name);
      return match ? match.id : 1;
    };

    const defaults = [
      {
        name: "Generic SNMP Monitor",
        description: "Standard telemetry gathering for SNMP agents.",
        oid_profile_id: findOidId("Generic SNMP Device"),
        poll_interval: 30,
        timeout: 2500,
        retries: 1,
        health_rules: [
          { metric: "response_time", operator: ">", threshold: 500, deduction: 15 }
        ],
        telemetry_rules: {}
      },
      {
        name: "Core Router Monitor",
        description: "High-frequency polling and health score tracking for Cisco Core Routers.",
        oid_profile_id: findOidId("Cisco Router"),
        poll_interval: 15,
        timeout: 3000,
        retries: 2,
        health_rules: [
          { metric: "cpu_util", operator: ">", threshold: 85, deduction: 20 },
          { metric: "mem_util", operator: ">", threshold: 90, deduction: 25 },
          { metric: "response_time", operator: ">", threshold: 200, deduction: 10 }
        ],
        telemetry_rules: {}
      },
      {
        name: "Core Switch Monitor",
        description: "Standard monitoring profile for switch node chassis.",
        oid_profile_id: findOidId("Cisco Switch"),
        poll_interval: 30,
        timeout: 2500,
        retries: 1,
        health_rules: [
          { metric: "cpu_util", operator: ">", threshold: 80, deduction: 15 },
          { metric: "mem_util", operator: ">", threshold: 90, deduction: 20 }
        ],
        telemetry_rules: {}
      },
      {
        name: "Linux Host Monitor",
        description: "Resource checking profile for Linux servers.",
        oid_profile_id: findOidId("Linux Server"),
        poll_interval: 60,
        timeout: 3000,
        retries: 1,
        health_rules: [
          { metric: "cpu_util", operator: ">", threshold: 90, deduction: 30 },
          { metric: "mem_util", operator: ">", threshold: 95, deduction: 30 }
        ],
        telemetry_rules: {}
      },
      {
        name: "Windows Host Monitor",
        description: "Resource checking profile for Windows servers.",
        oid_profile_id: findOidId("Windows Server"),
        poll_interval: 60,
        timeout: 3000,
        retries: 1,
        health_rules: [
          { metric: "cpu_util", operator: ">", threshold: 90, deduction: 30 },
          { metric: "mem_util", operator: ">", threshold: 95, deduction: 30 }
        ],
        telemetry_rules: {}
      }
    ];

    for (const d of defaults) {
      await pool.query(
        `INSERT INTO ${TABLE_NAME}
         (name, description, oid_profile_id, poll_interval, timeout, retries, health_rules, telemetry_rules)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          d.name,
          d.description,
          d.oid_profile_id,
          d.poll_interval,
          d.timeout,
          d.retries,
          JSON.stringify(d.health_rules),
          JSON.stringify(d.telemetry_rules),
        ]
      );
    }
  }

  static async list() {
    const [rows] = await pool.query(`SELECT * FROM ${TABLE_NAME} ORDER BY id ASC`);
    return rows.map(normalizeProfile);
  }

  static async findById(id) {
    const [rows] = await pool.query(`SELECT * FROM ${TABLE_NAME} WHERE id = ?`, [Number(id)]);
    return normalizeProfile(rows[0]);
  }
}

module.exports = MonitoringProfile;
