// src/modules/monitoring/adapters/IPollerAdapter.js
class IPollerAdapter {
  /**
   * Factory method to load concrete adapters based on protocol string.
   * @param {string} protocol
   * @returns {IPollerAdapter}
   */
  static getAdapter(protocol) {
    const key = String(protocol || "snmp").trim().toLowerCase();
    
    if (key === "aws") {
      const AwsMonitoringAdapter = require("./AwsMonitoringAdapter");
      return new AwsMonitoringAdapter();
    }
    
    // Future plugins:
    // if (key === "safran") return new SafranPollerAdapter();
    // if (key === "rf") return new RfPollerAdapter();
    
    const SnmpPollerAdapter = require("./SnmpPollerAdapter");
    return new SnmpPollerAdapter();
  }

  /**
   * Polls device metrics using the assigned profile parameters.
   * @param {object} device
   * @param {object} profile
   * @param {object} settings
   * @returns {Promise<object>} Poll result containing health, status, telemetry, interfaces
   */
  async poll(device, profile, settings) {
    throw new Error("Method poll() must be implemented by concrete adapters.");
  }

  /**
   * Performs a rapid ping or sysName query to check connection availability.
   * @param {object} device
   * @returns {Promise<object>} Connection success feedback object
   */
  async testConnection(device) {
    throw new Error("Method testConnection() must be implemented by concrete adapters.");
  }
}

module.exports = IPollerAdapter;
