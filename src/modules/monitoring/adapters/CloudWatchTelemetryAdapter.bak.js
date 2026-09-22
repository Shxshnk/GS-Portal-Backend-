const { CloudWatchClient, GetMetricDataCommand } = require("@aws-sdk/client-cloudwatch");
const AwsConfigHelper = require("../aws/AwsConfigHelper");
const AwsCredentialProfile = require("../aws/AwsCredentialProfile");

class CloudWatchTelemetryAdapter {
  constructor() {
    this.cache = new Map();
    this.CACHE_TTL_MS = 5000;
    this.client = null;
  }

  async _getClient(region) {
    if (!this.client) {
      try {
        // Pass null for profileId to let AwsConfigHelper resolve via AWS_PROFILE or env vars
        const config = await AwsConfigHelper.getClientConfig(null, region);
        this.client = new CloudWatchClient(config);
        
        let credSource = "Default Provider Chain / IAM";
        if (process.env.AWS_PROFILE) credSource = `AWS_PROFILE (${process.env.AWS_PROFILE})`;
        else if (process.env.AWS_ACCESS_KEY_ID) credSource = "AWS_ACCESS_KEY_ID (.env)";
        
        console.log(`[CloudWatchTelemetryAdapter] Initialized CloudWatchClient via: ${credSource}`);
      } catch (err) {
        console.log("[CloudWatchTelemetryAdapter] Falling back to default AWS credentials (IAM role). Reason:", err.message);
        this.client = new CloudWatchClient({ region });
      }
    }
    return this.client;
  }

  async getTelemetryForStation(stationId, config, timeRangeStr = "15m") {
    if (!config || !config.cloudWatch) {
      return this._emptyTelemetry();
    }

    // Determine Minutes and Period based on requested timeRange
    // If high-resolution is requested (e.g. 10s, 1m, 2m, 5m), we can use Period: 10
    let timeRangeMinutes = 15;
    let period = 60;

    if (timeRangeStr === "10s") {
       timeRangeMinutes = 1/6; // 10 seconds (for StartTime bounding)
       period = 10;
    } else if (timeRangeStr === "1m") {
       timeRangeMinutes = 1;
       period = 10;
    } else if (timeRangeStr === "2m") {
       timeRangeMinutes = 2;
       period = 10;
    } else if (timeRangeStr === "5m") {
       timeRangeMinutes = 5;
       period = 10;
    } else if (timeRangeStr === "15m") {
       timeRangeMinutes = 15;
       period = 10;
    }

    // Cache key must include the timeRange so if they switch ranges, it fetches fresh
    const cacheKey = `${stationId}-${timeRangeStr}`;
    const cached = this.cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < this.CACHE_TTL_MS)) {
      return cached.data;
    }

    try {
        MetricDataQueries: metricDataQueries,
        ScanBy: "TimestampDescending"
      });

      console.log(`[CloudWatchTelemetryAdapter] Querying Station: ${stationId}`);
      console.log(`[CloudWatchTelemetryAdapter] StartTime: ${startTime.toISOString()}, EndTime: ${now.toISOString()}`);
      console.log(`[CloudWatchTelemetryAdapter] Namespace: ${namespace}, Dimensions:`, JSON.stringify(awsDimensions));

      const response = await client.send(command);
      
      const emptyResult = this._emptyTelemetry();
      const telemetry = emptyResult.telemetry;
      let latestTimestamp = 0;
      
      const timelineMap = new Map();
      const FRESHNESS_THRESHOLD_MS = 5 * 60000;

      if (response.MetricDataResults) {
        console.log(`[CloudWatchTelemetryAdapter] Received ${response.MetricDataResults.length} metrics for ${stationId}`);
        response.MetricDataResults.forEach(res => {
          const metricId = metrics.find(m => m.id.toLowerCase() === res.Id.toLowerCase())?.id;
          if (!metricId) return;

          console.log(`[CloudWatchTelemetryAdapter] Metric: ${res.Id} | Datapoints returned: ${res.Values ? res.Values.length : 0}`);

          if (res.Values && res.Values.length > 0 && res.Timestamps && res.Timestamps.length > 0) {
            
            for (let i = 0; i < res.Values.length; i++) {
              let val = res.Values[i];
              let ts = new Date(res.Timestamps[i]).getTime();
              
              if (val === -128) {
                console.log(`[CloudWatchTelemetryAdapter] Filtered sentinel -128 for ${res.Id} at ${new Date(ts).toISOString()}`);
                continue;
              }

              if (!timelineMap.has(ts)) {
                timelineMap.set(ts, { timestamp: new Date(ts).toISOString() });
              }
              timelineMap.get(ts)[metricId] = val;
            }
          }
        });
      }

      const sortedTimeline = Array.from(timelineMap.values()).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      let dataState = "NO_DATA";
      let latestIsoTimestamp = null;
      
      if (sortedTimeline.length > 0) {
        const newestPoint = sortedTimeline[0];
        latestTimestamp = new Date(newestPoint.timestamp).getTime();
        latestIsoTimestamp = newestPoint.timestamp;

        console.log(`[CloudWatchTelemetryAdapter] Newest Timestamp: ${latestIsoTimestamp}`);

        if (now.getTime() - latestTimestamp < FRESHNESS_THRESHOLD_MS) {
          dataState = "LIVE";
          metrics.forEach(m => {
            const latestPointWithMetric = sortedTimeline.find(pt => pt[m.id] !== undefined);
            telemetry[m.id] = latestPointWithMetric ? latestPointWithMetric[m.id] : null;
            if (latestPointWithMetric) {
              console.log(`[CloudWatchTelemetryAdapter] ${m.id} | Normalized Value: ${telemetry[m.id]}`);
            }
          });
        } else {
          dataState = "STALE";
          console.log(`[CloudWatchTelemetryAdapter] Data is STALE (older than 5 minutes)`);
          metrics.forEach(m => telemetry[m.id] = null);
        }
      } else {
         console.log(`[CloudWatchTelemetryAdapter] No valid datapoints found after filtering for ${stationId}`);
      }

      const result = {
        telemetry,
        latestTelemetryTimestamp: latestIsoTimestamp,
        dataState,
        recentPoints: sortedTimeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      };

      this.cache.set(cacheKey, { timestamp: Date.now(), data: result });
      return result;

    } catch (err) {
      console.error(`[CloudWatchTelemetryAdapter] SDK Error for ${stationId}:`);
      console.error(`[CloudWatchTelemetryAdapter] Error Code: ${err.Code || err.code || err.name}`);
      console.error(`[CloudWatchTelemetryAdapter] Error Message: ${err.message}`);
      return this._emptyTelemetry(true);
    }
  }

  _emptyTelemetry(isError = false) {
    return {
      telemetry: {
        ebNo: null,
        ifLevel: null,
        pllStatus: null,
        bitSyncStatus: null,
        demodulation: null,
        carrierOffset: null
      },
      latestTelemetryTimestamp: null,
      dataState: isError ? "ERROR" : "NO_DATA",
      recentPoints: []
    };
  }
}

module.exports = new CloudWatchTelemetryAdapter();

