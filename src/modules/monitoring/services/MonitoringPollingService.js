// src/modules/monitoring/services/MonitoringPollingService.js
const PollingScheduler = require("./PollingScheduler");

class MonitoringPollingService {
  start() {
    PollingScheduler.start().catch((err) =>
      console.error("[monitoring] failed to start scheduler:", err)
    );
    return true;
  }

  stop() {
    PollingScheduler.stop();
    return true;
  }

  getStatus() {
    return PollingScheduler.getStatus();
  }

  async runOnce() {
    return PollingScheduler.runOnce();
  }

  async pollDevice(device) {
    return PollingScheduler.pollDevice(device);
  }
}

module.exports = new MonitoringPollingService();
module.exports.MonitoringPollingService = MonitoringPollingService;
