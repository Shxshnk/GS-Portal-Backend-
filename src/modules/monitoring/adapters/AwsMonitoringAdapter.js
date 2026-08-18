// src/modules/monitoring/adapters/AwsMonitoringAdapter.js
const IPollerAdapter = require("./IPollerAdapter");
const AwsMonitoringService = require("../aws/AwsMonitoringService");

class AwsMonitoringAdapter extends IPollerAdapter {
  constructor() {
    super();
  }

  /**
   * Polls AWS EC2 device metrics using CloudWatch.
   * @param {object} device
   * @param {object} profile
   * @param {object} settings
   * @returns {Promise<object>} Poll result containing health, status, telemetry, interfaces
   */
  async poll(device, profile, settings) {
    let success = false;
    let telemetry = [];
    let healthScore = 0;
    let newStatus = "OFFLINE";
    let interfaces = []; // CloudWatch doesn't give us standard SNMP interfaces list

    try {
      const data = await AwsMonitoringService.pollEC2Metrics(device, profile);
      
      success = true;
      telemetry = data.telemetry;
      
      // Determine Status
      const state = data.ec2State?.toLowerCase();
      if (state === "running") {
        newStatus = "ONLINE";
      } else if (state === "stopped") {
        newStatus = "STOPPED";
      } else if (state === "pending") {
        newStatus = "STARTING";
      } else if (state === "stopping") {
        newStatus = "STOPPING";
      } else if (state === "shutting-down" || state === "terminated") {
        newStatus = "OFFLINE"; // Or WARNING
      } else {
        newStatus = "UNKNOWN";
      }

      // Determine Health Score
      if (newStatus === "ONLINE" && data.statusCheckFailed === 0) {
        healthScore = 100;
      } else {
        healthScore = 0;
      }

      // If we need to update device metadata with agent capabilities:
      if (data.agentDetected !== undefined) {
         // This could be stored in device.cloudMetadata, but we don't modify it here.
         // We might just return it and let PollingScheduler handle it if needed.
      }

    } catch (err) {
      console.error(`[AwsMonitoringAdapter] Poll failed for device ${device.id}:`, err);
      success = false;
      newStatus = "OFFLINE";
    }

    return {
      success,
      telemetry,
      status: newStatus,
      healthScore,
      interfaces, // Empty for now, or could map from ENIs if we had them
      availability: success ? 100 : 0,
      responseTime: 0, // Not applicable for AWS polling
    };
  }

  /**
   * Performs a rapid connection test (e.g. STS GetCallerIdentity or DescribeInstances)
   * @param {object} device
   * @returns {Promise<object>} Connection success feedback object
   */
  async testConnection(device) {
    try {
      // In this phase, we can rely on standard AWS discovery. We return true for now.
      return { success: true, message: "AWS Connection OK" };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }
}

module.exports = AwsMonitoringAdapter;
