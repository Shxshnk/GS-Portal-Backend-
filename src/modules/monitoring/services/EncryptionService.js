// src/modules/monitoring/services/EncryptionService.js
const crypto = require("crypto");

const ALGORITHM = "aes-256-cbc";
const DEFAULT_KEY = "monitoring_secret_key_default_32"; // Fallback key

function getEncryptionKey() {
  const envKey = process.env.ENCRYPTION_KEY || DEFAULT_KEY;
  // Derive a solid 32-byte key from whatever passphrase is provided
  return crypto.createHash("sha256").update(envKey).digest();
}

class EncryptionService {
  /**
   * Encrypts a plaintext string.
   * @param {string} text
   * @returns {string} iv:ciphertext format
   */
  static encrypt(text) {
    if (!text) return "";
    try {
      const iv = crypto.randomBytes(16);
      const key = getEncryptionKey();
      const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
      let encrypted = cipher.update(text, "utf8", "hex");
      encrypted += cipher.final("hex");
      return iv.toString("hex") + ":" + encrypted;
    } catch (err) {
      console.error("[monitoring] encryption error:", err);
      return "";
    }
  }

  /**
   * Decrypts a ciphertext string.
   * @param {string} encryptedText iv:ciphertext format
   * @returns {string} plaintext
   */
  static decrypt(encryptedText) {
    if (!encryptedText) return "";
    try {
      const parts = encryptedText.split(":");
      if (parts.length !== 2) {
        // Return as-is if it's not in iv:ciphertext format (backward compatibility)
        return encryptedText;
      }
      const iv = Buffer.from(parts[0], "hex");
      const encrypted = parts[1];
      const key = getEncryptionKey();
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      let decrypted = decipher.update(encrypted, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return decrypted;
    } catch (err) {
      console.error("[monitoring] decryption error:", err);
      return "";
    }
  }
}

module.exports = EncryptionService;
