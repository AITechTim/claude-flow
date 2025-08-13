/**
 * Metrics Exporter
 * Export performance metrics in various formats for analysis
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { Logger } from '../../core/logger.js';
import { MetricsSnapshot, PerformanceAlert, BottleneckAnalysis, TrendAnalysis } from './performance-dashboard.js';

export interface ExportOptions {
  format: 'json' | 'csv' | 'prometheus' | 'html';
  timeRange?: { start: number; end: number };
  includeAlerts?: boolean;
  includeBottlenecks?: boolean;
  includeTrends?: boolean;
  compression?: boolean;
  template?: string;
}

export interface ExportResult {
  success: boolean;
  filePath: string;
  format: string;
  recordCount: number;
  fileSize: number;
  error?: string;
}

export class MetricsExporter {
  private logger: Logger;
  private exportPath: string;

  constructor(logger: Logger, exportPath = './analysis-reports') {
    this.logger = logger;
    this.exportPath = exportPath;
    
    // Ensure export directory exists
    this.ensureExportDirectory();
  }

  /**
   * Export metrics data in specified format
   */
  async exportMetrics(
    data: {
      metrics: MetricsSnapshot[];
      alerts?: PerformanceAlert[];
      bottlenecks?: BottleneckAnalysis[];
      trends?: TrendAnalysis[];
    },
    options: ExportOptions
  ): Promise<ExportResult> {
    try {
      // Filter data by time range if specified
      const filteredData = this.filterByTimeRange(data, options.timeRange);
      
      // Generate filename
      const filename = this.generateFilename(options.format);
      const filePath = join(this.exportPath, filename);
      
      // Export based on format
      let content: string;
      let recordCount = 0;
      
      switch (options.format) {
        case 'json':
          content = this.exportJSON(filteredData, options);
          recordCount = filteredData.metrics.length;
          break;
          
        case 'csv':
          content = this.exportCSV(filteredData, options);
          recordCount = filteredData.metrics.length;
          break;
          
        case 'prometheus':
          content = this.exportPrometheus(filteredData, options);
          recordCount = filteredData.metrics.length;
          break;
          
        case 'html':
          content = this.exportHTML(filteredData, options);
          recordCount = filteredData.metrics.length;
          break;
          
        default:
          throw new Error(`Unsupported export format: ${options.format}`);
      }
      
      // Write file
      writeFileSync(filePath, content, 'utf8');
      
      const fileSize = Buffer.byteLength(content, 'utf8');
      
      this.logger.info(`Exported ${recordCount} metrics to ${filePath} (${fileSize} bytes)`);
      
      return {
        success: true,
        filePath,
        format: options.format,
        recordCount,
        fileSize
      };
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error('Export failed:', error);
      
      return {
        success: false,
        filePath: '',
        format: options.format,
        recordCount: 0,
        fileSize: 0,
        error: errorMsg
      };
    }
  }

  /**
   * Export multiple formats in parallel
   */
  async exportMultipleFormats(
    data: {
      metrics: MetricsSnapshot[];
      alerts?: PerformanceAlert[];
      bottlenecks?: BottleneckAnalysis[];
      trends?: TrendAnalysis[];
    },
    formats: ExportOptions['format'][]
  ): Promise<ExportResult[]> {
    const exports = formats.map(format => 
      this.exportMetrics(data, { format, includeAlerts: true, includeBottlenecks: true, includeTrends: true })
    );
    
    return Promise.all(exports);
  }

  /**
   * Create performance summary report
   */
  async exportSummaryReport(
    data: {
      metrics: MetricsSnapshot[];
      alerts?: PerformanceAlert[];
      bottlenecks?: BottleneckAnalysis[];
      trends?: TrendAnalysis[];
    }
  ): Promise<ExportResult> {
    const summary = this.generateSummary(data);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `performance-summary-${timestamp}.html`;
    const filePath = join(this.exportPath, filename);
    
    const htmlContent = this.generateSummaryHTML(summary);
    
    writeFileSync(filePath, htmlContent, 'utf8');
    
    this.logger.info(`Generated performance summary: ${filePath}`);
    
    return {
      success: true,
      filePath,
      format: 'html',
      recordCount: data.metrics.length,
      fileSize: Buffer.byteLength(htmlContent, 'utf8')
    };
  }

  /**
   * Export for specific monitoring tools
   */
  async exportForTool(
    data: { metrics: MetricsSnapshot[] },
    tool: 'grafana' | 'prometheus' | 'datadog' | 'newrelic'
  ): Promise<ExportResult> {
    switch (tool) {
      case 'prometheus':
        return this.exportMetrics(data, { format: 'prometheus' });
        
      case 'grafana':
        // Grafana can read JSON format
        return this.exportMetrics(data, { format: 'json' });
        
      case 'datadog':
        // Custom format for DataDog
        return this.exportDataDogFormat(data);
        
      case 'newrelic':
        // Custom format for New Relic
        return this.exportNewRelicFormat(data);
        
      default:
        throw new Error(`Unsupported monitoring tool: ${tool}`);
    }
  }

  // Private methods

  private ensureExportDirectory(): void {
    if (!existsSync(this.exportPath)) {
      mkdirSync(this.exportPath, { recursive: true });
      this.logger.info(`Created export directory: ${this.exportPath}`);
    }
  }

  private filterByTimeRange(
    data: {
      metrics: MetricsSnapshot[];
      alerts?: PerformanceAlert[];
      bottlenecks?: BottleneckAnalysis[];
      trends?: TrendAnalysis[];
    },
    timeRange?: { start: number; end: number }
  ) {
    if (!timeRange) return data;
    
    return {
      metrics: data.metrics.filter(m => m.timestamp >= timeRange.start && m.timestamp <= timeRange.end),
      alerts: data.alerts?.filter(a => a.timestamp >= timeRange.start && a.timestamp <= timeRange.end),
      bottlenecks: data.bottlenecks?.filter(b => b.timestamp >= timeRange.start && b.timestamp <= timeRange.end),
      trends: data.trends // Trends are already calculated for time ranges
    };
  }

  private generateFilename(format: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `performance-metrics-${timestamp}.${format}`;
  }

  private exportJSON(
    data: {
      metrics: MetricsSnapshot[];
      alerts?: PerformanceAlert[];
      bottlenecks?: BottleneckAnalysis[];
      trends?: TrendAnalysis[];
    },
    options: ExportOptions
  ): string {
    const exportData: any = {
      exportTime: Date.now(),
      format: 'json',
      recordCount: data.metrics.length,
      metrics: data.metrics
    };
    
    if (options.includeAlerts && data.alerts) {
      exportData.alerts = data.alerts;
    }
    
    if (options.includeBottlenecks && data.bottlenecks) {
      exportData.bottlenecks = data.bottlenecks;
    }
    
    if (options.includeTrends && data.trends) {
      exportData.trends = data.trends;
    }
    
    return JSON.stringify(exportData, null, 2);
  }

  private exportCSV(
    data: { metrics: MetricsSnapshot[] },
    options: ExportOptions
  ): string {
    if (data.metrics.length === 0) {
      return 'timestamp,cpu_usage,memory_usage,disk_usage,response_time,throughput,frame_rate\n';
    }
    
    const headers = [
      'timestamp',
      'cpu_usage_percent',
      'memory_usage_percent',
      'disk_usage_percent',
      'network_latency_ms',
      'agent_response_time_ms',
      'task_throughput',
      'ui_frame_rate',
      'query_response_time_ms',
      'error_rate_percent',
      'trace_collection_overhead_ms'
    ];
    
    const rows = [headers.join(',')];
    
    data.metrics.forEach(metric => {
      const row = [
        metric.timestamp,
        metric.system.cpuUsage.toFixed(2),
        metric.system.memoryUsage.toFixed(2),
        metric.system.diskUsage.toFixed(2),
        metric.system.networkLatency.toFixed(2),
        metric.agents.avgResponseTime.toFixed(2),
        metric.agents.taskThroughput.toFixed(2),
        metric.ui.frameRate.toFixed(2),
        metric.queries.avgResponseTime.toFixed(2),
        (metric.tracing.errorRate * 100).toFixed(4),
        metric.tracing.collectionOverhead.toFixed(2)
      ];
      rows.push(row.join(','));
    });
    
    return rows.join('\n');
  }

  private exportPrometheus(
    data: { metrics: MetricsSnapshot[] },
    options: ExportOptions
  ): string {
    if (data.metrics.length === 0) return '';
    
    const latest = data.metrics[data.metrics.length - 1];
    const timestamp = Math.floor(latest.timestamp / 1000); // Prometheus uses seconds
    
    const metrics = [
      `# HELP system_cpu_usage_percent CPU usage percentage`,
      `# TYPE system_cpu_usage_percent gauge`,
      `system_cpu_usage_percent ${latest.system.cpuUsage} ${timestamp}`,
      '',
      `# HELP system_memory_usage_percent Memory usage percentage`,
      `# TYPE system_memory_usage_percent gauge`,
      `system_memory_usage_percent ${latest.system.memoryUsage} ${timestamp}`,
      '',
      `# HELP system_disk_usage_percent Disk usage percentage`,
      `# TYPE system_disk_usage_percent gauge`,
      `system_disk_usage_percent ${latest.system.diskUsage} ${timestamp}`,
      '',
      `# HELP agent_response_time_milliseconds Average agent response time`,
      `# TYPE agent_response_time_milliseconds gauge`,
      `agent_response_time_milliseconds ${latest.agents.avgResponseTime} ${timestamp}`,
      '',
      `# HELP agent_task_throughput_per_second Task processing throughput`,
      `# TYPE agent_task_throughput_per_second gauge`,
      `agent_task_throughput_per_second ${latest.agents.taskThroughput} ${timestamp}`,
      '',
      `# HELP ui_frame_rate_fps UI frame rate`,
      `# TYPE ui_frame_rate_fps gauge`,
      `ui_frame_rate_fps ${latest.ui.frameRate} ${timestamp}`,
      '',
      `# HELP query_response_time_milliseconds Query response time`,
      `# TYPE query_response_time_milliseconds gauge`,
      `query_response_time_milliseconds ${latest.queries.avgResponseTime} ${timestamp}`,
      '',
      `# HELP tracing_error_rate Error rate in tracing system`,
      `# TYPE tracing_error_rate gauge`,
      `tracing_error_rate ${latest.tracing.errorRate} ${timestamp}`
    ];
    
    return metrics.join('\n') + '\n';
  }

  private exportHTML(
    data: {
      metrics: MetricsSnapshot[];
      alerts?: PerformanceAlert[];
      bottlenecks?: BottleneckAnalysis[];
      trends?: TrendAnalysis[];
    },
    options: ExportOptions
  ): string {
    const summary = this.generateSummary(data);
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Performance Metrics Export</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0; padding: 20px; background: #f5f5f5; 
        }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid #eee; }
        .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .metric-card { background: #f8f9fa; padding: 20px; border-radius: 6px; border-left: 4px solid #007bff; }
        .metric-value { font-size: 2em; font-weight: bold; color: #333; margin-bottom: 5px; }
        .metric-label { color: #666; font-size: 0.9em; }
        .chart-container { margin: 20px 0; height: 400px; }
        .alerts { margin: 20px 0; }
        .alert { padding: 12px; margin: 8px 0; border-radius: 4px; border-left: 4px solid #dc3545; background: #f8d7da; color: #721c24; }
        .alert.warning { border-left-color: #ffc107; background: #fff3cd; color: #856404; }
        .bottleneck { padding: 12px; margin: 8px 0; border-radius: 4px; border-left: 4px solid #28a745; background: #d4edda; color: #155724; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #f8f9fa; font-weight: 600; }
        tr:hover { background: #f5f5f5; }
        .timestamp { color: #666; font-size: 0.9em; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔍 Performance Metrics Report</h1>
            <p class="timestamp">Generated: ${new Date().toLocaleString()}</p>
            <p>Records: ${data.metrics.length} | Time Range: ${data.metrics.length > 0 ? 
              `${new Date(data.metrics[0].timestamp).toLocaleString()} - ${new Date(data.metrics[data.metrics.length - 1].timestamp).toLocaleString()}` : 'No data'}</p>
        </div>

        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-value">${summary.avgCpu.toFixed(1)}%</div>
                <div class="metric-label">Average CPU Usage</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${summary.avgMemory.toFixed(1)}%</div>
                <div class="metric-label">Average Memory Usage</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${summary.avgResponseTime.toFixed(0)}ms</div>
                <div class="metric-label">Average Response Time</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${summary.avgThroughput.toFixed(1)}</div>
                <div class="metric-label">Average Throughput</div>
            </div>
        </div>

        ${data.alerts && data.alerts.length > 0 ? `
        <h2>🚨 Recent Alerts</h2>
        <div class="alerts">
            ${data.alerts.slice(0, 10).map(alert => `
                <div class="alert ${alert.severity === 'warning' ? 'warning' : ''}">
                    <strong>${alert.metric}</strong>: ${alert.message}
                    <br><small>${new Date(alert.timestamp).toLocaleString()}</small>
                </div>
            `).join('')}
        </div>` : ''}

        ${data.bottlenecks && data.bottlenecks.length > 0 ? `
        <h2>⚠️ Detected Bottlenecks</h2>
        <div class="bottlenecks">
            ${data.bottlenecks.slice(0, 5).map(bottleneck => `
                <div class="bottleneck">
                    <strong>${bottleneck.type.toUpperCase()}</strong> - ${bottleneck.component}
                    <br>${bottleneck.description}
                    <br><strong>Impact:</strong> ${bottleneck.impact}/100
                    <br><strong>Suggestions:</strong> ${bottleneck.suggestions.join(', ')}
                    <br><small>${new Date(bottleneck.timestamp).toLocaleString()}</small>
                </div>
            `).join('')}
        </div>` : ''}

        <h2>📊 Performance Charts</h2>
        <div class="chart-container">
            <canvas id="performanceChart"></canvas>
        </div>

        <h2>📋 Detailed Metrics</h2>
        <table>
            <thead>
                <tr>
                    <th>Timestamp</th>
                    <th>CPU %</th>
                    <th>Memory %</th>
                    <th>Response Time (ms)</th>
                    <th>Throughput</th>
                    <th>Frame Rate</th>
                    <th>Error Rate</th>
                </tr>
            </thead>
            <tbody>
                ${data.metrics.slice(-50).map(metric => `
                    <tr>
                        <td>${new Date(metric.timestamp).toLocaleString()}</td>
                        <td>${metric.system.cpuUsage.toFixed(1)}</td>
                        <td>${metric.system.memoryUsage.toFixed(1)}</td>
                        <td>${metric.agents.avgResponseTime.toFixed(0)}</td>
                        <td>${metric.agents.taskThroughput.toFixed(1)}</td>
                        <td>${metric.ui.frameRate.toFixed(1)}</td>
                        <td>${(metric.tracing.errorRate * 100).toFixed(2)}%</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </div>

    <script>
        const ctx = document.getElementById('performanceChart').getContext('2d');
        const metrics = ${JSON.stringify(data.metrics.slice(-20))};
        
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: metrics.map(m => new Date(m.timestamp).toLocaleTimeString()),
                datasets: [
                    {
                        label: 'CPU Usage %',
                        data: metrics.map(m => m.system.cpuUsage),
                        borderColor: '#007bff',
                        tension: 0.1
                    },
                    {
                        label: 'Memory Usage %',
                        data: metrics.map(m => m.system.memoryUsage),
                        borderColor: '#28a745',
                        tension: 0.1
                    },
                    {
                        label: 'Response Time (ms)',
                        data: metrics.map(m => m.agents.avgResponseTime),
                        borderColor: '#ffc107',
                        tension: 0.1,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: 'Performance Metrics Over Time'
                    }
                },
                scales: {
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: {
                            display: true,
                            text: 'Percentage (%)'
                        }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: {
                            display: true,
                            text: 'Response Time (ms)'
                        },
                        grid: {
                            drawOnChartArea: false
                        }
                    }
                }
            }
        });
    </script>
</body>
</html>`;
  }

  private generateSummary(data: { metrics: MetricsSnapshot[] }) {
    if (data.metrics.length === 0) {
      return {
        avgCpu: 0,
        avgMemory: 0,
        avgResponseTime: 0,
        avgThroughput: 0,
        maxCpu: 0,
        maxMemory: 0,
        maxResponseTime: 0
      };
    }
    
    const metrics = data.metrics;
    
    return {
      avgCpu: metrics.reduce((sum, m) => sum + m.system.cpuUsage, 0) / metrics.length,
      avgMemory: metrics.reduce((sum, m) => sum + m.system.memoryUsage, 0) / metrics.length,
      avgResponseTime: metrics.reduce((sum, m) => sum + m.agents.avgResponseTime, 0) / metrics.length,
      avgThroughput: metrics.reduce((sum, m) => sum + m.agents.taskThroughput, 0) / metrics.length,
      maxCpu: Math.max(...metrics.map(m => m.system.cpuUsage)),
      maxMemory: Math.max(...metrics.map(m => m.system.memoryUsage)),
      maxResponseTime: Math.max(...metrics.map(m => m.agents.avgResponseTime))
    };
  }

  private generateSummaryHTML(summary: any): string {
    return `<!DOCTYPE html>
<html>
<head>
    <title>Performance Summary</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .summary-card { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 10px 0; }
        .metric { display: inline-block; margin: 15px; text-align: center; }
        .metric-value { font-size: 2em; font-weight: bold; color: #007bff; }
        .metric-label { color: #666; margin-top: 5px; }
    </style>
</head>
<body>
    <h1>Performance Summary Report</h1>
    
    <div class="summary-card">
        <h2>Average Metrics</h2>
        <div class="metric">
            <div class="metric-value">${summary.avgCpu.toFixed(1)}%</div>
            <div class="metric-label">CPU Usage</div>
        </div>
        <div class="metric">
            <div class="metric-value">${summary.avgMemory.toFixed(1)}%</div>
            <div class="metric-label">Memory Usage</div>
        </div>
        <div class="metric">
            <div class="metric-value">${summary.avgResponseTime.toFixed(0)}ms</div>
            <div class="metric-label">Response Time</div>
        </div>
        <div class="metric">
            <div class="metric-value">${summary.avgThroughput.toFixed(1)}</div>
            <div class="metric-label">Throughput</div>
        </div>
    </div>
    
    <div class="summary-card">
        <h2>Peak Values</h2>
        <div class="metric">
            <div class="metric-value">${summary.maxCpu.toFixed(1)}%</div>
            <div class="metric-label">Peak CPU</div>
        </div>
        <div class="metric">
            <div class="metric-value">${summary.maxMemory.toFixed(1)}%</div>
            <div class="metric-label">Peak Memory</div>
        </div>
        <div class="metric">
            <div class="metric-value">${summary.maxResponseTime.toFixed(0)}ms</div>
            <div class="metric-label">Peak Response Time</div>
        </div>
    </div>
</body>
</html>`;
  }

  private async exportDataDogFormat(data: { metrics: MetricsSnapshot[] }): Promise<ExportResult> {
    // DataDog specific format
    const datadogMetrics = data.metrics.map(metric => ({
      metric: 'claude_flow.performance',
      points: [[Math.floor(metric.timestamp / 1000), metric.system.cpuUsage]],
      tags: ['service:claude-flow', 'env:production'],
      host: 'claude-flow-instance'
    }));
    
    const content = JSON.stringify(datadogMetrics, null, 2);
    const filename = this.generateFilename('json');
    const filePath = join(this.exportPath, `datadog-${filename}`);
    
    writeFileSync(filePath, content, 'utf8');
    
    return {
      success: true,
      filePath,
      format: 'datadog-json',
      recordCount: data.metrics.length,
      fileSize: Buffer.byteLength(content, 'utf8')
    };
  }

  private async exportNewRelicFormat(data: { metrics: MetricsSnapshot[] }): Promise<ExportResult> {
    // New Relic specific format
    const newrelicMetrics = data.metrics.map(metric => ({
      'eventType': 'ClaudeFlowPerformance',
      'timestamp': metric.timestamp,
      'cpuUsage': metric.system.cpuUsage,
      'memoryUsage': metric.system.memoryUsage,
      'responseTime': metric.agents.avgResponseTime,
      'throughput': metric.agents.taskThroughput,
      'service': 'claude-flow'
    }));
    
    const content = JSON.stringify(newrelicMetrics, null, 2);
    const filename = this.generateFilename('json');
    const filePath = join(this.exportPath, `newrelic-${filename}`);
    
    writeFileSync(filePath, content, 'utf8');
    
    return {
      success: true,
      filePath,
      format: 'newrelic-json',
      recordCount: data.metrics.length,
      fileSize: Buffer.byteLength(content, 'utf8')
    };
  }
}