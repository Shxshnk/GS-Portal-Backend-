require("dotenv").config();
const { CloudWatchClient, GetMetricDataCommand } = require("@aws-sdk/client-cloudwatch");
const AwsConfigHelper = require("./src/modules/monitoring/aws/AwsConfigHelper");

(async () => {
  const config = await AwsConfigHelper.getClientConfig(null, "af-south-1");
  const cw = new CloudWatchClient(config);
  const now = new Date();
  const startTime = new Date(now.getTime() - 5 * 60000); 
  
  const command = new GetMetricDataCommand({
    StartTime: startTime,
    EndTime: now,
    MetricDataQueries: [{
      Id: "test10s",
      MetricStat: {
        Metric: { Namespace: "GroundStation/SDR", MetricName: "EbNo", Dimensions: [{Name:"GroundStation",Value:"GS-001"},{Name:"Region",Value:"Africa"},{Name:"Receiver",Value:"IFR-1"}] },
        Period: 10,
        Stat: "Average"
      },
      ReturnData: true
    }],
    ScanBy: "TimestampDescending"
  });
  const res = await cw.send(command);
  console.log(res.MetricDataResults[0].Timestamps.length);
  console.log(res.MetricDataResults[0].Timestamps.slice(0, 5));
})();
