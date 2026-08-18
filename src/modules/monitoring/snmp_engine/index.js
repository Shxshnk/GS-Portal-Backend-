// src/modules/monitoring/snmp_engine/index.js
const snmp = require("net-snmp");

const SYSTEM_OIDS = {
  sysName: "1.3.6.1.2.1.1.5.0",
  sysDescr: "1.3.6.1.2.1.1.1.0",
  sysObjectID: "1.3.6.1.2.1.1.2.0",
  sysUpTime: "1.3.6.1.2.1.1.3.0",
};

class SnmpEngine {
  constructor(options = {}) {
    this.timeout = Number(options.timeout || 2500);
    this.retries = Number(options.retries || 1);
  }

  _createSession(host, port, version, credentials) {
    const protocolVersion = String(version || "v2c").replace(/^v/i, "").toLowerCase();
    
    if (protocolVersion === "3") {
      const user = {
        name: credentials.username || "",
        level: snmp.SecurityLevel[credentials.securityLevel] || snmp.SecurityLevel.noAuthNoPriv,
        authProtocol: snmp.AuthProtocols[credentials.authProtocol] || snmp.AuthProtocols.sha,
        authKey: credentials.authPassword || "",
        privProtocol: snmp.PrivProtocols[credentials.privProtocol] || snmp.PrivProtocols.des,
        privKey: credentials.privPassword || ""
      };
      
      const options = {
        port: Number(port || 161),
        retries: this.retries,
        timeout: this.timeout,
      };
      
      if (credentials.contextName) options.context = credentials.contextName;
      if (credentials.engineId) options.engineID = credentials.engineId;
      
      return snmp.createV3Session(host, user, options);
    } else {
      const options = {
        port: Number(port || 161),
        retries: this.retries,
        timeout: this.timeout,
        version: protocolVersion === "1" ? snmp.Version1 : snmp.Version2c
      };
      return snmp.createSession(host, credentials.community || "public", options);
    }
  }

  _parseVarbinds(varbinds) {
    const values = {};
    for (let i = 0; i < varbinds.length; i++) {
      if (snmp.isVarbindError(varbinds[i])) continue;
      const rawOid = varbinds[i].oid;
      const oid = Array.isArray(rawOid) ? rawOid.join(".") : String(rawOid);
      let value = varbinds[i].value;
      if (Buffer.isBuffer(value)) value = value.toString("utf8");
      values[oid] = value;
    }
    return values;
  }

  async get({ host, port, version, credentials, oid }) {
    const result = await this.getMany({ host, port, version, credentials, oids: [oid] });
    if (!result.success) return { success: false, error: result.error };
    return {
      success: true,
      oid,
      value: result.values?.[oid] ?? null,
      output: "",
    };
  }

  async getMany({ host, port, version, credentials, oids }) {
    return new Promise((resolve) => {
      const session = this._createSession(host, port, version, credentials);
      session.get(oids, (error, varbinds) => {
        if (error) {
          session.close();
          return resolve({ success: false, error: error.message });
        }
        const values = this._parseVarbinds(varbinds);
        session.close();
        resolve({ success: true, values, output: "" });
      });
    });
  }

  async getNext({ host, port, version, credentials, oid }) {
    return new Promise((resolve) => {
      const session = this._createSession(host, port, version, credentials);
      session.getNext([oid], (error, varbinds) => {
        if (error) {
          session.close();
          return resolve({ success: false, error: error.message });
        }
        const values = this._parseVarbinds(varbinds);
        session.close();
        resolve({ success: true, values, output: "" });
      });
    });
  }

  async getBulk({ host, port, version, credentials, nonRepeaters = 0, maxRepetitions = 20, oids }) {
    return new Promise((resolve) => {
      const session = this._createSession(host, port, version, credentials);
      session.getBulk(nonRepeaters, maxRepetitions, oids, (error, varbinds) => {
        if (error) {
          session.close();
          return resolve({ success: false, error: error.message });
        }
        const values = this._parseVarbinds(varbinds);
        session.close();
        resolve({ success: true, values, output: "" });
      });
    });
  }

  async walk({ host, port, version, credentials, oid }) {
    return new Promise((resolve) => {
      const session = this._createSession(host, port, version, credentials);
      const values = {};
      
      const feedCb = (varbinds) => {
        const parsed = this._parseVarbinds(varbinds);
        Object.assign(values, parsed);
      };
      
      const doneCb = (error) => {
        session.close();
        if (error) {
          return resolve({ success: false, error: error.message });
        }
        resolve({ success: true, values, output: "" });
      };
      
      session.walk(oid, 20, feedCb, doneCb);
    });
  }

  async set({ host, port, version, credentials, oid, type, value }) {
    return new Promise((resolve) => {
      const session = this._createSession(host, port, version, credentials);
      let snmpType = snmp.ObjectType.OctetString;
      if (type === "i" || type === "INTEGER") snmpType = snmp.ObjectType.Integer;
      
      const varbinds = [{ oid, type: snmpType, value }];
      
      session.set(varbinds, (error, varbindsResult) => {
        if (error) {
          session.close();
          return resolve({ success: false, error: error.message });
        }
        const values = this._parseVarbinds(varbindsResult);
        session.close();
        resolve({ success: true, values, output: "" });
      });
    });
  }
}

module.exports = SnmpEngine;
module.exports.SnmpEngine = SnmpEngine;
module.exports.SYSTEM_OIDS = SYSTEM_OIDS;
