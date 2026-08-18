// src/modules/monitoring/services/TelemetryService.js
const TelemetryCurrent = require("../models/TelemetryCurrent");
const TelemetryHistory = require("../models/TelemetryHistory");

class TelemetryService {
  /**
   * Records a set of telemetry metrics.
   * Pushes snapshots to current metrics and appends entries to time-series history logs.
   * @param {number} deviceId
   * @param {Array<object>} metrics List of metric objects
   * @param {string} source SNMP, Safran, RF, etc.
   * @param {string} collectionMode POLLING, TRAP, PUSH
   */
  static async recordTelemetry(deviceId, metrics = [], source = "SNMP", collectionMode = "POLLING") {
    if (!Array.isArray(metrics) || metrics.length === 0) return;

    for (const m of metrics) {
      const payload = {
        deviceId,
        metricName: m.metricName,
        oid: m.oid || null,
        rawValue: m.rawValue !== undefined ? String(m.rawValue) : null,
        convertedValue: m.convertedValue ?? null,
        unit: m.unit || null,
        source,
        collectionMode,
      };

      try {
        // 1. Update current status snapshot
        await TelemetryCurrent.upsert(payload);

        // 2. Append history log
        await TelemetryHistory.insert(payload);
      } catch (err) {
        console.error(`[monitoring] error recording telemetry for device ${deviceId}, metric ${m.metricName}:`, err);
      }
    }
  }

  static async getLiveMetrics(deviceId) {
    return TelemetryCurrent.listByDeviceId(deviceId);
  }

  static async getHistoricalMetrics(deviceId, metricName, options = {}) {
    // Backwards compatibility for callers passing limitHours as a number
    if (typeof options === "number") {
      options = { limitHours: options };
    }
    return TelemetryHistory.queryHistory(deviceId, metricName, options);
  }

  static async prune(retentionDays) {
    await TelemetryHistory.pruneOldData(retentionDays);
  }
}

module.exports = TelemetryService;
