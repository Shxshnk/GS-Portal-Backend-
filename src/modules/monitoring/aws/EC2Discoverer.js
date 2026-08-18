const { EC2Client, DescribeInstancesCommand } = require("@aws-sdk/client-ec2");

class EC2Discoverer {
  constructor(clientConfig) {
    this.client = new EC2Client(clientConfig);
    this.region = clientConfig.region;
  }

  async discover() {
    const discoveredInstances = [];
    try {
      let nextToken = undefined;
      do {
        const command = new DescribeInstancesCommand({ NextToken: nextToken });
        const response = await this.client.send(command);

        if (response.Reservations) {
          for (const reservation of response.Reservations) {
            if (reservation.Instances) {
              for (const instance of reservation.Instances) {
                discoveredInstances.push(this.normalizeInstance(instance));
              }
            }
          }
        }
        nextToken = response.NextToken;
      } while (nextToken);

      return discoveredInstances;
    } catch (error) {
      console.error("EC2 Discovery failed:", error);
      throw new Error(`EC2 Discovery failed: ${error.message}`);
    }
  }

  normalizeInstance(instance) {
    const tags = instance.Tags || [];
    const nameTag = tags.find((t) => t.Key === "Name");
    const instanceName = nameTag ? nameTag.Value : instance.InstanceId;
    // Structure matching the unified discovery output (with extended AWS fields)
    return {
      provider: "AWS",
      resourceType: "EC2",
      instanceId: instance.InstanceId,
      instanceName: instanceName,
      deviceName: instanceName, // Map for universal compatibility
      ipAddress: instance.PrivateIpAddress || instance.PublicIpAddress || "", // Primary IP for universal display
      privateIp: instance.PrivateIpAddress || null,
      publicIp: instance.PublicIpAddress || null,
      state: instance.State?.Name || "unknown",
      status: instance.State?.Name === "running" ? "ONLINE" : "OFFLINE", // Standard NMS status
      instanceType: instance.InstanceType,
      region: this.region,
      availabilityZone: instance.Placement?.AvailabilityZone || null,
      
      // Extended Metadata
      cloudMetadata: {
        Architecture: instance.Architecture,
        VirtualizationType: instance.VirtualizationType,
        VpcId: instance.VpcId,
        SubnetId: instance.SubnetId,
        SecurityGroups: instance.SecurityGroups || [],
        ImageId: instance.ImageId,
        KeyName: instance.KeyName,
        LaunchTime: instance.LaunchTime,
        RootDeviceName: instance.RootDeviceName,
        RootDeviceType: instance.RootDeviceType,
        EbsOptimized: instance.EbsOptimized,
        PublicDnsName: instance.PublicDnsName,
        PrivateDnsName: instance.PrivateDnsName,
        MonitoringState: instance.Monitoring?.State,
        PlatformDetails: instance.PlatformDetails || instance.Platform || "Linux/UNIX",
        IamInstanceProfile: instance.IamInstanceProfile || null,
        Tags: tags
      }
    };
  }
}

module.exports = EC2Discoverer;
