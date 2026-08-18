# End-to-End Telemetry Verification Report

## Working Router (192.168.121.150)

### SNMP Session Configuration
- IP: 192.168.121.150
- Version: v2c
- Community: public
- Port: 161
- Timeout: 1000
- Retries: 1

### Complete Raw Varbinds (Sample of 10)
*Note: Full raw varbinds saved in JSON report*
```json
[]
```

### Parsed Values (Sample)
```json
{}
```

### pollResult Object (Before DB)
```json
{
  "success": false,
  "status": "OFFLINE",
  "responseTime": 2046,
  "pollDuration": 16165,
  "sysName": null,
  "sysDescr": null,
  "sysObjectID": null,
  "sysUpTime": null,
  "telemetry": [],
  "interfaces": "[Array of 0 interfaces]",
  "error": "Request timed out"
}
```

### Database Row
```json
{
  "id": 30,
  "device_name": "Core-R1.lab.local",
  "ip_address": "192.168.121.150",
  "community": "public",
  "port": 161,
  "snmp_version": "v2c",
  "description": null,
  "sys_name": null,
  "sys_descr": null,
  "sys_uptime": null,
  "status": "OFFLINE",
  "last_polled_at": null,
  "last_poll": "2026-08-10 13:50:05",
  "last_poll_error": "Request timed out",
  "created_at": "2026-08-08 11:46:54",
  "updated_at": "2026-08-10 13:50:05",
  "hostname": "Core-R1.lab.local",
  "mac_address": null,
  "vendor": "Cisco",
  "model": "IOSv",
  "serial_number": "96A650YN7ZEG796QSPJLL",
  "firmware": null,
  "os_version": "IOS 15.8(3)M2",
  "device_type": "Switch",
  "site": null,
  "rack": null,
  "location": null,
  "latitude": null,
  "longitude": null,
  "credentials": {
    "port": 161,
    "retries": 1,
    "timeout": 1000,
    "community": "public",
    "pollInterval": null,
    "enableBulkWalk": null,
    "maxRepetitions": null,
    "maxOidsPerRequest": null,
    "preferredOperation": null,
    "enableInterfaceDiscovery": null,
    "enablePerformancePolling": null,
    "enableHistoricalTelemetry": null,
    "enableEnvironmentalPolling": null
  },
  "availability": 100,
  "health_score": 100,
  "response_time": 2046,
  "poll_duration": 16165,
  "last_successful_poll": "2026-08-10 13:44:47",
  "last_failed_poll": "2026-08-10 13:50:05",
  "is_active": 1,
  "sys_object_id": null,
  "poll_count": 197,
  "error_count": 120,
  "profile_id": null,
  "lifecycle_state": "Configured",
  "cpu_cores": null,
  "total_ram": null,
  "boot_time": null,
  "cpu_util": null,
  "mem_util": null,
  "cpuUtil": 70,
  "memUtil": 7.579046687039368
}
```

### REST API Payload
```json
{
  "id": 30,
  "deviceName": "Core-R1.lab.local",
  "hostname": "Core-R1.lab.local",
  "ipAddress": "192.168.121.150",
  "macAddress": null,
  "vendor": "Cisco",
  "model": "IOSv",
  "serialNumber": "96A650YN7ZEG796QSPJLL",
  "firmware": null,
  "osVersion": "IOS 15.8(3)M2",
  "deviceType": "Switch",
  "site": null,
  "rack": null,
  "location": null,
  "latitude": null,
  "longitude": null,
  "snmpVersion": "v2c",
  "credentials": {
    "port": 161,
    "retries": 1,
    "timeout": 1000,
    "community": "public",
    "pollInterval": null,
    "enableBulkWalk": null,
    "maxRepetitions": null,
    "maxOidsPerRequest": null,
    "preferredOperation": null,
    "enableInterfaceDiscovery": null,
    "enablePerformancePolling": null,
    "enableHistoricalTelemetry": null,
    "enableEnvironmentalPolling": null
  },
  "status": "OFFLINE",
  "lastPoll": "2026-08-10 13:50:05",
  "isActive": true,
  "sysName": null,
  "sysDescr": null,
  "sysObjectID": null,
  "sysUpTime": null,
  "lastPollError": "Request timed out",
  "availability": 100,
  "healthScore": 100,
  "responseTime": 2046,
  "pollDuration": 16165,
  "lastSuccessfulPoll": "2026-08-10 13:44:47",
  "lastFailedPoll": "2026-08-10 13:50:05",
  "pollCount": 197,
  "errorCount": 120,
  "profileId": null,
  "lifecycleState": "Configured",
  "createdAt": "2026-08-08 11:46:54",
  "updatedAt": "2026-08-10 13:50:05",
  "cpuUtil": 70,
  "memUtil": 7.579046687039368,
  "cpuCores": null,
  "totalRam": null,
  "bootTime": null,
  "interfaces": "[Array of 0 interfaces]"
}
```

## Target Switch (192.168.5.4)

### SNMP Session Configuration
- IP: 192.168.5.4
- Version: v2c
- Community: public
- Port: 161
- Timeout: 1000
- Retries: 1

### Complete Raw Varbinds (Sample of 10)
*Note: Full raw varbinds saved in JSON report*
```json
[]
```

### Parsed Values (Sample)
```json
{}
```

### pollResult Object (Before DB)
```json
{
  "success": false,
  "status": "OFFLINE",
  "responseTime": 2018,
  "pollDuration": 12079,
  "sysName": null,
  "sysDescr": null,
  "sysObjectID": null,
  "sysUpTime": null,
  "telemetry": [],
  "interfaces": "[Array of 0 interfaces]",
  "error": "Request timed out"
}
```

### Database Row
```json
{
  "id": 38,
  "device_name": "192.168.5.4",
  "ip_address": "192.168.5.4",
  "community": "public",
  "port": 161,
  "snmp_version": "v2c",
  "description": null,
  "sys_name": null,
  "sys_descr": null,
  "sys_uptime": null,
  "status": "OFFLINE",
  "last_polled_at": null,
  "last_poll": "2026-08-10 13:50:17",
  "last_poll_error": "Request timed out",
  "created_at": "2026-08-10 11:44:34",
  "updated_at": "2026-08-10 13:50:17",
  "hostname": null,
  "mac_address": null,
  "vendor": "Generic",
  "model": "SNMP Device",
  "serial_number": null,
  "firmware": null,
  "os_version": null,
  "device_type": "Other",
  "site": null,
  "rack": null,
  "location": null,
  "latitude": null,
  "longitude": null,
  "credentials": {
    "port": 161,
    "retries": 1,
    "timeout": 1000,
    "community": "public",
    "pollInterval": null,
    "enableBulkWalk": null,
    "maxRepetitions": null,
    "maxOidsPerRequest": null,
    "preferredOperation": null,
    "enableInterfaceDiscovery": null,
    "enablePerformancePolling": null,
    "enableHistoricalTelemetry": null,
    "enableEnvironmentalPolling": null
  },
  "availability": 100,
  "health_score": 100,
  "response_time": 2018,
  "poll_duration": 12079,
  "last_successful_poll": null,
  "last_failed_poll": "2026-08-10 13:50:17",
  "is_active": 1,
  "sys_object_id": null,
  "poll_count": 159,
  "error_count": 159,
  "profile_id": null,
  "lifecycle_state": "Configured",
  "cpu_cores": null,
  "total_ram": null,
  "boot_time": null,
  "cpu_util": null,
  "mem_util": null
}
```

### REST API Payload
```json
{
  "id": 38,
  "deviceName": "192.168.5.4",
  "hostname": null,
  "ipAddress": "192.168.5.4",
  "macAddress": null,
  "vendor": "Generic",
  "model": "SNMP Device",
  "serialNumber": null,
  "firmware": null,
  "osVersion": null,
  "deviceType": "Other",
  "site": null,
  "rack": null,
  "location": null,
  "latitude": null,
  "longitude": null,
  "snmpVersion": "v2c",
  "credentials": {
    "port": 161,
    "retries": 1,
    "timeout": 1000,
    "community": "public",
    "pollInterval": null,
    "enableBulkWalk": null,
    "maxRepetitions": null,
    "maxOidsPerRequest": null,
    "preferredOperation": null,
    "enableInterfaceDiscovery": null,
    "enablePerformancePolling": null,
    "enableHistoricalTelemetry": null,
    "enableEnvironmentalPolling": null
  },
  "status": "OFFLINE",
  "lastPoll": "2026-08-10 13:50:17",
  "isActive": true,
  "sysName": null,
  "sysDescr": null,
  "sysObjectID": null,
  "sysUpTime": null,
  "lastPollError": "Request timed out",
  "availability": 100,
  "healthScore": 100,
  "responseTime": 2018,
  "pollDuration": 12079,
  "lastSuccessfulPoll": null,
  "lastFailedPoll": "2026-08-10 13:50:17",
  "pollCount": 159,
  "errorCount": 159,
  "profileId": null,
  "lifecycleState": "Configured",
  "createdAt": "2026-08-10 11:44:34",
  "updatedAt": "2026-08-10 13:50:17",
  "cpuUtil": null,
  "memUtil": null,
  "cpuCores": null,
  "totalRam": null,
  "bootTime": null,
  "interfaces": "[Array of 0 interfaces]"
}
```

## End-to-End Comparison Table

### Working Router (192.168.121.150)

| Field | Raw SNMP | Parsed | pollResult | Database | API |
|---|---|---|---|---|---|
| sysName | Missing | Missing | null | NULL | null |
| sysDescr | Missing | Missing | null | NULL | null |
| sysObjectID | Missing | Missing | null | NULL | null |
| sysUpTime | Missing | Missing | null | NULL | null |
| hostname | Missing | Missing | Missing | Core-R1.lab.local | Core-R1.lab.local |
| vendor | N/A | N/A | Missing | Cisco | Cisco |
| model | N/A | N/A | Missing | IOSv | IOSv |
| serialNumber | N/A | N/A | Missing | 96A650YN7ZEG796QSPJLL | 96A650YN7ZEG796QSPJLL |
| interfaces | Walked 0 varbinds | N/A | Array(0) | N/A | Missing |
| cpuUtil | N/A | N/A | Missing | 70 | 70 |
| memUtil | N/A | N/A | Missing | 7.579046687039368 | 7.579046687039368 |

### Target Switch (192.168.5.4)

| Field | Raw SNMP | Parsed | pollResult | Database | API |
|---|---|---|---|---|---|
| sysName | Missing | Missing | null | NULL | null |
| sysDescr | Missing | Missing | null | NULL | null |
| sysObjectID | Missing | Missing | null | NULL | null |
| sysUpTime | Missing | Missing | null | NULL | null |
| hostname | Missing | Missing | Missing | NULL | null |
| vendor | N/A | N/A | Missing | Generic | Generic |
| model | N/A | N/A | Missing | SNMP Device | SNMP Device |
| serialNumber | N/A | N/A | Missing | NULL | null |
| interfaces | Walked 0 varbinds | N/A | Array(0) | N/A | Missing |
| cpuUtil | N/A | N/A | Missing | NULL | null |
| memUtil | N/A | N/A | Missing | NULL | null |

## Evidence-Based Conclusion

**Conclusion C: Switch never replies.**

Root cause = timeout/network.