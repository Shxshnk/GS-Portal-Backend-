const { EC2Client, DescribeInstancesCommand } = require("@aws-sdk/client-ec2");
const CloudWatchTelemetryAdapter = require("../adapters/CloudWatchTelemetryAdapter");
const AwsConfigHelper = require("../aws/AwsConfigHelper");

let RegionModel;
try {
  RegionModel = require("../models/RegionModel");
} catch (e) {
  // Fallback if not loaded
}

const DEFAULT_STATION_MAP = {
  CP1: { region: "af-south-1", sdr: "i-04dca7b61a57c74db", receiver: "i-09e18b7e39b38ba47" },
  CP2: { region: "af-south-1", sdr: "i-0f76b7aed11916f7b", receiver: "i-01355c3be5b62d5d6" },
  DU1: { region: "eu-west-1",   sdr: "i-0acbbc36feaa58978", receiver: "i-0a4878491efbc72f9" },
  DU2: { region: "eu-west-1",   sdr: "i-065b7f39185b032f8", receiver: "i-01c4a7f62f86aee19" },
  PA1: { region: "sa-east-1",   sdr: "i-0695e04fdef95e365", receiver: "i-08ea5a3259f8acb0b" },
  PA2: { region: "sa-east-1",   sdr: "i-069a1b0858fd20122", receiver: "i-0dbc2d128cadb8252" },
  DB1: { region: "ap-southeast-2", sdr: "i-0bd5179c86257d5ec", receiver: "i-0aadacb9a0ce87849" },
  DB2: { region: "ap-southeast-2", sdr: "i-0eaf782bb7e94cd11", receiver: "i-0bc0e9084846e5e5a" },
};

async function getStationInstanceIds(stationId) {
  let dbSdr = null;
  let dbReceiver = null;

  if (RegionModel) {
    try {
      const found = await RegionModel.findByStationId(stationId);
      if (found && found.station) {
        dbSdr = found.station.ec2SdrInstanceId;
        dbReceiver = found.station.ec2ReceiverInstanceId;
      }
    } catch (e) { }
  }

  const fallback = DEFAULT_STATION_MAP[stationId] || {};
  const explicitEc2Id = process.env[`${stationId}_EC2_INSTANCE_ID`] || process.env[`${stationId}_INSTANCE_ID`];
  const sdrId = process.env[`${stationId}_SDR_INSTANCE_ID`] || explicitEc2Id || dbSdr || fallback.sdr;
  const receiverId = process.env[`${stationId}_RECEIVER_INSTANCE_ID`] || dbReceiver || fallback.receiver;
  return { sdrId, receiverId, explicitEc2Id };
}

function mapEc2StateToStatus(stateName) {
  if (!stateName) return "UNKNOWN";
  const state = String(stateName).toLowerCase();
  switch (state) {
    case "running":
      return "ONLINE";
    case "stopped":
      return "OFFLINE";
    case "stopping":
      return "OFFLINE";
    case "pending":
      return "STARTING";
    case "rebooting":
      return "STARTING";
    case "shutting-down":
    case "terminated":
      return "OFFLINE";
    default:
      return "UNKNOWN";
  }
}

async function getStationConfig(stationId) {
  let dbStation = null;
  let dbRegion = null;

  if (RegionModel) {
    try {
      const found = await RegionModel.findByStationId(stationId);
      if (found) {
        dbStation = found.station;
        dbRegion = found.region;
      }
    } catch (e) { }
  }

  const isSD1 = String(stationId).includes("1");
  const isCP = stationId.startsWith("CP");
  const isDU = stationId.startsWith("DU");
  const isPA = stationId.startsWith("PA");
  const isDB = stationId.startsWith("DB");

  let regionName = dbRegion?.name || "Africa";
  let gsName = dbStation?.groundStation || "GS-001";
  let receiverName = dbStation?.receiver || "IFR-1";
  let awsRegion = dbRegion?.awsRegion || "af-south-1";

  if (!dbRegion) {
    if (isDU) { regionName = "Europe"; gsName = "GS-002"; awsRegion = "eu-west-1"; }
    else if (isPA) { regionName = "SouthAmerica"; gsName = "GS-003"; awsRegion = "sa-east-1"; }
    else if (isDB) { regionName = "AsiaPacific"; gsName = "GS-004"; awsRegion = "ap-southeast-2"; }
  }

  const fallbackPrefix = isSD1 ? "CP1" : "CP2";
  const sdPrefix = isSD1 ? "SD1" : "SD2";

  const namespace = process.env[`${stationId}_CLOUDWATCH_NAMESPACE`] || 
                    process.env[`${sdPrefix}_CLOUDWATCH_NAMESPACE`] || 
                    (isCP ? process.env[`${fallbackPrefix}_CLOUDWATCH_NAMESPACE`] : null) || 
                    dbStation?.cloudwatchNamespace || 
                    process.env.CLOUDWATCH_NAMESPACE || 
                    "GroundStation/SDR";

  const groundStation = process.env[`${stationId}_GROUND_STATION`] || 
                        process.env[`${sdPrefix}_GROUND_STATION`] || 
                        (isCP ? process.env[`${fallbackPrefix}_GROUND_STATION`] : null) || 
                        dbStation?.groundStation || 
                        gsName;

  const region = process.env[`${stationId}_REGION`] || 
                 process.env[`${sdPrefix}_REGION`] || 
                 (isCP ? process.env[`${fallbackPrefix}_REGION`] : null) || 
                 regionName;

  const receiver = process.env[`${stationId}_RECEIVER`] || 
                   process.env[`${sdPrefix}_RECEIVER`] || 
                   (isCP ? process.env[`${fallbackPrefix}_RECEIVER`] : null) || 
                   dbStation?.receiver || 
                   receiverName;

  const resolvedAwsRegion = process.env[`${stationId}_AWS_REGION`] ||
                            process.env[`${sdPrefix}_AWS_REGION`] ||
                            (isCP ? process.env[`${fallbackPrefix}_AWS_REGION`] : null) ||
                            dbRegion?.awsRegion || 
                            awsRegion;

  return {
    region: resolvedAwsRegion,
    cloudWatch: {
      namespace,
      dimensions: {
        GroundStation: groundStation,
        Region: region,
        Receiver: receiver
      }
    }
  };
}

function getStandardInfrastructureNodes(vpcStatus = "HEALTHY") {
  return [
    { id: "aws-vpc", name: "AWS VPC", status: vpcStatus, type: "cloud" },
    { id: "tgw", name: "Transit Gateway", status: "HEALTHY", type: "router" },
    { id: "privatelink", name: "PrivateLink", status: "HEALTHY", type: "link" },
    { id: "direct-connect", name: "AWS Direct Connect", status: "HEALTHY", type: "connect" },
    { id: "hosted-dx", name: "Hosted DX", status: "HEALTHY", type: "dns" },
    { id: "isp", name: "ISP / Network", status: "HEALTHY", type: "network" },
    { id: "mission-network", name: "Mission Network", status: "HEALTHY", type: "satellite" }
  ];
}

let pool;
try {
  pool = require("../../../db").pool;
} catch (err) {
  // DB fallback
}

class GroundStationMonitoringService {
  static ec2Clients = new Map();

  static async getEc2Client(stationId, region) {
    const isSD2 = String(stationId).includes("2");
    const target = isSD2 ? "GS2" : "GS1";
    const clientKey = `${target}-${region}`;

    if (!this.ec2Clients.has(clientKey)) {
      try {
        const config = await AwsConfigHelper.getClientConfigForStation(stationId, region);
        this.ec2Clients.set(clientKey, new EC2Client(config));
      } catch (err) {
        console.error(`[GroundStationMonitoringService] Failed to initialize EC2Client for [${target}] in [${region}]:`, err.message);
        this.ec2Clients.set(clientKey, new EC2Client({ region }));
      }
    }
    return this.ec2Clients.get(clientKey);
  }

  static async queryStationEc2State(stationId, awsRegion) {
    const { sdrId, receiverId, explicitEc2Id } = await getStationInstanceIds(stationId);
    const instanceIds = [];
    if (sdrId) instanceIds.push(sdrId);
    if (receiverId && !instanceIds.includes(receiverId)) instanceIds.push(receiverId);
    if (explicitEc2Id && !instanceIds.includes(explicitEc2Id)) instanceIds.push(explicitEc2Id);

    if (instanceIds.length === 0) {
      return { stationStatus: "UNKNOWN", sdrState: "UNKNOWN", receiverState: "UNKNOWN" };
    }

    try {
      const client = await this.getEc2Client(stationId, awsRegion);
      const command = new DescribeInstancesCommand({ InstanceIds: instanceIds });
      const response = await client.send(command);

      let sdrState = "UNKNOWN";
      let receiverState = "UNKNOWN";
      let explicitState = "UNKNOWN";

      response.Reservations?.forEach(res => {
        res.Instances?.forEach(inst => {
          const rawState = inst.State?.Name || "unknown";
          if (inst.InstanceId === explicitEc2Id) {
            explicitState = rawState;
          }
          if (inst.InstanceId === sdrId) {
            sdrState = rawState;
          }
          if (inst.InstanceId === receiverId) {
            receiverState = rawState;
          }
          console.log(`[EC2 STATUS] ${stationId} instance ${inst.InstanceId} state: ${rawState}`);
        });
      });

      const effectiveState = sdrState !== "UNKNOWN" ? sdrState : (receiverState !== "UNKNOWN" ? receiverState : explicitState);
      const stationStatus = mapEc2StateToStatus(effectiveState);

      return {
        stationStatus,
        sdrState,
        receiverState
      };
    } catch (err) {
      console.error(`[GroundStationMonitoringService] EC2 DescribeInstances error for ${stationId} (${awsRegion}):`, err.message);
      return { stationStatus: "UNKNOWN", sdrState: "UNKNOWN", receiverState: "UNKNOWN", error: err.message };
    }
  }

  /**
   * Generates the entire normalized dashboard payload for all regions.
   */
  static async getDashboardData(timeRange = "15m", stat = "Average") {
    // 0. Query database pass list to retrieve real uploaded satellite names & operations
    let dbPasses = [];
    if (pool) {
      try {
        const [rows] = await pool.query(
          "SELECT id, pass_req_no, date_text, satellite_name, supporting_station, aos_ut, los_ut, operations, pass_type, schedule_status FROM passes WHERE is_deleted = 0 ORDER BY id DESC LIMIT 100"
        );
        dbPasses = rows || [];
      } catch (err) {
        // Safe fallback if table doesn't exist yet
      }
    }

    // 0.1 Query dynamic active regions from RegionModel
    let dynamicRegions = [];
    if (RegionModel) {
      try {
        dynamicRegions = await RegionModel.list(false, false);
      } catch (err) {
        console.error("[GroundStationMonitoringService] Error fetching dynamic regions:", err.message);
      }
    }

    let regions = [];

    if (dynamicRegions && dynamicRegions.length > 0) {
      regions = dynamicRegions.map(reg => {
        const stations = (reg.stations || []).map(st => ({
          id: st.stationId,
          station: `${reg.name} (${st.stationId})`,
          stationType: st.stationType,
          region: reg.awsRegion,
          latitude: reg.latitude,
          longitude: reg.longitude,
          status: "UNKNOWN",
          rx: "OFF",
          tx: "OFF",
          ebNo: null,
          ifLevel: null,
          lastUpdate: "No Data",
          passMetrics: []
        }));

        return {
          id: reg.awsRegion || String(reg.id),
          dbId: reg.id,
          name: reg.name,
          city: reg.name,
          code: reg.code,
          latitude: reg.latitude,
          longitude: reg.longitude,
          infrastructure: { rx: "UNKNOWN", tx: "UNKNOWN", vpc: "UNKNOWN", directConnect: "HEALTHY", mpls: "HEALTHY", mission: "HEALTHY" },
          infrastructureNodes: getStandardInfrastructureNodes("UNKNOWN"),
          stations,
          activePasses: [],
          alerts: [],
          upcomingOperations: [],
          passMetrics: []
        };
      });
    } else {
      // Fallback initial skeleton if DB is not populated
      regions = [
        {
          id: "af-south-1",
          name: "Cape Town",
          city: "Cape Town",
          code: "CPT",
          latitude: -33.9249,
          longitude: 18.4241,
          infrastructure: { rx: "UNKNOWN", tx: "UNKNOWN", vpc: "UNKNOWN", directConnect: "HEALTHY", mpls: "HEALTHY", mission: "HEALTHY" },
          infrastructureNodes: getStandardInfrastructureNodes("UNKNOWN"),
          stations: [
            { id: "CP1", station: "Cape Town (CP1)", region: "af-south-1", status: "UNKNOWN", rx: "OFF", tx: "OFF", ebNo: null, ifLevel: null, lastUpdate: "No Data", passMetrics: [] },
            { id: "CP2", station: "Cape Town (CP2)", region: "af-south-1", status: "UNKNOWN", rx: "OFF", tx: "OFF", ebNo: null, ifLevel: null, lastUpdate: "No Data", passMetrics: [] }
          ],
          activePasses: [],
          alerts: [],
          upcomingOperations: [],
          passMetrics: []
        },
        {
          id: "eu-west-1",
          name: "Dublin",
          city: "Dublin",
          code: "DUB",
          latitude: 53.3498,
          longitude: -6.2603,
          infrastructure: { rx: "UNKNOWN", tx: "UNKNOWN", vpc: "UNKNOWN", directConnect: "HEALTHY", mpls: "HEALTHY", mission: "HEALTHY" },
          infrastructureNodes: getStandardInfrastructureNodes("UNKNOWN"),
          stations: [
            { id: "DU1", station: "Dublin (DU1)", region: "eu-west-1", status: "UNKNOWN", rx: "OFF", tx: "OFF", ebNo: null, ifLevel: null, lastUpdate: "No Data", passMetrics: [] },
            { id: "DU2", station: "Dublin (DU2)", region: "eu-west-1", status: "UNKNOWN", rx: "OFF", tx: "OFF", ebNo: null, ifLevel: null, lastUpdate: "No Data", passMetrics: [] }
          ],
          activePasses: [],
          alerts: [],
          upcomingOperations: [],
          passMetrics: []
        },
        {
          id: "sa-east-1",
          name: "Punta Arenas",
          city: "Punta Arenas",
          code: "PUQ",
          latitude: -53.15,
          longitude: -70.9167,
          infrastructure: { rx: "UNKNOWN", tx: "UNKNOWN", vpc: "UNKNOWN", directConnect: "HEALTHY", mpls: "HEALTHY", mission: "HEALTHY" },
          infrastructureNodes: getStandardInfrastructureNodes("UNKNOWN"),
          stations: [
            { id: "PA1", station: "Punta Arenas (PA1)", region: "sa-east-1", status: "UNKNOWN", rx: "OFF", tx: "OFF", ebNo: null, ifLevel: null, lastUpdate: "No Data", passMetrics: [] },
            { id: "PA2", station: "Punta Arenas (PA2)", region: "sa-east-1", status: "UNKNOWN", rx: "OFF", tx: "OFF", ebNo: null, ifLevel: null, lastUpdate: "No Data", passMetrics: [] }
          ],
          activePasses: [],
          alerts: [],
          upcomingOperations: [],
          passMetrics: []
        },
        {
          id: "ap-southeast-2",
          name: "Dubbo",
          city: "Dubbo",
          code: "DBO",
          latitude: -32.245,
          longitude: 148.604,
          infrastructure: { rx: "UNKNOWN", tx: "UNKNOWN", vpc: "UNKNOWN", directConnect: "HEALTHY", mpls: "HEALTHY", mission: "HEALTHY" },
          infrastructureNodes: getStandardInfrastructureNodes("UNKNOWN"),
          stations: [
            { id: "DB1", station: "Dubbo (DB1)", region: "ap-southeast-2", status: "UNKNOWN", rx: "OFF", tx: "OFF", ebNo: null, ifLevel: null, lastUpdate: "No Data", passMetrics: [] },
            { id: "DB2", station: "Dubbo (DB2)", region: "ap-southeast-2", status: "UNKNOWN", rx: "OFF", tx: "OFF", ebNo: null, ifLevel: null, lastUpdate: "No Data", passMetrics: [] }
          ],
          activePasses: [],
          alerts: [],
          upcomingOperations: [],
          passMetrics: []
        }
      ];
    }

    // Attach real satellite names and operations from pass database
    regions.forEach(region => {
      region.stations.forEach(st => {
        const isSD1 = String(st.id).includes("1");
        const fallbackSat = isSD1 ? "SPADEX-SD1" : "SPADEX-SD2";
        const matched = dbPasses.find(p => {
          const ss = String(p.supporting_station || "").toUpperCase();
          return ss.includes(st.id.toUpperCase()) || ss.includes(st.station.toUpperCase()) || (region.name && ss.includes(region.name.toUpperCase()));
        });
        st.satellite = matched?.satellite_name || process.env[`${st.id}_SATELLITE_NAME`] || fallbackSat;
        st.operations = matched?.operations || process.env[`${st.id}_OPERATIONS`] || "--";
        st.date = matched?.date_text || matched?.aos_ut || process.env[`${st.id}_DATE`] || "--";
        st.aos = matched?.aos_ut || process.env[`${st.id}_AOS`] || process.env[`${st.id}_AOS_UT`] || "--";
        st.los = matched?.los_ut || process.env[`${st.id}_LOS`] || process.env[`${st.id}_LOS_UT`] || "--";
      });

      const regionPasses = dbPasses.filter(p => {
        const ss = String(p.supporting_station || "").toUpperCase();
        return region.stations.some(st => ss.includes(st.id.toUpperCase()) || ss.includes(st.station.toUpperCase())) || (region.name && ss.includes(region.name.toUpperCase()));
      });
      if (regionPasses.length > 0) {
        region.upcomingOperations = regionPasses.map(p => {
          const aosTime = p.aos_ut ? new Date(p.aos_ut).getTime() : NaN;
          const losTime = p.los_ut ? new Date(p.los_ut).getTime() : NaN;
          const durMin = (!isNaN(aosTime) && !isNaN(losTime)) ? Math.max(1, Math.round((losTime - aosTime) / 60000)) : 15;
          return {
            id: String(p.id),
            station: p.supporting_station || region.name,
            satellite: p.satellite_name,
            aos: p.aos_ut || "--",
            duration: `${durMin} min`
          };
        });
      }
    });

    // --- STEP 1: EC2 Instance State Queries (Source of Truth for Station Status) ---
    const ec2Promises = [];
    for (const region of regions) {
      for (const station of region.stations) {
        ec2Promises.push(
          this.queryStationEc2State(station.id, station.region).then(ec2Result => {
            station.status = ec2Result.stationStatus;
            station.sdrEc2 = ec2Result.sdrState !== "UNKNOWN" ? ec2Result.sdrState.toUpperCase() : "UNKNOWN";
            station.receiverEc2 = ec2Result.receiverState !== "UNKNOWN" ? ec2Result.receiverState.toUpperCase() : "UNKNOWN";
            console.log(`[GROUND STATION STATUS] ${station.station}: ${station.status} (Receiver: ${station.receiverEc2}, SDR: ${station.sdrEc2})`);
            return { regionId: region.id, stationId: station.id, ec2Result };
          })
        );
      }
    }

    const ec2Results = await Promise.allSettled(ec2Promises);

    // Update regional infrastructure health based on EC2 results
    regions.forEach(region => {
      const regionEc2Results = ec2Results
        .filter(r => r.status === "fulfilled" && r.value.regionId === region.id)
        .map(r => r.value.ec2Result);

      const hasSuccessfulQuery = regionEc2Results.some(r => !r.error);
      const isAnyRxRunning = regionEc2Results.some(r => r.receiverState === "running" || r.receiverState === "RUNNING");
      const isAllRxStopped = regionEc2Results.length > 0 && regionEc2Results.every(r => r.receiverState === "stopped" || r.receiverState === "STOPPED");

      region.infrastructure.rx = isAnyRxRunning ? "HEALTHY" : (isAllRxStopped ? "OFFLINE" : "UNKNOWN");
      region.infrastructure.vpc = hasSuccessfulQuery ? "HEALTHY" : "UNKNOWN";
      region.infrastructureNodes = getStandardInfrastructureNodes(region.infrastructure.vpc);
    });

    // --- STEP 2: CloudWatch Telemetry Fetch (Independent of Station Health) ---
    const telemetryPromises = [];
    for (const region of regions) {
      for (const station of region.stations) {
        telemetryPromises.push(
          (async () => {
            const config = await getStationConfig(station.id);
            return CloudWatchTelemetryAdapter.getTelemetryForStation(station.id, config, timeRange, stat);
          })()
            .then(cwData => {
              station.telemetry = cwData.telemetry;
              station.ebNo = cwData.telemetry ? cwData.telemetry.ebNo : null;
              station.ifLevel = cwData.telemetry ? cwData.telemetry.ifLevel : null;

              if (cwData.dataState === "LIVE") {
                station.rx = cwData.telemetry.pllStatus === 1 ? "LOCKED" : "UNLOCKED";
                station.tx = cwData.telemetry.bitSyncStatus === 1 ? "ACTIVE" : "INACTIVE";
                station.lastUpdate = cwData.latestTelemetryTimestamp || "Live";
                station.hasLivePass = true;
              } else {
                station.hasLivePass = false;
                station.rx = station.status === "ONLINE" ? "SEARCHING" : "OFF";
                station.tx = "OFF";
                station.lastUpdate = cwData.dataState === "STALE" ? "STALE" : (cwData.dataState === "ERROR" ? "ERROR" : "No Data");
              }

              if (cwData.recentPoints && cwData.recentPoints.length > 0) {
                station.passMetrics = cwData.recentPoints.map(pt => ({
                  timestamp: pt.timestamp,
                  stationId: station.id,
                  ebNo: pt.ebNo !== undefined ? pt.ebNo : null,
                  ifLevel: pt.ifLevel !== undefined ? pt.ifLevel : null
                }));
              }
            })
            .catch(err => {
              console.error(`[GroundStationMonitoringService] Telemetry error for ${station.id}:`, err.message);
              station.hasLivePass = false;
            })
        );
      }
    }

    await Promise.allSettled(telemetryPromises);

    // --- STEP 3: Aggregate Regional Metrics and Generate Active Passes ---
    let totalActivePasses = 0;
    const allActivePassesList = [];
    const now = Date.now();

    regions.forEach(region => {
      let mergedMetrics = [];
      region.stations.forEach(st => {
        if (st.passMetrics && st.passMetrics.length > 0) {
          mergedMetrics = mergedMetrics.concat(st.passMetrics);
        }

        // Find any database passes that match this station and are currently active by UTC time
        const matchedDbPasses = dbPasses.filter(p => {
          const ss = String(p.supporting_station || "").toUpperCase();
          return ss.includes(st.id.toUpperCase()) || ss.includes(st.station.toUpperCase());
        });

        let activePassFound = false;

        matchedDbPasses.forEach(p => {
          const aosTime = p.aos_ut ? new Date(p.aos_ut).getTime() : NaN;
          const losTime = p.los_ut ? new Date(p.los_ut).getTime() : NaN;
          const isTimeActive = !isNaN(aosTime) && !isNaN(losTime) && (aosTime <= now && now <= losTime);
          const durMin = (!isNaN(aosTime) && !isNaN(losTime)) ? Math.max(1, Math.round((losTime - aosTime) / 60000)) : 15;

          if (isTimeActive || st.hasLivePass) {
            activePassFound = true;
            const satName = (p.satellite_name && p.satellite_name !== "CP1" && p.satellite_name !== "CP2")
              ? p.satellite_name
              : (st.id.includes("1") ? "SPADEX-SD1" : "SPADEX-SD2");

            const passObj = {
              id: `pass-${st.id}-${p.id}`,
              stationId: st.id,
              stationName: st.station,
              satellite: satName,
              date: p.date_text || p.aos_ut || st.date || "--",
              operations: (p.operations && p.operations !== "None") ? p.operations : (st.operations || "--"),
              status: "ACTIVE",
              aos: p.aos_ut || st.aos || "--",
              los: p.los_ut || st.los || "--",
              duration: "--",
              ebNo: st.ebNo,
              ifLevel: st.ifLevel,
              rxStatus: st.rx === "LOCKED" ? "LOCKED" : "SEARCHING",
              txStatus: st.tx === "ACTIVE" ? "ACTIVE" : "OFF",
              receiverEc2: st.receiverEc2 || "UNKNOWN",
              sdrEc2: st.sdrEc2 || "UNKNOWN",
              connection: st.status || "UNKNOWN",
              lastUpdate: st.lastUpdate || "No Data"
            };
            region.activePasses.push(passObj);
            allActivePassesList.push(passObj);
            totalActivePasses++;
          }
        });

        // If no matching DB pass was active by time but the station has live telemetry streaming, create live pass card
        if (!activePassFound && st.hasLivePass) {
          const isSD1 = String(st.id).includes("1");
          const satName = (st.satellite && st.satellite !== "CP1" && st.satellite !== "CP2")
            ? st.satellite
            : (isSD1 ? "SPADEX-SD1" : "SPADEX-SD2");

          const passObj = {
            id: `pass-${st.id}-live`,
            stationId: st.id,
            stationName: st.station,
            satellite: satName,
            date: st.date || st.aos || "--",
            operations: st.operations || "--",
            status: "ACTIVE",
            aos: st.aos || "--",
            los: st.los || "--",
            duration: "--",
            ebNo: st.ebNo,
            ifLevel: st.ifLevel,
            rxStatus: st.rx === "LOCKED" ? "LOCKED" : "SEARCHING",
            txStatus: st.tx === "ACTIVE" ? "ACTIVE" : "OFF",
            receiverEc2: st.receiverEc2 || "UNKNOWN",
            sdrEc2: st.sdrEc2 || "UNKNOWN",
            connection: st.status || "UNKNOWN",
            lastUpdate: st.lastUpdate || "Live"
          };
          region.activePasses.push(passObj);
          allActivePassesList.push(passObj);
          totalActivePasses++;
        }
      });
      region.passMetrics = mergedMetrics.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    });

    console.log(`[ACTIVE PASS FILTER] Total passes received: ${totalActivePasses}`);
    console.log(`[ACTIVE PASS FILTER] Active passes: ${totalActivePasses}`);
    allActivePassesList.forEach(p => console.log(`[ACTIVE PASS FILTER] ${p.stationId}: ACTIVE`));

    return { regions };
  }
}

module.exports = GroundStationMonitoringService;
