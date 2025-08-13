/**
 * Performance Monitoring and Metrics Collection System
 * 
 * Features:
 * - Real-time metrics collection
 * - Performance threshold monitoring  
 * - Alert system for violations
 * - Metrics aggregation and reporting
 * - Bottleneck detection
 * - Resource usage tracking
 * - Historical trend analysis
 * - Export metrics for analysis
 */

import { EventEmitter } from 'node:events';
import { performance, PerformanceObserver } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';
import { 
  TraceEvent, 
  PerformanceMetrics, 
  TracingConfig,
  TimeRange,
  AgentState,
  ResourceUsage
} from '../types.js';
import { Logger } from '../../core/logger.js';
import { generateId } from '../../utils/helpers.js';

export interface PerformanceThreshold {
  metric: string;
  warning: number;
  critical: number;
  unit: string;
  description: string;
}

export interface PerformanceAlert {
  id: string;
  timestamp: number;
  severity: 'warning' | 'critical';
  metric: string;
  value: number;
  threshold: number;
  message: string;
  component: string;
  resolved: boolean;
  resolvedAt?: number;
}

export interface MetricsSnapshot {
  timestamp: number;
  tracing: {
    collectionOverhead: number;
    memoryUsage: number;
    storageGrowth: number;
    eventThroughput: number;
    errorRate: number;
  };
  system: {
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
    networkLatency: number;
  };
  agents: {
    totalAgents: number;
    activeAgents: number;
    busyAgents: number;
    avgResponseTime: number;
    taskThroughput: number;
  };
  queries: {
    avgResponseTime: number;
    slowQueries: number;
    queryThroughput: number;
    cacheHitRate: number;
  };
  ui: {
    frameRate: number;
    renderTime: number;
    webSocketLatency: number;
    uiResponseTime: number;
  };
}

export interface BottleneckAnalysis {
  id: string;
  timestamp: number;
  type: 'cpu' | 'memory' | 'io' | 'network' | 'coordination' | 'ui';
  severity: 'low' | 'medium' | 'high' | 'critical';
  component: string;
  description: string;
  impact: number; // 0-100 scale
  suggestions: string[];
  metrics: Record<string, number>;
  resolution?: {
    action: string;
    timestamp: number;
    effectiveness: number;
  };
}

export interface TrendAnalysis {
  metric: string;
  timeRange: TimeRange;
  trend: 'improving' | 'degrading' | 'stable' | 'volatile';
  rate: number; // Rate of change
  prediction: {
    nextHour: number;
    nextDay: number;
    confidence: number;
  };
  anomalies: Array<{
    timestamp: number;
    value: number;
    deviation: number;
  }>;
}

export interface DashboardConfig {
  enabled: boolean;
  port: number;
  updateInterval: number;
  retentionDays: number;
  alerting: {
    enabled: boolean;
    channels: Array<{
      type: 'console' | 'webhook' | 'email';
      config: Record<string, any>;
    }>;
  };
  thresholds: PerformanceThreshold[];
  exportPath: string;
}

export class PerformanceDashboard extends EventEmitter {
  private config: DashboardConfig;
  private logger: Logger;
  private metricsHistory: MetricsSnapshot[] = [];
  private alerts: PerformanceAlert[] = [];
  private bottlenecks: BottleneckAnalysis[] = [];
  private trends: Map<string, TrendAnalysis> = new Map();
  
  // Real-time monitoring
  private performanceObserver: PerformanceObserver;
  private metricsCollector: MetricsCollector;
  private bottleneckDetector: BottleneckDetector;
  private trendAnalyzer: TrendAnalyzer;
  private alertManager: AlertManager;
  
  // WebSocket server for real-time updates
  private wsServer?: WebSocket.Server;
  private clients: Set<WebSocket> = new Set();
  
  // Timing and intervals
  private updateTimer?: NodeJS.Timeout;
  private cleanupTimer?: NodeJS.Timeout;
  private exportTimer?: NodeJS.Timeout;
  
  // Performance tracking
  private startTime = Date.now();
  private lastSnapshot?: MetricsSnapshot;
  private performanceMarks = new Map<string, number>();

  constructor(config: DashboardConfig, tracingConfig: TracingConfig) {
    super();
    
    this.config = config;
    this.logger = new Logger('PerformanceDashboard');
    
    this.metricsCollector = new MetricsCollector(this.logger);
    this.bottleneckDetector = new BottleneckDetector(this.logger, config.thresholds);
    this.trendAnalyzer = new TrendAnalyzer(this.logger);
    this.alertManager = new AlertManager(this.logger, config.alerting);
    
    this.setupPerformanceObserver();
    this.loadHistoricalData();
    
    if (config.enabled) {
      this.start();
    }
  }

  /**
   * Start the performance monitoring dashboard
   */
  async start(): Promise<void> {
    this.logger.info('Starting performance monitoring dashboard...');
    
    // Start WebSocket server for real-time updates
    if (this.config.port > 0) {
      await this.startWebSocketServer();
    }
    
    // Start metrics collection
    this.startMetricsCollection();
    
    // Start trend analysis
    this.startTrendAnalysis();
    
    // Start cleanup tasks
    this.startCleanupTasks();
    
    // Start automated exports
    this.startAutomatedExports();
    
    this.logger.info(`Performance dashboard started on port ${this.config.port}`);
    this.emit('started');
  }

  /**
   * Stop the performance monitoring dashboard
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping performance dashboard...');
    
    // Stop timers
    if (this.updateTimer) clearInterval(this.updateTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    if (this.exportTimer) clearInterval(this.exportTimer);
    
    // Close WebSocket server
    if (this.wsServer) {
      this.wsServer.close();
      this.clients.clear();
    }
    
    // Disconnect performance observer
    this.performanceObserver.disconnect();
    
    // Final export
    await this.exportMetrics();
    
    this.logger.info('Performance dashboard stopped');
    this.emit('stopped');
  }

  /**
   * Record a performance mark for timing measurements
   */
  mark(name: string): void {
    this.performanceMarks.set(name, performance.now());
    performance.mark(name);
  }

  /**
   * Measure time between marks and record metric
   */
  measure(name: string, startMark: string, endMark?: string): number {
    const startTime = this.performanceMarks.get(startMark);
    if (!startTime) {
      this.logger.warn(`Start mark '${startMark}' not found`);
      return 0;
    }
    
    const endTime = endMark ? 
      this.performanceMarks.get(endMark) || performance.now() : 
      performance.now();
    
    const duration = endTime - startTime;
    
    // Record the measurement
    performance.measure(name, startMark, endMark);
    
    // Add to metrics
    this.recordCustomMetric(`timing.${name}`, duration, 'ms');
    
    return duration;
  }

  /**
   * Record a custom metric value
   */
  recordCustomMetric(name: string, value: number, unit = 'count'): void {
    this.metricsCollector.recordMetric(name, value, unit);
    
    // Check thresholds
    const threshold = this.config.thresholds.find(t => t.metric === name);
    if (threshold) {
      this.checkThreshold(name, value, threshold);
    }
  }

  /**
   * Record trace collection overhead
   */
  recordTraceOverhead(duration: number, eventCount: number): void {
    this.recordCustomMetric('tracing.collection_overhead', duration, 'ms');
    this.recordCustomMetric('tracing.events_per_second', eventCount / (duration / 1000));
    
    // Calculate overhead percentage
    const overheadPercent = (duration / 1000) * 100; // Assuming 1s base time
    this.recordCustomMetric('tracing.overhead_percent', overheadPercent, '%');
  }

  /**
   * Record memory usage for tracing system
   */
  recordMemoryUsage(component: string, bytes: number): void {
    this.recordCustomMetric(`memory.${component}`, bytes, 'bytes');
    
    // Convert to MB for easier reading
    this.recordCustomMetric(`memory.${component}_mb`, bytes / (1024 * 1024), 'MB');
  }

  /**
   * Record storage growth metrics
   */
  recordStorageGrowth(size: number, growth: number): void {
    this.recordCustomMetric('storage.total_size', size, 'bytes');
    this.recordCustomMetric('storage.growth_rate', growth, 'bytes/hour');
    
    // Convert to MB
    this.recordCustomMetric('storage.total_size_mb', size / (1024 * 1024), 'MB');
  }

  /**
   * Record query performance metrics
   */
  recordQueryPerformance(queryType: string, duration: number, resultCount: number): void {
    this.recordCustomMetric(`query.${queryType}.duration`, duration, 'ms');
    this.recordCustomMetric(`query.${queryType}.results`, resultCount);
    this.recordCustomMetric(`query.${queryType}.throughput`, resultCount / (duration / 1000), 'results/sec');
  }

  /**
   * Record WebSocket latency
   */
  recordWebSocketLatency(latency: number): void {
    this.recordCustomMetric('websocket.latency', latency, 'ms');
  }

  /**
   * Record UI performance metrics
   */
  recordUIMetrics(frameRate: number, renderTime: number): void {
    this.recordCustomMetric('ui.frame_rate', frameRate, 'fps');
    this.recordCustomMetric('ui.render_time', renderTime, 'ms');
    
    // Calculate UI responsiveness score
    const responsiveness = Math.min(100, (frameRate / 60) * 100);
    this.recordCustomMetric('ui.responsiveness_score', responsiveness, 'score');
  }

  /**
   * Record agent performance metrics
   */
  recordAgentMetrics(agentId: string, metrics: {
    responseTime: number;
    cpuUsage: number;
    memoryUsage: number;
    taskCount: number;
  }): void {
    const prefix = `agent.${agentId}`;
    
    this.recordCustomMetric(`${prefix}.response_time`, metrics.responseTime, 'ms');
    this.recordCustomMetric(`${prefix}.cpu_usage`, metrics.cpuUsage, '%');
    this.recordCustomMetric(`${prefix}.memory_usage`, metrics.memoryUsage, 'bytes');
    this.recordCustomMetric(`${prefix}.task_count`, metrics.taskCount);
  }

  /**
   * Get current performance snapshot
   */
  getCurrentSnapshot(): MetricsSnapshot {
    return this.metricsCollector.collectSnapshot();
  }

  /**
   * Get metrics history for a time range
   */
  getMetricsHistory(timeRange: TimeRange): MetricsSnapshot[] {
    return this.metricsHistory.filter(
      snapshot => snapshot.timestamp >= timeRange.start && snapshot.timestamp <= timeRange.end
    );
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): PerformanceAlert[] {
    return this.alerts.filter(alert => !alert.resolved);
  }

  /**
   * Get current bottlenecks
   */
  getCurrentBottlenecks(): BottleneckAnalysis[] {
    const now = Date.now();
    const recentThreshold = now - (30 * 60 * 1000); // Last 30 minutes
    
    return this.bottlenecks.filter(
      bottleneck => bottleneck.timestamp >= recentThreshold && !bottleneck.resolution
    );
  }

  /**
   * Get trend analysis for metrics
   */
  getTrendAnalysis(metrics?: string[]): TrendAnalysis[] {
    if (metrics) {
      return metrics
        .map(metric => this.trends.get(metric))
        .filter(trend => trend !== undefined) as TrendAnalysis[];
    }
    
    return Array.from(this.trends.values());
  }

  /**
   * Export metrics to various formats
   */
  async exportMetrics(format: 'json' | 'csv' | 'html' = 'json'): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `performance-metrics-${timestamp}.${format}`;
    const filepath = join(this.config.exportPath, filename);
    
    const data = {
      exportTime: Date.now(),
      config: this.config,
      metrics: this.metricsHistory,
      alerts: this.alerts,
      bottlenecks: this.bottlenecks,
      trends: Array.from(this.trends.entries()),
      summary: this.generateSummaryReport()
    };
    
    try {
      switch (format) {
        case 'json':
          writeFileSync(filepath, JSON.stringify(data, null, 2));
          break;
          
        case 'csv':
          const csv = this.convertToCSV(data);
          writeFileSync(filepath, csv);
          break;
          
        case 'html':
          const html = this.generateHTMLReport(data);
          writeFileSync(filepath, html);
          break;
      }
      
      this.logger.info(`Metrics exported to ${filepath}`);
      return filepath;
      
    } catch (error) {
      this.logger.error('Failed to export metrics:', error);
      throw error;
    }
  }

  /**
   * Generate performance summary report
   */
  generateSummaryReport(): {
    overview: any;
    topBottlenecks: BottleneckAnalysis[];
    criticalAlerts: PerformanceAlert[];
    recommendations: string[];
  } {
    const now = Date.now();
    const uptime = now - this.startTime;
    const recent = this.metricsHistory.slice(-10); // Last 10 snapshots
    
    // Calculate averages
    const avgMetrics = recent.length > 0 ? {
      cpuUsage: recent.reduce((sum, s) => sum + s.system.cpuUsage, 0) / recent.length,
      memoryUsage: recent.reduce((sum, s) => sum + s.system.memoryUsage, 0) / recent.length,
      responseTime: recent.reduce((sum, s) => sum + s.agents.avgResponseTime, 0) / recent.length,
      throughput: recent.reduce((sum, s) => sum + s.agents.taskThroughput, 0) / recent.length
    } : null;
    
    const overview = {
      uptime,
      totalSnapshots: this.metricsHistory.length,
      totalAlerts: this.alerts.length,
      activeAlerts: this.getActiveAlerts().length,
      totalBottlenecks: this.bottlenecks.length,
      currentBottlenecks: this.getCurrentBottlenecks().length,
      averageMetrics: avgMetrics
    };
    
    // Top bottlenecks by impact
    const topBottlenecks = this.bottlenecks
      .sort((a, b) => b.impact - a.impact)
      .slice(0, 5);
    
    // Critical alerts
    const criticalAlerts = this.alerts.filter(alert => 
      alert.severity === 'critical' && !alert.resolved
    );
    
    // Generate recommendations
    const recommendations = this.generateRecommendations();
    
    return {
      overview,
      topBottlenecks,
      criticalAlerts,
      recommendations
    };
  }

  /**
   * Resolve an alert manually
   */
  resolveAlert(alertId: string, resolution?: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (!alert || alert.resolved) {
      return false;
    }
    
    alert.resolved = true;
    alert.resolvedAt = Date.now();
    
    if (resolution) {
      (alert as any).resolution = resolution;
    }
    
    this.broadcastToClients({
      type: 'alert_resolved',
      data: alert
    });
    
    this.logger.info(`Alert ${alertId} resolved: ${resolution || 'Manual resolution'}`);
    return true;
  }

  /**
   * Add a custom bottleneck analysis
   */
  addBottleneck(bottleneck: Omit<BottleneckAnalysis, 'id' | 'timestamp'>): string {
    const analysis: BottleneckAnalysis = {
      ...bottleneck,
      id: generateId('bottleneck'),
      timestamp: Date.now()
    };
    
    this.bottlenecks.push(analysis);
    
    this.broadcastToClients({
      type: 'bottleneck_detected',
      data: analysis
    });
    
    return analysis.id;
  }

  // Private methods

  private setupPerformanceObserver(): void {
    this.performanceObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      
      for (const entry of entries) {
        if (entry.entryType === 'measure') {
          this.recordCustomMetric(`performance.${entry.name}`, entry.duration, 'ms');
        }
      }
    });
    
    this.performanceObserver.observe({ entryTypes: ['measure', 'navigation', 'resource'] });
  }

  private async startWebSocketServer(): Promise<void> {
    this.wsServer = new WebSocket.Server({ port: this.config.port });
    
    this.wsServer.on('connection', (ws) => {
      this.clients.add(ws);
      
      // Send initial data
      ws.send(JSON.stringify({
        type: 'initial_data',
        data: {
          current: this.getCurrentSnapshot(),
          alerts: this.getActiveAlerts(),
          bottlenecks: this.getCurrentBottlenecks(),
          config: this.config
        }
      }));
      
      ws.on('close', () => {
        this.clients.delete(ws);
      });
      
      ws.on('error', (error) => {
        this.logger.error('WebSocket error:', error);
        this.clients.delete(ws);
      });
    });
    
    this.logger.info(`WebSocket server started on port ${this.config.port}`);
  }

  private startMetricsCollection(): void {
    this.updateTimer = setInterval(() => {
      try {
        const snapshot = this.metricsCollector.collectSnapshot();
        this.metricsHistory.push(snapshot);
        this.lastSnapshot = snapshot;
        
        // Detect bottlenecks
        const bottlenecks = this.bottleneckDetector.analyze(snapshot, this.lastSnapshot);
        bottlenecks.forEach(bottleneck => {
          this.bottlenecks.push(bottleneck);
          this.emit('bottleneck_detected', bottleneck);
        });
        
        // Check for alerts
        this.checkAllThresholds(snapshot);
        
        // Broadcast to connected clients
        this.broadcastToClients({
          type: 'metrics_update',
          data: snapshot
        });
        
        this.emit('metrics_collected', snapshot);
        
      } catch (error) {
        this.logger.error('Error collecting metrics:', error);
      }
    }, this.config.updateInterval);
  }

  private startTrendAnalysis(): void {
    // Run trend analysis every 5 minutes
    setInterval(() => {
      try {
        const trends = this.trendAnalyzer.analyzeMetrics(this.metricsHistory);
        
        trends.forEach(trend => {
          this.trends.set(trend.metric, trend);
        });
        
        this.broadcastToClients({
          type: 'trends_update',
          data: Array.from(this.trends.values())
        });
        
      } catch (error) {
        this.logger.error('Error analyzing trends:', error);
      }
    }, 5 * 60 * 1000);
  }

  private startCleanupTasks(): void {
    this.cleanupTimer = setInterval(() => {
      const retentionTime = Date.now() - (this.config.retentionDays * 24 * 60 * 60 * 1000);
      
      // Clean old metrics
      this.metricsHistory = this.metricsHistory.filter(
        snapshot => snapshot.timestamp >= retentionTime
      );
      
      // Clean old alerts
      this.alerts = this.alerts.filter(
        alert => alert.timestamp >= retentionTime
      );
      
      // Clean old bottlenecks
      this.bottlenecks = this.bottlenecks.filter(
        bottleneck => bottleneck.timestamp >= retentionTime
      );
      
      this.logger.debug('Cleaned up old performance data');
      
    }, 60 * 60 * 1000); // Every hour
  }

  private startAutomatedExports(): void {
    this.exportTimer = setInterval(async () => {
      try {
        await this.exportMetrics('json');
        await this.exportMetrics('html');
      } catch (error) {
        this.logger.error('Automated export failed:', error);
      }
    }, 24 * 60 * 60 * 1000); // Daily exports
  }

  private checkThreshold(metric: string, value: number, threshold: PerformanceThreshold): void {
    let severity: 'warning' | 'critical' | null = null;
    let thresholdValue: number;
    
    if (value >= threshold.critical) {
      severity = 'critical';
      thresholdValue = threshold.critical;
    } else if (value >= threshold.warning) {
      severity = 'warning';
      thresholdValue = threshold.warning;
    }
    
    if (severity) {
      const alert: PerformanceAlert = {
        id: generateId('alert'),
        timestamp: Date.now(),
        severity,
        metric,
        value,
        threshold: thresholdValue,
        message: `${threshold.description}: ${value}${threshold.unit} (threshold: ${thresholdValue}${threshold.unit})`,
        component: metric.split('.')[0],
        resolved: false
      };
      
      this.alerts.push(alert);
      this.alertManager.triggerAlert(alert);
      
      this.broadcastToClients({
        type: 'alert_triggered',
        data: alert
      });
      
      this.emit('alert', alert);
    }
  }

  private checkAllThresholds(snapshot: MetricsSnapshot): void {
    // Flatten snapshot into metric values
    const metrics = this.flattenMetrics(snapshot);
    
    for (const [metricName, value] of Object.entries(metrics)) {
      const threshold = this.config.thresholds.find(t => t.metric === metricName);
      if (threshold && typeof value === 'number') {
        this.checkThreshold(metricName, value, threshold);
      }
    }
  }

  private flattenMetrics(obj: any, prefix = ''): Record<string, number> {
    const result: Record<string, number> = {};
    
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      
      if (typeof value === 'number') {
        result[fullKey] = value;
      } else if (typeof value === 'object' && value !== null) {
        Object.assign(result, this.flattenMetrics(value, fullKey));
      }
    }
    
    return result;
  }

  private broadcastToClients(message: any): void {
    const data = JSON.stringify(message);
    
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(data);
        } catch (error) {
          this.logger.error('Error broadcasting to client:', error);
          this.clients.delete(client);
        }
      }
    });
  }

  private loadHistoricalData(): void {
    try {
      const historyFile = join(this.config.exportPath, 'metrics-history.json');
      
      if (existsSync(historyFile)) {
        const data = JSON.parse(readFileSync(historyFile, 'utf8'));
        this.metricsHistory = data.metrics || [];
        this.alerts = data.alerts || [];
        this.bottlenecks = data.bottlenecks || [];
        
        if (data.trends) {
          this.trends = new Map(data.trends);
        }
        
        this.logger.info(`Loaded ${this.metricsHistory.length} historical metrics`);
      }
    } catch (error) {
      this.logger.warn('Could not load historical data:', error);
    }
  }

  private convertToCSV(data: any): string {
    // Convert metrics to CSV format
    const headers = ['timestamp', 'cpu_usage', 'memory_usage', 'response_time', 'throughput', 'error_rate'];
    const rows = [headers.join(',')];
    
    data.metrics.forEach((snapshot: MetricsSnapshot) => {
      const row = [
        snapshot.timestamp,
        snapshot.system.cpuUsage,
        snapshot.system.memoryUsage,
        snapshot.agents.avgResponseTime,
        snapshot.agents.taskThroughput,
        snapshot.tracing.errorRate
      ];
      rows.push(row.join(','));
    });
    
    return rows.join('\n');
  }

  private generateHTMLReport(data: any): string {
    const summary = data.summary;
    
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Performance Monitoring Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #f5f5f5; padding: 20px; border-radius: 5px; }
        .metric { display: inline-block; margin: 10px; padding: 10px; border: 1px solid #ddd; border-radius: 3px; }
        .alert { background: #ffebee; padding: 10px; margin: 5px 0; border-left: 4px solid #f44336; }
        .warning { border-left-color: #ff9800; background: #fff3e0; }
        .bottleneck { background: #e8f5e8; padding: 10px; margin: 5px 0; border-left: 4px solid #4caf50; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Performance Monitoring Report</h1>
        <p>Generated: ${new Date(data.exportTime).toLocaleString()}</p>
        <p>Uptime: ${Math.round(summary.overview.uptime / (1000 * 60 * 60))} hours</p>
    </div>
    
    <h2>System Overview</h2>
    <div class="metric">
        <h3>CPU Usage</h3>
        <p>${summary.overview.averageMetrics?.cpuUsage?.toFixed(1) || 'N/A'}%</p>
    </div>
    <div class="metric">
        <h3>Memory Usage</h3>
        <p>${summary.overview.averageMetrics?.memoryUsage?.toFixed(1) || 'N/A'}%</p>
    </div>
    <div class="metric">
        <h3>Avg Response Time</h3>
        <p>${summary.overview.averageMetrics?.responseTime?.toFixed(1) || 'N/A'}ms</p>
    </div>
    <div class="metric">
        <h3>Task Throughput</h3>
        <p>${summary.overview.averageMetrics?.throughput?.toFixed(1) || 'N/A'}/sec</p>
    </div>
    
    <h2>Active Alerts (${summary.criticalAlerts.length})</h2>
    ${summary.criticalAlerts.map((alert: PerformanceAlert) => `
        <div class="alert ${alert.severity === 'warning' ? 'warning' : ''}">
            <strong>${alert.metric}</strong>: ${alert.message}
            <br><small>Triggered: ${new Date(alert.timestamp).toLocaleString()}</small>
        </div>
    `).join('')}
    
    <h2>Top Bottlenecks</h2>
    ${summary.topBottlenecks.map((bottleneck: BottleneckAnalysis) => `
        <div class="bottleneck">
            <strong>${bottleneck.type.toUpperCase()}</strong> - ${bottleneck.component}
            <br>${bottleneck.description}
            <br><strong>Impact:</strong> ${bottleneck.impact}/100
            <br><strong>Suggestions:</strong> ${bottleneck.suggestions.join(', ')}
        </div>
    `).join('')}
    
    <h2>Recommendations</h2>
    <ul>
        ${summary.recommendations.map((rec: string) => `<li>${rec}</li>`).join('')}
    </ul>
    
    <h2>Metrics History</h2>
    <table>
        <tr>
            <th>Timestamp</th>
            <th>CPU %</th>
            <th>Memory %</th>
            <th>Response Time (ms)</th>
            <th>Throughput</th>
            <th>Error Rate</th>
        </tr>
        ${data.metrics.slice(-20).map((snapshot: MetricsSnapshot) => `
            <tr>
                <td>${new Date(snapshot.timestamp).toLocaleString()}</td>
                <td>${snapshot.system.cpuUsage.toFixed(1)}</td>
                <td>${snapshot.system.memoryUsage.toFixed(1)}</td>
                <td>${snapshot.agents.avgResponseTime.toFixed(1)}</td>
                <td>${snapshot.agents.taskThroughput.toFixed(1)}</td>
                <td>${(snapshot.tracing.errorRate * 100).toFixed(2)}%</td>
            </tr>
        `).join('')}
    </table>
</body>
</html>`;
  }

  private generateRecommendations(): string[] {
    const recommendations: string[] = [];
    const recent = this.metricsHistory.slice(-5);
    
    if (recent.length === 0) return recommendations;
    
    // Analyze recent metrics for recommendations
    const avgCpu = recent.reduce((sum, s) => sum + s.system.cpuUsage, 0) / recent.length;
    const avgMemory = recent.reduce((sum, s) => sum + s.system.memoryUsage, 0) / recent.length;
    const avgResponseTime = recent.reduce((sum, s) => sum + s.agents.avgResponseTime, 0) / recent.length;
    const errorRate = recent.reduce((sum, s) => sum + s.tracing.errorRate, 0) / recent.length;
    
    if (avgCpu > 80) {
      recommendations.push('High CPU usage detected. Consider optimizing agent algorithms or reducing concurrent tasks.');
    }
    
    if (avgMemory > 85) {
      recommendations.push('High memory usage detected. Enable memory cleanup and consider increasing retention policies.');
    }
    
    if (avgResponseTime > 1000) {
      recommendations.push('Slow response times detected. Check for bottlenecks in task processing or coordination overhead.');
    }
    
    if (errorRate > 0.05) {
      recommendations.push('High error rate detected. Review error logs and implement better error handling.');
    }
    
    // Check for active bottlenecks
    const currentBottlenecks = this.getCurrentBottlenecks();
    if (currentBottlenecks.length > 0) {
      recommendations.push(`${currentBottlenecks.length} active bottlenecks detected. Address the highest impact items first.`);
    }
    
    // Check for trend issues
    const degradingTrends = Array.from(this.trends.values()).filter(t => t.trend === 'degrading');
    if (degradingTrends.length > 0) {
      recommendations.push(`Performance degradation trends detected in: ${degradingTrends.map(t => t.metric).join(', ')}`);
    }
    
    if (recommendations.length === 0) {
      recommendations.push('System performance appears healthy. Continue monitoring for optimal operation.');
    }
    
    return recommendations;
  }
}

/**
 * Metrics collector for gathering system and application metrics
 */
class MetricsCollector {
  private logger: Logger;
  private customMetrics = new Map<string, Array<{ value: number; timestamp: number; unit: string }>>();

  constructor(logger: Logger) {
    this.logger = logger;
  }

  recordMetric(name: string, value: number, unit = 'count'): void {
    if (!this.customMetrics.has(name)) {
      this.customMetrics.set(name, []);
    }
    
    const metrics = this.customMetrics.get(name)!;
    metrics.push({ value, timestamp: Date.now(), unit });
    
    // Keep only recent metrics (last hour)
    const cutoff = Date.now() - (60 * 60 * 1000);
    const filtered = metrics.filter(m => m.timestamp >= cutoff);
    this.customMetrics.set(name, filtered);
  }

  collectSnapshot(): MetricsSnapshot {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    return {
      timestamp: Date.now(),
      tracing: {
        collectionOverhead: this.getRecentAverage('tracing.collection_overhead') || 0,
        memoryUsage: this.getRecentAverage('memory.tracing_mb') || 0,
        storageGrowth: this.getRecentAverage('storage.growth_rate') || 0,
        eventThroughput: this.getRecentAverage('tracing.events_per_second') || 0,
        errorRate: this.getRecentAverage('tracing.error_rate') || 0
      },
      system: {
        cpuUsage: this.calculateCpuPercent(cpuUsage),
        memoryUsage: (memUsage.heapUsed / memUsage.heapTotal) * 100,
        diskUsage: this.getRecentAverage('system.disk_usage') || 0,
        networkLatency: this.getRecentAverage('network.latency') || 0
      },
      agents: {
        totalAgents: this.getRecentValue('agents.total') || 0,
        activeAgents: this.getRecentValue('agents.active') || 0,
        busyAgents: this.getRecentValue('agents.busy') || 0,
        avgResponseTime: this.getRecentAverage('agents.avg_response_time') || 0,
        taskThroughput: this.getRecentAverage('agents.task_throughput') || 0
      },
      queries: {
        avgResponseTime: this.getRecentAverage('query.avg_duration') || 0,
        slowQueries: this.getRecentValue('query.slow_count') || 0,
        queryThroughput: this.getRecentAverage('query.throughput') || 0,
        cacheHitRate: this.getRecentAverage('cache.hit_rate') || 0
      },
      ui: {
        frameRate: this.getRecentAverage('ui.frame_rate') || 60,
        renderTime: this.getRecentAverage('ui.render_time') || 0,
        webSocketLatency: this.getRecentAverage('websocket.latency') || 0,
        uiResponseTime: this.getRecentAverage('ui.response_time') || 0
      }
    };
  }

  private getRecentAverage(metricName: string): number | undefined {
    const metrics = this.customMetrics.get(metricName);
    if (!metrics || metrics.length === 0) return undefined;
    
    const recent = metrics.slice(-10); // Last 10 values
    return recent.reduce((sum, m) => sum + m.value, 0) / recent.length;
  }

  private getRecentValue(metricName: string): number | undefined {
    const metrics = this.customMetrics.get(metricName);
    if (!metrics || metrics.length === 0) return undefined;
    
    return metrics[metrics.length - 1].value;
  }

  private calculateCpuPercent(cpuUsage: NodeJS.CpuUsage): number {
    // Simple CPU percentage calculation
    const totalTime = cpuUsage.user + cpuUsage.system;
    return Math.min(100, (totalTime / 1000000) * 100); // Convert microseconds to percentage
  }
}

/**
 * Bottleneck detector for identifying performance issues
 */
class BottleneckDetector {
  private logger: Logger;
  private thresholds: PerformanceThreshold[];

  constructor(logger: Logger, thresholds: PerformanceThreshold[]) {
    this.logger = logger;
    this.thresholds = thresholds;
  }

  analyze(current: MetricsSnapshot, previous?: MetricsSnapshot): BottleneckAnalysis[] {
    const bottlenecks: BottleneckAnalysis[] = [];
    
    // CPU bottleneck detection
    if (current.system.cpuUsage > 90) {
      bottlenecks.push({
        id: generateId('bottleneck'),
        timestamp: Date.now(),
        type: 'cpu',
        severity: current.system.cpuUsage > 95 ? 'critical' : 'high',
        component: 'system',
        description: `High CPU usage: ${current.system.cpuUsage.toFixed(1)}%`,
        impact: Math.min(100, current.system.cpuUsage),
        suggestions: [
          'Reduce concurrent agent tasks',
          'Optimize algorithm complexity',
          'Enable task scheduling'
        ],
        metrics: { cpuUsage: current.system.cpuUsage }
      });
    }
    
    // Memory bottleneck detection
    if (current.system.memoryUsage > 85) {
      bottlenecks.push({
        id: generateId('bottleneck'),
        timestamp: Date.now(),
        type: 'memory',
        severity: current.system.memoryUsage > 95 ? 'critical' : 'high',
        component: 'system',
        description: `High memory usage: ${current.system.memoryUsage.toFixed(1)}%`,
        impact: Math.min(100, current.system.memoryUsage),
        suggestions: [
          'Enable garbage collection',
          'Reduce trace retention time',
          'Implement memory pooling'
        ],
        metrics: { memoryUsage: current.system.memoryUsage }
      });
    }
    
    // Response time bottleneck
    if (current.agents.avgResponseTime > 2000) {
      bottlenecks.push({
        id: generateId('bottleneck'),
        timestamp: Date.now(),
        type: 'coordination',
        severity: current.agents.avgResponseTime > 5000 ? 'critical' : 'medium',
        component: 'agents',
        description: `Slow response times: ${current.agents.avgResponseTime.toFixed(0)}ms`,
        impact: Math.min(100, current.agents.avgResponseTime / 50), // Scale to 0-100
        suggestions: [
          'Optimize coordination protocols',
          'Reduce message passing overhead',
          'Implement request batching'
        ],
        metrics: { responseTime: current.agents.avgResponseTime }
      });
    }
    
    // Query performance bottleneck
    if (current.queries.avgResponseTime > 1000) {
      bottlenecks.push({
        id: generateId('bottleneck'),
        timestamp: Date.now(),
        type: 'io',
        severity: current.queries.avgResponseTime > 3000 ? 'critical' : 'medium',
        component: 'storage',
        description: `Slow query performance: ${current.queries.avgResponseTime.toFixed(0)}ms`,
        impact: Math.min(100, current.queries.avgResponseTime / 30),
        suggestions: [
          'Add database indexes',
          'Optimize query patterns',
          'Enable query caching'
        ],
        metrics: { queryTime: current.queries.avgResponseTime }
      });
    }
    
    // UI performance bottleneck
    if (current.ui.frameRate < 30) {
      bottlenecks.push({
        id: generateId('bottleneck'),
        timestamp: Date.now(),
        type: 'ui',
        severity: current.ui.frameRate < 15 ? 'critical' : 'medium',
        component: 'dashboard',
        description: `Low frame rate: ${current.ui.frameRate.toFixed(1)} FPS`,
        impact: Math.max(0, 100 - (current.ui.frameRate / 60) * 100),
        suggestions: [
          'Reduce update frequency',
          'Optimize rendering code',
          'Enable virtualization for large datasets'
        ],
        metrics: { frameRate: current.ui.frameRate }
      });
    }
    
    return bottlenecks;
  }
}

/**
 * Trend analyzer for detecting performance patterns over time
 */
class TrendAnalyzer {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  analyzeMetrics(history: MetricsSnapshot[]): TrendAnalysis[] {
    if (history.length < 3) return [];
    
    const trends: TrendAnalysis[] = [];
    const recent = history.slice(-20); // Last 20 snapshots
    
    // Analyze key metrics
    const metricsToAnalyze = [
      { name: 'system.cpuUsage', values: recent.map(h => h.system.cpuUsage) },
      { name: 'system.memoryUsage', values: recent.map(h => h.system.memoryUsage) },
      { name: 'agents.avgResponseTime', values: recent.map(h => h.agents.avgResponseTime) },
      { name: 'queries.avgResponseTime', values: recent.map(h => h.queries.avgResponseTime) },
      { name: 'ui.frameRate', values: recent.map(h => h.ui.frameRate) }
    ];
    
    for (const metric of metricsToAnalyze) {
      const trend = this.calculateTrend(metric.name, metric.values, recent);
      if (trend) {
        trends.push(trend);
      }
    }
    
    return trends;
  }

  private calculateTrend(
    metricName: string, 
    values: number[], 
    snapshots: MetricsSnapshot[]
  ): TrendAnalysis | null {
    if (values.length < 3) return null;
    
    // Calculate linear regression
    const x = values.map((_, i) => i);
    const y = values;
    const n = values.length;
    
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    // Determine trend type
    let trendType: 'improving' | 'degrading' | 'stable' | 'volatile';
    const absSlope = Math.abs(slope);
    
    if (absSlope < 0.01) {
      trendType = 'stable';
    } else {
      // For metrics like frameRate, higher is better
      const higherIsBetter = metricName.includes('frameRate') || metricName.includes('throughput');
      
      if (higherIsBetter) {
        trendType = slope > 0 ? 'improving' : 'degrading';
      } else {
        trendType = slope > 0 ? 'degrading' : 'improving';
      }
    }
    
    // Check for volatility
    const variance = this.calculateVariance(values);
    const mean = sumY / n;
    const coefficientOfVariation = Math.sqrt(variance) / mean;
    
    if (coefficientOfVariation > 0.3) {
      trendType = 'volatile';
    }
    
    // Find anomalies
    const anomalies = this.findAnomalies(values, snapshots);
    
    // Make predictions
    const nextHour = intercept + slope * (n + 1);
    const nextDay = intercept + slope * (n + 24); // Assuming hourly snapshots
    const confidence = Math.max(0, 1 - coefficientOfVariation);
    
    return {
      metric: metricName,
      timeRange: {
        start: snapshots[0].timestamp,
        end: snapshots[snapshots.length - 1].timestamp
      },
      trend: trendType,
      rate: slope,
      prediction: {
        nextHour: Math.max(0, nextHour),
        nextDay: Math.max(0, nextDay),
        confidence
      },
      anomalies
    };
  }

  private calculateVariance(values: number[]): number {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
  }

  private findAnomalies(
    values: number[], 
    snapshots: MetricsSnapshot[]
  ): Array<{ timestamp: number; value: number; deviation: number }> {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const stdDev = Math.sqrt(this.calculateVariance(values));
    const threshold = 2 * stdDev; // 2 standard deviations
    
    const anomalies = [];
    
    for (let i = 0; i < values.length; i++) {
      const deviation = Math.abs(values[i] - mean);
      if (deviation > threshold) {
        anomalies.push({
          timestamp: snapshots[i].timestamp,
          value: values[i],
          deviation
        });
      }
    }
    
    return anomalies;
  }
}

/**
 * Alert manager for handling performance alerts
 */
class AlertManager {
  private logger: Logger;
  private config: DashboardConfig['alerting'];

  constructor(logger: Logger, config: DashboardConfig['alerting']) {
    this.logger = logger;
    this.config = config;
  }

  triggerAlert(alert: PerformanceAlert): void {
    if (!this.config.enabled) return;
    
    this.logger.warn(`Performance Alert [${alert.severity.toUpperCase()}]: ${alert.message}`);
    
    // Send alerts through configured channels
    this.config.channels.forEach(channel => {
      try {
        switch (channel.type) {
          case 'console':
            this.sendConsoleAlert(alert);
            break;
          case 'webhook':
            this.sendWebhookAlert(alert, channel.config);
            break;
          case 'email':
            this.sendEmailAlert(alert, channel.config);
            break;
        }
      } catch (error) {
        this.logger.error(`Failed to send alert via ${channel.type}:`, error);
      }
    });
  }

  private sendConsoleAlert(alert: PerformanceAlert): void {
    const color = alert.severity === 'critical' ? '\x1b[31m' : '\x1b[33m'; // Red or yellow
    const reset = '\x1b[0m';
    
    console.log(`${color}🚨 PERFORMANCE ALERT${reset}`);
    console.log(`${color}Severity: ${alert.severity.toUpperCase()}${reset}`);
    console.log(`${color}Component: ${alert.component}${reset}`);
    console.log(`${color}Message: ${alert.message}${reset}`);
    console.log(`${color}Time: ${new Date(alert.timestamp).toISOString()}${reset}`);
  }

  private async sendWebhookAlert(alert: PerformanceAlert, config: any): Promise<void> {
    if (!config.url) return;
    
    const payload = {
      type: 'performance_alert',
      alert,
      timestamp: Date.now()
    };
    
    // Note: In real implementation, use fetch or axios
    this.logger.info(`Would send webhook alert to ${config.url}`, payload);
  }

  private async sendEmailAlert(alert: PerformanceAlert, config: any): Promise<void> {
    // Note: In real implementation, integrate with email service
    this.logger.info(`Would send email alert to ${config.recipient}`, alert);
  }
}

// Default configuration
export const defaultDashboardConfig: DashboardConfig = {
  enabled: true,
  port: 8080,
  updateInterval: 5000, // 5 seconds
  retentionDays: 30,
  alerting: {
    enabled: true,
    channels: [
      { type: 'console', config: {} }
    ]
  },
  thresholds: [
    { metric: 'system.cpuUsage', warning: 70, critical: 90, unit: '%', description: 'CPU Usage' },
    { metric: 'system.memoryUsage', warning: 80, critical: 95, unit: '%', description: 'Memory Usage' },
    { metric: 'agents.avgResponseTime', warning: 1000, critical: 3000, unit: 'ms', description: 'Agent Response Time' },
    { metric: 'queries.avgResponseTime', warning: 500, critical: 2000, unit: 'ms', description: 'Query Response Time' },
    { metric: 'ui.frameRate', warning: 30, critical: 15, unit: 'fps', description: 'UI Frame Rate' },
    { metric: 'tracing.errorRate', warning: 0.01, critical: 0.05, unit: '%', description: 'Tracing Error Rate' },
    { metric: 'websocket.latency', warning: 100, critical: 500, unit: 'ms', description: 'WebSocket Latency' }
  ],
  exportPath: './analysis-reports'
};