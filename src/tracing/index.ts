/**
 * Tracing System - Main Module Exports
 * Provides comprehensive tracing and visualization capabilities for Claude Flow
 */

// Core Components
export { TraceCollector } from './collector/trace-collector';
export { TraceStorage } from './storage/trace-storage';
export { TraceStreamer } from './streaming/trace-streamer';
export { StateReconstructor } from './time-travel/state-reconstructor';
export { SnapshotManager } from './time-travel/snapshot-manager';

// Performance Components
export { SelectiveTracer } from './performance/selective-tracer';
export { AsyncProcessor } from './performance/async-processor';
export { MemoryManager } from './performance/memory-manager';

// Integration Components
export { EventBusTracer } from './integration/eventbus-tracer';
export { CoordinationTracer } from './integration/coordination-tracer';

// Monitoring Components
export { PerformanceDashboard } from './monitoring/performance-dashboard';
export { MetricsCollector } from './monitoring/metrics-collector';

// Types and Interfaces
export * from './types';

// Utilities
export { createTracingSystem } from './factory';