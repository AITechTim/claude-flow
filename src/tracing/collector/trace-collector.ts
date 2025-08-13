/**
 * TraceCollector - Core trace collection and instrumentation
 */

import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';
import { TraceEvent, TraceEventType, TracingConfig, AgentTrace, EventMetadata, PerformanceMetrics } from '../types';
import { TraceStorage } from '../storage/trace-storage';
import { TraceStreamer } from '../streaming/trace-streamer';
import { EventFilterManager, EventPreprocessor } from './event-filters';
import { Logger } from '../../core/logger';

export interface TraceCollectorMetrics {
  totalEvents: number;
  eventsPerSecond: number;
  averageProcessingTime: number;
  bufferUtilization: number;
  samplingRate: number;
  errorCount: number;
  droppedEvents: number;
  collectionOverhead: number;
}

export class TraceCollector extends EventEmitter {
  private config: TracingConfig;
  private eventBuffer: TraceEvent[] = [];
  private agentTraces: Map<string, AgentTrace> = new Map();
  private isCollecting = false;
  private flushTimer?: NodeJS.Timeout;
  
  // Performance monitoring
  private metrics: TraceCollectorMetrics = {
    totalEvents: 0,
    eventsPerSecond: 0,
    averageProcessingTime: 0,
    bufferUtilization: 0,
    samplingRate: 0,
    errorCount: 0,
    droppedEvents: 0,
    collectionOverhead: 0
  };
  
  // Dependencies
  private storage?: TraceStorage;
  private streamer?: TraceStreamer;
  private filterManager: EventFilterManager;
  private logger: Logger;
  
  // Rate limiting and backpressure
  private lastFlushTime = Date.now();
  private processingTimes: number[] = [];
  private eventCounts: number[] = [];
  private lastSecondCount = Date.now();
  private currentSecondEvents = 0;
  
  // Sampling state
  private sampleCounter = 0;
  private adaptiveSamplingEnabled = true;
  private targetOverhead = 0.05; // 5% max overhead

  constructor(config: TracingConfig, storage?: TraceStorage, streamer?: TraceStreamer) {
    super();
    this.config = config;
    this.storage = storage;
    this.streamer = streamer;
    this.filterManager = new EventFilterManager();
    this.logger = new Logger('TraceCollector');
    
    this.setupFlushTimer();
    this.setupPerformanceMonitoring();
    this.setupAdaptiveSampling();
  }

  /**
   * Start trace collection
   */
  start(): void {
    if (this.isCollecting) {
      this.logger.warn('Trace collection already started');
      return;
    }
    
    this.logger.info('Starting trace collection');
    this.isCollecting = true;
    this.resetMetrics();
    
    // Initialize instrumentation
    this.initializeInstrumentation();
    
    // Setup event listeners
    this.setupEventListeners();
    
    // Start performance monitoring if enabled
    if (this.config.performanceMonitoring) {
      this.startPerformanceMonitoring();
    }
    
    this.emit('collection-started');
    this.logger.info('Trace collection started successfully');
  }

  /**
   * Stop trace collection
   */
  stop(): void {
    if (!this.isCollecting) {
      this.logger.warn('Trace collection already stopped');
      return;
    }
    
    this.logger.info('Stopping trace collection');
    this.isCollecting = false;
    
    // Flush remaining events
    this.flush();
    
    // Cleanup timers
    this.clearFlushTimer();
    this.stopPerformanceMonitoring();
    
    // Log final metrics
    this.logFinalMetrics();
    
    this.emit('collection-stopped');
    this.logger.info('Trace collection stopped successfully');
  }

  /**
   * Collect a trace event with comprehensive processing
   */
  collectEvent(event: Partial<TraceEvent>): void {
    const startTime = performance.now();
    
    try {
      // Quick validation for hot path optimization
      if (!this.isCollecting || !this.isValidEvent(event)) {
        this.metrics.droppedEvents++;
        return;
      }

      // Apply sampling logic early to avoid processing overhead
      if (!this.shouldCollectEvent(event)) {
        this.metrics.droppedEvents++;
        return;
      }

      // Preprocess and enrich the event
      const processedEvent = this.processEvent(event);
      
      // Apply filters
      if (!this.filterManager.shouldAcceptEvent(processedEvent)) {
        this.metrics.droppedEvents++;
        return;
      }

      // Handle backpressure - drop events if buffer is critically full
      if (this.isBackpressureTriggered()) {
        this.handleBackpressure(processedEvent);
        return;
      }

      // Add to buffer
      this.eventBuffer.push(processedEvent);
      this.updateAgentTrace(processedEvent);

      // Update metrics
      this.updateCollectionMetrics(performance.now() - startTime);

      // Real-time streaming if enabled
      if (this.config.realtimeStreaming && this.streamer) {
        this.streamer.broadcastTraceEvent(processedEvent);
      }

      // Emit for local listeners
      this.emit('event-collected', processedEvent);

      // Auto-flush if buffer threshold reached
      if (this.shouldFlush()) {
        this.flush();
      }
      
    } catch (error) {
      this.handleCollectionError(error, event);
    }
  }

  /**
   * Start a new trace with timing
   */
  startTrace(traceId: string, type: TraceEventType, agentId: string, swarmId: string, data?: any): string {
    const event: Partial<TraceEvent> = {
      id: traceId,
      type,
      agentId,
      swarmId,
      timestamp: Date.now(),
      data: { ...data, phase: 'start' },
      metadata: {
        source: 'trace-collector',
        severity: 'low',
        tags: ['lifecycle', 'start'],
        correlationId: traceId
      }
    };
    
    this.collectEvent(event);
    return traceId;
  }

  /**
   * Complete a trace with duration calculation
   */
  completeTrace(traceId: string, result?: any): void {
    const startEvent = this.findEventById(traceId);
    const duration = startEvent ? Date.now() - startEvent.timestamp : 0;
    
    const event: Partial<TraceEvent> = {
      id: this.generateEventId(),
      type: TraceEventType.TASK_COMPLETE,
      agentId: startEvent?.agentId || 'unknown',
      swarmId: startEvent?.swarmId || 'unknown',
      timestamp: Date.now(),
      duration,
      parentId: traceId,
      data: { 
        result,
        phase: 'complete',
        originalTraceId: traceId
      },
      metadata: {
        source: 'trace-collector',
        severity: 'low',
        tags: ['lifecycle', 'complete'],
        correlationId: traceId
      }
    };
    
    this.collectEvent(event);
  }

  /**
   * Record a trace error
   */
  errorTrace(traceId: string, error: Error | string): void {
    const startEvent = this.findEventById(traceId);
    const duration = startEvent ? Date.now() - startEvent.timestamp : 0;
    
    const event: Partial<TraceEvent> = {
      id: this.generateEventId(),
      type: TraceEventType.TASK_FAIL,
      agentId: startEvent?.agentId || 'unknown',
      swarmId: startEvent?.swarmId || 'unknown',
      timestamp: Date.now(),
      duration,
      parentId: traceId,
      data: {
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack
        } : { message: error },
        phase: 'error',
        originalTraceId: traceId
      },
      metadata: {
        source: 'trace-collector',
        severity: 'high',
        tags: ['lifecycle', 'error'],
        correlationId: traceId
      }
    };
    
    this.collectEvent(event);
  }

  /**
   * Get agent trace by ID
   */
  getAgentTrace(agentId: string): AgentTrace | undefined {
    return this.agentTraces.get(agentId);
  }

  /**
   * Get all agent traces
   */
  getAllAgentTraces(): AgentTrace[] {
    return Array.from(this.agentTraces.values());
  }

  /**
   * Get collection metrics
   */
  getMetrics(): TraceCollectorMetrics {
    this.updateDerivedMetrics();
    return { ...this.metrics };
  }

  /**
   * Add event filter
   */
  addFilter(filter: any): void {
    this.filterManager.addFilter(filter);
  }

  /**
   * Clear all filters
   */
  clearFilters(): void {
    this.filterManager.clearFilters();
  }

  /**
   * Force flush event buffer with comprehensive processing
   */
  async flush(): Promise<void> {
    if (this.eventBuffer.length === 0) {
      return;
    }

    const flushStart = performance.now();
    const events = [...this.eventBuffer];
    this.eventBuffer = [];
    
    this.logger.debug(`Flushing ${events.length} events`);

    try {
      // Store to persistent storage if available
      if (this.storage) {
        await this.storage.storeBatch(events);
      }

      // Emit for local processing
      this.emit('events-flushed', events);
      
      // Update metrics
      this.lastFlushTime = Date.now();
      const flushTime = performance.now() - flushStart;
      
      this.logger.debug(`Flushed ${events.length} events in ${flushTime.toFixed(2)}ms`);
      
    } catch (error) {
      this.logger.error('Error during flush:', error);
      this.metrics.errorCount++;
      
      // Re-queue events if storage fails (with limits to prevent memory issues)
      if (this.eventBuffer.length < this.config.bufferSize) {
        this.eventBuffer.unshift(...events.slice(0, this.config.bufferSize - this.eventBuffer.length));
      }
      
      throw error;
    }
  }

  // Private helper methods

  /**
   * Setup automatic flush timer
   */
  private setupFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    
    this.flushTimer = setInterval(() => {
      if (this.eventBuffer.length > 0) {
        this.flush().catch(error => {
          this.logger.error('Automatic flush failed:', error);
        });
      }
    }, this.config.flushInterval);
  }

  /**
   * Clear flush timer
   */
  private clearFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  /**
   * Setup performance monitoring
   */
  private setupPerformanceMonitoring(): void {
    // Track events per second
    setInterval(() => {
      this.updateEventsPerSecond();
    }, 1000);

    // Track processing times (keep last 100 samples)
    setInterval(() => {
      if (this.processingTimes.length > 100) {
        this.processingTimes = this.processingTimes.slice(-50);
      }
    }, 10000);
  }

  /**
   * Setup adaptive sampling
   */
  private setupAdaptiveSampling(): void {
    if (!this.adaptiveSamplingEnabled) return;

    setInterval(() => {
      this.adjustSamplingRate();
    }, 5000); // Adjust every 5 seconds
  }

  /**
   * Initialize instrumentation hooks
   */
  private initializeInstrumentation(): void {
    // Set up any global instrumentation hooks here
    // This could include process monitoring, memory tracking, etc.
    if (this.config.performanceMonitoring) {
      this.startSystemMetrics();
    }
  }

  /**
   * Setup event listeners for external events
   */
  private setupEventListeners(): void {
    // Listen to uncaught exceptions
    process.on('uncaughtException', (error) => {
      this.collectEvent({
        type: TraceEventType.TASK_FAIL,
        agentId: 'system',
        swarmId: 'system',
        data: { error: error.message, stack: error.stack },
        metadata: {
          source: 'system',
          severity: 'critical',
          tags: ['system', 'error', 'uncaught']
        }
      });
    });

    // Listen to unhandled rejections
    process.on('unhandledRejection', (reason) => {
      this.collectEvent({
        type: TraceEventType.TASK_FAIL,
        agentId: 'system',
        swarmId: 'system',
        data: { error: reason },
        metadata: {
          source: 'system',
          severity: 'critical',
          tags: ['system', 'error', 'unhandled-rejection']
        }
      });
    });
  }

  /**
   * Advanced sampling logic with adaptive rate control
   */
  private shouldCollectEvent(event: Partial<TraceEvent>): boolean {
    // Always collect critical events
    if (event.metadata?.severity === 'critical') {
      return true;
    }

    // Skip if sampling rate is 0
    if (this.config.samplingRate <= 0) {
      return false;
    }

    // Always collect if sampling rate is 1
    if (this.config.samplingRate >= 1) {
      return true;
    }

    // Deterministic sampling for better consistency
    this.sampleCounter++;
    const threshold = 1 / this.config.samplingRate;
    
    if (this.sampleCounter >= threshold) {
      this.sampleCounter = 0;
      return true;
    }

    return false;
  }

  /**
   * Process and enrich event data
   */
  private processEvent(event: Partial<TraceEvent>): TraceEvent {
    const processedEvent = EventPreprocessor.preprocessEvent({
      id: event.id || this.generateEventId(),
      timestamp: event.timestamp || Date.now(),
      type: event.type!,
      agentId: event.agentId!,
      swarmId: event.swarmId!,
      data: event.data || {},
      duration: event.duration,
      parentId: event.parentId,
      children: event.children || [],
      metadata: event.metadata
    });

    return processedEvent;
  }

  /**
   * Validate event structure
   */
  private isValidEvent(event: Partial<TraceEvent>): boolean {
    return !!(
      event.type &&
      event.agentId &&
      event.swarmId &&
      typeof event.type === 'string' &&
      typeof event.agentId === 'string' &&
      typeof event.swarmId === 'string'
    );
  }

  /**
   * Check if backpressure should be triggered
   */
  private isBackpressureTriggered(): boolean {
    const bufferUtilization = this.eventBuffer.length / this.config.bufferSize;
    return bufferUtilization > 0.9; // Trigger at 90% capacity
  }

  /**
   * Handle backpressure by dropping less important events
   */
  private handleBackpressure(event: TraceEvent): void {
    this.metrics.droppedEvents++;
    
    // Log backpressure condition
    if (this.metrics.droppedEvents % 100 === 0) {
      this.logger.warn(`Backpressure triggered: dropped ${this.metrics.droppedEvents} events`);
    }

    // Try to make room by dropping older, less important events
    const lowPriorityIndices: number[] = [];
    for (let i = 0; i < this.eventBuffer.length; i++) {
      const bufferedEvent = this.eventBuffer[i];
      if (bufferedEvent.metadata?.severity === 'low') {
        lowPriorityIndices.push(i);
      }
    }

    if (lowPriorityIndices.length > 0) {
      // Remove the oldest low priority event
      const indexToRemove = lowPriorityIndices[0];
      this.eventBuffer.splice(indexToRemove, 1);
      // Add the new event
      this.eventBuffer.push(event);
    }
  }

  /**
   * Check if buffer should be flushed
   */
  private shouldFlush(): boolean {
    const bufferFull = this.eventBuffer.length >= this.config.bufferSize;
    const timeThreshold = Date.now() - this.lastFlushTime > this.config.flushInterval;
    
    return bufferFull || timeThreshold;
  }

  /**
   * Update agent trace with new event and compute metrics
   */
  private updateAgentTrace(event: TraceEvent): void {
    let agentTrace = this.agentTraces.get(event.agentId);
    
    if (!agentTrace) {
      agentTrace = this.createAgentTrace(event.agentId);
      this.agentTraces.set(event.agentId, agentTrace);
    }

    agentTrace.events.push(event);
    
    // Update agent state based on event type
    this.updateAgentState(agentTrace, event);
    
    // Update performance metrics
    this.updateAgentPerformanceMetrics(agentTrace, event);
    
    // Limit events to prevent memory issues (keep last 1000 events per agent)
    if (agentTrace.events.length > 1000) {
      agentTrace.events = agentTrace.events.slice(-500);
    }
  }

  /**
   * Update agent state based on event
   */
  private updateAgentState(agentTrace: AgentTrace, event: TraceEvent): void {
    const { state } = agentTrace;
    
    switch (event.type) {
      case TraceEventType.AGENT_SPAWN:
        state.status = 'idle';
        break;
      case TraceEventType.TASK_START:
        state.status = 'busy';
        state.currentTask = event.data.taskId || event.id;
        break;
      case TraceEventType.TASK_COMPLETE:
        state.status = 'idle';
        state.currentTask = undefined;
        break;
      case TraceEventType.TASK_FAIL:
        state.status = 'error';
        break;
      case TraceEventType.AGENT_DESTROY:
        state.status = 'terminated';
        agentTrace.endTime = event.timestamp;
        break;
    }

    // Update capabilities if provided
    if (event.data.capabilities) {
      state.capabilities = event.data.capabilities;
    }

    // Update resources if provided
    if (event.data.resources) {
      state.resources = { ...state.resources, ...event.data.resources };
    }
  }

  /**
   * Update agent performance metrics
   */
  private updateAgentPerformanceMetrics(agentTrace: AgentTrace, event: TraceEvent): void {
    const { performance } = agentTrace;
    
    // Update task count
    if (event.type === TraceEventType.TASK_COMPLETE) {
      performance.taskCount++;
    }

    // Update error rate
    if (event.type === TraceEventType.TASK_FAIL) {
      const totalTasks = performance.taskCount + 1;
      const errorEvents = agentTrace.events.filter(e => e.type === TraceEventType.TASK_FAIL).length;
      performance.errorRate = errorEvents / totalTasks;
    }

    // Update response time
    if (event.duration !== undefined) {
      const responseTimeEvents = agentTrace.events.filter(e => e.duration !== undefined);
      const totalResponseTime = responseTimeEvents.reduce((sum, e) => sum + (e.duration || 0), 0);
      performance.averageResponseTime = totalResponseTime / responseTimeEvents.length;
    }

    // Update throughput (events per minute)
    const oneMinuteAgo = Date.now() - (60 * 1000);
    const recentEvents = agentTrace.events.filter(e => e.timestamp > oneMinuteAgo);
    performance.throughput = recentEvents.length;

    // Update resource usage from event data
    if (event.data.cpuUsage !== undefined) {
      performance.cpuUsage = event.data.cpuUsage;
    }
    if (event.data.memoryUsage !== undefined) {
      performance.memoryUsage = event.data.memoryUsage;
    }
  }

  /**
   * Create new agent trace with proper initialization
   */
  private createAgentTrace(agentId: string): AgentTrace {
    return {
      agentId,
      agentType: this.inferAgentType(agentId),
      events: [],
      startTime: Date.now(),
      state: {
        status: 'idle',
        capabilities: [],
        resources: { cpu: 0, memory: 0, disk: 0, network: 0 },
        memory: {}
      },
      performance: {
        cpuUsage: 0,
        memoryUsage: 0,
        taskCount: 0,
        averageResponseTime: 0,
        throughput: 0,
        errorRate: 0
      }
    };
  }

  /**
   * Infer agent type from ID or other heuristics
   */
  private inferAgentType(agentId: string): string {
    // Simple heuristic based on agent ID patterns
    if (agentId.includes('coordinator')) return 'coordinator';
    if (agentId.includes('worker')) return 'worker';
    if (agentId.includes('analyzer')) return 'analyzer';
    if (agentId.includes('monitor')) return 'monitor';
    return 'unknown';
  }

  /**
   * Find event by ID in buffer and agent traces
   */
  private findEventById(eventId: string): TraceEvent | undefined {
    // Check buffer first
    const bufferEvent = this.eventBuffer.find(e => e.id === eventId);
    if (bufferEvent) return bufferEvent;

    // Check agent traces
    for (const agentTrace of this.agentTraces.values()) {
      const event = agentTrace.events.find(e => e.id === eventId);
      if (event) return event;
    }

    return undefined;
  }

  /**
   * Update collection metrics after processing an event
   */
  private updateCollectionMetrics(processingTime: number): void {
    this.metrics.totalEvents++;
    this.currentSecondEvents++;
    this.processingTimes.push(processingTime);
    
    // Calculate collection overhead
    this.metrics.collectionOverhead = this.calculateCollectionOverhead();
  }

  /**
   * Calculate collection overhead as percentage
   */
  private calculateCollectionOverhead(): number {
    if (this.processingTimes.length === 0) return 0;
    
    const avgProcessingTime = this.processingTimes.reduce((sum, time) => sum + time, 0) / this.processingTimes.length;
    const eventsPerSecond = this.metrics.eventsPerSecond || 1;
    
    // Overhead = (processing time per event * events per second) / 1000ms
    return Math.min((avgProcessingTime * eventsPerSecond) / 1000, 1);
  }

  /**
   * Update events per second metric
   */
  private updateEventsPerSecond(): void {
    const now = Date.now();
    if (now - this.lastSecondCount >= 1000) {
      this.eventCounts.push(this.currentSecondEvents);
      if (this.eventCounts.length > 60) { // Keep last 60 seconds
        this.eventCounts.shift();
      }
      
      this.metrics.eventsPerSecond = this.eventCounts.reduce((sum, count) => sum + count, 0) / this.eventCounts.length;
      this.currentSecondEvents = 0;
      this.lastSecondCount = now;
    }
  }

  /**
   * Update derived metrics
   */
  private updateDerivedMetrics(): void {
    // Buffer utilization
    this.metrics.bufferUtilization = this.eventBuffer.length / this.config.bufferSize;
    
    // Average processing time
    if (this.processingTimes.length > 0) {
      this.metrics.averageProcessingTime = this.processingTimes.reduce((sum, time) => sum + time, 0) / this.processingTimes.length;
    }
    
    // Current sampling rate (may differ from config due to adaptive sampling)
    this.metrics.samplingRate = this.config.samplingRate;
  }

  /**
   * Adjust sampling rate based on system load
   */
  private adjustSamplingRate(): void {
    if (!this.adaptiveSamplingEnabled) return;

    const overhead = this.calculateCollectionOverhead();
    
    if (overhead > this.targetOverhead) {
      // Reduce sampling rate
      this.config.samplingRate = Math.max(0.1, this.config.samplingRate * 0.8);
      this.logger.debug(`Reduced sampling rate to ${this.config.samplingRate} due to high overhead (${(overhead * 100).toFixed(1)}%)`);
    } else if (overhead < this.targetOverhead * 0.5) {
      // Increase sampling rate
      this.config.samplingRate = Math.min(1.0, this.config.samplingRate * 1.1);
    }
  }

  /**
   * Start system metrics collection
   */
  private startSystemMetrics(): void {
    const collectSystemMetrics = () => {
      const memUsage = process.memoryUsage();
      this.collectEvent({
        type: TraceEventType.PERFORMANCE_METRIC,
        agentId: 'system',
        swarmId: 'system',
        data: {
          memoryUsage: memUsage,
          uptime: process.uptime(),
          cpuUsage: process.cpuUsage?.() || { user: 0, system: 0 }
        },
        metadata: {
          source: 'system',
          severity: 'low',
          tags: ['system', 'metrics']
        }
      });
    };

    setInterval(collectSystemMetrics, 30000); // Every 30 seconds
  }

  /**
   * Start performance monitoring
   */
  private startPerformanceMonitoring(): void {
    // Already started in setupPerformanceMonitoring
  }

  /**
   * Stop performance monitoring
   */
  private stopPerformanceMonitoring(): void {
    // Clear any performance monitoring timers if needed
  }

  /**
   * Reset metrics
   */
  private resetMetrics(): void {
    this.metrics = {
      totalEvents: 0,
      eventsPerSecond: 0,
      averageProcessingTime: 0,
      bufferUtilization: 0,
      samplingRate: this.config.samplingRate,
      errorCount: 0,
      droppedEvents: 0,
      collectionOverhead: 0
    };
    
    this.processingTimes = [];
    this.eventCounts = [];
    this.currentSecondEvents = 0;
    this.lastSecondCount = Date.now();
  }

  /**
   * Handle collection errors
   */
  private handleCollectionError(error: any, event: Partial<TraceEvent>): void {
    this.metrics.errorCount++;
    this.logger.error('Error collecting trace event:', error, { eventId: event.id, eventType: event.type });
    
    // Emit error event for external handling
    this.emit('collection-error', { error, event });
  }

  /**
   * Log final metrics on shutdown
   */
  private logFinalMetrics(): void {
    const metrics = this.getMetrics();
    this.logger.info('Final trace collection metrics:', {
      totalEvents: metrics.totalEvents,
      droppedEvents: metrics.droppedEvents,
      errorCount: metrics.errorCount,
      averageProcessingTime: metrics.averageProcessingTime,
      collectionOverhead: `${(metrics.collectionOverhead * 100).toFixed(2)}%`,
      agentCount: this.agentTraces.size
    });
  }

  /**
   * Generate unique event ID with better entropy
   */
  private generateEventId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 11);
    const counter = (++this.sampleCounter % 1000).toString(36);
    return `trace_${timestamp}_${random}_${counter}`;
  }
}