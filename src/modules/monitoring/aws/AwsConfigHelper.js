const AwsCredentialProfile = require("./AwsCredentialProfile");
const { fromIni } = require("@aws-sdk/credential-providers");

let RegionModel;
try {
  RegionModel = require("../models/RegionModel");
} catch (e) {
  // Model fallback if not yet loaded
}

class AwsConfigHelper {
  /**
   * Retrieves AWS Credentials based on profile ID, AWS_PROFILE, or environment variables.
   * @param {number} profileId - The ID of the AWS Credential Profile
   * @param {string} [overrideRegion] - Optional region to override the profile's default region
   * @returns {Promise<{ credentials?: any, region: string }>}
   */
  static async getClientConfig(profileId, overrideRegion = null) {
    if (profileId) {
      const profile = await AwsCredentialProfile.findById(profileId, true);
      if (profile) {
        return {
          credentials: {
            accessKeyId: profile.accessKey,
            secretAccessKey: profile.secretKey,
          },
          region: overrideRegion || profile.region,
        };
      }
    }

    const region = overrideRegion || process.env.AWS_REGION || "us-east-1";

    // 1. Explicitly check for AWS_PROFILE (Overrides local AWS_ACCESS_KEY_ID in SDK v3)
    // If the user specifies a profile (e.g. isro-gs2), we MUST use it via fromIni.
    if (process.env.AWS_PROFILE) {
      return {
        credentials: fromIni({ profile: process.env.AWS_PROFILE }),
        region
      };
    }

    // 2. Fallback to hardcoded environment variables
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

    if (accessKeyId && secretAccessKey) {
      return {
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
        region,
      };
    }

    // 3. Fallback to default provider chain (IAM role, etc.) by omitting credentials
    return { region };
  }

  /**
   * Retrieves AWS Client Config for a specific Ground Station Region by Region ID or Code.
   * @param {number|string} regionIdOrCode
   * @param {string} [overrideRegion]
   * @returns {Promise<{ credentials?: any, region: string }>}
   */
  static async getClientConfigForRegion(regionIdOrCode, overrideRegion = null) {
    if (RegionModel) {
      try {
        let regionObj = null;
        if (typeof regionIdOrCode === "number" || !isNaN(Number(regionIdOrCode))) {
          regionObj = await RegionModel.findById(Number(regionIdOrCode), true);
        } else {
          regionObj = await RegionModel.findByCode(String(regionIdOrCode));
        }

        if (regionObj && regionObj.accessKey && regionObj.secretKey && regionObj.secretKey !== "****************") {
          return {
            credentials: {
              accessKeyId: regionObj.accessKey,
              secretAccessKey: regionObj.secretKey,
            },
            region: overrideRegion || regionObj.awsRegion || "af-south-1"
          };
        }
      } catch (err) {
        console.error(`[AwsConfigHelper] Error loading config for region [${regionIdOrCode}]:`, err.message);
      }
    }
    return this.getClientConfig(null, overrideRegion);
  }

  /**
   * Retrieves AWS Client Config for a specific Account Type ('GS1' | 'GS2').
   * Guarantees strict credential isolation between GS1/SD1 and GS2/SD2.
   * Under no circumstances will GS2 credentials fall back to GS1 credentials or default AWS env keys.
   * @param {'GS1'|'GS2'|'SD1'|'SD2'|string} accountType - 'GS1' or 'GS2'
   * @param {string} [overrideRegion] - AWS region (e.g., 'ap-southeast-2')
   * @returns {Promise<{ credentials?: any, region: string }>}
   */
  static async getClientConfigForAccount(accountType, overrideRegion = null) {
    const isGS2 = String(accountType).toUpperCase().includes("2");
    const targetRegion = overrideRegion || process.env.AWS_REGION || "us-east-1";

    if (isGS2) {
      // 1. GS2-specific Profile (e.g. isro-gs2 in ~/.aws/credentials)
      const gs2Profile = process.env.GS2_AWS_PROFILE || 
                         process.env.CP2_AWS_PROFILE || 
                         process.env.SD2_AWS_PROFILE ||
                         "isro-gs2";

      if (gs2Profile) {
        try {
          const provider = fromIni({ profile: gs2Profile });
          await provider();
          return {
            credentials: provider,
            region: targetRegion
          };
        } catch (profErr) {
          // If profile is not found in ~/.aws/credentials, continue to explicit keys
        }
      }

      // 2. Direct explicit GS2 environment variables
      const gs2AccessKey = process.env.GS2_AWS_ACCESS_KEY_ID || 
                            process.env.CP2_AWS_ACCESS_KEY_ID || 
                            process.env.SD2_AWS_ACCESS_KEY_ID;
      const gs2SecretKey = process.env.GS2_AWS_SECRET_ACCESS_KEY || 
                            process.env.CP2_AWS_SECRET_ACCESS_KEY || 
                            process.env.SD2_AWS_SECRET_ACCESS_KEY;

      if (gs2AccessKey && gs2SecretKey) {
        return {
          credentials: {
            accessKeyId: gs2AccessKey.trim(),
            secretAccessKey: gs2SecretKey.trim(),
          },
          region: targetRegion
        };
      }

      throw new Error("GS2 AWS credentials (isro-gs2 profile or GS2_AWS_ACCESS_KEY_ID) are not configured.");
    } else {
      // GS1 Account
      // 1. Direct explicit GS1 / CP1 environment variables
      const gs1AccessKey = process.env.CP1_AWS_ACCESS_KEY_ID || 
                            process.env.GS1_AWS_ACCESS_KEY_ID || 
                            process.env.SD1_AWS_ACCESS_KEY_ID ||
                            process.env.AWS_ACCESS_KEY_ID;
      const gs1SecretKey = process.env.CP1_AWS_SECRET_ACCESS_KEY || 
                            process.env.GS1_AWS_SECRET_ACCESS_KEY || 
                            process.env.SD1_AWS_SECRET_ACCESS_KEY ||
                            process.env.AWS_SECRET_ACCESS_KEY;

      if (gs1AccessKey && gs1SecretKey) {
        return {
          credentials: {
            accessKeyId: gs1AccessKey.trim(),
            secretAccessKey: gs1SecretKey.trim(),
          },
          region: targetRegion
        };
      }

      // 2. GS1-specific profile
      const gs1Profile = process.env.GS1_AWS_PROFILE || 
                         process.env.CP1_AWS_PROFILE || 
                         process.env.SD1_AWS_PROFILE;
      if (gs1Profile) {
        try {
          const provider = fromIni({ profile: gs1Profile });
          await provider();
          return {
            credentials: provider,
            region: targetRegion
          };
        } catch (profErr) { }
      }

      return { region: targetRegion };
    }
  }

  /**
   * Retrieves AWS Client Config for a specific Ground Station / Satellite Pass.
   * Isolates SD1 and SD2 credentials per region and supports dynamic regions.
   * @param {string} stationId - e.g. "CP1", "CP2", "DU1", "DU2", "PA1", "PA2", "DB1", "DB2", "SG1", "SG2", etc.
   * @param {string} [overrideRegion] - Optional region to override
   * @returns {Promise<{ credentials?: any, region: string }>}
   */
  static async getClientConfigForStation(stationId, overrideRegion = null) {
    const isSD2 = String(stationId).includes("2");

    // 1. If it is an SD2/GS2 station, strictly resolve GS2 account credentials
    if (isSD2) {
      const region = overrideRegion || 
                     process.env[`${String(stationId).toUpperCase()}_AWS_REGION`] ||
                     process.env.CP2_AWS_REGION || 
                     process.env.SD2_AWS_REGION || 
                     process.env.GS2_AWS_REGION || 
                     "af-south-1";
      return this.getClientConfigForAccount("GS2", region);
    }

    // 2. For SD1/GS1 stations, check dynamic database configuration first
    if (RegionModel) {
      try {
        const found = await RegionModel.findByStationId(stationId);
        if (found && found.region && found.region.accessKey && found.region.secretKey) {
          if (found.region.accessKey !== "MOCK_KEY_CPT" && 
              found.region.accessKey !== "MOCK_KEY_DUB" && 
              found.region.accessKey !== "MOCK_KEY_PUQ" && 
              found.region.accessKey !== "MOCK_KEY_DBO") {
            return {
              credentials: {
                accessKeyId: found.region.accessKey,
                secretAccessKey: found.region.secretKey,
              },
              region: overrideRegion || found.region.awsRegion || "af-south-1"
            };
          }
        }
      } catch (err) {
        console.error(`[AwsConfigHelper] Error checking dynamic station config for [${stationId}]:`, err.message);
      }
    }

    const stUpper = String(stationId).toUpperCase();
    const region = overrideRegion || 
                   process.env[`${stUpper}_AWS_REGION`] ||
                   process.env.CP1_AWS_REGION || 
                   process.env.SD1_AWS_REGION || 
                   process.env.GS1_AWS_REGION || 
                   "af-south-1";

    return this.getClientConfigForAccount("GS1", region);
  }
}

module.exports = AwsConfigHelper;

