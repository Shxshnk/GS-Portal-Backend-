// src/modules/monitoring/models/DiscoverySession.js
const { pool } = require("../../../db");

const TABLE_NAME = "monitoring_discovery_sessions";

class DiscoverySession {
  static async ensureTable() {
    const [fields] = await pool.query(`SHOW TABLES LIKE '${TABLE_NAME}'`);
    if (fields.length === 0) {
      await pool.query(`
        CREATE TABLE ${TABLE_NAME} (
          id INT AUTO_INCREMENT PRIMARY KEY,
          session_name VARCHAR(100) NOT NULL,
          cidr VARCHAR(100) NOT NULL,
          mode VARCHAR(50) NOT NULL DEFAULT 'SNMP + Ping',
          status VARCHAR(50) NOT NULL DEFAULT 'Completed',
          total_ips INT NOT NULL DEFAULT 0,
          scanned_ips INT NOT NULL DEFAULT 0,
          devices_found INT NOT NULL DEFAULT 0,
          reachable_count INT NOT NULL DEFAULT 0,
          unreachable_count INT NOT NULL DEFAULT 0,
          start_time DATETIME NULL,
          end_time DATETIME NULL,
          duration_seconds INT NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
      console.log(`[monitoring] Created table ${TABLE_NAME}`);
    }
  }

  static async create(payload) {
    await this.ensureTable();
    const values = [
      payload.sessionName || "Subnet Scan",
      payload.cidr || "",
      payload.mode || "SNMP + Ping",
      payload.status || "Completed",
      payload.totalIps || 0,
      payload.scannedIps || 0,
      payload.devicesFound || 0,
      payload.reachableCount || 0,
      payload.unreachableCount || 0,
      payload.startTime ? new Date(payload.startTime) : null,
      payload.endTime ? new Date(payload.endTime) : null,
      payload.durationSeconds || 0,
    ];

    const [result] = await pool.query(
      `INSERT INTO ${TABLE_NAME}
       (session_name, cidr, mode, status, total_ips, scanned_ips, devices_found, reachable_count, unreachable_count, start_time, end_time, duration_seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      values
    );

    return this.findById(result.insertId);
  }

  static async findById(id) {
    await this.ensureTable();
    const [rows] = await pool.query(`SELECT * FROM ${TABLE_NAME} WHERE id = ?`, [id]);
    return rows[0] || null;
  }

  static async list() {
    await this.ensureTable();
    const [rows] = await pool.query(`SELECT * FROM ${TABLE_NAME} ORDER BY id DESC LIMIT 50`);
    return rows.map(r => ({
      id: r.id,
      sessionName: r.session_name,
      cidr: r.cidr,
      mode: r.mode,
      status: r.status,
      totalIps: r.total_ips,
      scannedIps: r.scanned_ips,
      devicesFound: r.devices_found,
      reachableCount: r.reachable_count,
      unreachableCount: r.unreachable_count,
      startTime: r.start_time,
      endTime: r.end_time,
      durationSeconds: r.duration_seconds,
      createdAt: r.created_at
    }));
  }

  static async getSummaryStats() {
    await this.ensureTable();
    const [rows] = await pool.query(`
      SELECT 
        COUNT(*) as totalSessions,
        SUM(total_ips) as totalScanned,
        SUM(devices_found) as totalDevicesFound,
        SUM(reachable_count) as totalReachable,
        SUM(unreachable_count) as totalUnreachable,
        AVG(duration_seconds) as avgScanTime
      FROM ${TABLE_NAME}
    `);
    const summary = rows[0] || {};
    return {
      networksScanned: summary.totalSessions || 0,
      devicesFound: summary.totalDevicesFound || 0,
      reachableDevices: summary.totalReachable || 0,
      unreachableDevices: summary.totalUnreachable || 0,
      discoverySessions: summary.totalSessions || 0,
      avgScanTime: Math.round(summary.avgScanTime || 0),
    };
  }
}

module.exports = DiscoverySession;
