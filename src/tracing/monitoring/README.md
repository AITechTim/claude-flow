# Performance Monitoring and Metrics Collection System

A comprehensive performance monitoring system for the Claude Flow tracing infrastructure that provides real-time metrics collection, alert management, bottleneck detection, and trend analysis.

## Features

### 🔍 Real-time Metrics Collection
- **System Metrics**: CPU, memory, disk, and network usage
- **Tracing Overhead**: Collection time, memory usage, storage growth
- **Agent Performance**: Response times, task throughput, resource usage  
- **Query Performance**: Database response times, cache hit rates
- **UI Metrics**: Frame rates, render times, WebSocket latency
- **Custom Metrics**: Extensible metric recording system

### 🚨 Alert System
- **Threshold Monitoring**: Configurable warning and critical thresholds
- **Multi-Channel Alerts**: Console, webhook, email, Slack, Discord
- **Alert Rules**: Custom rules with conditions, duration, and cooldown
- **Alert Filtering**: Channel-specific filters by severity, component, metric
- **Alert History**: Complete audit trail of all alerts

### 📊 Bottleneck Detection
- **Automated Detection**: CPU, memory, I/O, network, coordination bottlenecks
- **Impact Assessment**: Quantified impact scoring (0-100 scale)
- **Resolution Suggestions**: Actionable recommendations for each bottleneck
- **Component Tracking**: Bottleneck attribution to specific system components

### 📈 Trend Analysis
- **Performance Trends**: Improving, degrading, stable, or volatile patterns
- **Predictive Analytics**: Next hour/day predictions with confidence scores
- **Anomaly Detection**: Statistical detection of unusual metric values
- **Historical Patterns**: Long-term performance pattern recognition

### 📤 Export & Reporting
- **Multiple Formats**: JSON, CSV, Prometheus, HTML exports
- **Interactive Reports**: HTML reports with charts and visualizations
- **Summary Reports**: Executive-style performance summaries
- **Tool Integration**: Grafana, DataDog, New Relic export formats

### 🔧 WebSocket Dashboard
- **Real-time Updates**: Live performance data streaming
- **Interactive Charts**: Real-time visualization of metrics
- **Alert Notifications**: Instant alert delivery to connected clients
- **Historical Data**: Access to trend data and historical metrics

## Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────────┐
│                Performance Dashboard                         │
├─────────────────┬─────────────────┬─────────────────────────┤
│  MetricsCollector│  BottleneckDetector│    TrendAnalyzer    │
├─────────────────┼─────────────────┼─────────────────────────┤
│  AlertManager   │  MetricsExporter │   PerformanceCollector │
└─────────────────┴─────────────────┴─────────────────────────┘
```

### Data Flow

```
System Metrics ──┐
Agent Metrics ───┼──→ PerformanceDashboard ──→ WebSocket Clients
Trace Metrics ───┘                           ├──→ Alert System
                                             ├──→ Export System
                                             └──→ Storage
```

## Quick Start

### Basic Setup

```typescript
import { PerformanceDashboard, defaultDashboardConfig } from './performance-dashboard.js';

// Create dashboard with default configuration
const dashboard = new PerformanceDashboard(defaultDashboardConfig, tracingConfig);

// Start monitoring
await dashboard.start();

// Record custom metrics
dashboard.recordCustomMetric('my_metric', 42, 'units');

// Stop monitoring
await dashboard.stop();
```

### Advanced Configuration

```typescript
const customConfig = {
  enabled: true,
  port: 8080,
  updateInterval: 5000, // 5 seconds
  retentionDays: 30,
  alerting: {
    enabled: true,
    channels: [
      { type: 'console', config: {} },
      { type: 'slack', config: { webhook_url: 'https://...' } },
      { type: 'webhook', config: { url: 'https://monitoring.example.com' } }
    ]
  },
  thresholds: [
    { metric: 'system.cpuUsage', warning: 70, critical: 90, unit: '%', description: 'CPU Usage' },
    { metric: 'agents.avgResponseTime', warning: 1000, critical: 3000, unit: 'ms', description: 'Response Time' }
  ],
  exportPath: './analysis-reports'
};

const dashboard = new PerformanceDashboard(customConfig, tracingConfig);
```

## Usage Examples

### Recording Trace Performance

```typescript
// Measure trace collection overhead
dashboard.mark('trace_start');
await processTraces(events);
const duration = dashboard.measure('trace_collection', 'trace_start');
dashboard.recordTraceOverhead(duration, events.length);
```

### Recording Memory Usage

```typescript
// Track memory usage by component
const memoryBytes = process.memoryUsage().heapUsed;
dashboard.recordMemoryUsage('trace_collector', memoryBytes);
```

### Recording Query Performance

```typescript
// Track database query performance
const startTime = Date.now();
const results = await database.query(sql);
const duration = Date.now() - startTime;
dashboard.recordQueryPerformance('session_lookup', duration, results.length);
```

### Custom Alert Rules

```typescript
import { AlertingService } from './alerting-service.js';

const alerting = new AlertingService(logger);

// Add custom alert rule
alerting.addRule({
  id: 'custom-metric-high',
  name: 'High Custom Metric',
  metric: 'custom.metric',
  condition: 'greater_than',
  threshold: 100,
  severity: 'warning',
  duration: 30000, // Must persist for 30 seconds
  cooldown: 300000, // 5 minute cooldown between alerts
  enabled: true,
  description: 'Custom metric is above normal levels',
  tags: ['custom', 'performance']
});
```

### Exporting Metrics

```typescript
import { MetricsExporter } from './metrics-exporter.js';

const exporter = new MetricsExporter(logger, './exports');

// Export in multiple formats
const data = {
  metrics: dashboard.getMetricsHistory({ start: startTime, end: endTime }),
  alerts: dashboard.getActiveAlerts(),
  bottlenecks: dashboard.getCurrentBottlenecks(),
  trends: dashboard.getTrendAnalysis()
};

await exporter.exportMultipleFormats(data, ['json', 'csv', 'html']);

// Generate summary report
await exporter.exportSummaryReport(data);
```

## Metrics Reference

### System Metrics
- `system.cpuUsage` - CPU usage percentage (0-100)
- `system.memoryUsage` - Memory usage percentage (0-100) 
- `system.diskUsage` - Disk usage percentage (0-100)
- `system.networkLatency` - Network latency in milliseconds

### Tracing Metrics
- `tracing.collectionOverhead` - Time spent collecting traces (ms)
- `tracing.memoryUsage` - Memory used by tracing system (MB)
- `tracing.storageGrowth` - Rate of storage growth (bytes/hour)
- `tracing.eventThroughput` - Events processed per second
- `tracing.errorRate` - Error rate (0.0-1.0)

### Agent Metrics
- `agents.totalAgents` - Total number of agents
- `agents.activeAgents` - Currently active agents
- `agents.busyAgents` - Agents currently processing tasks
- `agents.avgResponseTime` - Average agent response time (ms)
- `agents.taskThroughput` - Tasks processed per second

### Query Metrics
- `queries.avgResponseTime` - Average query response time (ms)
- `queries.slowQueries` - Number of slow queries
- `queries.queryThroughput` - Queries per second
- `queries.cacheHitRate` - Cache hit rate (0.0-1.0)

### UI Metrics
- `ui.frameRate` - UI frame rate (FPS)
- `ui.renderTime` - Average render time (ms)
- `ui.webSocketLatency` - WebSocket message latency (ms)
- `ui.uiResponseTime` - UI interaction response time (ms)

## Alert Channels

### Console Alerts
```typescript
{
  type: 'console',
  config: {},
  enabled: true
}
```

### Webhook Alerts
```typescript
{
  type: 'webhook',
  config: {
    url: 'https://your-webhook-endpoint.com',
    headers: { 'Authorization': 'Bearer token' }
  },
  enabled: true,
  filters: {
    severity: ['critical'],
    components: ['system']
  }
}
```

### Slack Integration
```typescript
{
  type: 'slack',
  config: {
    webhook_url: 'https://hooks.slack.com/services/...'
  },
  enabled: true
}
```

### Email Alerts
```typescript
{
  type: 'email',
  config: {
    recipient: 'alerts@yourcompany.com',
    smtp: {
      host: 'smtp.gmail.com',
      port: 587,
      auth: { user: 'user', pass: 'pass' }
    }
  },
  enabled: true
}
```

## WebSocket API

Connect to `ws://localhost:8080` to receive real-time updates:

### Message Types

#### Initial Data
```json
{
  "type": "initial_data",
  "data": {
    "current": { ... },
    "alerts": [...],
    "bottlenecks": [...],
    "config": { ... }
  }
}
```

#### Metrics Update
```json
{
  "type": "metrics_update",
  "data": {
    "timestamp": 1234567890,
    "system": { "cpuUsage": 45.2, ... },
    "agents": { "avgResponseTime": 250, ... },
    ...
  }
}
```

#### Alert Triggered
```json
{
  "type": "alert_triggered",
  "data": {
    "id": "alert-123",
    "severity": "warning",
    "message": "CPU usage above threshold",
    ...
  }
}
```

## Bottleneck Types

### CPU Bottlenecks
- **Detection**: CPU usage > 90%
- **Impact**: Scaled by usage percentage
- **Suggestions**: Reduce concurrent tasks, optimize algorithms

### Memory Bottlenecks  
- **Detection**: Memory usage > 85%
- **Impact**: Scaled by usage percentage
- **Suggestions**: Enable garbage collection, reduce retention

### I/O Bottlenecks
- **Detection**: Query response time > 1000ms
- **Impact**: Based on response time
- **Suggestions**: Add indexes, optimize queries, enable caching

### Coordination Bottlenecks
- **Detection**: Agent response time > 2000ms
- **Impact**: Based on response time
- **Suggestions**: Optimize protocols, reduce message passing

### UI Bottlenecks
- **Detection**: Frame rate < 30 FPS
- **Impact**: Based on frame rate
- **Suggestions**: Reduce update frequency, optimize rendering

## Export Formats

### JSON Export
- Complete data structure with all metrics, alerts, and metadata
- Suitable for programmatic analysis and data processing
- Includes nested objects and arrays for complex data

### CSV Export
- Flattened metrics suitable for spreadsheet analysis
- Time-series data with essential performance indicators
- Compatible with Excel, Google Sheets, and data analysis tools

### HTML Export
- Interactive reports with charts and visualizations
- Executive summaries with key performance indicators
- Embedded JavaScript for data visualization

### Prometheus Export
- Metrics in Prometheus exposition format
- Compatible with Prometheus monitoring system
- Includes help text and metric types

## Configuration Reference

### Dashboard Configuration
```typescript
interface DashboardConfig {
  enabled: boolean;
  port: number;                    // WebSocket server port
  updateInterval: number;          // Metrics collection interval (ms)
  retentionDays: number;          // Data retention period
  alerting: AlertingConfig;
  thresholds: PerformanceThreshold[];
  exportPath: string;             // Export directory path
}
```

### Performance Thresholds
```typescript
interface PerformanceThreshold {
  metric: string;                 // Metric name
  warning: number;               // Warning threshold value
  critical: number;              // Critical threshold value
  unit: string;                  // Unit of measurement
  description: string;           // Human-readable description
}
```

### Alert Configuration
```typescript
interface AlertingConfig {
  enabled: boolean;
  channels: AlertChannel[];       // Notification channels
}
```

## Best Practices

### Metric Collection
1. **Sample Rate**: Start with 5-second intervals, adjust based on load
2. **Data Retention**: Keep 7-30 days of detailed data, longer for summaries
3. **Custom Metrics**: Use consistent naming conventions (component.metric)
4. **Thresholds**: Set warning thresholds at 70-80% of critical values

### Alert Management
1. **Alert Fatigue**: Use cooldown periods to prevent spam
2. **Severity Levels**: Reserve critical alerts for service-impacting issues
3. **Channel Routing**: Route alerts based on severity and component
4. **Documentation**: Include actionable information in alert messages

### Performance Optimization
1. **Batch Updates**: Process metrics in batches to reduce overhead
2. **Compression**: Enable compression for large metric datasets
3. **Indexing**: Use appropriate database indexes for query performance
4. **Cleanup**: Regular cleanup of old data to maintain performance

### Dashboard Usage
1. **Real-time Monitoring**: Use WebSocket connection for live updates
2. **Historical Analysis**: Export data for detailed offline analysis
3. **Trend Monitoring**: Set up alerts for degrading performance trends
4. **Capacity Planning**: Use predictions for resource planning

## Troubleshooting

### Common Issues

#### High Memory Usage
- **Symptom**: Dashboard memory usage grows over time
- **Solution**: Reduce retention period, enable compression, check for memory leaks

#### Slow Query Performance
- **Symptom**: Query response times increase
- **Solution**: Add database indexes, optimize queries, increase cache size

#### WebSocket Disconnections
- **Symptom**: Dashboard clients frequently disconnect
- **Solution**: Check network stability, increase heartbeat interval

#### Missing Metrics
- **Symptom**: Some metrics not appearing in dashboard
- **Solution**: Check metric name spelling, verify collection is enabled

#### Alert Spam
- **Symptom**: Too many alerts being generated
- **Solution**: Increase thresholds, add cooldown periods, use alert filters

### Debug Mode

Enable debug logging for troubleshooting:

```typescript
const config = {
  ...defaultDashboardConfig,
  // Add debug logging
  tracingConfig: {
    ...tracingConfig,
    level: 'debug'
  }
};
```

### Health Checks

Monitor system health:

```typescript
// Check if monitoring is healthy
const isHealthy = dashboard.getHealthScore() > 80;
const stats = collector.getStatistics();
const alertStats = alerting.getStatistics();
```

## Integration Examples

See `example-usage.ts` for a complete integration example showing:
- Dashboard setup and configuration
- Real-time metrics collection
- Alert system integration
- Export functionality
- WebSocket client handling

## Contributing

When adding new metrics or features:

1. **Metric Naming**: Use dot notation (component.metric_name)
2. **Units**: Always specify units in metric definitions
3. **Documentation**: Update this README with new metrics
4. **Tests**: Add tests for new functionality
5. **Examples**: Update examples with new features

## License

This performance monitoring system is part of the Claude Flow project and follows the same licensing terms.