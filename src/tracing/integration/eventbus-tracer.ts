import { EventBus, IEventBus } from '../../core/event-bus';
import { TraceCollector } from '../collector/trace-collector';
import { TraceEvent, TraceLevel, TraceContext } from '../types';

/**
 * Event handler type definition
 */
export type EventHandler<T = any> = (data: T) => void;

/**
 * Configuration for EventBus tracing
 */
export interface EventBusTracerConfig {
  /** Enable/disable tracing */
  enabled: boolean;
  /** Events to include (empty array = all events) */
  includeEvents: string[];
  /** Events to exclude */
  excludeEvents: string[];
  /** Include event payload in traces */
  includePayload: boolean;
  /** Maximum payload size to trace (bytes) */
  maxPayloadSize: number;
  /** Batch size for trace events */
  batchSize: number;
  /** Batch timeout in milliseconds */
  batchTimeout: number;
  /** Enable performance monitoring */
  enablePerformanceMonitoring: boolean;
  /** Sensitive fields to sanitize from payloads */
  sensitiveFields: string[];
}

/**
 * Default configuration for EventBus tracer
 */
const DEFAULT_CONFIG: EventBusTracerConfig = {
  enabled: true,
  includeEvents: [],
  excludeEvents: ['heartbeat', 'ping', 'metrics'],
  includePayload: true,
  maxPayloadSize: 1024 * 10, // 10KB
  batchSize: 50,
  batchTimeout: 1000,
  enablePerformanceMonitoring: true,
  sensitiveFields: ['password', 'token', 'secret', 'key', 'auth']
};

/**
 * Performance metrics for event types
 */
interface EventPerformanceMetrics {
  count: number;
  totalDuration: number;
  averageDuration: number;
  minDuration: number;
  maxDuration: number;
  lastUpdated: Date;
}

/**
 * Event correlation tracking
 */
interface EventCorrelation {
  correlationId: string;
  causationId?: string;
  timestamp: Date;
  eventType: string;
  parentEventId?: string;
}

/**
 * Batch of trace events waiting to be processed
 */
interface TraceBatch {
  events: TraceEvent[];
  timestamp: Date;
  timeout?: NodeJS.Timeout;
}

/**
 * EventBus tracer that wraps the existing EventBus with tracing capabilities
 */
export class EventBusTracer {
  private config: EventBusTracerConfig;
  private traceCollector: TraceCollector;
  private performanceMetrics = new Map<string, EventPerformanceMetrics>();
  private correlationMap = new Map<string, EventCorrelation>();
  private traceBatch: TraceBatch | null = null;
  private correlationCounter = 0;

  constructor(
    private eventBus: EventBus,
    traceCollector: TraceCollector,
    config?: Partial<EventBusTracerConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.traceCollector = traceCollector;
    this.initializeTracing();
  }

  /**
   * Initialize event tracing by wrapping EventBus methods
   */
  private initializeTracing(): void {
    if (!this.config.enabled) {
      return;
    }

    // Wrap the emit method
    this.wrapEmitMethod();
    
    // Wrap the on method for handler registration
    this.wrapOnMethod();
    
    // Wrap the off method for handler deregistration
    this.wrapOffMethod();
  }

  /**
   * Wrap the emit method to trace event emissions
   */
  private wrapEmitMethod(): void {
    const originalEmit = this.eventBus.emit.bind(this.eventBus);
    
    this.eventBus.emit = (eventType: string, data?: any): void => {
      const startTime = performance.now();
      const correlationId = this.generateCorrelationId();
      
      try {
        // Check if event should be traced
        if (!this.shouldTraceEvent(eventType)) {
          return originalEmit(eventType, data);
        }

        // Create trace context
        const traceContext: TraceContext = {
          correlationId,
          timestamp: new Date(),
          metadata: {
            eventType,
            operation: 'emit',
            component: 'EventBus'
          }
        };

        // Create correlation entry
        this.correlationMap.set(correlationId, {
          correlationId,
          timestamp: new Date(),
          eventType,
          parentEventId: this.getCurrentEventId()
        });

        // Sanitize payload if needed
        const sanitizedData = this.sanitizePayload(data);
        
        // Emit the event
        originalEmit(eventType, data);
        
        // Record successful emission
        this.recordTraceEvent({
          id: correlationId,
          timestamp: new Date(),
          level: TraceLevel.INFO,
          component: 'EventBus',
          operation: 'emit',
          message: `Event emitted: ${eventType}`,
          context: traceContext,
          payload: this.config.includePayload ? sanitizedData : undefined,
          duration: performance.now() - startTime
        });

        // Update performance metrics
        if (this.config.enablePerformanceMonitoring) {
          this.updatePerformanceMetrics(eventType, performance.now() - startTime);
        }
      } catch (error) {
        // Record error
        this.recordTraceEvent({
          id: correlationId,
          timestamp: new Date(),
          level: TraceLevel.ERROR,
          component: 'EventBus',
          operation: 'emit',
          message: `Event emission failed: ${eventType}`,
          context: {
            correlationId,
            timestamp: new Date(),
            metadata: { eventType, operation: 'emit', error: error.message }
          },
          error: error instanceof Error ? error : new Error(String(error)),
          duration: performance.now() - startTime
        });
        
        throw error;
      }
    };
  }

  /**
   * Wrap the on method to trace event handler registrations
   */
  private wrapOnMethod(): void {
    const originalOn = this.eventBus.on.bind(this.eventBus);
    
    this.eventBus.on = (eventType: string, handler: EventHandler): void => {
      // Wrap the handler to trace executions
      const wrappedHandler: EventHandler = (data: any) => {
        const startTime = performance.now();
        const correlationId = this.generateCorrelationId();
        
        try {
          if (this.shouldTraceEvent(eventType)) {
            const traceContext: TraceContext = {
              correlationId,
              timestamp: new Date(),
              metadata: {
                eventType,
                operation: 'handle',
                component: 'EventBus',
                handlerName: handler.name || 'anonymous'
              }
            };

            this.recordTraceEvent({
              id: correlationId,
              timestamp: new Date(),
              level: TraceLevel.DEBUG,
              component: 'EventBus',
              operation: 'handle',
              message: `Event handler executing: ${eventType}`,
              context: traceContext,
              payload: this.config.includePayload ? this.sanitizePayload(data) : undefined
            });
          }

          // Execute the original handler
          const result = handler(data);

          if (this.shouldTraceEvent(eventType)) {
            this.recordTraceEvent({
              id: `${correlationId}-complete`,
              timestamp: new Date(),
              level: TraceLevel.DEBUG,
              component: 'EventBus',
              operation: 'handle-complete',
              message: `Event handler completed: ${eventType}`,
              context: {
                correlationId,
                timestamp: new Date(),
                metadata: { eventType, operation: 'handle-complete' }
              },
              duration: performance.now() - startTime
            });
          }

          return result;
        } catch (error) {
          this.recordTraceEvent({
            id: `${correlationId}-error`,
            timestamp: new Date(),
            level: TraceLevel.ERROR,
            component: 'EventBus',
            operation: 'handle-error',
            message: `Event handler failed: ${eventType}`,
            context: {
              correlationId,
              timestamp: new Date(),
              metadata: { eventType, operation: 'handle-error', error: error.message }
            },
            error: error instanceof Error ? error : new Error(String(error)),
            duration: performance.now() - startTime
          });
          
          throw error;
        }
      };

      // Record handler registration
      if (this.shouldTraceEvent(eventType)) {
        this.recordTraceEvent({
          id: this.generateCorrelationId(),
          timestamp: new Date(),
          level: TraceLevel.INFO,
          component: 'EventBus',
          operation: 'register-handler',
          message: `Event handler registered: ${eventType}`,
          context: {
            correlationId: this.generateCorrelationId(),
            timestamp: new Date(),
            metadata: {
              eventType,
              operation: 'register-handler',
              handlerName: handler.name || 'anonymous'
            }
          }
        });
      }

      originalOn(eventType, wrappedHandler);
    };
  }

  /**
   * Wrap the off method to trace event handler deregistrations
   */
  private wrapOffMethod(): void {
    const originalOff = this.eventBus.off.bind(this.eventBus);
    
    this.eventBus.off = (eventType: string, handler?: EventHandler): void => {
      if (this.shouldTraceEvent(eventType)) {
        this.recordTraceEvent({
          id: this.generateCorrelationId(),
          timestamp: new Date(),
          level: TraceLevel.INFO,
          component: 'EventBus',
          operation: 'unregister-handler',
          message: `Event handler unregistered: ${eventType}`,
          context: {
            correlationId: this.generateCorrelationId(),
            timestamp: new Date(),
            metadata: {
              eventType,
              operation: 'unregister-handler',
              handlerName: handler?.name || 'all-handlers'
            }
          }
        });
      }

      originalOff(eventType, handler);
    };
  }

  /**
   * Check if an event should be traced based on configuration
   */
  private shouldTraceEvent(eventType: string): boolean {
    if (!this.config.enabled) {
      return false;
    }

    // Check exclude list first
    if (this.config.excludeEvents.includes(eventType)) {
      return false;
    }

    // If include list is empty, trace all (except excluded)
    if (this.config.includeEvents.length === 0) {
      return true;
    }

    // Check include list
    return this.config.includeEvents.includes(eventType);
  }

  /**
   * Sanitize payload to remove sensitive data
   */
  private sanitizePayload(data: any): any {
    if (!data || typeof data !== 'object') {
      return data;
    }

    const sanitized = JSON.parse(JSON.stringify(data));
    
    const sanitizeObject = (obj: any): void => {
      if (!obj || typeof obj !== 'object') {
        return;
      }

      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          const lowerKey = key.toLowerCase();
          
          // Check if field is sensitive
          if (this.config.sensitiveFields.some(field => lowerKey.includes(field.toLowerCase()))) {
            obj[key] = '[REDACTED]';
          } else if (typeof obj[key] === 'object') {
            sanitizeObject(obj[key]);
          }
        }
      }
    };

    sanitizeObject(sanitized);

    // Check payload size
    const payloadSize = JSON.stringify(sanitized).length;
    if (payloadSize > this.config.maxPayloadSize) {
      return {
        _truncated: true,
        _originalSize: payloadSize,
        _maxSize: this.config.maxPayloadSize,
        _preview: JSON.stringify(sanitized).substring(0, this.config.maxPayloadSize) + '...'
      };
    }

    return sanitized;
  }

  /**
   * Record a trace event with batching
   */
  private recordTraceEvent(event: TraceEvent): void {
    if (!this.traceBatch) {
      this.traceBatch = {
        events: [],
        timestamp: new Date()
      };
      
      // Set batch timeout
      this.traceBatch.timeout = setTimeout(() => {
        this.flushTraceBatch();
      }, this.config.batchTimeout);
    }

    this.traceBatch.events.push(event);

    // Flush if batch is full
    if (this.traceBatch.events.length >= this.config.batchSize) {
      this.flushTraceBatch();
    }
  }

  /**
   * Flush the current trace batch
   */
  private flushTraceBatch(): void {
    if (!this.traceBatch || this.traceBatch.events.length === 0) {
      return;
    }

    // Clear timeout
    if (this.traceBatch.timeout) {
      clearTimeout(this.traceBatch.timeout);
    }

    // Send events to trace collector
    const events = this.traceBatch.events;
    this.traceBatch = null;

    // Process batch asynchronously to avoid blocking
    setImmediate(() => {
      events.forEach(event => {
        this.traceCollector.collectTrace(event);
      });
    });
  }

  /**
   * Update performance metrics for an event type
   */
  private updatePerformanceMetrics(eventType: string, duration: number): void {
    const existing = this.performanceMetrics.get(eventType);
    
    if (existing) {
      existing.count++;
      existing.totalDuration += duration;
      existing.averageDuration = existing.totalDuration / existing.count;
      existing.minDuration = Math.min(existing.minDuration, duration);
      existing.maxDuration = Math.max(existing.maxDuration, duration);
      existing.lastUpdated = new Date();
    } else {
      this.performanceMetrics.set(eventType, {
        count: 1,
        totalDuration: duration,
        averageDuration: duration,
        minDuration: duration,
        maxDuration: duration,
        lastUpdated: new Date()
      });
    }
  }

  /**
   * Generate a unique correlation ID
   */
  private generateCorrelationId(): string {
    return `eb-${Date.now()}-${++this.correlationCounter}`;
  }

  /**
   * Get current event ID from correlation context
   */
  private getCurrentEventId(): string | undefined {
    // In a real implementation, this would use async context or similar
    // to track the current event being processed
    return undefined;
  }

  /**
   * Get performance metrics for all event types
   */
  public getPerformanceMetrics(): Map<string, EventPerformanceMetrics> {
    return new Map(this.performanceMetrics);
  }

  /**
   * Get performance metrics for a specific event type
   */
  public getEventPerformanceMetrics(eventType: string): EventPerformanceMetrics | undefined {
    return this.performanceMetrics.get(eventType);
  }

  /**
   * Clear performance metrics
   */
  public clearPerformanceMetrics(): void {
    this.performanceMetrics.clear();
  }

  /**
   * Update tracer configuration
   */
  public updateConfig(config: Partial<EventBusTracerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  public getConfig(): EventBusTracerConfig {
    return { ...this.config };
  }

  /**
   * Enable or disable tracing
   */
  public setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * Flush any pending trace events
   */
  public flush(): void {
    this.flushTraceBatch();
  }

  /**
   * Get correlation information for debugging
   */
  public getCorrelationInfo(): Array<EventCorrelation> {
    return Array.from(this.correlationMap.values());
  }

  /**
   * Clean up resources
   */
  public destroy(): void {
    this.flush();
    this.performanceMetrics.clear();
    this.correlationMap.clear();
    
    if (this.traceBatch?.timeout) {
      clearTimeout(this.traceBatch.timeout);
    }
    
    this.traceBatch = null;
  }
}

/**
 * Factory function to create an EventBusTracer instance
 */
export function createEventBusTracer(
  eventBus: EventBus,
  traceCollector: TraceCollector,
  config?: Partial<EventBusTracerConfig>
): EventBusTracer {
  return new EventBusTracer(eventBus, traceCollector, config);
}

/**
 * Utility function to wrap an existing EventBus with tracing
 */
export function wrapEventBusWithTracing(
  eventBus: EventBus,
  traceCollector: TraceCollector,
  config?: Partial<EventBusTracerConfig>
): EventBus {
  new EventBusTracer(eventBus, traceCollector, config);
  return eventBus;
}