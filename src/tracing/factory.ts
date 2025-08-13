/**
 * Tracing System Factory - Creates and configures tracing components
 */

import { TraceCollector } from './collector/trace-collector';
import { TraceStorage } from './storage/trace-storage';
import { TraceStreamer } from './streaming/trace-streamer';
import { StateReconstructor } from './time-travel/state-reconstructor';
import { SnapshotManager } from './time-travel/snapshot-manager';
import { AgentInstrumentation } from './collector/instrumentation';
import { TracingConfig } from './types';

export interface TracingSystemComponents {
  collector: TraceCollector;
  storage: TraceStorage;
  streamer: TraceStreamer;
  reconstructor: StateReconstructor;
  snapshotManager: SnapshotManager;
  instrumentation: AgentInstrumentation;
}

export interface TracingSystemOptions {
  config?: Partial<TracingConfig>;
  storagePath?: string;
  streamingPort?: number;
  autoStart?: boolean;
}

/**
 * Create a complete tracing system with all components
 */
export async function createTracingSystem(
  options: TracingSystemOptions = {}
): Promise<TracingSystemComponents> {
  const {
    config = {},
    storagePath = './traces.db',
    streamingPort = 8080,
    autoStart = true
  } = options;

  // Default configuration
  const tracingConfig: TracingConfig = {
    enabled: true,
    samplingRate: 1.0,
    bufferSize: 1000,
    flushInterval: 5000,
    storageRetention: 7, // days
    compressionEnabled: true,
    realtimeStreaming: true,
    performanceMonitoring: true,
    ...config
  };

  // Initialize storage
  const storage = new TraceStorage(storagePath, tracingConfig.storageRetention);
  await storage.initialize();

  // Initialize collector
  const collector = new TraceCollector(tracingConfig);

  // Initialize streaming server
  const streamer = new TraceStreamer(streamingPort);

  // Initialize time-travel components
  const reconstructor = new StateReconstructor(storage);
  const snapshotManager = new SnapshotManager(storage, reconstructor);

  // Initialize instrumentation
  const instrumentation = new AgentInstrumentation(collector);

  // Wire up components
  setupComponentConnections(collector, storage, streamer, snapshotManager);

  // Auto-start if requested
  if (autoStart) {
    collector.start();
    streamer.start();
    
    if (tracingConfig.performanceMonitoring) {
      // TODO: Start performance monitoring
    }
  }

  return {
    collector,
    storage,
    streamer,
    reconstructor,
    snapshotManager,
    instrumentation
  };
}

/**
 * Setup connections between tracing components
 */
function setupComponentConnections(
  collector: TraceCollector,
  storage: TraceStorage,
  streamer: TraceStreamer,
  snapshotManager: SnapshotManager
): void {
  // Collector -> Storage: Store events when flushed
  collector.on('events-flushed', async (events) => {
    try {
      await storage.storeEventsBatch(events);
    } catch (error) {
      console.error('Error storing events:', error);
    }
  });

  // Collector -> Streamer: Stream events in real-time
  collector.on('event-collected', (event) => {
    streamer.streamEvent(event);
  });

  // Collector -> Streamer: Stream batch events
  collector.on('events-flushed', (events) => {
    streamer.streamEventsBatch(events);
  });

  // Auto-create snapshots periodically
  const snapshotInterval = setInterval(async () => {
    try {
      const snapshot = await snapshotManager.createSnapshot();
      console.log(`Created automatic snapshot: ${snapshot.id}`);
    } catch (error) {
      console.error('Error creating automatic snapshot:', error);
    }
  }, 30000); // Every 30 seconds

  // Cleanup interval on collector stop
  collector.on('collection-stopped', () => {
    clearInterval(snapshotInterval);
  });
}

/**
 * Quick setup for development/testing
 */
export async function createDevelopmentTracingSystem(): Promise<TracingSystemComponents> {
  return createTracingSystem({
    config: {
      samplingRate: 1.0, // Capture all events
      bufferSize: 500,   // Smaller buffer for faster flushing
      flushInterval: 2000, // Flush every 2 seconds
      storageRetention: 1  // Keep only 1 day of data
    },
    storagePath: './dev-traces.db',
    streamingPort: 8080,
    autoStart: true
  });
}

/**
 * Production setup with optimized performance
 */
export async function createProductionTracingSystem(): Promise<TracingSystemComponents> {
  return createTracingSystem({
    config: {
      samplingRate: 0.1, // Sample 10% of events
      bufferSize: 5000,  // Larger buffer for efficiency
      flushInterval: 10000, // Flush every 10 seconds
      storageRetention: 30,  // Keep 30 days of data
      compressionEnabled: true
    },
    storagePath: process.env.TRACE_STORAGE_PATH || './traces.db',
    streamingPort: parseInt(process.env.TRACE_STREAMING_PORT || '8080'),
    autoStart: true
  });
}

/**
 * Minimal setup for testing
 */
export async function createTestTracingSystem(): Promise<TracingSystemComponents> {
  return createTracingSystem({
    config: {
      samplingRate: 1.0,
      bufferSize: 100,
      flushInterval: 1000,
      storageRetention: 1,
      realtimeStreaming: false, // Disable streaming in tests
      performanceMonitoring: false
    },
    storagePath: ':memory:', // In-memory database
    streamingPort: 0, // Random available port
    autoStart: false // Manual start in tests
  });
}