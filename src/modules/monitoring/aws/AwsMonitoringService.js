// src/modules/monitoring/aws/AwsMonitoringService.js
const { CloudWatchClient, GetMetricDataCommand } = require("@aws-sdk/client-cloudwatch");
const { EC2Client, DescribeInstancesCommand } = require("@aws-sdk/client-ec2");
const AwsConfigHelper = require("./AwsConfigHelper");
const AwsCredentialProfile = require("./AwsCredentialProfile");

class AwsMonitoringService {
  /**
   * Stub for future CloudWatch Alarm integration.
   * Do not implement alarm logic in this phase.
   */
  static async getAlarms(deviceId, profile) {
    return [];
  }

  /**
   * Fetches EC2 metadata and CloudWatch metrics in a single cycle.
   */
  static async pollEC2Metrics(device, profile) {
    if (!profile) {
      if (device.profileId) {
        profile = await AwsCredentialProfile.findById(device.profileId);
      }
      if (!profile) {
        throw new Error("AWS Credential Profile not found for device.");
      }
    }

    // Pass the profile id to getClientConfig, which returns { credentials, region }
    const config = await AwsConfigHelper.getClientConfig(profile.id, device.region);
    const region = config.region;
    const credentials = config.credentials;

    const ec2Client = new EC2Client({ region, credentials });
    const cwClient = new CloudWatchClient({ region, credentials });

    // 1. Fetch EC2 Metadata
    const ec2Command = new DescribeInstancesCommand({
      InstanceIds: [device.instanceId]
    });
    
    let ec2State = "unknown";
    try {
      const ec2Data = await ec2Client.send(ec2Command);
      const instance = ec2Data.Reservations?.[0]?.Instances?.[0];
      if (instance && instance.State) {
        ec2State = instance.State.Name; // "running", "stopped", etc.
      }
    } catch (err) {
      console.warn(`[AwsMonitoringService] Failed to fetch EC2 state for ${device.instanceId}:`, err.message);
    }

    // 2. Fetch CloudWatch Metrics using GetMetricData
    // We poll the last 15 minutes, with a period of 5 minutes (300s)
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 15 * 60 * 1000);

    // Helper to build a metric query
    const buildQuery = (id, metricName, stat, namespace = "AWS/EC2", unit = undefined) => ({
      Id: id,
      MetricStat: {
        Metric: {
          Namespace: namespace,
          MetricName: metricName,
          Dimensions: [{ Name: "InstanceId", Value: device.instanceId }]
        },
        Period: 300,
        Stat: stat,
        ...(unit ? { Unit: unit } : {})
      },
      ReturnData: true
    });

    const metricQueries = [
      buildQuery("cpu", "CPUUtilization", "Average", "AWS/EC2", "Percent"),
      buildQuery("net_in", "NetworkIn", "Sum", "AWS/EC2", "Bytes"),
      buildQuery("net_out", "NetworkOut", "Sum", "AWS/EC2", "Bytes"),
      buildQuery("net_pkts_in", "NetworkPacketsIn", "Sum", "AWS/EC2", "Count"),
      buildQuery("net_pkts_out", "NetworkPacketsOut", "Sum", "AWS/EC2", "Count"),
      buildQuery("disk_read_ops", "DiskReadOps", "Sum", "AWS/EBS", "Count"),
      buildQuery("disk_write_ops", "DiskWriteOps", "Sum", "AWS/EBS", "Count"),
      buildQuery("disk_read_bytes", "DiskReadBytes", "Sum", "AWS/EBS", "Bytes"),
      buildQuery("disk_write_bytes", "DiskWriteBytes", "Sum", "AWS/EBS", "Bytes"),
      buildQuery("status_failed", "StatusCheckFailed", "Maximum", "AWS/EC2", "Count"),
      buildQuery("status_failed_inst", "StatusCheckFailed_Instance", "Maximum", "AWS/EC2", "Count"),
      buildQuery("status_failed_sys", "StatusCheckFailed_System", "Maximum", "AWS/EC2", "Count"),
      buildQuery("cpu_credit_usage", "CPUCreditUsage", "Average", "AWS/EC2", "Count"),
      buildQuery("cpu_credit_balance", "CPUCreditBalance", "Average", "AWS/EC2", "Count"),
      buildQuery("metadata_no_token", "MetadataNoToken", "Sum", "AWS/EC2", "Count")
    ];

    const cwCommand = new GetMetricDataCommand({
      MetricDataQueries: metricQueries,
      StartTime: startTime,
      EndTime: endTime,
    });

    let cwData = null;
    let agentDetected = false;

    try {
      cwData = await cwClient.send(cwCommand);
      
      // Optionally check for CloudWatch agent metrics (CWAgent namespace)
      // This could be done by querying CWAgent metrics. For now, we assume agent isn't available
      // unless we successfully query a CWAgent metric, but to avoid 2 calls, we can check 
      // if metadata or a previous poll discovered it. We will leave agentDetected = false.
    } catch (err) {
      console.warn(`[AwsMonitoringService] Failed to fetch CloudWatch metrics for ${device.instanceId}:`, err.message);
    }

    // 3. Process CW Data into standard telemetry array
    const telemetry = [];
    let statusCheckFailed = 0;

    if (cwData && cwData.MetricDataResults) {
      cwData.MetricDataResults.forEach(result => {
        if (result.Values && result.Values.length > 0) {
          // Values are ordered chronologically depending on ScanBy, default is Timestamp descending (latest first)
          // We take the first value which is the most recent
          const latestValue = result.Values[0];
          
          let metricName = "";
          let unit = "";
          
          switch (result.Id) {
            case "cpu": metricName = "CPUUtilization"; unit = "%"; break;
            case "net_in": metricName = "NetworkIn"; unit = "Bytes"; break;
            case "net_out": metricName = "NetworkOut"; unit = "Bytes"; break;
            case "net_pkts_in": metricName = "NetworkPacketsIn"; unit = "Count"; break;
            case "net_pkts_out": metricName = "NetworkPacketsOut"; unit = "Count"; break;
            case "disk_read_ops": metricName = "DiskReadOps"; unit = "Count"; break;
            case "disk_write_ops": metricName = "DiskWriteOps"; unit = "Count"; break;
            case "disk_read_bytes": metricName = "DiskReadBytes"; unit = "Bytes"; break;
            case "disk_write_bytes": metricName = "DiskWriteBytes"; unit = "Bytes"; break;
            case "status_failed": 
              metricName = "StatusCheckFailed"; 
              unit = "Count"; 
              statusCheckFailed = latestValue;
              break;
            case "status_failed_inst": metricName = "StatusCheckFailed_Instance"; unit = "Count"; break;
            case "status_failed_sys": metricName = "StatusCheckFailed_System"; unit = "Count"; break;
            case "cpu_credit_usage": metricName = "CPUCreditUsage"; unit = "Count"; break;
            case "cpu_credit_balance": metricName = "CPUCreditBalance"; unit = "Count"; break;
            case "metadata_no_token": metricName = "MetadataNoToken"; unit = "Count"; break;
          }
          
          if (metricName) {
            telemetry.push({
              metricName: metricName,
              convertedValue: latestValue,
              unit: unit,
            });
          }
        }
      });
    }

    return {
      ec2State,
      telemetry,
      statusCheckFailed,
      agentDetected
    };
  }
}

module.exports = AwsMonitoringService;
