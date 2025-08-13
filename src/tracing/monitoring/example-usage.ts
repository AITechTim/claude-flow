/**
 * Performance Monitoring Dashboard - Usage Example
 * Demonstrates how to integrate and use the performance monitoring system
 */

import { PerformanceDashboard, defaultDashboardConfig } from './performance-dashboard.js';
import { PerformanceCollector } from './performance-collector.js';
import { MetricsExporter } from './metrics-exporter.js';
import { AlertingService, defaultAlertRules } from './alerting-service.js';
import { Logger } from '../../core/logger.js';

/**
 * Example integration class showing how to use the performance monitoring system
 */
export class PerformanceMonitoringExample {
  private dashboard: PerformanceDashboard;
  private collector: PerformanceCollector;
  private exporter: MetricsExporter;
  private alerting: AlertingService;
  private logger: Logger;

  constructor() {
    this.logger = new Logger('PerformanceMonitoringExample');
    
    // Configure dashboard with custom settings
    const config = {
      ...defaultDashboardConfig,
      port: 8081,
      updateInterval: 3000, // 3 seconds for demo
      retentionDays: 7,
      alerting: {
        enabled: true,
        channels: [
          { type: 'console' as const, config: {} },
          { type: 'webhook' as const, config: { url: 'https://example.com/alerts' } }
        ]
      },
      exportPath: './performance-exports'
    };
    
    // Initialize components
    this.dashboard = new PerformanceDashboard(config, {
      enabled: true,
      samplingRate: 1.0,
      bufferSize: 1000,
      flushInterval: 1000,
      storageRetention: 24 * 60 * 60 * 1000, // 24 hours
      compressionEnabled: true,
      realtimeStreaming: true,
      performanceMonitoring: true
    });
    
    this.collector = new PerformanceCollector(this.logger, {
      interval: 2000, // 2 seconds
      maxHistory: 200,
      thresholds: {
        cpu: { warning: 70, critical: 90 },
        memory: { warning: 80, critical: 95 },
        disk: { warning: 85, critical: 95 }
      }
    });
    
    this.exporter = new MetricsExporter(this.logger, './analysis-reports');
    
    this.alerting = new AlertingService(this.logger);
    
    this.setupEventHandlers();
    this.setupDefaultAlerts();
  }

  /**
   * Start the complete monitoring system
   */
  async start(): Promise<void> {
    this.logger.info('Starting performance monitoring system...');
    
    try {
      // Start dashboard (includes WebSocket server)
      await this.dashboard.start();
      
      // Start system metrics collection
      this.collector.start();
      
      this.logger.info('Performance monitoring system started successfully');
      
      // Start demo data generation
      this.startDemoDataGeneration();
      
    } catch (error) {
      this.logger.error('Failed to start performance monitoring system:', error);
      throw error;
    }
  }

  /**
   * Stop the monitoring system
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping performance monitoring system...');
    
    try {
      await this.dashboard.stop();
      this.collector.stop();
      
      // Export final metrics
      await this.exportFinalReport();
      
      this.logger.info('Performance monitoring system stopped');
      
    } catch (error) {
      this.logger.error('Error stopping performance monitoring system:', error);
    }
  }

  /**
   * Demonstrate recording custom metrics
   */
  recordSampleMetrics(): void {
    // Simulate trace collection overhead
    this.dashboard.mark('trace_collection_start');
    setTimeout(() => {
      const duration = this.dashboard.measure('trace_collection', 'trace_collection_start');
      this.dashboard.recordTraceOverhead(duration, 150); // 150 events processed
    }, Math.random() * 50 + 10); // 10-60ms processing time
    
    // Simulate memory usage
    const memoryMB = 256 + Math.random() * 512; // 256-768 MB
    this.dashboard.recordMemoryUsage('tracing_system', memoryMB * 1024 * 1024);
    
    // Simulate storage growth
    const storageSize = 1024 * 1024 * 1024 + Math.random() * 500 * 1024 * 1024; // ~1-1.5GB
    const growthRate = Math.random() * 10 * 1024 * 1024; // 0-10 MB/hour
    this.dashboard.recordStorageGrowth(storageSize, growthRate);
    
    // Simulate query performance
    const queryTypes = ['session_traces', 'agent_metrics', 'time_range_query'];
    const queryType = queryTypes[Math.floor(Math.random() * queryTypes.length)];
    const queryDuration = Math.random() * 500 + 50; // 50-550ms
    const resultCount = Math.floor(Math.random() * 1000) + 10;
    this.dashboard.recordQueryPerformance(queryType, queryDuration, resultCount);
    
    // Simulate UI metrics
    const frameRate = 60 - Math.random() * 20; // 40-60 FPS
    const renderTime = Math.random() * 16.67; // 0-16.67ms (60 FPS = 16.67ms per frame)
    this.dashboard.recordUIMetrics(frameRate, renderTime);
    
    // Simulate WebSocket latency
    const wsLatency = Math.random() * 50 + 5; // 5-55ms
    this.dashboard.recordWebSocketLatency(wsLatency);
    
    // Simulate agent metrics
    const agentId = `agent-${Math.floor(Math.random() * 5) + 1}`;
    this.dashboard.recordAgentMetrics(agentId, {
      responseTime: Math.random() * 1000 + 100, // 100-1100ms
      cpuUsage: Math.random() * 100,
      memoryUsage: Math.random() * 1024 * 1024 * 512, // 0-512MB
      taskCount: Math.floor(Math.random() * 20)
    });
  }

  /**
   * Demonstrate exporting metrics in different formats
   */
  async demonstrateExporting(): Promise<void> {
    this.logger.info('Demonstrating metrics export...');
    
    const metricsData = {
      metrics: this.dashboard.getMetricsHistory({ start: 0, end: Date.now() }),
      alerts: this.dashboard.getActiveAlerts(),
      bottlenecks: this.dashboard.getCurrentBottlenecks(),
      trends: this.dashboard.getTrendAnalysis()
    };
    
    // Export in multiple formats
    const results = await this.exporter.exportMultipleFormats(metricsData, ['json', 'csv', 'html']);
    
    results.forEach(result => {
      if (result.success) {
        this.logger.info(`Exported ${result.recordCount} records to ${result.filePath} (${result.fileSize} bytes)`);
      } else {
        this.logger.error(`Export failed: ${result.error}`);
      }
    });
    
    // Generate summary report
    const summaryResult = await this.exporter.exportSummaryReport(metricsData);
    if (summaryResult.success) {
      this.logger.info(`Generated summary report: ${summaryResult.filePath}`);
    }
  }

  /**
   * Demonstrate bottleneck detection
   */
  simulateBottleneck(): void {
    // Simulate a CPU bottleneck
    this.dashboard.addBottleneck({
      type: 'cpu',
      severity: 'high',
      component: 'agent-orchestrator',
      description: 'High CPU usage detected during task coordination',
      impact: 85,
      suggestions: [
        'Reduce concurrent agent count',
        'Optimize coordination algorithms',
        'Enable task batching'
      ],
      metrics: {
        cpuUsage: 92.5,
        taskCount: 150,
        coordinationOverhead: 45.2
      }
    });
    
    // Simulate a memory bottleneck
    setTimeout(() => {
      this.dashboard.addBottleneck({
        type: 'memory',
        severity: 'medium',
        component: 'trace-storage',
        description: 'Memory usage increasing due to large trace buffer',
        impact: 65,
        suggestions: [
          'Increase flush frequency',
          'Reduce buffer size',
          'Enable compression'
        ],
        metrics: {
          memoryUsage: 87.3,
          bufferSize: 15000,
          compressionRatio: 2.1
        }
      });
    }, 3000);
  }

  /**
   * Demonstrate alert system
   */
  async demonstrateAlerting(): Promise<void> {
    this.logger.info('Demonstrating alert system...');
    
    // Add custom alert channels
    this.alerting.addChannel({
      type: 'slack',
      enabled: true,
      config: {
        webhook_url: 'https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK'
      },
      filters: {
        severity: ['critical'],
        components: ['system', 'agents']
      }
    });
    
    // Test alerts
    await this.alerting.testChannel('console');
    
    // Simulate threshold violations
    this.alerting.checkMetric('system.cpuUsage', 95, Date.now());
    setTimeout(() => {
      this.alerting.checkMetric('agents.avgResponseTime', 3500, Date.now());
    }, 2000);
    
    // Show alert statistics
    setTimeout(() => {
      const stats = this.alerting.getStatistics();
      this.logger.info('Alert statistics:', stats);
    }, 5000);
  }

  // Private methods

  private setupEventHandlers(): void {
    // Dashboard events
    this.dashboard.on('started', () => {
      this.logger.info('📊 Performance dashboard started');
    });
    
    this.dashboard.on('metrics_collected', (snapshot) => {
      // You could process metrics here, e.g., send to external systems
      this.logger.debug('Metrics collected:', {
        timestamp: snapshot.timestamp,
        cpu: snapshot.system.cpuUsage,
        memory: snapshot.system.memoryUsage
      });
    });
    
    this.dashboard.on('alert', (alert) => {
      this.logger.warn(`🚨 Alert triggered: ${alert.message}`);
    });
    
    this.dashboard.on('bottleneck_detected', (bottleneck) => {
      this.logger.warn(`⚠️  Bottleneck detected: ${bottleneck.description}`);
    });
    
    // Collector events
    this.collector.on('started', () => {
      this.logger.info('📈 Performance collector started');
    });
    
    this.collector.on('threshold_exceeded', (alert) => {
      this.logger.warn(`⚠️  Threshold exceeded: ${alert.message}`);
      
      // Forward to alerting system
      this.alerting.checkMetric(alert.type, alert.value, alert.timestamp);
    });
    
    // Alerting events
    this.alerting.on('alert_triggered', ({ rule, alert }) => {
      this.logger.info(`🔔 Alert rule triggered: ${rule.name}`);
    });
    
    this.alerting.on('alert_sent', ({ alert, results }) => {
      const successful = results.filter(r => r.success).length;
      const total = results.length;
      this.logger.info(`📤 Alert sent to ${successful}/${total} channels`);
    });
  }

  private setupDefaultAlerts(): void {
    // Add default alert rules
    defaultAlertRules.forEach(rule => {
      this.alerting.addRule(rule);
    });
    
    this.logger.info(`Added ${defaultAlertRules.length} default alert rules`);
  }

  private startDemoDataGeneration(): void {
    // Generate sample metrics every few seconds
    const metricsInterval = setInterval(() => {
      this.recordSampleMetrics();
    }, 4000);
    
    // Simulate bottlenecks occasionally
    const bottleneckInterval = setInterval(() => {
      if (Math.random() < 0.3) { // 30% chance
        this.simulateBottleneck();
      }
    }, 15000);
    
    // Export reports periodically
    const exportInterval = setInterval(async () => {
      await this.demonstrateExporting();
    }, 60000); // Every minute
    
    // Clean up intervals on shutdown
    this.dashboard.once('stopped', () => {
      clearInterval(metricsInterval);
      clearInterval(bottleneckInterval);
      clearInterval(exportInterval);
    });
  }

  private async exportFinalReport(): Promise<void> {
    try {
      const finalData = {
        metrics: this.dashboard.getMetricsHistory({ start: 0, end: Date.now() }),
        alerts: this.dashboard.getActiveAlerts(),
        bottlenecks: this.dashboard.getCurrentBottlenecks(),
        trends: this.dashboard.getTrendAnalysis()
      };
      
      await this.exporter.exportSummaryReport(finalData);
      this.logger.info('Final performance report exported');
      
    } catch (error) {
      this.logger.error('Failed to export final report:', error);
    }
  }
}

// Example usage function
export async function runPerformanceMonitoringExample(): Promise<void> {
  const monitor = new PerformanceMonitoringExample();
  
  try {
    // Start the monitoring system
    await monitor.start();
    
    console.log('\n🚀 Performance monitoring system is running!');
    console.log('📊 Dashboard available at: http://localhost:8081');
    console.log('📈 Collecting metrics every 3 seconds');
    console.log('⚠️  Alerts configured for CPU, memory, and response time');
    console.log('📤 Exporting reports every minute');
    
    // Demonstrate alerting after a short delay
    setTimeout(() => {
      monitor.demonstrateAlerting();
    }, 10000);
    
    // Keep running for demonstration
    setTimeout(async () => {
      console.log('\n⏹️  Stopping performance monitoring system...');
      await monitor.stop();
      console.log('✅ Performance monitoring system stopped');
      process.exit(0);
    }, 120000); // Run for 2 minutes
    
  } catch (error) {
    console.error('❌ Failed to run performance monitoring example:', error);
    process.exit(1);
  }
}

// Run the example if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runPerformanceMonitoringExample();
}