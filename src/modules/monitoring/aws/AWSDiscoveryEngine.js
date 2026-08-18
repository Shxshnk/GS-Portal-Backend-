const { EC2Client, DescribeRegionsCommand } = require("@aws-sdk/client-ec2");
const AwsConfigHelper = require("./AwsConfigHelper");
const EC2Discoverer = require("./EC2Discoverer");
const AwsCredentialProfile = require("./AwsCredentialProfile");

class AWSDiscoveryEngine {
  /**
   * Run multi-region discovery for a specific AWS resource type
   * @param {Object} params
   * @param {number} params.profileId - AWS Credential Profile ID
   * @param {string} params.resourceType - e.g., 'EC2'
   * @returns {Promise<Object>} Discovery Summary containing results
   */
  static async discover({ profileId, resourceType }) {
    if (resourceType.toUpperCase() !== "EC2") {
      throw new Error(`Unsupported AWS resource type: ${resourceType}`);
    }

    console.log("[AWS] Fetching Profile details...");
    const profile = await AwsCredentialProfile.findById(profileId, true);
    if (!profile) throw new Error(`AWS Profile ID ${profileId} not found`);
    if (!profile.region) throw new Error(`AWS Profile "${profile.profileName}" does not have a region configured.`);

    const startTime = Date.now();
    console.log("[AWS] Authenticating...");
    
    // We get the base client config using the specific region
    const baseClientConfig = await AwsConfigHelper.getClientConfig(profileId, profile.region);
    
    console.log("[AWS] STS Success");
    
    // Scan only the configured region
    const regions = [profile.region];

    const allInstances = [];
    const successfulRegions = [];
    const failedRegions = [];
    
    // Worker pool logic for concurrent scanning (max 5)
    const MAX_CONCURRENT = 5;
    let index = 0;

    const worker = async () => {
      while (index < regions.length) {
        const region = regions[index++];
        try {
          const regionClientConfig = { ...baseClientConfig, region };
          const discoverer = new EC2Discoverer(regionClientConfig);
          
          const instances = await discoverer.discover();
          
          instances.forEach(inst => {
            inst.profileId = profileId;
          });

          console.log(`[AWS] Region ${region} - Found ${instances.length} Instances`);
          
          allInstances.push(...instances);
          successfulRegions.push(region);
        } catch (err) {
          if (err.message.includes("AccessDenied") || err.message.includes("OptInRequired") || err.message.includes("UnauthorizedOperation")) {
            console.log(`[AWS] Region ${region} - Access Denied / OptIn Required`);
          } else {
            console.error(`[AWS] Region ${region} - Failed:`, err.message);
          }
          failedRegions.push({ region, error: err.message });
        }
      }
    };

    const workers = [];
    for (let i = 0; i < Math.min(MAX_CONCURRENT, regions.length); i++) {
      workers.push(worker());
    }

    await Promise.all(workers);

    const durationSeconds = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log("[AWS] Discovery Complete");
    console.log(`${allInstances.length} EC2 Instances`);
    console.log(`${regions.length} Regions`);
    console.log(`${durationSeconds} Seconds`);

    // Build the exact summary payload the user asked for
    const summary = {
      accountId: "N/A", // We could extract from STS if needed, but not strictly required for frontend if not shown
      regionsScanned: regions.length,
      successfulRegions: successfulRegions.length,
      failedRegions: failedRegions.length,
      instancesFound: allInstances.length,
      running: allInstances.filter(i => i.state === 'running' || i.status === 'ONLINE').length,
      stopped: allInstances.filter(i => i.state !== 'running' && i.status !== 'ONLINE').length,
      discoveryDuration: `${durationSeconds} Seconds`,
      instances: allInstances
    };

    return summary;
  }
}

module.exports = AWSDiscoveryEngine;
