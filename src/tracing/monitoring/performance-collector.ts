/**
 * Performance Metrics Collector
 * Specialized collector for gathering system performance metrics
 */

import { EventEmitter } from 'node:events';
import { performance, PerformanceObserver } from 'node:perf_hooks';
import { cpus, freemem, totalmem, loadavg } from 'node:os';
import { execSync } from 'node:child_process';
import { Logger } from '../../core/logger.js';

export interface SystemMetrics {
  timestamp: number;
  cpu: {
    usage: number;
    loadAverage: number[];
    cores: number;
  };
  memory: {
    used: number;
    free: number;
    total: number;
    percentage: number;
    heap: NodeJS.MemoryUsage;
  };
  disk: {
    usage: number;
    free: number;
    total: number;
    percentage: number;
  };
  network: {
    latency: number;
    throughput: number;
    connections: number;
  };
  process: {
    uptime: number;
    pid: number;
    version: string;
    activeHandles: number;
  };
}

export interface ResourceThresholds {
  cpu: { warning: number; critical: number };
  memory: { warning: number; critical: number };
  disk: { warning: number; critical: number };
}

export class PerformanceCollector extends EventEmitter {
  private logger: Logger;
  private isCollecting = false;
  private collectionInterval = 5000; // 5 seconds
  private timer?: NodeJS.Timeout;
  private performanceObserver?: PerformanceObserver;
  
  // Baseline measurements
  private baseline: SystemMetrics | null = null;
  private history: SystemMetrics[] = [];
  private maxHistorySize = 100;
  
  // Thresholds for alerts
  private thresholds: ResourceThresholds = {
    cpu: { warning: 70, critical: 90 },
    memory: { warning: 80, critical: 95 },
    disk: { warning: 85, critical: 95 }
  };

  constructor(logger: Logger, options: {
    interval?: number;
    maxHistory?: number;
    thresholds?: Partial<ResourceThresholds>;
  } = {}) {
    super();
    
    this.logger = logger;
    this.collectionInterval = options.interval || 5000;
    this.maxHistorySize = options.maxHistory || 100;
    
    if (options.thresholds) {
      this.thresholds = { ...this.thresholds, ...options.thresholds };
    }
    
    this.setupPerformanceObserver();
  }

  /**
   * Start collecting performance metrics
   */
  start(): void {
    if (this.isCollecting) {
      this.logger.warn('Performance collector already running');
      return;
    }
    
    this.logger.info('Starting performance collection...');
    this.isCollecting = true;
    
    // Collect initial baseline
    this.baseline = this.collectMetrics();
    this.history.push(this.baseline);
    
    // Start periodic collection
    this.timer = setInterval(() => {
      try {
        const metrics = this.collectMetrics();
        this.addToHistory(metrics);
        this.checkThresholds(metrics);
        this.emit('metrics', metrics);
      } catch (error) {
        this.logger.error('Error collecting performance metrics:', error);
      }
    }, this.collectionInterval);
    
    this.emit('started');
    this.logger.info(`Performance collector started (interval: ${this.collectionInterval}ms)`);
  }

  /**
   * Stop collecting performance metrics
   */
  stop(): void {
    if (!this.isCollecting) return;
    
    this.logger.info('Stopping performance collection...');
    this.isCollecting = false;
    
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    
    if (this.performanceObserver) {
      this.performanceObserver.disconnect();
    }
    
    this.emit('stopped');
    this.logger.info('Performance collector stopped');
  }

  /**
   * Get current system metrics
   */
  getCurrentMetrics(): SystemMetrics {
    return this.collectMetrics();
  }

  /**
   * Get metrics history
   */
  getHistory(): SystemMetrics[] {
    return [...this.history];
  }

  /**
   * Get baseline metrics
   */
  getBaseline(): SystemMetrics | null {
    return this.baseline;
  }

  /**
   * Calculate performance delta from baseline
   */
  getPerformanceDelta(): {
    cpu: number;
    memory: number;
    disk: number;
  } | null {
    if (!this.baseline || this.history.length === 0) return null;
    
    const current = this.history[this.history.length - 1];
    
    return {
      cpu: current.cpu.usage - this.baseline.cpu.usage,
      memory: current.memory.percentage - this.baseline.memory.percentage,
      disk: current.disk.percentage - this.baseline.disk.percentage
    };
  }

  /**
   * Get performance statistics
   */
  getStatistics(): {
    cpu: { min: number; max: number; avg: number; current: number };
    memory: { min: number; max: number; avg: number; current: number };
    disk: { min: number; max: number; avg: number; current: number };
  } | null {
    if (this.history.length === 0) return null;
    
    const cpuValues = this.history.map(h => h.cpu.usage);
    const memoryValues = this.history.map(h => h.memory.percentage);
    const diskValues = this.history.map(h => h.disk.percentage);
    
    const current = this.history[this.history.length - 1];
    
    return {
      cpu: {
        min: Math.min(...cpuValues),
        max: Math.max(...cpuValues),
        avg: cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length,
        current: current.cpu.usage
      },
      memory: {
        min: Math.min(...memoryValues),
        max: Math.max(...memoryValues),
        avg: memoryValues.reduce((a, b) => a + b, 0) / memoryValues.length,
        current: current.memory.percentage
      },
      disk: {
        min: Math.min(...diskValues),
        max: Math.max(...diskValues),
        avg: diskValues.reduce((a, b) => a + b, 0) / diskValues.length,
        current: current.disk.percentage
      }
    };
  }

  /**
   * Update collection thresholds
   */
  updateThresholds(thresholds: Partial<ResourceThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
    this.logger.info('Updated performance thresholds:', this.thresholds);
  }

  /**
   * Check if system is under high load
   */
  isHighLoad(): boolean {
    if (this.history.length === 0) return false;
    
    const current = this.history[this.history.length - 1];
    
    return (
      current.cpu.usage > this.thresholds.cpu.warning ||
      current.memory.percentage > this.thresholds.memory.warning ||
      current.disk.percentage > this.thresholds.disk.warning
    );
  }

  /**
   * Get system health score (0-100)
   */
  getHealthScore(): number {
    if (this.history.length === 0) return 100;
    
    const current = this.history[this.history.length - 1];
    
    // Calculate individual health scores
    const cpuHealth = Math.max(0, 100 - current.cpu.usage);
    const memoryHealth = Math.max(0, 100 - current.memory.percentage);
    const diskHealth = Math.max(0, 100 - current.disk.percentage);
    
    // Weighted average (CPU and memory are more important)
    return Math.round((cpuHealth * 0.4 + memoryHealth * 0.4 + diskHealth * 0.2));
  }

  // Private methods

  private collectMetrics(): SystemMetrics {
    const timestamp = Date.now();
    const memUsage = process.memoryUsage();
    const totalMem = totalmem();
    const freeMem = freemem();
    const usedMem = totalMem - freeMem;
    
    // Get CPU information
    const cpuInfo = cpus();
    const loadAvg = loadavg();
    
    // Calculate CPU usage (simplified)
    const cpuUsage = this.calculateCpuUsage();
    
    // Get disk usage (cross-platform)
    const diskInfo = this.getDiskUsage();
    
    // Get network info
    const networkInfo = this.getNetworkInfo();
    
    return {
      timestamp,
      cpu: {
        usage: cpuUsage,
        loadAverage: loadAvg,
        cores: cpuInfo.length
      },
      memory: {
        used: usedMem,
        free: freeMem,
        total: totalMem,
        percentage: (usedMem / totalMem) * 100,
        heap: memUsage
      },
      disk: {
        usage: diskInfo.used,
        free: diskInfo.free,
        total: diskInfo.total,
        percentage: diskInfo.percentage
      },
      network: {
        latency: networkInfo.latency,
        throughput: networkInfo.throughput,
        connections: networkInfo.connections
      },
      process: {
        uptime: process.uptime(),
        pid: process.pid,
        version: process.version,
        activeHandles: (process as any)._getActiveHandles ? (process as any)._getActiveHandles().length : 0
      }
    };
  }

  private calculateCpuUsage(): number {
    try {
      // Use process.cpuUsage() for Node.js CPU usage
      const cpuUsage = process.cpuUsage();
      const totalTime = cpuUsage.user + cpuUsage.system;
      
      // Convert microseconds to percentage (simplified approach)
      return Math.min(100, (totalTime / 1000000) * 100);
    } catch (error) {
      this.logger.warn('Could not calculate CPU usage:', error);
      return 0;
    }
  }

  private getDiskUsage(): { used: number; free: number; total: number; percentage: number } {
    try {
      // Try to get disk usage from system commands
      let result: string;
      
      if (process.platform === 'win32') {
        // Windows
        result = execSync('wmic logicaldisk get size,freespace,caption', { encoding: 'utf8' });
        // Parse Windows output (simplified)
        return { used: 0, free: 0, total: 0, percentage: 0 };
      } else {
        // Unix-like systems
        result = execSync('df -h /', { encoding: 'utf8' });
        const lines = result.split('\n');
        
        if (lines.length > 1) {
          const parts = lines[1].split(/\s+/);
          const total = this.parseSize(parts[1]);
          const used = this.parseSize(parts[2]);
          const free = this.parseSize(parts[3]);
          const percentage = parseFloat(parts[4].replace('%', ''));
          
          return { used, free, total, percentage };
        }
      }
    } catch (error) {
      this.logger.warn('Could not get disk usage:', error);
    }
    
    return { used: 0, free: 0, total: 0, percentage: 0 };
  }

  private getNetworkInfo(): { latency: number; throughput: number; connections: number } {
    try {
      // Simple network latency test (ping localhost)
      const start = performance.now();
      execSync('ping -c 1 localhost > /dev/null 2>&1', { timeout: 1000 });
      const latency = performance.now() - start;
      
      return {
        latency,
        throughput: 0, // Would need more complex measurement
        connections: 0 // Would need netstat or similar
      };
    } catch (error) {
      return {
        latency: 0,
        throughput: 0,
        connections: 0
      };
    }
  }

  private parseSize(sizeStr: string): number {
    const units = { K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };
    const match = sizeStr.match(/^(\d+(?:\.\d+)?)([KMGT]?)$/);
    
    if (!match) return 0;
    
    const value = parseFloat(match[1]);
    const unit = match[2] as keyof typeof units;
    
    return value * (units[unit] || 1);
  }

  private addToHistory(metrics: SystemMetrics): void {
    this.history.push(metrics);
    
    // Keep history size manageable
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(-this.maxHistorySize);
    }
  }

  private checkThresholds(metrics: SystemMetrics): void {
    const alerts: Array<{ type: string; level: 'warning' | 'critical'; value: number; threshold: number }> = [];
    
    // Check CPU threshold
    if (metrics.cpu.usage >= this.thresholds.cpu.critical) {
      alerts.push({ type: 'cpu', level: 'critical', value: metrics.cpu.usage, threshold: this.thresholds.cpu.critical });
    } else if (metrics.cpu.usage >= this.thresholds.cpu.warning) {
      alerts.push({ type: 'cpu', level: 'warning', value: metrics.cpu.usage, threshold: this.thresholds.cpu.warning });
    }
    
    // Check memory threshold
    if (metrics.memory.percentage >= this.thresholds.memory.critical) {
      alerts.push({ type: 'memory', level: 'critical', value: metrics.memory.percentage, threshold: this.thresholds.memory.critical });
    } else if (metrics.memory.percentage >= this.thresholds.memory.warning) {
      alerts.push({ type: 'memory', level: 'warning', value: metrics.memory.percentage, threshold: this.thresholds.memory.warning });
    }
    
    // Check disk threshold
    if (metrics.disk.percentage >= this.thresholds.disk.critical) {
      alerts.push({ type: 'disk', level: 'critical', value: metrics.disk.percentage, threshold: this.thresholds.disk.critical });
    } else if (metrics.disk.percentage >= this.thresholds.disk.warning) {
      alerts.push({ type: 'disk', level: 'warning', value: metrics.disk.percentage, threshold: this.thresholds.disk.warning });
    }
    
    // Emit alerts
    alerts.forEach(alert => {
      this.emit('threshold_exceeded', {
        ...alert,
        timestamp: metrics.timestamp,
        message: `${alert.type.toUpperCase()} usage ${alert.level}: ${alert.value.toFixed(1)}% (threshold: ${alert.threshold}%)`
      });
    });
  }

  private setupPerformanceObserver(): void {
    try {
      this.performanceObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        
        for (const entry of entries) {
          if (entry.entryType === 'measure') {
            this.emit('performance_measure', {
              name: entry.name,
              duration: entry.duration,
              startTime: entry.startTime,
              timestamp: Date.now()
            });
          }
        }
      });
      
      this.performanceObserver.observe({ 
        entryTypes: ['measure', 'navigation', 'resource'],
        buffered: true
      });
      
    } catch (error) {
      this.logger.warn('Could not setup performance observer:', error);
    }
  }
}