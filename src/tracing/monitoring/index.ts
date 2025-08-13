/**
 * Performance Monitoring Module Exports
 */

export { 
  PerformanceDashboard,
  defaultDashboardConfig,
  type PerformanceThreshold,
  type PerformanceAlert,
  type MetricsSnapshot,
  type BottleneckAnalysis,
  type TrendAnalysis,
  type DashboardConfig
} from './performance-dashboard.js';

export { 
  PerformanceCollector,
  type SystemMetrics,
  type ResourceThresholds
} from './performance-collector.js';

export { 
  MetricsExporter,
  type ExportOptions,
  type ExportResult
} from './metrics-exporter.js';

export { 
  AlertingService,
  defaultAlertRules,
  type AlertChannel,
  type AlertRule,
  type NotificationResult
} from './alerting-service.js';

export { 
  PerformanceMonitoringExample,
  runPerformanceMonitoringExample
} from './example-usage.js';