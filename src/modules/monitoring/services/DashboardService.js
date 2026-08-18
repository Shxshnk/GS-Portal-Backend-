// src/modules/monitoring/services/DashboardService.js
const MonitoringDevice = require("../models/MonitoringDevice");
const TelemetryHistory = require("../models/TelemetryHistory");

class DashboardService {
  /**
   * Generates a unified dashboard payload for a specific device.
   * Handles querying multiple telemetry metrics simultaneously.
   */
  static async getDashboardPayload(deviceId, startTime, endTime) {
    const device = await MonitoringDevice.findById(deviceId);
    if (!device) {
      throw new Error("Device not found");
    }

    const options = { startTime, endTime };
    
    // Summary
    const summary = {
      deviceId: device.id,
      instanceName: device.instanceName || device.deviceName,
      instanceId: device.instanceId,
      provider: device.provider,
      state: device.state || "unknown",
      health: device.healthScore ?? 100,
      availability: device.availability ?? 100,
      region: device.region,
      availabilityZone: device.availabilityZone,
      instanceType: device.instanceType,
      monitoring: device.cloudMetadata?.Monitoring?.State === 'enabled' ? 'Detailed' : 'Standard',
      lastUpdated: new Date().toISOString()
    };

    const metricsToFetch = [
      "CPUUtilization", 
      "NetworkIn", "NetworkOut", 
      "NetworkPacketsIn", "NetworkPacketsOut",
      "DiskReadOps", "DiskWriteOps", 
      "DiskReadBytes", "DiskWriteBytes",
      "CPUCreditUsage", "CPUCreditBalance",
      "StatusCheckFailed", "StatusCheckFailed_Instance", "StatusCheckFailed_System",
      "MetadataNoToken"
    ];

    // Optimize DB query: fetch all required metrics in a single pass
    const allTelemetry = await TelemetryHistory.queryHistoryForMetrics(deviceId, metricsToFetch, options);
    
    // Group telemetry by metric
    const groupedTelemetry = {};
    metricsToFetch.forEach(m => groupedTelemetry[m] = []);
    allTelemetry.forEach(t => {
      if (groupedTelemetry[t.metricName]) {
        groupedTelemetry[t.metricName].push(t);
      }
    });

    const mapMetric = (metricName) => {
      return groupedTelemetry[metricName].map(t => ({
        timestamp: t.timestamp,
        value: t.convertedValue ?? Number(t.rawValue) ?? 0
      }));
    };

    const charts = {
      cpu: mapMetric("CPUUtilization"),
      networkIn: mapMetric("NetworkIn"),
      networkOut: mapMetric("NetworkOut"),
      networkPacketsIn: mapMetric("NetworkPacketsIn"),
      networkPacketsOut: mapMetric("NetworkPacketsOut"),
      diskReadOps: mapMetric("DiskReadOps"),
      diskWriteOps: mapMetric("DiskWriteOps"),
      diskReadBytes: mapMetric("DiskReadBytes"),
      diskWriteBytes: mapMetric("DiskWriteBytes"),
      cpuCreditUsage: mapMetric("CPUCreditUsage"),
      cpuCreditBalance: mapMetric("CPUCreditBalance"),
      statusChecks: mapMetric("StatusCheckFailed"),
      metadataNoToken: mapMetric("MetadataNoToken")
    };

    const extractLatest = (metricArr) => {
      if (!metricArr || metricArr.length === 0) return null;
      return metricArr[metricArr.length - 1].value;
    };

    const latest = {
      cpu: extractLatest(charts.cpu),
      networkIn: extractLatest(charts.networkIn),
      networkOut: extractLatest(charts.networkOut),
      diskReadOps: extractLatest(charts.diskReadOps),
      diskWriteOps: extractLatest(charts.diskWriteOps),
      status: extractLatest(charts.statusChecks)
    };

    // Capabilities
    const capabilities = {
      memorySupported: false, // Will be implemented in Phase 3 or when CW Agent is detected
      diskUsageSupported: false
    };

    return {
      summary,
      charts,
      latest,
      capabilities
    };
  }
}

module.exports = DashboardService;
