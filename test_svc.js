require("dotenv").config();
const GroundStationMonitoringService = require("./src/modules/monitoring/services/GroundStationMonitoringService");
(async () => {
  try {
    const data = await GroundStationMonitoringService.getDashboardData("15m");
    console.log("Regions:", data.regions.length);
    console.log("CP2 Status:", data.regions[0].stations[1].status);
  } catch (err) {
    console.error(err);
  }
})();
