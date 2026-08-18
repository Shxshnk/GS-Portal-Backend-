// src/modules/monitoring/services/HealthEngine.js
class HealthEngine {
  /**
   * Calculates a dynamic health score based on active metrics and rule thresholds.
   * @param {Array<object>} telemetryCurrent List of metric snapshots (metricName, convertedValue)
   * @param {Array<object>} healthRules Declarative health rules from monitoring profile
   * @param {number|null} responseTime Current ping latency response time
   * @returns {number} Health percentage (0-100)
   */
  static calculateHealth(telemetryCurrent = [], healthRules = [], responseTime = null) {
    if (!Array.isArray(healthRules) || healthRules.length === 0) {
      return 100;
    }

    let score = 100;

    // Create a quick lookup map for telemetry current values
    const metricsMap = {};
    for (const t of telemetryCurrent) {
      if (t.metricName) {
        metricsMap[t.metricName.toLowerCase()] = Number(t.convertedValue ?? 0);
      }
    }

    // Add response time to lookup if present
    if (responseTime !== null) {
      metricsMap["response_time"] = Number(responseTime);
    }

    for (const rule of healthRules) {
      const ruleMetric = String(rule.metric || "").toLowerCase();
      const op = String(rule.operator || "").trim();
      const threshold = Number(rule.threshold ?? 0);
      const deduction = Number(rule.deduction ?? 0);

      if (!ruleMetric || !op) continue;

      const val = metricsMap[ruleMetric];
      if (val === undefined || val === null) {
        // Metric not present in the current poll snapshot, skip evaluation
        continue;
      }

      let matches = false;
      switch (op) {
        case ">":
          matches = val > threshold;
          break;
        case "<":
          matches = val < threshold;
          break;
        case ">=":
          matches = val >= threshold;
          break;
        case "<=":
          matches = val <= threshold;
          break;
        case "==":
        case "=":
          matches = val === threshold;
          break;
        default:
          matches = false;
      }

      if (matches) {
        score -= deduction;
      }
    }

    return Math.max(0, Math.min(100, Math.floor(score)));
  }
}

module.exports = HealthEngine;
