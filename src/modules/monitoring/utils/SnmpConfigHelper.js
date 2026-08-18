const EncryptionService = require('../services/EncryptionService');

class SnmpConfigHelper {
  /**
   * Resolves a unified SNMP configuration object from various sources.
   * Handles Discovery payload, MonitoringDevice database row, and Test Connection payload.
   * 
   * @param {Object} source - The configuration source object
   * @param {Object} [settings] - Optional global settings fallbacks
   * @returns {Object} { host, port, version, credentials, timeout, retries }
   */
  static resolveConfig(source, settings = {}) {
    const host = source.ipAddress || source.host || "";
    const version = source.snmpVersion || source.version || "v2c";
    
    // Resolve timing parameters with cascading fallbacks
    const timeout = Number(
      source.timeout ?? 
      source.credentials?.timeout ?? 
      settings.default_timeout ?? 
      1000
    );
    
    const retries = Number(
      source.retries ?? 
      source.credentials?.retries ?? 
      settings.default_retries ?? 
      1
    );

    // Resolve port
    const port = Number(
      source.port ?? 
      source.credentials?.port ?? 
      161
    );

    // Resolve and decrypt credentials
    let credentials = {};
    const rawCreds = source.credentials || {};

    if (version !== "v3" && version !== "3") {
      credentials = { 
        community: rawCreds.community || source.community || "public" 
      };
    } else {
      // For v3, handle potential payload from discovery config directly or nested credentials object
      credentials = {
        username: rawCreds.username || source.v3Username || "",
        securityLevel: rawCreds.securityLevel || source.v3SecurityLevel || "noAuthNoPriv",
        authProtocol: rawCreds.authProtocol || source.v3AuthProtocol || "MD5",
        authPassword: this._decryptIfNeeded(rawCreds.authPassword || source.v3AuthPassword),
        privProtocol: rawCreds.privProtocol || source.v3PrivProtocol || "DES",
        privPassword: this._decryptIfNeeded(rawCreds.privPassword || source.v3PrivPassword),
        contextName: rawCreds.contextName || source.v3ContextName || "",
        engineId: rawCreds.engineId || source.v3EngineId || "",
      };
    }

    return {
      host,
      port,
      version,
      credentials,
      timeout,
      retries
    };
  }

  static _decryptIfNeeded(password) {
    if (!password) return "";
    // Extremely basic check to see if it's already an encrypted hex payload from DB
    // Usually it looks like IV:EncryptedPayload. 
    // In our system EncryptionService handles failures gracefully or returns raw.
    try {
      // If it fails to decrypt (e.g. raw password from UI), EncryptionService will throw or return malformed
      // We assume UI inputs are plaintext, while DB inputs are encrypted.
      // If we are in the helper, we should try decrypting it.
      return EncryptionService.decrypt(password);
    } catch (e) {
      // If decryption fails, it's likely plaintext from UI
      return password;
    }
  }
}

module.exports = SnmpConfigHelper;
