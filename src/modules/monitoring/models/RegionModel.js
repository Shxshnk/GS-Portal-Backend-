// src/modules/monitoring/models/RegionModel.js
const { pool } = require("../../../db");
const EncryptionService = require("../services/EncryptionService");

const REGIONS_TABLE = "gs_regions";
const STATIONS_TABLE = "gs_region_stations";

// Default seed regions to ensure 100% backward compatibility
const DEFAULT_REGIONS = [
  {
    name: "Cape Town",
    code: "CPT",
    aws_region: "af-south-1",
    latitude: -33.9249,
    longitude: 18.4241,
    access_key: process.env.CP1_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || "MOCK_KEY_CPT",
    secret_key: process.env.CP1_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || "MOCK_SECRET_CPT",
    is_active: 1,
    stations: [
      {
        station_type: "SD1",
        station_name: "Cape Town SD1",
        station_id: "CP1",
        cloudwatch_namespace: process.env.CP1_CLOUDWATCH_NAMESPACE || "GroundStation/SDR",
        ground_station: process.env.CP1_GROUND_STATION || "GS-001",
        receiver: process.env.CP1_RECEIVER || "IFR-1",
        ec2_sdr_instance_id: process.env.CP1_SDR_INSTANCE_ID || "i-04dca7b61a57c74db",
        ec2_receiver_instance_id: process.env.CP1_RECEIVER_INSTANCE_ID || "i-09e18b7e39b38ba47"
      },
      {
        station_type: "SD2",
        station_name: "Cape Town SD2",
        station_id: "CP2",
        cloudwatch_namespace: process.env.CP2_CLOUDWATCH_NAMESPACE || "GroundStation/SDR",
        ground_station: process.env.CP2_GROUND_STATION || "GS-001",
        receiver: process.env.CP2_RECEIVER || "IFR-1",
        ec2_sdr_instance_id: process.env.CP2_SDR_INSTANCE_ID || "i-0f76b7aed11916f7b",
        ec2_receiver_instance_id: process.env.CP2_RECEIVER_INSTANCE_ID || "i-01355c3be5b62d5d6"
      }
    ]
  },
  {
    name: "Dublin",
    code: "DUB",
    aws_region: "eu-west-1",
    latitude: 53.3498,
    longitude: -6.2603,
    access_key: process.env.DU1_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || "MOCK_KEY_DUB",
    secret_key: process.env.DU1_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || "MOCK_SECRET_DUB",
    is_active: 1,
    stations: [
      {
        station_type: "SD1",
        station_name: "Dublin SD1",
        station_id: "DU1",
        cloudwatch_namespace: process.env.DU1_CLOUDWATCH_NAMESPACE || "GroundStation/SDR",
        ground_station: process.env.DU1_GROUND_STATION || "GS-002",
        receiver: process.env.DU1_RECEIVER || "IFR-1",
        ec2_sdr_instance_id: process.env.DU1_SDR_INSTANCE_ID || "i-0acbbc36feaa58978",
        ec2_receiver_instance_id: process.env.DU1_RECEIVER_INSTANCE_ID || "i-0a4878491efbc72f9"
      },
      {
        station_type: "SD2",
        station_name: "Dublin SD2",
        station_id: "DU2",
        cloudwatch_namespace: process.env.DU2_CLOUDWATCH_NAMESPACE || "GroundStation/SDR",
        ground_station: process.env.DU2_GROUND_STATION || "GS-002",
        receiver: process.env.DU2_RECEIVER || "IFR-1",
        ec2_sdr_instance_id: process.env.DU2_SDR_INSTANCE_ID || "i-065b7f39185b032f8",
        ec2_receiver_instance_id: process.env.DU2_RECEIVER_INSTANCE_ID || "i-01c4a7f62f86aee19"
      }
    ]
  },
  {
    name: "Punta Arenas",
    code: "PUQ",
    aws_region: "sa-east-1",
    latitude: -53.15,
    longitude: -70.9167,
    access_key: process.env.PA1_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || "MOCK_KEY_PUQ",
    secret_key: process.env.PA1_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || "MOCK_SECRET_PUQ",
    is_active: 1,
    stations: [
      {
        station_type: "SD1",
        station_name: "Punta Arenas SD1",
        station_id: "PA1",
        cloudwatch_namespace: process.env.PA1_CLOUDWATCH_NAMESPACE || "GroundStation/SDR",
        ground_station: process.env.PA1_GROUND_STATION || "GS-003",
        receiver: process.env.PA1_RECEIVER || "IFR-1",
        ec2_sdr_instance_id: process.env.PA1_SDR_INSTANCE_ID || "i-0695e04fdef95e365",
        ec2_receiver_instance_id: process.env.PA1_RECEIVER_INSTANCE_ID || "i-08ea5a3259f8acb0b"
      },
      {
        station_type: "SD2",
        station_name: "Punta Arenas SD2",
        station_id: "PA2",
        cloudwatch_namespace: process.env.PA2_CLOUDWATCH_NAMESPACE || "GroundStation/SDR",
        ground_station: process.env.PA2_GROUND_STATION || "GS-003",
        receiver: process.env.PA2_RECEIVER || "IFR-1",
        ec2_sdr_instance_id: process.env.PA2_SDR_INSTANCE_ID || "i-069a1b0858fd20122",
        ec2_receiver_instance_id: process.env.PA2_RECEIVER_INSTANCE_ID || "i-0dbc2d128cadb8252"
      }
    ]
  },
  {
    name: "Dubbo",
    code: "DBO",
    aws_region: "ap-southeast-2",
    latitude: -32.245,
    longitude: 148.604,
    access_key: process.env.DB1_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || "MOCK_KEY_DBO",
    secret_key: process.env.DB1_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || "MOCK_SECRET_DBO",
    is_active: 1,
    stations: [
      {
        station_type: "SD1",
        station_name: "Dubbo SD1",
        station_id: "DB1",
        cloudwatch_namespace: process.env.DB1_CLOUDWATCH_NAMESPACE || "GroundStation/SDR",
        ground_station: process.env.DB1_GROUND_STATION || "GS-004",
        receiver: process.env.DB1_RECEIVER || "IFR-1",
        ec2_sdr_instance_id: process.env.DB1_SDR_INSTANCE_ID || "i-0bd5179c86257d5ec",
        ec2_receiver_instance_id: process.env.DB1_RECEIVER_INSTANCE_ID || "i-0aadacb9a0ce87849"
      },
      {
        station_type: "SD2",
        station_name: "Dubbo SD2",
        station_id: "DB2",
        cloudwatch_namespace: process.env.DB2_CLOUDWATCH_NAMESPACE || "GroundStation/SDR",
        ground_station: process.env.DB2_GROUND_STATION || "GS-004",
        receiver: process.env.DB2_RECEIVER || "IFR-1",
        ec2_sdr_instance_id: process.env.DB2_SDR_INSTANCE_ID || "i-0eaf782bb7e94cd11",
        ec2_receiver_instance_id: process.env.DB2_RECEIVER_INSTANCE_ID || "i-0bc0e9084846e5e5a"
      }
    ]
  },
  {
    name: "Oregon",
    code: "OR",
    aws_region: "us-west-2",
    latitude: 44.0,
    longitude: -120.5,
    access_key: process.env.OR1_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || "MOCK_KEY_OR",
    secret_key: process.env.OR1_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || "MOCK_SECRET_OR",
    is_active: 1,
    stations: [
      {
        station_type: "SD1",
        station_name: "Oregon SD1",
        station_id: "OR1",
        cloudwatch_namespace: process.env.OR1_CLOUDWATCH_NAMESPACE || "GroundStation/SDR",
        ground_station: process.env.OR1_GROUND_STATION || "GS-001",
        receiver: process.env.OR1_RECEIVER || "IFR-1",
        ec2_sdr_instance_id: process.env.OR1_SDR_INSTANCE_ID || null,
        ec2_receiver_instance_id: process.env.OR1_RECEIVER_INSTANCE_ID || null
      },
      {
        station_type: "SD2",
        station_name: "Oregon SD2",
        station_id: "OR2",
        cloudwatch_namespace: process.env.OR2_CLOUDWATCH_NAMESPACE || "GroundStation/SDR",
        ground_station: process.env.OR2_GROUND_STATION || "GS-002",
        receiver: process.env.OR2_RECEIVER || "IFR-1",
        ec2_sdr_instance_id: process.env.OR2_SDR_INSTANCE_ID || null,
        ec2_receiver_instance_id: process.env.OR2_RECEIVER_INSTANCE_ID || null
      }
    ]
  }
];

function normalizeRegion(row, maskSecret = true) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    awsRegion: row.aws_region,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    accessKey: maskSecret && row.access_key ? (row.access_key.length > 8 ? `${row.access_key.slice(0, 4)}...${row.access_key.slice(-4)}` : "********") : row.access_key,
    secretKey: maskSecret ? "****************" : (row.secret_key ? EncryptionService.decrypt(row.secret_key) : ""),
    hasCredentials: Boolean(row.access_key && row.secret_key),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stations: []
  };
}

function normalizeStation(row) {
  if (!row) return null;
  return {
    id: row.id,
    regionId: row.region_id,
    stationType: row.station_type,
    stationName: row.station_name,
    stationId: row.station_id,
    cloudwatchNamespace: row.cloudwatch_namespace,
    groundStation: row.ground_station,
    receiver: row.receiver,
    ec2SdrInstanceId: row.ec2_sdr_instance_id,
    ec2ReceiverInstanceId: row.ec2_receiver_instance_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

class RegionModel {
  static isInitialized = false;

  static async ensureTables() {
    if (this.isInitialized || !pool) return;
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${REGIONS_TABLE} (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          code VARCHAR(50) NOT NULL UNIQUE,
          aws_region VARCHAR(100) NOT NULL,
          latitude DECIMAL(10, 6) NOT NULL,
          longitude DECIMAL(10, 6) NOT NULL,
          access_key VARCHAR(255) NULL,
          secret_key VARCHAR(500) NULL,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);

      // Ensure nullable access_key and secret_key in case table was created with NOT NULL
      try {
        await pool.query(`ALTER TABLE ${REGIONS_TABLE} MODIFY COLUMN access_key VARCHAR(255) NULL`);
        await pool.query(`ALTER TABLE ${REGIONS_TABLE} MODIFY COLUMN secret_key VARCHAR(500) NULL`);
      } catch (alterErr) {
        // Safe to ignore if already nullable
      }

      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${STATIONS_TABLE} (
          id INT AUTO_INCREMENT PRIMARY KEY,
          region_id INT NOT NULL,
          station_type ENUM('SD1', 'SD2') NOT NULL,
          station_name VARCHAR(255) NULL,
          station_id VARCHAR(50) NOT NULL,
          cloudwatch_namespace VARCHAR(255) NOT NULL DEFAULT 'GroundStation/SDR',
          ground_station VARCHAR(255) NOT NULL DEFAULT 'GS-001',
          receiver VARCHAR(255) NOT NULL DEFAULT 'IFR-1',
          ec2_sdr_instance_id VARCHAR(100) NULL,
          ec2_receiver_instance_id VARCHAR(100) NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_station_id (station_id),
          INDEX idx_region_id (region_id),
          CONSTRAINT fk_gs_region FOREIGN KEY (region_id) REFERENCES ${REGIONS_TABLE}(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);

      // Seed default regions if table is empty
      const [rows] = await pool.query(`SELECT COUNT(*) as count FROM ${REGIONS_TABLE}`);
      if (rows[0].count === 0) {
        console.log("[RegionModel] Seeding default 4 Ground Station regions...");
        for (const r of DEFAULT_REGIONS) {
          const encryptedSecret = EncryptionService.encrypt(r.secret_key);
          const [result] = await pool.query(
            `INSERT INTO ${REGIONS_TABLE} (name, code, aws_region, latitude, longitude, access_key, secret_key, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [r.name, r.code, r.aws_region, r.latitude, r.longitude, r.access_key, encryptedSecret, r.is_active]
          );
          const regionId = result.insertId;
          for (const s of r.stations) {
            await pool.query(
              `INSERT INTO ${STATIONS_TABLE} (region_id, station_type, station_name, station_id, cloudwatch_namespace, ground_station, receiver, ec2_sdr_instance_id, ec2_receiver_instance_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [regionId, s.station_type, s.station_name, s.station_id, s.cloudwatch_namespace, s.ground_station, s.receiver, s.ec2_sdr_instance_id, s.ec2_receiver_instance_id]
            );
          }
        }
        console.log("[RegionModel] Successfully seeded default Ground Station regions.");
      }

      this.isInitialized = true;
    } catch (err) {
      console.error("[RegionModel] ensureTables error:", err.message);
    }
  }

  static async list(includeInactive = false, maskSecret = true) {
    await this.ensureTables();
    if (!pool) return [];

    const whereClause = includeInactive ? "" : "WHERE is_active = 1";
    const [regionRows] = await pool.query(`SELECT * FROM ${REGIONS_TABLE} ${whereClause} ORDER BY name ASC`);
    
    if (regionRows.length === 0) return [];

    const regionIds = regionRows.map(r => r.id);
    const [stationRows] = await pool.query(
      `SELECT * FROM ${STATIONS_TABLE} WHERE region_id IN (?) ORDER BY station_type ASC`,
      [regionIds]
    );

    const regions = regionRows.map(r => normalizeRegion(r, maskSecret));
    const stationsByRegion = new Map();

    stationRows.forEach(s => {
      const norm = normalizeStation(s);
      if (!stationsByRegion.has(s.region_id)) {
        stationsByRegion.set(s.region_id, []);
      }
      stationsByRegion.get(s.region_id).push(norm);
    });

    regions.forEach(r => {
      r.stations = stationsByRegion.get(r.id) || [];
    });

    return regions;
  }

  static async findById(id, includeSecret = false) {
    await this.ensureTables();
    if (!pool) return null;

    const numId = Number(id);
    if (isNaN(numId)) return null;

    const [regionRows] = await pool.query(`SELECT * FROM ${REGIONS_TABLE} WHERE id = ?`, [numId]);
    if (regionRows.length === 0) return null;

    const region = normalizeRegion(regionRows[0], !includeSecret);
    const [stationRows] = await pool.query(`SELECT * FROM ${STATIONS_TABLE} WHERE region_id = ? ORDER BY station_type ASC`, [numId]);
    region.stations = stationRows.map(normalizeStation);

    return region;
  }

  static async findByCode(code) {
    await this.ensureTables();
    if (!pool || !code) return null;

    const [rows] = await pool.query(`SELECT * FROM ${REGIONS_TABLE} WHERE code = ?`, [String(code).trim().toUpperCase()]);
    if (rows.length === 0) return null;
    return this.findById(rows[0].id, false);
  }

  static async findByStationId(stationId) {
    await this.ensureTables();
    if (!pool || !stationId) return null;

    const [rows] = await pool.query(
      `SELECT s.*, r.id as region_id, r.name as region_name, r.code as region_code, r.aws_region, r.latitude, r.longitude, r.access_key, r.secret_key, r.is_active
       FROM ${STATIONS_TABLE} s
       JOIN ${REGIONS_TABLE} r ON s.region_id = r.id
       WHERE s.station_id = ? AND r.is_active = 1
       LIMIT 1`,
      [String(stationId).trim().toUpperCase()]
    );

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      station: normalizeStation(row),
      region: {
        id: row.region_id,
        name: row.region_name,
        code: row.region_code,
        awsRegion: row.aws_region,
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        accessKey: row.access_key,
        secretKey: row.secret_key ? EncryptionService.decrypt(row.secret_key) : "",
        isActive: Boolean(row.is_active)
      }
    };
  }

  static async create(payload) {
    await this.ensureTables();
    if (!pool) throw new Error("Database pool unavailable");

    const {
      name,
      code,
      awsRegion,
      latitude,
      longitude,
      accessKey,
      secretKey,
      sd1,
      sd2,
      gs1,
      gs2
    } = payload;

    const codeUpper = String(code).trim().toUpperCase();
    const cleanAccessKey = accessKey && String(accessKey).trim() ? String(accessKey).trim() : null;
    const encryptedSecret = secretKey && String(secretKey).trim() && String(secretKey).trim() !== "****************" 
      ? EncryptionService.encrypt(String(secretKey).trim()) 
      : null;

    const [result] = await pool.query(
      `INSERT INTO ${REGIONS_TABLE} (name, code, aws_region, latitude, longitude, access_key, secret_key, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [name.trim(), codeUpper, awsRegion.trim(), Number(latitude), Number(longitude), cleanAccessKey, encryptedSecret]
    );

    const regionId = result.insertId;

    const sd1Config = sd1 || gs1;
    const sd2Config = sd2 || gs2;

    // Insert SD1 if configured
    if (sd1Config && (sd1Config.stationId || sd1Config.ec2SdrInstanceId || sd1Config.sdrInstanceId || sd1Config.ec2ReceiverInstanceId || sd1Config.receiverInstanceId)) {
      const sd1StationId = String(sd1Config.stationId || `${codeUpper}1`).trim().toUpperCase();
      await pool.query(
        `INSERT INTO ${STATIONS_TABLE} (region_id, station_type, station_name, station_id, cloudwatch_namespace, ground_station, receiver, ec2_sdr_instance_id, ec2_receiver_instance_id)
         VALUES (?, 'SD1', ?, ?, ?, ?, ?, ?, ?)`,
        [
          regionId,
          sd1Config.stationName || `${name} SD1`,
          sd1StationId,
          sd1Config.cloudwatchNamespace || "GroundStation/SDR",
          sd1Config.groundStation || "GS-001",
          sd1Config.receiver || "IFR-1",
          sd1Config.ec2SdrInstanceId || sd1Config.sdrInstanceId || null,
          sd1Config.ec2ReceiverInstanceId || sd1Config.receiverInstanceId || null
        ]
      );
    }

    // Insert SD2 if configured
    if (sd2Config && (sd2Config.stationId || sd2Config.ec2SdrInstanceId || sd2Config.sdrInstanceId || sd2Config.ec2ReceiverInstanceId || sd2Config.receiverInstanceId)) {
      const sd2StationId = String(sd2Config.stationId || `${codeUpper}2`).trim().toUpperCase();
      await pool.query(
        `INSERT INTO ${STATIONS_TABLE} (region_id, station_type, station_name, station_id, cloudwatch_namespace, ground_station, receiver, ec2_sdr_instance_id, ec2_receiver_instance_id)
         VALUES (?, 'SD2', ?, ?, ?, ?, ?, ?, ?)`,
        [
          regionId,
          sd2Config.stationName || `${name} SD2`,
          sd2StationId,
          sd2Config.cloudwatchNamespace || "GroundStation/SDR",
          sd2Config.groundStation || "GS-001",
          sd2Config.receiver || "IFR-1",
          sd2Config.ec2SdrInstanceId || sd2Config.sdrInstanceId || null,
          sd2Config.ec2ReceiverInstanceId || sd2Config.receiverInstanceId || null
        ]
      );
    }

    return this.findById(regionId, false);
  }

  static async updateById(id, payload) {
    await this.ensureTables();
    if (!pool) throw new Error("Database pool unavailable");

    const numId = Number(id);
    const existing = await this.findById(numId, true);
    if (!existing) return null;

    const updates = [];
    const values = [];

    if (payload.name !== undefined) {
      updates.push("name = ?");
      values.push(payload.name.trim());
    }
    if (payload.code !== undefined) {
      updates.push("code = ?");
      values.push(String(payload.code).trim().toUpperCase());
    }
    if (payload.awsRegion !== undefined) {
      updates.push("aws_region = ?");
      values.push(payload.awsRegion.trim());
    }
    if (payload.latitude !== undefined) {
      updates.push("latitude = ?");
      values.push(Number(payload.latitude));
    }
    if (payload.longitude !== undefined) {
      updates.push("longitude = ?");
      values.push(Number(payload.longitude));
    }
    if (payload.accessKey !== undefined && payload.accessKey !== "********") {
      updates.push("access_key = ?");
      values.push(payload.accessKey ? payload.accessKey.trim() : null);
    }
    if (payload.secretKey !== undefined && payload.secretKey !== "****************" && payload.secretKey.trim() !== "") {
      updates.push("secret_key = ?");
      values.push(EncryptionService.encrypt(payload.secretKey.trim()));
    }
    if (payload.isActive !== undefined) {
      updates.push("is_active = ?");
      values.push(payload.isActive ? 1 : 0);
    }

    if (updates.length > 0) {
      values.push(numId);
      await pool.query(`UPDATE ${REGIONS_TABLE} SET ${updates.join(", ")} WHERE id = ?`, values);
    }

    // Update SD1 if provided
    const sd1 = payload.sd1 !== undefined ? payload.sd1 : payload.gs1;
    if (sd1 && (sd1.stationId || sd1.ec2SdrInstanceId || sd1.sdrInstanceId || sd1.ec2ReceiverInstanceId || sd1.receiverInstanceId)) {
      const codeUpper = String(payload.code || existing.code).trim().toUpperCase();
      const sd1StationId = String(sd1.stationId || `${codeUpper}1`).trim().toUpperCase();
      const [existingSd1] = await pool.query(`SELECT id FROM ${STATIONS_TABLE} WHERE region_id = ? AND station_type = 'SD1'`, [numId]);
      if (existingSd1.length > 0) {
        await pool.query(
          `UPDATE ${STATIONS_TABLE} 
           SET station_name = ?, station_id = ?, cloudwatch_namespace = ?, ground_station = ?, receiver = ?, ec2_sdr_instance_id = ?, ec2_receiver_instance_id = ?
           WHERE region_id = ? AND station_type = 'SD1'`,
          [
            sd1.stationName || `${payload.name || existing.name} SD1`,
            sd1StationId,
            sd1.cloudwatchNamespace || "GroundStation/SDR",
            sd1.groundStation || "GS-001",
            sd1.receiver || "IFR-1",
            sd1.ec2SdrInstanceId !== undefined ? sd1.ec2SdrInstanceId : (sd1.sdrInstanceId || null),
            sd1.ec2ReceiverInstanceId !== undefined ? sd1.ec2ReceiverInstanceId : (sd1.receiverInstanceId || null),
            numId
          ]
        );
      } else {
        await pool.query(
          `INSERT INTO ${STATIONS_TABLE} (region_id, station_type, station_name, station_id, cloudwatch_namespace, ground_station, receiver, ec2_sdr_instance_id, ec2_receiver_instance_id)
           VALUES (?, 'SD1', ?, ?, ?, ?, ?, ?, ?)`,
          [
            numId,
            sd1.stationName || `${payload.name || existing.name} SD1`,
            sd1StationId,
            sd1.cloudwatchNamespace || "GroundStation/SDR",
            sd1.groundStation || "GS-001",
            sd1.receiver || "IFR-1",
            sd1.ec2SdrInstanceId !== undefined ? sd1.ec2SdrInstanceId : (sd1.sdrInstanceId || null),
            sd1.ec2ReceiverInstanceId !== undefined ? sd1.ec2ReceiverInstanceId : (sd1.receiverInstanceId || null)
          ]
        );
      }
    } else if (payload.sd1 === null || payload.gs1 === null) {
      await pool.query(`DELETE FROM ${STATIONS_TABLE} WHERE region_id = ? AND station_type = 'SD1'`, [numId]);
    }

    // Update SD2 if provided
    const sd2 = payload.sd2 !== undefined ? payload.sd2 : payload.gs2;
    if (sd2 && (sd2.stationId || sd2.ec2SdrInstanceId || sd2.sdrInstanceId || sd2.ec2ReceiverInstanceId || sd2.receiverInstanceId)) {
      const codeUpper = String(payload.code || existing.code).trim().toUpperCase();
      const sd2StationId = String(sd2.stationId || `${codeUpper}2`).trim().toUpperCase();
      const [existingSd2] = await pool.query(`SELECT id FROM ${STATIONS_TABLE} WHERE region_id = ? AND station_type = 'SD2'`, [numId]);
      if (existingSd2.length > 0) {
        await pool.query(
          `UPDATE ${STATIONS_TABLE} 
           SET station_name = ?, station_id = ?, cloudwatch_namespace = ?, ground_station = ?, receiver = ?, ec2_sdr_instance_id = ?, ec2_receiver_instance_id = ?
           WHERE region_id = ? AND station_type = 'SD2'`,
          [
            sd2.stationName || `${payload.name || existing.name} SD2`,
            sd2StationId,
            sd2.cloudwatchNamespace || "GroundStation/SDR",
            sd2.groundStation || "GS-001",
            sd2.receiver || "IFR-1",
            sd2.ec2SdrInstanceId !== undefined ? sd2.ec2SdrInstanceId : (sd2.sdrInstanceId || null),
            sd2.ec2ReceiverInstanceId !== undefined ? sd2.ec2ReceiverInstanceId : (sd2.receiverInstanceId || null),
            numId
          ]
        );
      } else {
        await pool.query(
          `INSERT INTO ${STATIONS_TABLE} (region_id, station_type, station_name, station_id, cloudwatch_namespace, ground_station, receiver, ec2_sdr_instance_id, ec2_receiver_instance_id)
           VALUES (?, 'SD2', ?, ?, ?, ?, ?, ?, ?)`,
          [
            numId,
            sd2.stationName || `${payload.name || existing.name} SD2`,
            sd2StationId,
            sd2.cloudwatchNamespace || "GroundStation/SDR",
            sd2.groundStation || "GS-001",
            sd2.receiver || "IFR-1",
            sd2.ec2SdrInstanceId !== undefined ? sd2.ec2SdrInstanceId : (sd2.sdrInstanceId || null),
            sd2.ec2ReceiverInstanceId !== undefined ? sd2.ec2ReceiverInstanceId : (sd2.receiverInstanceId || null)
          ]
        );
      }
    } else if (payload.sd2 === null || payload.gs2 === null) {
      await pool.query(`DELETE FROM ${STATIONS_TABLE} WHERE region_id = ? AND station_type = 'SD2'`, [numId]);
    }

    return this.findById(numId, false);
  }

  static async toggleActive(id, isActive) {
    await this.ensureTables();
    if (!pool) return false;
    const [result] = await pool.query(`UPDATE ${REGIONS_TABLE} SET is_active = ? WHERE id = ?`, [isActive ? 1 : 0, Number(id)]);
    return result.affectedRows > 0;
  }

  static async deleteById(id, permanent = true) {
    await this.ensureTables();
    if (!pool) return false;
    const numId = Number(id);
    if (isNaN(numId)) return false;

    if (permanent) {
      // Remove associated stations from gs_region_stations
      await pool.query(`DELETE FROM ${STATIONS_TABLE} WHERE region_id = ?`, [numId]);
      // Remove region from gs_regions
      const [result] = await pool.query(`DELETE FROM ${REGIONS_TABLE} WHERE id = ?`, [numId]);
      return result.affectedRows > 0;
    } else {
      return this.toggleActive(id, false);
    }
  }
}

module.exports = RegionModel;
