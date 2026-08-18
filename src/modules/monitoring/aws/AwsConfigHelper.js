const AwsCredentialProfile = require("./AwsCredentialProfile");

class AwsConfigHelper {
  /**
   * Retrieves AWS Credentials based on profile ID or falls back to environment variables.
   * @param {number} profileId - The ID of the AWS Credential Profile
   * @param {string} [overrideRegion] - Optional region to override the profile's default region
   * @returns {Promise<{ credentials: { accessKeyId: string, secretAccessKey: string }, region: string }>}
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

    // Fallback to environment variables
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const region = overrideRegion || process.env.AWS_REGION || "us-east-1";

    if (!accessKeyId || !secretAccessKey) {
      throw new Error("AWS Credentials not found. Please provide a valid Profile ID or configure environment variables.");
    }

    return {
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      region,
    };
  }
}

module.exports = AwsConfigHelper;
