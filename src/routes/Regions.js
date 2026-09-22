// src/routes/Regions.js
const express = require("express");
const router = express.Router();
const RegionModel = require("../modules/monitoring/models/RegionModel");
const AwsConfigHelper = require("../modules/monitoring/aws/AwsConfigHelper");
const { EC2Client, DescribeRegionsCommand, DescribeInstancesCommand } = require("@aws-sdk/client-ec2");
const { CloudWatchClient, ListMetricsCommand } = require("@aws-sdk/client-cloudwatch");
const { STSClient, GetCallerIdentityCommand } = require("@aws-sdk/client-sts");

function sendError(res, error, fallbackMessage) {
  const statusCode = error.statusCode || 500;
  return res.status(statusCode).json({
    success: false,
    error: error.message || fallbackMessage,
  });
}

// Standard AWS regions dictionary for fallback / enriched labels
const STANDARD_AWS_REGIONS = [
  { id: "us-west-2", name: "us-west-2 (Oregon)" },
  { id: "af-south-1", name: "af-south-1 (Cape Town)" },
  { id: "eu-west-1", name: "eu-west-1 (Dublin)" },
  { id: "sa-east-1", name: "sa-east-1 (Punta Arenas / São Paulo)" },
  { id: "ap-southeast-2", name: "ap-southeast-2 (Dubbo / Sydney)" },
  { id: "us-east-1", name: "us-east-1 (N. Virginia)" },
  { id: "us-east-2", name: "us-east-2 (Ohio)" },
  { id: "us-west-1", name: "us-west-1 (N. California)" },
  { id: "eu-central-1", name: "eu-central-1 (Frankfurt)" },
  { id: "eu-west-2", name: "eu-west-2 (London)" },
  { id: "eu-north-1", name: "eu-north-1 (Stockholm)" },
  { id: "ap-south-1", name: "ap-south-1 (Mumbai)" },
  { id: "ap-southeast-1", name: "ap-southeast-1 (Singapore)" },
  { id: "ap-northeast-1", name: "ap-northeast-1 (Tokyo)" },
  { id: "ap-northeast-2", name: "ap-northeast-2 (Seoul)" },
  { id: "me-south-1", name: "me-south-1 (Bahrain)" }
];

// 0. GET AWS REGIONS FOR SELECTED STATION ACCOUNT (GS1/SD1 or GS2/SD2)
router.get("/aws/regions", async (req, res) => {
  try {
    const stationType = String(req.query.stationType || req.query.station || req.query.gs || "GS1").toUpperCase();
    const isSD2 = stationType.includes("2");
    const targetAccount = isSD2 ? "GS2" : "GS1";

    try {
      const clientConfig = await AwsConfigHelper.getClientConfigForAccount(targetAccount, "us-east-1");
      const ec2Client = new EC2Client(clientConfig);
      const resp = await ec2Client.send(new DescribeRegionsCommand({ AllRegions: false }));
      
      if (resp.Regions && resp.Regions.length > 0) {
        const discovered = resp.Regions.map(r => {
          const matched = STANDARD_AWS_REGIONS.find(std => std.id === r.RegionName);
          return {
            id: r.RegionName,
            name: matched ? matched.name : `${r.RegionName} (${r.Endpoint || r.RegionName})`
          };
        }).sort((a, b) => a.id.localeCompare(b.id));

        return res.json({ success: true, data: discovered });
      }
    } catch (awsErr) {
      console.warn(`[regions/aws/regions] DescribeRegions query failed (${awsErr.message}), returning standard AWS regions list.`);
    }

    return res.json({ success: true, data: STANDARD_AWS_REGIONS });
  } catch (error) {
    console.error("[regions/aws/regions] error:", error);
    return res.json({ success: true, data: STANDARD_AWS_REGIONS });
  }
});

// 0.1 GET EC2 INSTANCES FOR SELECTED STATION ACCOUNT + AWS REGION
router.get("/aws/instances", async (req, res) => {
  try {
    const stationType = String(req.query.stationType || req.query.station || req.query.gs || "GS1").toUpperCase();
    const awsRegion = String(req.query.awsRegion || req.query.region || "").trim();

    if (!awsRegion) {
      return res.status(400).json({ success: false, error: "awsRegion parameter is required." });
    }

    const isSD2 = stationType.includes("2");
    const targetAccount = isSD2 ? "GS2" : "GS1";

    const clientConfig = await AwsConfigHelper.getClientConfigForAccount(targetAccount, awsRegion);
    const ec2Client = new EC2Client(clientConfig);

    const instances = [];
    let nextToken = undefined;

    do {
      const command = new DescribeInstancesCommand({ NextToken: nextToken });
      const resp = await ec2Client.send(command);

      if (resp.Reservations) {
        for (const resv of resp.Reservations) {
          if (resv.Instances) {
            for (const inst of resv.Instances) {
              const tags = inst.Tags || [];
              const nameTag = tags.find(t => t.Key === "Name");
              const instanceName = nameTag ? nameTag.Value : inst.InstanceId;
              const rawState = inst.State?.Name || "unknown";

              instances.push({
                instanceId: inst.InstanceId,
                instanceName: instanceName,
                name: instanceName,
                state: rawState.toUpperCase(),
                instanceType: inst.InstanceType || "unknown",
                privateIp: inst.PrivateIpAddress || null,
                publicIp: inst.PublicIpAddress || null,
                availabilityZone: inst.Placement?.AvailabilityZone || null,
                label: `${instanceName} (${inst.InstanceId}) - ${rawState.toUpperCase()}`
              });
            }
          }
        }
      }
      nextToken = resp.NextToken;
    } while (nextToken);

    // Sort running instances first, then by name
    instances.sort((a, b) => {
      if (a.state === "RUNNING" && b.state !== "RUNNING") return -1;
      if (a.state !== "RUNNING" && b.state === "RUNNING") return 1;
      return a.instanceName.localeCompare(b.instanceName);
    });

    return res.json({ success: true, account: targetAccount, region: awsRegion, data: instances });
  } catch (error) {
    console.error("[regions/aws/instances] error:", error.message);
    const isSD2 = String(req.query.stationType || "").toUpperCase().includes("2");
    const accountLabel = isSD2 ? "GS2/SD2" : "GS1/SD1";
    return res.status(500).json({
      success: false,
      error: `Unable to discover ${accountLabel} instances for this AWS region: ${error.message}`,
      data: []
    });
  }
});

// 1. LIST REGIONS
router.get("/", async (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === "true" || req.query.all === "true";
    const regions = await RegionModel.list(includeInactive, true);
    return res.json({ success: true, data: regions });
  } catch (error) {
    console.error("[regions] list error:", error);
    return sendError(res, error, "Failed to list regions");
  }
});

// 2. GET SINGLE REGION
router.get("/:id", async (req, res) => {
  try {
    const region = await RegionModel.findById(req.params.id, false);
    if (!region) {
      return res.status(404).json({ success: false, error: "Region not found" });
    }
    return res.json({ success: true, data: region });
  } catch (error) {
    console.error("[regions] get error:", error);
    return sendError(res, error, "Failed to get region");
  }
});

// 3. CREATE REGION
router.post("/", async (req, res) => {
  try {
    const {
      name,
      code,
      awsRegion,
      latitude,
      longitude,
      accessKey,
      secretKey,
      sd1,
      sd2,
      gs1,
      gs2
    } = req.body || {};

    // Validation
    if (!name || !code || !awsRegion || latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: name, code, awsRegion, latitude, and longitude are required."
      });
    }

    const lat = Number(latitude);
    const lng = Number(longitude);
    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({
        success: false,
        error: "Latitude and Longitude must be valid numbers."
      });
    }

    // Check duplicate code
    const existing = await RegionModel.findByCode(code);
    if (existing && existing.isActive) {
      return res.status(409).json({
        success: false,
        error: `A region with code '${code.toUpperCase()}' already exists and is active.`
      });
    }

    const created = await RegionModel.create({
      name,
      code,
      awsRegion,
      latitude: lat,
      longitude: lng,
      accessKey,
      secretKey,
      sd1: sd1 || gs1,
      sd2: sd2 || gs2
    });

    try {
      req.audit?.log?.({
        action: "GROUND_STATION_REGION_CREATE",
        targetType: "region",
        targetId: String(created.id),
        statusCode: 201,
        metadata: { name, code, awsRegion },
      });
    } catch { }

    return res.status(201).json({ success: true, data: created });
  } catch (error) {
    console.error("[regions] create error:", error);
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ success: false, error: "A region with this code already exists." });
    }
    return sendError(res, error, "Failed to create region");
  }
});

// 4. UPDATE REGION
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      code,
      awsRegion,
      latitude,
      longitude,
      accessKey,
      secretKey,
      isActive,
      sd1,
      sd2,
      gs1,
      gs2
    } = req.body || {};

    if (latitude !== undefined && isNaN(Number(latitude))) {
      return res.status(400).json({ success: false, error: "Latitude must be a valid number." });
    }
    if (longitude !== undefined && isNaN(Number(longitude))) {
      return res.status(400).json({ success: false, error: "Longitude must be a valid number." });
    }

    const updated = await RegionModel.updateById(id, {
      name,
      code,
      awsRegion,
      latitude: latitude !== undefined ? Number(latitude) : undefined,
      longitude: longitude !== undefined ? Number(longitude) : undefined,
      accessKey,
      secretKey,
      isActive,
      sd1: sd1 || gs1,
      sd2: sd2 || gs2
    });

    if (!updated) {
      return res.status(404).json({ success: false, error: "Region not found" });
    }

    try {
      req.audit?.log?.({
        action: "GROUND_STATION_REGION_UPDATE",
        targetType: "region",
        targetId: String(id),
        statusCode: 200,
        metadata: { name, code, awsRegion },
      });
    } catch { }

    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error("[regions] update error:", error);
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ success: false, error: "A region with this code already exists." });
    }
    return sendError(res, error, "Failed to update region");
  }
});

// 5. DELETE REGION (Permanent removal)
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const numId = Number(id);
    if (isNaN(numId)) {
      return res.status(400).json({ success: false, error: "Invalid region ID." });
    }

    const existing = await RegionModel.findById(numId, false);
    if (!existing) {
      return res.status(404).json({ success: false, error: "Region not found" });
    }

    const deleted = await RegionModel.deleteById(numId, true);
    if (!deleted) {
      return res.status(500).json({ success: false, error: "Failed to delete region from database." });
    }

    try {
      req.audit?.log?.({
        action: "GROUND_STATION_REGION_DELETE",
        targetType: "region",
        targetId: String(id),
        statusCode: 200,
        metadata: { name: existing.name, code: existing.code, awsRegion: existing.awsRegion }
      });
    } catch { }

    return res.json({
      success: true,
      message: `Ground station region "${existing.name}" deleted successfully`,
      data: { id: numId, name: existing.name, code: existing.code }
    });
  } catch (error) {
    console.error("[regions] delete error:", error);
    return sendError(res, error, "Failed to delete region");
  }
});

// 6. TEST AWS CONNECTION
router.post("/test-connection", async (req, res) => {
  try {
    const { awsRegion, accessKey, secretKey, regionId, stationType } = req.body || {};

    let targetRegion = awsRegion || "af-south-1";
    let clientConfig;

    if (accessKey && secretKey && secretKey !== "****************") {
      clientConfig = {
        region: targetRegion,
        credentials: {
          accessKeyId: accessKey.trim(),
          secretAccessKey: secretKey.trim(),
        },
      };
    } else {
      const isSD2 = String(stationType).includes("2");
      const targetAccount = isSD2 ? "GS2" : "GS1";
      clientConfig = await AwsConfigHelper.getClientConfigForAccount(targetAccount, targetRegion);
    }

    // First attempt: STS GetCallerIdentity for quick credential verification
    try {
      const stsClient = new STSClient(clientConfig);
      const stsResp = await stsClient.send(new GetCallerIdentityCommand({}));
      return res.json({
        success: true,
        message: "AWS connection successful (Authenticated as " + (stsResp.Arn ? stsResp.Arn.split("/").pop() : "AWS User") + ")",
        account: stsResp.Account,
        arn: stsResp.Arn
      });
    } catch (stsErr) {
      // If STS is not permitted, fallback to CloudWatch ListMetrics
      try {
        const cwClient = new CloudWatchClient(clientConfig);
        await cwClient.send(new ListMetricsCommand({}));
        return res.json({
          success: true,
          message: "AWS connection successful (CloudWatch verified)"
        });
      } catch (cwErr) {
        console.error("[regions/test-connection] AWS validation failed:", stsErr.message, cwErr.message);
        
        let errorReason = "AWS authentication failed";
        if (stsErr.name === "UnrecognizedClientException" || cwErr.name === "UnrecognizedClientException") {
          errorReason = "The security token included in the request is invalid (Invalid Access Key or Secret).";
        } else if (stsErr.name === "InvalidSignatureException" || cwErr.name === "InvalidSignatureException") {
          errorReason = "The request signature does not conform to AWS standards (Invalid Secret Key).";
        } else if (stsErr.message?.includes("connect") || cwErr.message?.includes("connect")) {
          errorReason = "Could not connect to AWS region endpoint. Please check region name and network connectivity.";
        } else {
          errorReason = stsErr.message || cwErr.message || "AWS connection failed.";
        }

        return res.status(400).json({
          success: false,
          error: errorReason
        });
      }
    }
  } catch (error) {
    console.error("[regions/test-connection] Internal error:", error);
    return sendError(res, error, "Internal error testing AWS connection");
  }
});

module.exports = router;
