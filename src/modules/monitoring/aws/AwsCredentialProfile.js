const { pool } = require("../../../db");

const TABLE_NAME = "aws_credential_profiles";

function normalizeProfile(row, maskSecret = true) {
  if (!row) return null;
  return {
    id: row.id,
    profileName: row.profile_name,
    accessKey: row.access_key,
    secretKey: maskSecret ? "****************" : row.secret_key,
    region: row.region,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class AwsCredentialProfile {
  static async ensureTable() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        profile_name VARCHAR(255) NOT NULL,
        access_key VARCHAR(255) NOT NULL,
        secret_key VARCHAR(255) NOT NULL,
        region VARCHAR(100) NOT NULL,
        description TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_aws_profiles_name (profile_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Ensure description column exists for existing tables
    const [columns] = await pool.query(`DESCRIBE ${TABLE_NAME}`);
    const fields = new Set(columns.map(c => c.Field.toLowerCase()));
    if (!fields.has("description")) {
      await pool.query(`ALTER TABLE ${TABLE_NAME} ADD COLUMN description TEXT NULL`);
    }
  }

  static async create(payload) {
    const values = [
      payload.profileName,
      payload.accessKey,
      payload.secretKey,
      payload.region || "us-east-1",
      payload.description || null,
    ];

    const [result] = await pool.query(
      `INSERT INTO ${TABLE_NAME} (profile_name, access_key, secret_key, region, description)
       VALUES (?, ?, ?, ?, ?)`,
      values
    );

    return this.findById(result.insertId);
  }

  static async updateById(id, payload) {
    const updates = [];
    const values = [];

    const mapField = (field, key) => {
      if (payload[field] !== undefined) {
        updates.push(`${key} = ?`);
        values.push(payload[field]);
      }
    };

    mapField("profileName", "profile_name");
    mapField("accessKey", "access_key");
    mapField("secretKey", "secret_key");
    mapField("region", "region");
    mapField("description", "description");

    if (!updates.length) return this.findById(id);

    values.push(Number(id));
    const [result] = await pool.query(
      `UPDATE ${TABLE_NAME} SET ${updates.join(", ")} WHERE id = ?`,
      values
    );

    if (result.affectedRows === 0) return null;
    return this.findById(id);
  }

  static async deleteById(id) {
    const [result] = await pool.query(`DELETE FROM ${TABLE_NAME} WHERE id = ?`, [Number(id)]);
    return result.affectedRows > 0;
  }

  static async findById(id, includeSecret = false) {
    const numId = Number(id);
    if (isNaN(numId)) return null;
    const [rows] = await pool.query(`SELECT * FROM ${TABLE_NAME} WHERE id = ?`, [numId]);
    return normalizeProfile(rows[0], !includeSecret);
  }

  static async list() {
    const [rows] = await pool.query(`SELECT * FROM ${TABLE_NAME} ORDER BY profile_name ASC`);
    return rows.map(row => normalizeProfile(row, true));
  }
}

module.exports = AwsCredentialProfile;
