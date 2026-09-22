const { CloudWatchClient, GetMetricDataCommand } = require("@aws-sdk/client-cloudwatch");
const AwsConfigHelper = require("../aws/AwsConfigHelper");
const AwsCredentialProfile = require("../aws/AwsCredentialProfile");

class CloudWatchTelemetryAdapter {
  constructor() {
    this.cache = new Map();
    this.CACHE_TTL_MS = 800; // Allow 1-second live polling to get fresh data
    this.clients = new Map();
  }

  async _getClient(stationId = "CP2", region = "af-south-1") {
    const isSD1 = String(stationId).includes("1");
    const target = isSD1 ? "CP1" : "CP2";
    const clientKey = `${target}-${region}`;

    if (!this.clients.has(clientKey)) {
      try {
        const config = await AwsConfigHelper.getClientConfigForStation(stationId, region);
        const client = new CloudWatchClient(config);
        this.clients.set(clientKey, client);
        console.log(`[CloudWatchTelemetryAdapter] Initialized CloudWatchClient for [${target}] in [${region}]`);
      } catch (err) {
        console.log(`[CloudWatchTelemetryAdapter] Fallback for [${target}] in [${region}]:`, err.message);
        this.clients.set(clientKey, new CloudWatchClient({ region }));
      }
    }
    return this.clients.get(clientKey);
  }

  async getTelemetryForStation(stationId, config, timeRangeStr = "15m", stat = "Average") {
    if (!config || !config.cloudWatch) {
      return this._emptyTelemetry();
    }

    let timeRangeMinutes = 15;

    if (timeRangeStr === "1s") {
       timeRangeMinutes = 1 / 60;
    } else if (timeRangeStr === "5s") {
       timeRangeMinutes = 5 / 60;
    } else if (timeRangeStr === "10s") {
       timeRangeMinutes = 10 / 60;
    } else if (timeRangeStr === "1m") {
       timeRangeMinutes = 1;
    } else if (timeRangeStr === "2m") {
       timeRangeMinutes = 2;
    } else if (timeRangeStr === "5m") {
       timeRangeMinutes = 5;
    } else if (timeRangeStr === "10m") {
       timeRangeMinutes = 10;
    } else if (timeRangeStr === "15m") {
       timeRangeMinutes = 15;
    } else if (timeRangeStr === "30m") {
       timeRangeMinutes = 30;
    } else if (timeRangeStr === "1h" || timeRangeStr === "60m") {
       timeRangeMinutes = 60;
    } else if (timeRangeStr === "3h") {
       timeRangeMinutes = 180;
    } else if (timeRangeStr === "6h") {
       timeRangeMinutes = 360;
    } else if (timeRangeStr === "12h") {
       timeRangeMinutes = 720;
    } else if (timeRangeStr === "1d" || timeRangeStr === "24h") {
       timeRangeMinutes = 1440;
    } else if (timeRangeStr === "2d" || timeRangeStr === "48h") {
       timeRangeMinutes = 2880;
    } else if (timeRangeStr === "3d" || timeRangeStr === "72h") {
       timeRangeMinutes = 4320;
    } else if (timeRangeStr === "7d") {
       timeRangeMinutes = 10080;
    } else if (timeRangeStr === "14d") {
       timeRangeMinutes = 20160;
    }

    // Dynamic CloudWatch Period Selection (CloudWatch retention & query points limit):
    // <= 15 min: 1s
    // <= 1 hour: 5s
    // <= 3 hours: 10s
    // <= 24 hours (1 day): 60s
    // <= 3 days: 300s
    // 7 - 14 days: 900s
    let period = 1;
    if (timeRangeMinutes <= 15) {
      period = 1;
    } else if (timeRangeMinutes <= 60) {
      period = 5;
    } else if (timeRangeMinutes <= 180) {
      period = 10;
    } else if (timeRangeMinutes <= 1440) {
      period = 60;
    } else if (timeRangeMinutes <= 4320) {
      period = 300;
    } else {
      period = 900;
    }

    const validStat = ["Average", "Maximum", "Minimum", "Sum"].includes(stat) ? stat : "Average";

    // Cache key must include the timeRange and stat
    const cacheKey = `${stationId}-${timeRangeStr}-${validStat}`;
    const cached = this.cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < this.CACHE_TTL_MS)) {
      return cached.data;
    }

    try {
      const { namespace, dimensions } = config.cloudWatch;
      const awsDimensions = Object.entries(dimensions).map(([Name, Value]) => ({ Name, Value }));
      const targetRegion = config.region || "af-south-1";

      const metrics = [
        { id: "ebNo", metric: "EbNo" },
        { id: "ifLevel", metric: "IFRFLevel" },
        { id: "pllStatus", metric: "PLLStatus" },
        { id: "bitSyncStatus", metric: "BitSyncStatus" },
        { id: "demodulation", metric: "Demodulation" },
        { id: "carrierOffset", metric: "CarrierOffset" }
      ];

      const now = new Date();
      // Add a 60-second acquisition buffer to prevent empty arrays due to ingestion latency
      const acquisitionBufferMs = 60000;
      const startTime = new Date(now.getTime() - (timeRangeMinutes * 60000) - (period * 1000) - acquisitionBufferMs); 

      const metricDataQueries = metrics.map(m => ({
        Id: m.id.toLowerCase(),
        MetricStat: {
          Metric: {
            Namespace: namespace,
            MetricName: m.metric,
            Dimensions: awsDimensions
          },
          Period: period,
          Stat: validStat
        },
        ReturnData: true
      }));

      const client = await this._getClient(stationId, targetRegion);
      const command = new GetMetricDataCommand({
        StartTime: startTime,
        EndTime: now,
        MetricDataQueries: metricDataQueries,
        ScanBy: "TimestampDescending"
      });

      console.log(`[${stationId}] AWS configuration loaded: true`);
      console.log(`[${stationId}] CloudWatch region: ${targetRegion}`);
      console.log(`[${stationId}] CloudWatch namespace: ${namespace}`);
      console.log(`[${stationId}] CloudWatch query started (${validStat}, 1s period)`);

      const response = await client.send(command);
      
      const emptyResult = this._emptyTelemetry();
      const telemetry = emptyResult.telemetry;
      let latestTimestamp = 0;
      
      const timelineMap = new Map();
      const FRESHNESS_THRESHOLD_MS = 5 * 60000;
      let totalDatapoints = 0;
      let ebNoPointsCount = 0;
      let ifLevelPointsCount = 0;

      if (response.MetricDataResults) {
        response.MetricDataResults.forEach(res => {
          const metricId = metrics.find(m => m.id.toLowerCase() === res.Id.toLowerCase())?.id;
          if (!metricId) return;

          const pointsCount = res.Values ? res.Values.length : 0;
          totalDatapoints += pointsCount;
          if (metricId === "ebNo") ebNoPointsCount += pointsCount;
          if (metricId === "ifLevel") ifLevelPointsCount += pointsCount;

          if (res.Values && res.Values.length > 0 && res.Timestamps && res.Timestamps.length > 0) {
            for (let i = 0; i < res.Values.length; i++) {
              let val = res.Values[i];
              let ts = new Date(res.Timestamps[i]).getTime();
              
              if (val === -128) {
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

      console.log(`[${stationId}] CloudWatch points received: ${totalDatapoints}`);
      console.log(`[${stationId}] EbNo points: ${ebNoPointsCount}`);
      console.log(`[${stationId}] IFRFLevel points: ${ifLevelPointsCount}`);

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
        console.log(`[${stationId}] GroundStation: ${dimensions.GroundStation}`);
        console.log(`[${stationId}] Region: ${dimensions.Region}`);
        console.log(`[${stationId}] Receiver: ${dimensions.Receiver}`);
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


