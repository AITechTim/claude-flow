/**
 * Alerting Service
 * Handles performance alerts and notifications
 */

import { EventEmitter } from 'node:events';
import { Logger } from '../../core/logger.js';
import { PerformanceAlert } from './performance-dashboard.js';

export interface AlertChannel {
  type: 'console' | 'webhook' | 'email' | 'slack' | 'discord';
  config: Record<string, any>;
  enabled: boolean;
  filters?: {
    severity?: ('warning' | 'critical')[];
    components?: string[];
    metrics?: string[];
  };
}

export interface AlertRule {
  id: string;
  name: string;
  metric: string;
  condition: 'greater_than' | 'less_than' | 'equals' | 'not_equals';
  threshold: number;
  severity: 'warning' | 'critical';
  duration: number; // How long condition must persist
  cooldown: number; // Minimum time between alerts
  enabled: boolean;
  description: string;
  tags: string[];
}

export interface NotificationResult {
  success: boolean;
  channel: string;
  error?: string;
  timestamp: number;
}

export class AlertingService extends EventEmitter {
  private logger: Logger;
  private channels: AlertChannel[] = [];
  private rules: AlertRule[] = [];
  private alertHistory: PerformanceAlert[] = [];
  private cooldowns = new Map<string, number>();
  private persistentConditions = new Map<string, { startTime: number; lastValue: number }>();

  constructor(logger: Logger) {
    super();
    this.logger = logger;
    
    // Setup default console channel
    this.addChannel({
      type: 'console',
      config: {},
      enabled: true
    });
  }

  /**
   * Add an alert channel
   */
  addChannel(channel: AlertChannel): void {
    this.channels.push(channel);
    this.logger.info(`Added alert channel: ${channel.type}`);
  }

  /**
   * Remove an alert channel
   */
  removeChannel(type: string): boolean {
    const index = this.channels.findIndex(c => c.type === type);
    if (index >= 0) {
      this.channels.splice(index, 1);
      this.logger.info(`Removed alert channel: ${type}`);
      return true;
    }
    return false;
  }

  /**
   * Add an alert rule
   */
  addRule(rule: AlertRule): void {
    this.rules.push(rule);
    this.logger.info(`Added alert rule: ${rule.name}`);
  }

  /**
   * Remove an alert rule
   */
  removeRule(ruleId: string): boolean {
    const index = this.rules.findIndex(r => r.id === ruleId);
    if (index >= 0) {
      this.rules.splice(index, 1);
      this.cooldowns.delete(ruleId);
      this.persistentConditions.delete(ruleId);
      this.logger.info(`Removed alert rule: ${ruleId}`);
      return true;
    }
    return false;
  }

  /**
   * Process metric value and check for alerts
   */
  checkMetric(metric: string, value: number, timestamp: number = Date.now()): void {
    const applicableRules = this.rules.filter(rule => 
      rule.enabled && rule.metric === metric
    );

    for (const rule of applicableRules) {
      this.evaluateRule(rule, value, timestamp);
    }
  }

  /**
   * Send an alert through configured channels
   */
  async sendAlert(alert: PerformanceAlert): Promise<NotificationResult[]> {
    const results: NotificationResult[] = [];
    
    // Add to history
    this.alertHistory.push(alert);
    
    // Keep history size manageable
    if (this.alertHistory.length > 1000) {
      this.alertHistory = this.alertHistory.slice(-500);
    }
    
    // Send through all enabled channels
    const promises = this.channels
      .filter(channel => channel.enabled && this.shouldSendToChannel(alert, channel))
      .map(channel => this.sendToChannel(alert, channel));
    
    const channelResults = await Promise.allSettled(promises);
    
    channelResults.forEach((result, index) => {
      const channel = this.channels.filter(c => c.enabled)[index];
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        results.push({
          success: false,
          channel: channel.type,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          timestamp: Date.now()
        });
      }
    });
    
    this.emit('alert_sent', { alert, results });
    return results;
  }

  /**
   * Get alert history
   */
  getAlertHistory(limit = 100): PerformanceAlert[] {
    return this.alertHistory.slice(-limit);
  }

  /**
   * Get active alert rules
   */
  getRules(): AlertRule[] {
    return [...this.rules];
  }

  /**
   * Get configured channels
   */
  getChannels(): AlertChannel[] {
    return [...this.channels];
  }

  /**
   * Test an alert channel
   */
  async testChannel(channelType: string): Promise<NotificationResult> {
    const channel = this.channels.find(c => c.type === channelType);
    if (!channel) {
      return {
        success: false,
        channel: channelType,
        error: 'Channel not found',
        timestamp: Date.now()
      };
    }
    
    const testAlert: PerformanceAlert = {
      id: 'test-alert',
      timestamp: Date.now(),
      severity: 'warning',
      metric: 'test.metric',
      value: 50,
      threshold: 40,
      message: 'This is a test alert to verify channel configuration',
      component: 'alerting-service',
      resolved: false
    };
    
    return this.sendToChannel(testAlert, channel);
  }

  /**
   * Get alerting statistics
   */
  getStatistics(): {
    totalAlerts: number;
    alertsByType: Record<string, number>;
    alertsBySeverity: Record<string, number>;
    channelStats: Record<string, { sent: number; failed: number }>;
    activeRules: number;
    enabledChannels: number;
  } {
    const alertsByType: Record<string, number> = {};
    const alertsBySeverity: Record<string, number> = {};
    
    this.alertHistory.forEach(alert => {
      const component = alert.component;
      const severity = alert.severity;
      
      alertsByType[component] = (alertsByType[component] || 0) + 1;
      alertsBySeverity[severity] = (alertsBySeverity[severity] || 0) + 1;
    });
    
    return {
      totalAlerts: this.alertHistory.length,
      alertsByType,
      alertsBySeverity,
      channelStats: {}, // TODO: Track per-channel statistics
      activeRules: this.rules.filter(r => r.enabled).length,
      enabledChannels: this.channels.filter(c => c.enabled).length
    };
  }

  // Private methods

  private evaluateRule(rule: AlertRule, value: number, timestamp: number): void {
    const conditionMet = this.checkCondition(rule, value);
    const ruleKey = rule.id;
    
    if (conditionMet) {
      // Check if this is a new condition or continuation
      if (!this.persistentConditions.has(ruleKey)) {
        this.persistentConditions.set(ruleKey, {
          startTime: timestamp,
          lastValue: value
        });
      } else {
        const condition = this.persistentConditions.get(ruleKey)!;
        condition.lastValue = value;
        
        // Check if condition has persisted long enough
        const duration = timestamp - condition.startTime;
        if (duration >= rule.duration) {
          // Check cooldown period
          const lastAlert = this.cooldowns.get(ruleKey) || 0;
          if (timestamp - lastAlert >= rule.cooldown) {
            this.triggerAlert(rule, value, timestamp);
            this.cooldowns.set(ruleKey, timestamp);
          }
        }
      }
    } else {
      // Condition no longer met, clear persistent state
      this.persistentConditions.delete(ruleKey);
    }
  }

  private checkCondition(rule: AlertRule, value: number): boolean {
    switch (rule.condition) {
      case 'greater_than':
        return value > rule.threshold;
      case 'less_than':
        return value < rule.threshold;
      case 'equals':
        return value === rule.threshold;
      case 'not_equals':
        return value !== rule.threshold;
      default:
        return false;
    }
  }

  private triggerAlert(rule: AlertRule, value: number, timestamp: number): void {
    const alert: PerformanceAlert = {
      id: `alert-${rule.id}-${timestamp}`,
      timestamp,
      severity: rule.severity,
      metric: rule.metric,
      value,
      threshold: rule.threshold,
      message: `${rule.description}: ${value} ${this.getConditionText(rule)} ${rule.threshold}`,
      component: rule.tags.includes('component') ? rule.tags[rule.tags.indexOf('component') + 1] || 'unknown' : 'system',
      resolved: false
    };
    
    this.sendAlert(alert);
    this.emit('alert_triggered', { rule, alert });
  }

  private getConditionText(rule: AlertRule): string {
    switch (rule.condition) {
      case 'greater_than': return '>';
      case 'less_than': return '<';
      case 'equals': return '=';
      case 'not_equals': return '≠';
      default: return '?';
    }
  }

  private shouldSendToChannel(alert: PerformanceAlert, channel: AlertChannel): boolean {
    if (!channel.filters) return true;
    
    // Check severity filter
    if (channel.filters.severity && !channel.filters.severity.includes(alert.severity)) {
      return false;
    }
    
    // Check component filter
    if (channel.filters.components && !channel.filters.components.includes(alert.component)) {
      return false;
    }
    
    // Check metric filter
    if (channel.filters.metrics && !channel.filters.metrics.includes(alert.metric)) {
      return false;
    }
    
    return true;
  }

  private async sendToChannel(alert: PerformanceAlert, channel: AlertChannel): Promise<NotificationResult> {
    try {
      switch (channel.type) {
        case 'console':
          return this.sendConsoleAlert(alert);
          
        case 'webhook':
          return this.sendWebhookAlert(alert, channel.config);
          
        case 'email':
          return this.sendEmailAlert(alert, channel.config);
          
        case 'slack':
          return this.sendSlackAlert(alert, channel.config);
          
        case 'discord':
          return this.sendDiscordAlert(alert, channel.config);
          
        default:
          throw new Error(`Unsupported channel type: ${channel.type}`);
      }
    } catch (error) {
      return {
        success: false,
        channel: channel.type,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now()
      };
    }
  }

  private sendConsoleAlert(alert: PerformanceAlert): NotificationResult {
    const icon = alert.severity === 'critical' ? '🚨' : '⚠️';
    const color = alert.severity === 'critical' ? '\x1b[31m' : '\x1b[33m';
    const reset = '\x1b[0m';
    
    console.log(`${color}${icon} PERFORMANCE ALERT${reset}`);
    console.log(`${color}Severity: ${alert.severity.toUpperCase()}${reset}`);
    console.log(`${color}Component: ${alert.component}${reset}`);
    console.log(`${color}Metric: ${alert.metric}${reset}`);
    console.log(`${color}Value: ${alert.value} (threshold: ${alert.threshold})${reset}`);
    console.log(`${color}Message: ${alert.message}${reset}`);
    console.log(`${color}Time: ${new Date(alert.timestamp).toISOString()}${reset}`);
    console.log('');
    
    return {
      success: true,
      channel: 'console',
      timestamp: Date.now()
    };
  }

  private async sendWebhookAlert(alert: PerformanceAlert, config: any): Promise<NotificationResult> {
    if (!config.url) {
      throw new Error('Webhook URL not configured');
    }
    
    const payload = {
      type: 'performance_alert',
      alert,
      timestamp: Date.now(),
      service: 'claude-flow'
    };
    
    // In a real implementation, you would use fetch or a HTTP client
    this.logger.info(`Webhook alert would be sent to: ${config.url}`, payload);
    
    // Simulate HTTP request
    await new Promise(resolve => setTimeout(resolve, 100));
    
    return {
      success: true,
      channel: 'webhook',
      timestamp: Date.now()
    };
  }

  private async sendEmailAlert(alert: PerformanceAlert, config: any): Promise<NotificationResult> {
    if (!config.recipient) {
      throw new Error('Email recipient not configured');
    }
    
    const subject = `[Claude Flow] ${alert.severity.toUpperCase()} Alert: ${alert.component}`;
    const body = `
Performance Alert Details:

Severity: ${alert.severity.toUpperCase()}
Component: ${alert.component}
Metric: ${alert.metric}
Current Value: ${alert.value}
Threshold: ${alert.threshold}
Message: ${alert.message}
Time: ${new Date(alert.timestamp).toISOString()}

This alert was generated by the Claude Flow performance monitoring system.
`;
    
    // In a real implementation, integrate with an email service
    this.logger.info(`Email alert would be sent to: ${config.recipient}`, { subject, body });
    
    return {
      success: true,
      channel: 'email',
      timestamp: Date.now()
    };
  }

  private async sendSlackAlert(alert: PerformanceAlert, config: any): Promise<NotificationResult> {
    if (!config.webhook_url) {
      throw new Error('Slack webhook URL not configured');
    }
    
    const color = alert.severity === 'critical' ? 'danger' : 'warning';
    const icon = alert.severity === 'critical' ? ':rotating_light:' : ':warning:';
    
    const payload = {
      text: `${icon} Performance Alert: ${alert.component}`,
      attachments: [
        {
          color,
          title: alert.message,
          fields: [
            { title: 'Severity', value: alert.severity.toUpperCase(), short: true },
            { title: 'Metric', value: alert.metric, short: true },
            { title: 'Value', value: alert.value.toString(), short: true },
            { title: 'Threshold', value: alert.threshold.toString(), short: true },
            { title: 'Component', value: alert.component, short: true },
            { title: 'Time', value: new Date(alert.timestamp).toISOString(), short: true }
          ],
          footer: 'Claude Flow Performance Monitor',
          ts: Math.floor(alert.timestamp / 1000)
        }
      ]
    };
    
    // In a real implementation, send HTTP POST to Slack webhook
    this.logger.info(`Slack alert would be sent to: ${config.webhook_url}`, payload);
    
    return {
      success: true,
      channel: 'slack',
      timestamp: Date.now()
    };
  }

  private async sendDiscordAlert(alert: PerformanceAlert, config: any): Promise<NotificationResult> {
    if (!config.webhook_url) {
      throw new Error('Discord webhook URL not configured');
    }
    
    const color = alert.severity === 'critical' ? 0xFF0000 : 0xFFAA00; // Red or Orange
    
    const payload = {
      embeds: [
        {
          title: `🔍 Performance Alert: ${alert.component}`,
          description: alert.message,
          color,
          fields: [
            { name: 'Severity', value: alert.severity.toUpperCase(), inline: true },
            { name: 'Metric', value: alert.metric, inline: true },
            { name: 'Value', value: alert.value.toString(), inline: true },
            { name: 'Threshold', value: alert.threshold.toString(), inline: true },
            { name: 'Component', value: alert.component, inline: true },
            { name: 'Time', value: new Date(alert.timestamp).toISOString(), inline: true }
          ],
          footer: {
            text: 'Claude Flow Performance Monitor'
          },
          timestamp: new Date(alert.timestamp).toISOString()
        }
      ]
    };
    
    // In a real implementation, send HTTP POST to Discord webhook
    this.logger.info(`Discord alert would be sent to: ${config.webhook_url}`, payload);
    
    return {
      success: true,
      channel: 'discord',
      timestamp: Date.now()
    };
  }
}

// Default alert rules
export const defaultAlertRules: AlertRule[] = [
  {
    id: 'cpu-high',
    name: 'High CPU Usage',
    metric: 'system.cpuUsage',
    condition: 'greater_than',
    threshold: 80,
    severity: 'warning',
    duration: 30000, // 30 seconds
    cooldown: 300000, // 5 minutes
    enabled: true,
    description: 'CPU usage is above acceptable levels',
    tags: ['system', 'performance']
  },
  {
    id: 'cpu-critical',
    name: 'Critical CPU Usage',
    metric: 'system.cpuUsage',
    condition: 'greater_than',
    threshold: 95,
    severity: 'critical',
    duration: 10000, // 10 seconds
    cooldown: 180000, // 3 minutes
    enabled: true,
    description: 'CPU usage is critically high',
    tags: ['system', 'performance', 'critical']
  },
  {
    id: 'memory-high',
    name: 'High Memory Usage',
    metric: 'system.memoryUsage',
    condition: 'greater_than',
    threshold: 85,
    severity: 'warning',
    duration: 60000, // 1 minute
    cooldown: 600000, // 10 minutes
    enabled: true,
    description: 'Memory usage is above acceptable levels',
    tags: ['system', 'memory']
  },
  {
    id: 'response-time-slow',
    name: 'Slow Response Times',
    metric: 'agents.avgResponseTime',
    condition: 'greater_than',
    threshold: 2000, // 2 seconds
    severity: 'warning',
    duration: 45000, // 45 seconds
    cooldown: 300000, // 5 minutes
    enabled: true,
    description: 'Agent response times are slower than expected',
    tags: ['agents', 'performance']
  },
  {
    id: 'frame-rate-low',
    name: 'Low Frame Rate',
    metric: 'ui.frameRate',
    condition: 'less_than',
    threshold: 30,
    severity: 'warning',
    duration: 20000, // 20 seconds
    cooldown: 240000, // 4 minutes
    enabled: true,
    description: 'UI frame rate has dropped below acceptable levels',
    tags: ['ui', 'performance']
  }
];