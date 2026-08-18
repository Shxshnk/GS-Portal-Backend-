// src/modules/monitoring/models/OidProfile.js
const { pool } = require("../../../db");

const TABLE_NAME = "monitoring_oid_profiles";

function normalizeOidProfile(row) {
  if (!row) return null;

  const parseJSON = (val) => {
    if (!val) return {};
    if (typeof val === "object") return val;
    try {
      return JSON.parse(val);
    } catch (_) {
      return {};
    }
  };

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    systemOids: parseJSON(row.system_oids),
    cpuOids: parseJSON(row.cpu_oids),
    memoryOids: parseJSON(row.memory_oids),
    tempOids: parseJSON(row.temp_oids),
    interfaceOids: parseJSON(row.interface_oids),
    customOids: parseJSON(row.custom_oids),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class OidProfile {
  static async ensureTable() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT NULL,
        system_oids JSON NULL,
        cpu_oids JSON NULL,
        memory_oids JSON NULL,
        temp_oids JSON NULL,
        interface_oids JSON NULL,
        custom_oids JSON NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_monitoring_oid_profiles_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await this.seedDefaults();
  }

  static async seedDefaults() {
    const [rows] = await pool.query(`SELECT COUNT(*) as count FROM ${TABLE_NAME}`);
    if (rows[0].count > 0) return;

    const defaultProfiles = [
      {
        name: "Generic SNMP Device",
        description: "Default standard RFC-1213 OID profile mappings.",
        system_oids: {
          sysName: "1.3.6.1.2.1.1.5.0",
          sysDescr: "1.3.6.1.2.1.1.1.0",
          sysObjectID: "1.3.6.1.2.1.1.2.0",
          sysUpTime: "1.3.6.1.2.1.1.3.0"
        },
        cpu_oids: {},
        memory_oids: {},
        temp_oids: {},
        interface_oids: {
          ifDescr: "1.3.6.1.2.1.2.2.1.2",
          ifSpeed: "1.3.6.1.2.1.2.2.1.5",
          ifPhysAddress: "1.3.6.1.2.1.2.2.1.6",
          ifAdminStatus: "1.3.6.1.2.1.2.2.1.7",
          ifOperStatus: "1.3.6.1.2.1.2.2.1.8"
        },
        custom_oids: {}
      },
      {
        name: "Cisco Router",
        description: "Cisco Systems ISR/ASR Series OID mappings.",
        system_oids: {
          sysName: "1.3.6.1.2.1.1.5.0",
          sysDescr: "1.3.6.1.2.1.1.1.0",
          sysObjectID: "1.3.6.1.2.1.1.2.0",
          sysUpTime: "1.3.6.1.2.1.1.3.0"
        },
        cpu_oids: {
          cpu_util: "1.3.6.1.4.1.9.9.109.1.1.1.1.8" // cpmCPUTotal5minRev
        },
        memory_oids: {
          mem_used: "1.3.6.1.4.1.9.9.48.1.1.1.5.1", // ciscoMemoryPoolUsed
          mem_free: "1.3.6.1.4.1.9.9.48.1.1.1.6.1"  // ciscoMemoryPoolFree
        },
        temp_oids: {
          temperature: "1.3.6.1.4.1.9.9.13.1.3.1.3" // ciscoEnvMonTemperatureStatusValue
        },
        interface_oids: {
          ifDescr: "1.3.6.1.2.1.2.2.1.2",
          ifMtu: "1.3.6.1.2.1.2.2.1.4",
          ifSpeed: "1.3.6.1.2.1.2.2.1.5",
          ifPhysAddress: "1.3.6.1.2.1.2.2.1.6",
          ifAdminStatus: "1.3.6.1.2.1.2.2.1.7",
          ifOperStatus: "1.3.6.1.2.1.2.2.1.8",
          ifInOctets: "1.3.6.1.2.1.2.2.1.10",
          ifOutOctets: "1.3.6.1.2.1.2.2.1.16",
          ifInErrors: "1.3.6.1.2.1.2.2.1.14",
          ifOutErrors: "1.3.6.1.2.1.2.2.1.20",
          ifAlias: "1.3.6.1.2.1.31.1.1.1.18"
        },
        custom_oids: {}
      },
      {
        name: "Cisco Switch",
        description: "Cisco Catalyst switch enterprise OIDs.",
        system_oids: {
          sysName: "1.3.6.1.2.1.1.5.0",
          sysDescr: "1.3.6.1.2.1.1.1.0",
          sysObjectID: "1.3.6.1.2.1.1.2.0",
          sysUpTime: "1.3.6.1.2.1.1.3.0"
        },
        cpu_oids: {
          cpu_util: "1.3.6.1.4.1.9.9.109.1.1.1.1.8"
        },
        memory_oids: {
          mem_used: "1.3.6.1.4.1.9.9.48.1.1.1.5.1",
          mem_free: "1.3.6.1.4.1.9.9.48.1.1.1.6.1"
        },
        temp_oids: {
          temperature: "1.3.6.1.4.1.9.9.13.1.3.1.3"
        },
        interface_oids: {
          ifDescr: "1.3.6.1.2.1.2.2.1.2",
          ifMtu: "1.3.6.1.2.1.2.2.1.4",
          ifSpeed: "1.3.6.1.2.1.2.2.1.5",
          ifPhysAddress: "1.3.6.1.2.1.2.2.1.6",
          ifAdminStatus: "1.3.6.1.2.1.2.2.1.7",
          ifOperStatus: "1.3.6.1.2.1.2.2.1.8",
          ifInOctets: "1.3.6.1.2.1.2.2.1.10",
          ifOutOctets: "1.3.6.1.2.1.2.2.1.16",
          ifInErrors: "1.3.6.1.2.1.2.2.1.14",
          ifOutErrors: "1.3.6.1.2.1.2.2.1.20",
          ifAlias: "1.3.6.1.2.1.31.1.1.1.18"
        },
        custom_oids: {}
      },
      {
        name: "Linux Server",
        description: "UCD-SNMP-MIB Linux daemon statistics OID mappings.",
        system_oids: {
          sysName: "1.3.6.1.2.1.1.5.0",
          sysDescr: "1.3.6.1.2.1.1.1.0",
          sysObjectID: "1.3.6.1.2.1.1.2.0",
          sysUpTime: "1.3.6.1.2.1.1.3.0"
        },
        cpu_oids: {
          cpu_idle: "1.3.6.1.4.1.2021.11.11.0" // ssCpuIdle
        },
        memory_oids: {
          mem_total: "1.3.6.1.4.1.2021.4.5.0", // memTotalReal
          mem_avail: "1.3.6.1.4.1.2021.4.6.0"  // memAvailReal
        },
        temp_oids: {},
        interface_oids: {
          ifDescr: "1.3.6.1.2.1.2.2.1.2",
          ifMtu: "1.3.6.1.2.1.2.2.1.4",
          ifSpeed: "1.3.6.1.2.1.2.2.1.5",
          ifPhysAddress: "1.3.6.1.2.1.2.2.1.6",
          ifAdminStatus: "1.3.6.1.2.1.2.2.1.7",
          ifOperStatus: "1.3.6.1.2.1.2.2.1.8",
          ifInOctets: "1.3.6.1.2.1.2.2.1.10",
          ifOutOctets: "1.3.6.1.2.1.2.2.1.16",
          ifInErrors: "1.3.6.1.2.1.2.2.1.14",
          ifOutErrors: "1.3.6.1.2.1.2.2.1.20"
        },
        custom_oids: {}
      },
      {
        name: "Windows Server",
        description: "RFC-1213 based Windows Host Resources MIB mappings.",
        system_oids: {
          sysName: "1.3.6.1.2.1.1.5.0",
          sysDescr: "1.3.6.1.2.1.1.1.0",
          sysObjectID: "1.3.6.1.2.1.1.2.0",
          sysUpTime: "1.3.6.1.2.1.1.3.0"
        },
        cpu_oids: {
          cpu_util: "1.3.6.1.2.1.25.3.3.1.2" // hrProcessorLoad
        },
        memory_oids: {
          mem_total: "1.3.6.1.2.1.25.2.2.0" // hrMemorySize
        },
        temp_oids: {},
        interface_oids: {
          ifDescr: "1.3.6.1.2.1.2.2.1.2",
          ifMtu: "1.3.6.1.2.1.2.2.1.4",
          ifSpeed: "1.3.6.1.2.1.2.2.1.5",
          ifPhysAddress: "1.3.6.1.2.1.2.2.1.6",
          ifAdminStatus: "1.3.6.1.2.1.2.2.1.7",
          ifOperStatus: "1.3.6.1.2.1.2.2.1.8",
          ifInOctets: "1.3.6.1.2.1.2.2.1.10",
          ifOutOctets: "1.3.6.1.2.1.2.2.1.16",
          ifInErrors: "1.3.6.1.2.1.2.2.1.14",
          ifOutErrors: "1.3.6.1.2.1.2.2.1.20"
        },
        custom_oids: {}
      }
    ];

    for (const p of defaultProfiles) {
      await pool.query(
        `INSERT INTO ${TABLE_NAME}
         (name, description, system_oids, cpu_oids, memory_oids, temp_oids, interface_oids, custom_oids)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          p.name,
          p.description,
          JSON.stringify(p.system_oids),
          JSON.stringify(p.cpu_oids),
          JSON.stringify(p.memory_oids),
          JSON.stringify(p.temp_oids),
          JSON.stringify(p.interface_oids),
          JSON.stringify(p.custom_oids),
        ]
      );
    }
  }

  static async list() {
    const [rows] = await pool.query(`SELECT * FROM ${TABLE_NAME} ORDER BY id ASC`);
    return rows.map(normalizeOidProfile);
  }

  static async findById(id) {
    const [rows] = await pool.query(`SELECT * FROM ${TABLE_NAME} WHERE id = ?`, [Number(id)]);
    return normalizeOidProfile(rows[0]);
  }
}

module.exports = OidProfile;
