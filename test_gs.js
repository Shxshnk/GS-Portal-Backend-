const GS = require("./src/modules/monitoring/services/GroundStationMonitoringService");
GS.getDashboardData().then(res => console.log(JSON.stringify(res, null, 2))).catch(console.error);
