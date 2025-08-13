/**
 * Core trace collector with selective instrumentation and performance optimization
 */

import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import { 
  TraceEvent, 
  TracingConfig, 
  TraceCollectorOptions,
  TraceEventHandler,
  TraceFilter,
  TraceTransform,
  TraceEventType,
  PerformanceMetrics
} from './types.js';
import { generateId } from '../utils/helpers.js';
import { Logger } from '../core/logger.js';

export class TraceCollector extends EventEmitter {
  private config: TracingConfig;
  private logger: Logger;
  private filters: TraceFilter[] = [];
  private transforms: TraceTransform[] = [];
  private handlers: TraceEventHandler[] = [];
  
  // Performance monitoring
  private performanceTracker = new PerformanceTracker();
  private rateLimiter = new RateLimiter();
  private memoryManager = new TraceMemoryManager();
  
  // Processing queue
  private queue: TraceEvent[] = [];
  private processing = false;
  private batchSize: number;
  private flushInterval: number;
  private flushTimer?: NodeJS.Timeout;
  
  // Metrics
  private metrics = {
    collected: 0,
    filtered: 0,
    processed: 0,
    errors: 0,
    avgProcessingTime: 0
  };

  constructor(options: TraceCollectorOptions) {
    super();
    
    this.config = options.config;
    this.logger = new Logger('TraceCollector');
    this.filters = options.filters || [];
    this.transforms = options.transforms || [];
    this.handlers = options.handlers || [];
    
    this.batchSize = this.config.performance.batchSize;
    this.flushInterval = this.config.performance.flushInterval;
    
    this.setupPerformanceMonitoring();
    this.startProcessing();
  }

  /**
   * Collect a trace event with full processing pipeline
   */
  async collect(event: TraceEvent): Promise<void> {
    const startTime = performance.now();
    
    try {
      this.metrics.collected++;
      
      // Performance gating - reject if system is overloaded
      if (!this.performanceTracker.canAcceptTrace()) {
        this.metrics.filtered++;
        return;
      }
      
      // Rate limiting per agent
      if (this.rateLimiter.isRateLimited(event.agentId, event.type)) {
        this.metrics.filtered++;
        return;
      }
      
      // Apply filters
      if (!this.shouldTrace(event)) {
        this.metrics.filtered++;
        return;
      }
      
      // Apply transforms
      const transformedEvent = this.applyTransforms(event);
      
      // Add to processing queue
      this.enqueue(transformedEvent);
      
      // Update performance metrics
      const processingTime = performance.now() - startTime;
      this.updateProcessingMetrics(processingTime);
      
    } catch (error) {
      this.metrics.errors++;
      this.logger.error('Error collecting trace event:', error);
      this.emit('error', error);
    }
  }

  /**
   * Create and collect a trace event in one call
   */
  async trace(
    type: TraceEventType,
    agentId: string,
    data: any,
    options: {
      sessionId?: string;
      parentId?: string;
      correlationId?: string;
      priority?: 'low' | 'normal' | 'high' | 'critical';
      tags?: string[];
    } = {}
  ): Promise<string> {
    const traceId = generateId('trace');
    
    const event: TraceEvent = {
      id: traceId,
      timestamp: Date.now(),
      sessionId: options.sessionId || this.getCurrentSessionId(),
      agentId,
      type,
      phase: 'complete',
      data,
      metadata: {
        parentId: options.parentId,
        correlationId: options.correlationId || traceId,
        tags: options.tags || [type],
        priority: options.priority || 'normal',
        retention: this.config.retention.default
      },
      performance: this.capturePerformanceMetrics()
    };
    
    await this.collect(event);
    return traceId;
  }

  /**
   * Start a long-running trace operation
   */
  startTrace(
    type: TraceEventType,
    agentId: string,
    data: any,
    options: any = {}
  ): string {
    const traceId = generateId('trace');
    
    const event: TraceEvent = {
      id: traceId,
      timestamp: Date.now(),
      sessionId: options.sessionId || this.getCurrentSessionId(),
      agentId,
      type,
      phase: 'start',
      data,
      metadata: {
        parentId: options.parentId,
        correlationId: options.correlationId || traceId,
        tags: options.tags || [type, 'start'],
        priority: options.priority || 'normal',
        retention: this.config.retention.default
      },
      performance: this.capturePerformanceMetrics()
    };
    
    this.collect(event);
    return traceId;
  }

  /**
   * Update a long-running trace with progress
   */
  updateTrace(traceId: string, data: any, progress?: number): void {
    // Find original trace to get context
    const originalTrace = this.memoryManager.getTrace(traceId);
    if (!originalTrace) {
      this.logger.warn(`Cannot update trace ${traceId}: not found`);
      return;
    }
    
    const event: TraceEvent = {
      ...originalTrace,
      id: generateId('trace'),
      timestamp: Date.now(),
      phase: 'progress',
      data: { ...originalTrace.data, ...data, progress },
      metadata: {
        ...originalTrace.metadata,
        parentId: traceId,
        tags: [...originalTrace.metadata.tags, 'progress']
      },
      performance: this.capturePerformanceMetrics()
    };
    
    this.collect(event);
  }

  /**
   * Complete a long-running trace
   */
  completeTrace(traceId: string, result: any): void {
    const originalTrace = this.memoryManager.getTrace(traceId);
    if (!originalTrace) {
      this.logger.warn(`Cannot complete trace ${traceId}: not found`);
      return;
    }
    
    const event: TraceEvent = {
      ...originalTrace,
      id: generateId('trace'),
      timestamp: Date.now(),
      phase: 'complete',
      data: { ...originalTrace.data, result },
      metadata: {
        ...originalTrace.metadata,
        parentId: traceId,
        tags: [...originalTrace.metadata.tags.filter(t => t !== 'start'), 'complete']
      },
      performance: this.capturePerformanceMetrics()
    };
    
    this.collect(event);
  }

  /**
   * Error a long-running trace
   */
  errorTrace(traceId: string, error: any): void {
    const originalTrace = this.memoryManager.getTrace(traceId);
    if (!originalTrace) {
      this.logger.warn(`Cannot error trace ${traceId}: not found`);
      return;
    }
    
    const event: TraceEvent = {
      ...originalTrace,
      id: generateId('trace'),
      timestamp: Date.now(),
      phase: 'error',
      data: { 
        ...originalTrace.data, 
        error: {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          recoverable: false
        }
      },
      metadata: {
        ...originalTrace.metadata,
        parentId: traceId,
        tags: [...originalTrace.metadata.tags, 'error'],
        priority: 'high',
        retention: this.config.retention.error
      },
      performance: this.capturePerformanceMetrics()
    };
    
    this.collect(event);
  }

  /**
   * Add a filter to the processing pipeline
   */
  addFilter(filter: TraceFilter): void {
    this.filters.push(filter);
  }

  /**
   * Add a transform to the processing pipeline
   */
  addTransform(transform: TraceTransform): void {
    this.transforms.push(transform);
  }

  /**
   * Add a handler to the processing pipeline
   */
  addHandler(handler: TraceEventHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Get current collector metrics
   */
  getMetrics(): any {
    return {
      ...this.metrics,
      performance: this.performanceTracker.getMetrics(),
      rateLimiting: this.rateLimiter.getMetrics(),
      memory: this.memoryManager.getMetrics(),
      queueSize: this.queue.length
    };
  }

  /**
   * Shutdown the collector gracefully
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down trace collector...');
    
    // Stop accepting new traces
    this.config.enabled = false;
    
    // Flush remaining traces
    await this.flush();
    
    // Stop timers
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    
    this.emit('shutdown');
  }

  // Private methods

  private shouldTrace(event: TraceEvent): boolean {
    // Check global enable flag
    if (!this.config.enabled) {
      return false;
    }
    
    // Check sampling rate
    if (this.config.sampling.enabled) {
      const rate = this.config.sampling.adaptiveRates[event.type] || this.config.sampling.rate;
      if (Math.random() > rate) {
        return false;
      }
    }
    
    // Check event type filters
    if (this.config.filters.excludeEvents.includes(event.type)) {
      return false;
    }
    
    // Check agent filters
    if (this.config.filters.includeAgents.length > 0) {
      if (!this.config.filters.includeAgents.includes(event.agentId)) {
        return false;
      }
    }
    
    if (this.config.filters.excludeAgents.includes(event.agentId)) {
      return false;
    }
    
    // Check priority filter
    const priorityOrder = { low: 0, normal: 1, high: 2, critical: 3 };
    const eventPriority = priorityOrder[event.metadata.priority];
    const minPriority = priorityOrder[this.config.filters.minimumPriority];
    
    if (eventPriority < minPriority) {
      return false;
    }
    
    // Apply custom filters
    return this.filters.every(filter => filter(event));
  }

  private applyTransforms(event: TraceEvent): TraceEvent {
    return this.transforms.reduce((currentEvent, transform) => {
      try {
        return transform(currentEvent);
      } catch (error) {
        this.logger.error('Error applying transform:', error);
        return currentEvent;
      }
    }, event);
  }

  private enqueue(event: TraceEvent): void {
    this.queue.push(event);
    this.memoryManager.addTrace(event);
    
    if (this.queue.length >= this.batchSize) {
      this.processImmediate();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.processBatch();
      }, this.flushInterval);
    }
  }

  private startProcessing(): void {
    // Regular batch processing
    setInterval(() => {
      if (this.queue.length > 0) {
        this.processBatch();
      }
    }, this.flushInterval);
  }

  private async processImmediate(): Promise<void> {
    if (this.processing) return;
    
    this.processing = true;
    await this.processBatch();
    this.processing = false;
  }

  private async processBatch(): Promise<void> {
    if (this.queue.length === 0) return;
    
    const batch = this.queue.splice(0, this.batchSize);
    
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    
    try {
      await Promise.all(
        this.handlers.map(handler => 
          this.processEventWithHandler(batch, handler)
        )
      );
      
      this.metrics.processed += batch.length;
      this.emit('batch_processed', { size: batch.length, events: batch });
      
    } catch (error) {
      this.metrics.errors++;
      this.logger.error('Error processing batch:', error);
      this.emit('error', error);
    }
  }

  private async processEventWithHandler(
    events: TraceEvent[], 
    handler: TraceEventHandler
  ): Promise<void> {
    try {
      for (const event of events) {
        await handler(event);
      }
    } catch (error) {
      this.logger.error('Handler error:', error);
    }
  }

  private async flush(): Promise<void> {
    while (this.queue.length > 0) {
      await this.processBatch();
    }
  }

  private capturePerformanceMetrics(): PerformanceMetrics {
    return {
      duration: 0, // Will be set by caller
      memoryUsage: process.memoryUsage().heapUsed,
      cpuTime: process.cpuUsage().user,
      tokenCount: undefined,
      networkLatency: undefined
    };
  }

  private getCurrentSessionId(): string {
    // TODO: Get from context or session manager
    return 'default-session';
  }

  private setupPerformanceMonitoring(): void {
    setInterval(() => {
      this.performanceTracker.update();
      this.rateLimiter.cleanup();
      this.memoryManager.cleanup();
    }, 5000);
  }

  private updateProcessingMetrics(processingTime: number): void {
    this.metrics.avgProcessingTime = 
      (this.metrics.avgProcessingTime * this.metrics.processed + processingTime) / 
      (this.metrics.processed + 1);
  }
}

/**
 * Performance tracker to monitor system load
 */
class PerformanceTracker {
  private cpuUsage = 0;
  private memoryUsage = 0;
  private lastCpuUsage = process.cpuUsage();
  private lastCheck = Date.now();

  update(): void {
    const now = Date.now();
    const currentCpuUsage = process.cpuUsage(this.lastCpuUsage);
    const timeDiff = now - this.lastCheck;
    
    // Calculate CPU percentage
    this.cpuUsage = (currentCpuUsage.user + currentCpuUsage.system) / (timeDiff * 1000);
    this.memoryUsage = process.memoryUsage().heapUsed;
    
    this.lastCpuUsage = process.cpuUsage();
    this.lastCheck = now;
  }

  canAcceptTrace(): boolean {
    // Reject if CPU or memory usage is too high
    return this.cpuUsage < 0.8 && this.memoryUsage < 1024 * 1024 * 1024; // 1GB
  }

  getMetrics(): any {
    return {
      cpuUsage: this.cpuUsage,
      memoryUsage: this.memoryUsage
    };
  }
}

/**
 * Rate limiter to prevent trace spam
 */
class RateLimiter {
  private rates = new Map<string, number[]>();
  private windowSize = 1000; // 1 second
  private maxPerWindow = 100;

  isRateLimited(agentId: string, eventType: TraceEventType): boolean {
    const key = `${agentId}:${eventType}`;
    const now = Date.now();
    
    if (!this.rates.has(key)) {
      this.rates.set(key, []);
    }
    
    const timestamps = this.rates.get(key)!;
    
    // Remove old timestamps
    const cutoff = now - this.windowSize;
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }
    
    // Check if rate limited
    if (timestamps.length >= this.maxPerWindow) {
      return true;
    }
    
    // Add current timestamp
    timestamps.push(now);
    return false;
  }

  cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.windowSize * 10; // Keep 10 windows of history
    
    for (const [key, timestamps] of this.rates) {
      while (timestamps.length > 0 && timestamps[0] < cutoff) {
        timestamps.shift();
      }
      
      if (timestamps.length === 0) {
        this.rates.delete(key);
      }
    }
  }

  getMetrics(): any {
    return {
      activeAgents: this.rates.size,
      totalTimestamps: Array.from(this.rates.values()).reduce((sum, arr) => sum + arr.length, 0)
    };
  }
}

/**
 * Memory manager for trace events
 */
class TraceMemoryManager {
  private traces = new Map<string, TraceEvent>();
  private maxSize = 10000;

  addTrace(event: TraceEvent): void {
    if (this.traces.size >= this.maxSize) {
      // Remove oldest trace
      const oldestKey = this.traces.keys().next().value;
      this.traces.delete(oldestKey);
    }
    
    this.traces.set(event.id, event);
  }

  getTrace(id: string): TraceEvent | undefined {
    return this.traces.get(id);
  }

  cleanup(): void {
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1 hour
    
    for (const [id, trace] of this.traces) {
      if (now - trace.timestamp > maxAge) {
        this.traces.delete(id);
      }
    }
  }

  getMetrics(): any {
    return {
      size: this.traces.size,
      maxSize: this.maxSize
    };
  }
}