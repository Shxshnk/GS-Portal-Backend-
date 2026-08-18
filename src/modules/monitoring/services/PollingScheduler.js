// src/modules/monitoring/services/PollingScheduler.js
const MonitoringDevice = require("../models/MonitoringDevice");
const MonitoringProfile = require("../models/MonitoringProfile");
const OidProfile = require("../models/OidProfile");
const DeviceInterface = require("../models/DeviceInterface");
const MonitoringSettings = require("../models/MonitoringSettings");
const IPollerAdapter = require("../adapters/IPollerAdapter");
const HealthEngine = require("./HealthEngine");
const TelemetryService = require("./TelemetryService");

const DEFAULT_INTERVAL_MS = 30000;

class PollingScheduler {
  constructor() {
    this.isRunning = false;
    this.schedule = new Map(); // deviceId -> { nextPollAt: timestamp, executing: boolean }
    this.loopPromise = null;
    this.lastRunAt = null;
    this.lastResult = { total: 0, online: 0, offline: 0, warning: 0, unknown: 0, executing: 0 };
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Build/bootstrap database schema tables
    await MonitoringDevice.ensureTable();

    console.log(`[monitoring] PollingScheduler started | Continuous Async Engine`);
    this.loopPromise = this._loop();
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    console.log("[monitoring] PollingScheduler stopped");
  }

  getStatus() {
    let executing = 0;
    for (const val of this.schedule.values()) {
      if (val.executing) executing++;
    }
    return {
      running: this.isRunning,
      isPolling: executing > 0,
      activeDevices: this.schedule.size,
      executingCount: executing,
      lastRunAt: this.lastRunAt,
      lastResult: this.lastResult,
    };
  }

  async _loop() {
    while (this.isRunning) {
      try {
        const intervalSec = await MonitoringSettings.getNumber("default_poll_interval", 10);
        const intervalMs = intervalSec * 1000;
        const maxConcurrent = await MonitoringSettings.getNumber("max_concurrent_polls", 10);

        // 1. Retention pruning (Throttle to only happen occasionally, e.g., once an hour, but here we'll just let it run)
        // Wait, pruning every 10 seconds is too aggressive. Let's do it based on a timestamp.
        if (!this.lastPruneAt || Date.now() - this.lastPruneAt > 3600000) {
           const retentionDays = await MonitoringSettings.getNumber("telemetry_retention_days", 30);
           await TelemetryService.prune(retentionDays);
           this.lastPruneAt = Date.now();
        }

        // 2. Fetch all active pollable devices
        const devices = await MonitoringDevice.listActive();
        const pollableDevices = devices.filter(d => 
          d.isActive && 
          !["Draft", "Disabled", "Retired"].includes(d.lifecycleState)
        );

        // Sync in-memory schedule with DB active devices
        const currentIds = new Set(pollableDevices.map(d => d.id));
        for (const [id, val] of this.schedule.entries()) {
           if (!currentIds.has(id)) {
             this.schedule.delete(id); // Device deleted or disabled
           }
        }
        for (const device of pollableDevices) {
           if (!this.schedule.has(device.id)) {
             this.schedule.set(device.id, { 
               nextPollAt: Date.now(), 
               lastEnvPollAt: 0, 
               lastHwPollAt: 0,
               consecutiveFailures: 0,
               executing: false 
             });
           }
        }

        // 3. Find devices ready to poll
        const now = Date.now();
        let executingCount = 0;
        const readyToPoll = [];

        for (const [id, state] of this.schedule.entries()) {
           if (state.executing) {
             executingCount++;
           } else if (state.nextPollAt <= now) {
             readyToPoll.push(pollableDevices.find(d => d.id === id));
           }
        }

        this.lastResult.total = pollableDevices.length;
        this.lastResult.executing = executingCount;
        this.lastRunAt = new Date().toISOString();

        // 4. Dispatch tasks without exceeding maxConcurrent
        while (readyToPoll.length > 0 && executingCount < maxConcurrent) {
           const device = readyToPoll.shift();
           if (!device) continue;
           
           const state = this.schedule.get(device.id);
           state.executing = true;
           executingCount++;

           // Adaptive Polling: Exponential backoff for offline devices
           let baseIntervalMs = (device.pollInterval ? device.pollInterval : intervalSec) * 1000;
           if (state.consecutiveFailures > 0) {
              const backoff = Math.min(baseIntervalMs * Math.pow(2, state.consecutiveFailures), 120000); // Max 120s
              baseIntervalMs = backoff;
           }

           // Stratified Polling
           const doEnvPoll = (now - state.lastEnvPollAt) >= 30000;
           const doHwPoll = (now - state.lastHwPollAt) >= 300000;
           const pollOptions = { doEnvPoll, doHwPoll };

           // Run async without awaiting to avoid blocking the main loop
           this.pollDevice(device, pollOptions, true)
             .then((pollResult) => {
                const key = String(pollResult.status || "UNKNOWN").toLowerCase();
                if (Object.prototype.hasOwnProperty.call(this.lastResult, key)) {
                  this.lastResult[key] += 1;
                }
                
                const finishedState = this.schedule.get(device.id);
                if (finishedState) {
                  if (doEnvPoll && pollResult.success) finishedState.lastEnvPollAt = Date.now();
                  if (doHwPoll && pollResult.success) finishedState.lastHwPollAt = Date.now();
                }
             })
             .catch((err) => {
                console.error(`[monitoring] error polling device ${device.id}:`, err);
             })
             .finally(() => {
                const finishedState = this.schedule.get(device.id);
                if (finishedState) {
                   finishedState.nextPollAt = Date.now() + baseIntervalMs;
                }
             });
        }
      } catch (err) {
         console.error("[monitoring] Scheduler loop error:", err);
      }

      // Wait 1 second before next evaluation tick
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  async pollDevice(device, options = { doEnvPoll: true, doHwPoll: true }, fromScheduler = false) {
    const provider = String(device.provider || "SNMP").toUpperCase();
    
    // Future placeholders for unsupported providers
    if (provider === "AZURE" || provider === "GCP") {
      console.log(`[POLL SKIP] ${provider} Poll not yet implemented for device ${device.id}`);
      return { success: true, status: "SKIPPED", error: `${provider} Poll (future)` };
    }
    
    // For SNMP we preserve the existing _pollSnmp method logic for compatibility
    if (provider === "SNMP") {
      return await this._pollSnmp(device, options, fromScheduler);
    }
    
    // For AWS and other providers, use the adapter pattern
    return await this._pollAdapter(device, options, fromScheduler, provider);
  }
  
  async _pollAdapter(device, options, fromScheduler, provider) {
    const pollId = Math.random().toString(36).substring(7);
    console.log(`\n[POLL START]\ndeviceId=${device.id}\nprovider=${provider}\npollId=${pollId}\ntimestamp=${new Date().toISOString()}`);

    let state = this.schedule.get(device.id);
    if (!state) {
       state = { consecutiveFailures: 0, executing: false };
       this.schedule.set(device.id, state);
    }

    if (!fromScheduler) {
      if (state.executing) {
        console.log(`[POLL SKIP] deviceId=${device.id} is already executing.`);
        return { success: false, error: "Already executing" };
      }
      state.executing = true;
    }
    console.log(`[POLL LOCK]\ndeviceId=${device.id}\naction=START\n`);

    try {
      const IPollerAdapter = require("../adapters/IPollerAdapter");
      const adapter = IPollerAdapter.getAdapter(provider);
      
      const pollResult = await adapter.poll(device, null, options);
      
      console.log(`[POLL RESULT]\ndeviceId=${device.id}\npollId=${pollId}\nsuccess=${pollResult.success}\nstatus=${pollResult.status}`);
      
      const previousStatus = device.status || "UNKNOWN";
      const newStatus = pollResult.status || previousStatus;

      console.log(`[POLL STATE]\npreviousStatus=${previousStatus}\nnewStatus=${newStatus}\nconsecutiveFailures=${state.consecutiveFailures}`);
      
      // Update Device in DB
      await MonitoringDevice.updateById(device.id, {
        status: newStatus,
        availability: pollResult.availability !== undefined ? pollResult.availability : device.availability,
        healthScore: pollResult.healthScore !== undefined ? pollResult.healthScore : device.healthScore,
        responseTime: pollResult.responseTime !== undefined ? pollResult.responseTime : device.responseTime,
        lastPolledAt: new Date(),
        state: provider === "AWS" && pollResult.ec2State ? pollResult.ec2State : device.state,
      });
      
      // Save Telemetry
      if (pollResult.telemetry && pollResult.telemetry.length > 0) {
        await TelemetryService.recordTelemetry(device.id, pollResult.telemetry, provider, "POLLING");
      }
      
      return pollResult;
    } catch (err) {
      console.error(`[monitoring] Adapter poll error for device ${device.id}:`, err);
      return { success: false, error: err.message };
    } finally {
      if (fromScheduler) {
        state.executing = false;
        console.log(`[POLL END]\ndeviceId=${device.id}\npollId=${pollId}`);
        console.log(`[POLL LOCK]\ndeviceId=${device.id}\naction=RELEASE\n`);
      }
    }
  }

  async _pollSnmp(device, options = { doEnvPoll: true, doHwPoll: true }, fromScheduler = false) {
    const pollId = Math.random().toString(36).substring(7);
    console.log(`\n[POLL START]\ndeviceId=${device.id}\npollId=${pollId}\ntimestamp=${new Date().toISOString()}`);

    let state = this.schedule.get(device.id);
    if (!state) {
      state = { nextPollAt: 0, lastEnvPollAt: 0, lastHwPollAt: 0, consecutiveFailures: 0, executing: false };
      this.schedule.set(device.id, state);
    }

    if (!fromScheduler) {
      if (state.executing) {
        console.log(`[POLL LOCK]\ndeviceId=${device.id}\naction=BUSY`);
        return { success: false, status: "BUSY", error: "Device is currently being polled" };
      }
      state.executing = true;
    }
    console.log(`[POLL LOCK]\ndeviceId=${device.id}\naction=START`);

    try {
      const settings = await MonitoringSettings.list();

    // 1. Resolve Monitoring Profile (inherit rules)
    let profile = null;
    if (device.profileId) {
      profile = await MonitoringProfile.findById(device.profileId);
    }
    if (!profile) {
      // Fallback to default
      const profiles = await MonitoringProfile.list();
      profile = profiles.find(p => p.name === "Generic SNMP Monitor") || {
        pollInterval: 10,
        timeout: 2500,
        retries: 1,
        healthRules: [],
      };
    }

    // 2. Resolve OID Profile
    let oids = null;
    if (profile.oidProfileId) {
      oids = await OidProfile.findById(profile.oidProfileId);
    }
    if (!oids) {
      const oidProfiles = await OidProfile.list();
      oids = oidProfiles.find(o => o.name === "Generic SNMP Device") || {
        systemOids: {},
        cpuOids: {},
        memoryOids: {},
        tempOids: {},
        interfaceOids: {},
      };
    }

    // Embed OID maps into profile for adapter queries
    profile.systemOids = oids.systemOids;
    profile.cpuOids = oids.cpuOids;
    profile.memoryOids = oids.memoryOids;
    profile.tempOids = oids.tempOids;
    profile.interfaceOids = oids.interfaceOids;

    // 3. Resolve Poller Adapter dynamically based on protocol
    const adapter = IPollerAdapter.getAdapter(device.snmpVersion ? "snmp" : "mock");

    // 4. Perform Poll with Stratified Options
    const pollResult = await adapter.poll(device, profile, settings, options);

    // 5. Apply Status Hysteresis and Calculate availability
    const previousStatus = device.status || "UNKNOWN";
    const previousFailures = state.consecutiveFailures || 0;
    
    console.log(`[POLL RESULT]\ndeviceId=${device.id}\npollId=${pollId}\nsuccess=${pollResult.success}\nresponseTime=${pollResult.responseTime}\nerror=${pollResult.error || "none"}`);

    if (pollResult.status === "OFFLINE") {
      state.consecutiveFailures = previousFailures + 1;
      const threshold = await MonitoringSettings.getNumber("failure_threshold", 3);
      if (previousStatus === "ONLINE" && state.consecutiveFailures < threshold) {
        pollResult.status = "ONLINE"; // Override to preserve ONLINE during temporary failure
      }
    } else if (pollResult.status === "ONLINE") {
      state.consecutiveFailures = 0;
    }

    console.log(`[POLL STATE]\npreviousStatus=${previousStatus}\nnewStatus=${pollResult.status}\nconsecutiveFailures=${state.consecutiveFailures}`);

    const newPollCount = device.pollCount + 1;
    const newErrorCount = device.errorCount + (!pollResult.success ? 1 : 0);
    pollResult.availability = ((newPollCount - newErrorCount) / newPollCount) * 100;

    // 6. Evaluate health score using the Health Engine rules
    pollResult.healthScore = HealthEngine.calculateHealth(
      pollResult.telemetry,
      profile.healthRules,
      pollResult.responseTime
    );

    // If device is offline, set health to 0
    if (pollResult.status === "OFFLINE") {
      pollResult.healthScore = 0;
    }

    // 7. Store Telemetry
    const globalMetrics = [
      { metricName: "availability", rawValue: String(pollResult.availability), convertedValue: pollResult.availability, unit: "%" },
      { metricName: "health_score", rawValue: String(pollResult.healthScore), convertedValue: pollResult.healthScore, unit: "%" },
      { metricName: "response_time", rawValue: String(pollResult.responseTime || 0), convertedValue: pollResult.responseTime, unit: "ms" },
      { metricName: "poll_duration", rawValue: String(pollResult.pollDuration || 0), convertedValue: pollResult.pollDuration, unit: "ms" },
      { metricName: "status", rawValue: pollResult.status },
      { metricName: "error", rawValue: pollResult.error || "" }
    ];
    const combinedTelemetry = [...pollResult.telemetry, ...globalMetrics];
    await TelemetryService.recordTelemetry(device.id, combinedTelemetry, "SNMP", "POLLING");

    // 8. Store Discovered Interfaces
    if (pollResult.interfaces.length > 0) {
      for (const iface of pollResult.interfaces) {
        await DeviceInterface.upsert(iface);
      }
    }

    // 9. Update device properties database record
    await MonitoringDevice.updatePollResultExtended(device.id, pollResult);

    return pollResult;
    } finally {
      state.executing = false;
      console.log(`[POLL END]\ndeviceId=${device.id}\npollId=${pollId}`);
      console.log(`[POLL LOCK]\ndeviceId=${device.id}\naction=RELEASE\n`);
    }
  }
}

module.exports = new PollingScheduler();
