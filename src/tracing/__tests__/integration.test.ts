/**
 * Integration Tests for Tracing System End-to-End Flow
 */

import { beforeEach, afterEach, describe, expect, test, jest } from '@jest/globals';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { TraceCollector } from '../collector/trace-collector';
import { TraceStorage } from '../storage/trace-storage';
import { TraceStreamer } from '../streaming/trace-streamer';
import { EventBusTracer } from '../integration/eventbus-tracer';
import { EventBus } from '../../core/event-bus';
import { 
  TraceEvent, 
  TraceEventType, 
  TracingConfig, 
  TraceSession,
  TimeRange,
  StreamEvent,
  ClientMessage
} from '../types';
import WebSocket from 'ws';

describe('Tracing System Integration', () => {
  let tempDir: string;
  let storage: TraceStorage;
  let streamer: TraceStreamer;
  let collector: TraceCollector;
  let eventBus: EventBus;
  let eventBusTracer: EventBusTracer;
  let config: TracingConfig;
  let sessionId: string;

  beforeEach(async () => {
    // Setup temporary directory for test database
    tempDir = join(tmpdir(), `tracing-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    // Configuration
    config = {
      enabled: true,
      samplingRate: 1.0,
      bufferSize: 100,
      flushInterval: 500,
      storageRetention: 3600,
      compressionEnabled: false,
      realtimeStreaming: true,
      performanceMonitoring: true
    };

    // Initialize components
    storage = new TraceStorage(
      {
        databasePath: join(tempDir, 'traces.db'),
        maxFileSize: 100 * 1024 * 1024,
        maxFiles: 10,
        compressionLevel: 1000,
        indexingEnabled: true,
        vacuumInterval: 3600
      },
      config
    );

    // Create session
    sessionId = await storage.createSession('Integration Test Session');

    // Initialize streaming server
    streamer = new TraceStreamer({
      port: 0, // Use random available port
      maxConnections: 100,
      heartbeatInterval: 30000,
      compressionEnabled: false,
      rateLimiting: {
        windowMs: 60000,
        maxMessages: 1000,
        maxBytesPerWindow: 1024 * 1024
      },
      auth: {
        enabled: false
      },
      backpressure: {
        highWaterMark: 1000,
        lowWaterMark: 500,
        maxQueueSize: 5000,
        dropOldest: true
      }
    });

    await streamer.start();

    // Initialize collector
    collector = new TraceCollector(config, storage, streamer);

    // Initialize EventBus integration
    eventBus = new EventBus();
    eventBusTracer = new EventBusTracer(eventBus, collector);
  });

  afterEach(async () => {
    // Cleanup
    collector?.stop();
    await streamer?.stop();
    await storage?.close();
    
    // Remove temp directory
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }

    jest.clearAllTimers();
  });

  describe('End-to-End Trace Flow', () => {
    test('should collect, store, and retrieve traces', async () => {
      collector.start();

      // Generate test events
      const events = [
        {
          type: TraceEventType.AGENT_SPAWN,
          agentId: 'agent-1',
          swarmId: 'swarm-1',
          data: { capabilities: ['task1', 'task2'] }
        },
        {
          type: TraceEventType.TASK_START,
          agentId: 'agent-1',
          swarmId: 'swarm-1',
          data: { taskId: 'task-1', priority: 'high' }
        },
        {
          type: TraceEventType.TASK_COMPLETE,
          agentId: 'agent-1',
          swarmId: 'swarm-1',
          data: { taskId: 'task-1', result: 'success' }
        }
      ];

      // Collect events
      events.forEach(event => collector.collectEvent(event));

      // Wait for flush
      await new Promise(resolve => setTimeout(resolve, 600));

      // Force final flush
      await collector.flush();

      // Retrieve stored traces
      const storedTraces = await storage.getTracesBySession(sessionId);
      
      expect(storedTraces.length).toBeGreaterThanOrEqual(3);
      expect(storedTraces.some(t => t.type === TraceEventType.AGENT_SPAWN)).toBe(true);
      expect(storedTraces.some(t => t.type === TraceEventType.TASK_START)).toBe(true);
      expect(storedTraces.some(t => t.type === TraceEventType.TASK_COMPLETE)).toBe(true);
    });

    test('should handle agent lifecycle tracking', async () => {
      collector.start();

      const agentId = 'lifecycle-agent';
      const swarmId = 'lifecycle-swarm';

      // Agent lifecycle events
      const lifecycle = [
        { type: TraceEventType.AGENT_SPAWN, phase: 'spawn' },
        { type: TraceEventType.TASK_START, phase: 'task-start' },
        { type: TraceEventType.TASK_COMPLETE, phase: 'task-complete' },
        { type: TraceEventType.AGENT_DESTROY, phase: 'destroy' }
      ];

      for (const event of lifecycle) {
        collector.collectEvent({
          ...event,
          agentId,
          swarmId,
          data: { phase: event.phase }
        });
        
        // Small delay between events
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      await collector.flush();

      // Check agent trace
      const agentTrace = collector.getAgentTrace(agentId);
      expect(agentTrace).toBeDefined();
      expect(agentTrace?.state.status).toBe('terminated');
      expect(agentTrace?.endTime).toBeDefined();
      
      // Check stored traces
      const storedTraces = await storage.getTracesByAgent(agentId);
      expect(storedTraces).toHaveLength(4);
    });

    test('should build trace relationships and graphs', async () => {
      collector.start();

      const parentTraceId = 'parent-trace';
      const childTraceId = 'child-trace';

      // Parent trace
      collector.collectEvent({
        id: parentTraceId,
        type: TraceEventType.TASK_START,
        agentId: 'parent-agent',
        swarmId: 'test-swarm',
        data: { operation: 'parent-task' }
      });

      // Child trace
      collector.collectEvent({
        id: childTraceId,
        type: TraceEventType.TASK_START,
        agentId: 'child-agent',
        swarmId: 'test-swarm',
        parentId: parentTraceId,
        data: { operation: 'child-task' }
      });

      await collector.flush();

      // Get trace graph
      const graph = await storage.getTraceGraph(sessionId);
      
      expect(graph.nodes.length).toBeGreaterThanOrEqual(2);
      expect(graph.edges.length).toBeGreaterThanOrEqual(1);
      expect(graph.metadata.nodeCount).toBeGreaterThanOrEqual(2);
      expect(graph.metadata.edgeCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Real-time Streaming Integration', () => {
    test('should stream events to connected clients', (done) => {
      collector.start();

      const port = (streamer as any).server?.address()?.port;
      if (!port) {
        done(new Error('Streamer port not available'));
        return;
      }

      const ws = new WebSocket(`ws://localhost:${port}`);
      const receivedEvents: StreamEvent[] = [];

      ws.on('open', () => {
        // Subscribe to session
        const subscribeMessage: ClientMessage = {
          type: 'subscribe_session',
          sessionId
        };
        ws.send(JSON.stringify(subscribeMessage));

        // Generate test event
        collector.collectEvent({
          type: TraceEventType.TASK_START,
          agentId: 'streaming-agent',
          swarmId: 'streaming-swarm',
          data: { streaming: true }
        });
      });

      ws.on('message', (data) => {
        const event: StreamEvent = JSON.parse(data.toString());
        receivedEvents.push(event);

        if (event.type === 'trace_event' && event.data?.streaming) {
          expect(event.data.streaming).toBe(true);
          ws.close();
          done();
        }
      });

      ws.on('error', done);

      // Timeout fallback
      setTimeout(() => {
        ws.close();
        done(new Error('Streaming test timeout'));
      }, 5000);
    }, 10000);

    test('should handle multiple concurrent clients', async () => {
      collector.start();

      const port = (streamer as any).server?.address()?.port;
      if (!port) {
        throw new Error('Streamer port not available');
      }

      const clientCount = 5;
      const clients: WebSocket[] = [];
      const receivedCounts: number[] = new Array(clientCount).fill(0);

      // Create multiple clients
      for (let i = 0; i < clientCount; i++) {
        const ws = new WebSocket(`ws://localhost:${port}`);
        clients.push(ws);

        ws.on('open', () => {
          ws.send(JSON.stringify({
            type: 'subscribe_session',
            sessionId
          }));
        });

        ws.on('message', (data) => {
          const event: StreamEvent = JSON.parse(data.toString());
          if (event.type === 'trace_event') {
            receivedCounts[i]++;
          }
        });
      }

      // Wait for connections
      await new Promise(resolve => setTimeout(resolve, 100));

      // Generate multiple events
      for (let i = 0; i < 10; i++) {
        collector.collectEvent({
          type: TraceEventType.TASK_START,
          agentId: `multi-agent-${i}`,
          swarmId: 'multi-swarm',
          data: { eventIndex: i }
        });
      }

      // Wait for propagation
      await new Promise(resolve => setTimeout(resolve, 500));

      // Close all clients
      clients.forEach(ws => ws.close());

      // All clients should have received events
      receivedCounts.forEach(count => {
        expect(count).toBeGreaterThan(0);
      });
    });
  });

  describe('EventBus Integration', () => {
    test('should trace EventBus operations', async () => {
      collector.start();

      let handlerExecuted = false;
      const testHandler = (data: any) => {
        handlerExecuted = true;
        expect(data.message).toBe('test-message');
      };

      // Register handler (should be traced)
      eventBus.on('test-event', testHandler);

      // Emit event (should be traced)
      eventBus.emit('test-event', { message: 'test-message' });

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(handlerExecuted).toBe(true);

      // Check that EventBus operations were traced
      const metrics = collector.getMetrics();
      expect(metrics.totalEvents).toBeGreaterThan(0);
    });

    test('should handle EventBus errors in tracing', async () => {
      collector.start();

      const errorHandler = () => {
        throw new Error('Handler error');
      };

      eventBus.on('error-event', errorHandler);

      expect(() => {
        eventBus.emit('error-event', {});
      }).toThrow('Handler error');

      // Wait for error tracing
      await new Promise(resolve => setTimeout(resolve, 100));

      const metrics = collector.getMetrics();
      expect(metrics.totalEvents).toBeGreaterThan(0);
    });
  });

  describe('Performance Under Load', () => {
    test('should handle high event throughput', async () => {
      const highThroughputConfig = {
        ...config,
        bufferSize: 1000,
        flushInterval: 100
      };

      const highThroughputCollector = new TraceCollector(
        highThroughputConfig, 
        storage, 
        streamer
      );
      highThroughputCollector.start();

      const eventCount = 1000;
      const startTime = Date.now();

      // Generate high load
      const promises: Promise<void>[] = [];
      for (let i = 0; i < eventCount; i++) {
        promises.push(
          Promise.resolve().then(() => {
            highThroughputCollector.collectEvent({
              type: TraceEventType.TASK_START,
              agentId: `load-agent-${i % 10}`,
              swarmId: `load-swarm-${i % 5}`,
              data: {
                index: i,
                timestamp: Date.now(),
                payload: `data-${i}`
              }
            });
          })
        );
      }

      await Promise.all(promises);
      await highThroughputCollector.flush();

      const endTime = Date.now();
      const duration = endTime - startTime;

      highThroughputCollector.stop();

      const metrics = highThroughputCollector.getMetrics();
      
      // Verify throughput
      expect(metrics.totalEvents).toBeGreaterThan(eventCount * 0.9); // Allow for some sampling
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
      expect(metrics.collectionOverhead).toBeLessThan(0.1); // Less than 10% overhead
    }, 10000);

    test('should maintain low memory usage under sustained load', async () => {
      collector.start();

      const initialMemory = process.memoryUsage().heapUsed;

      // Sustained event generation
      for (let batch = 0; batch < 10; batch++) {
        for (let i = 0; i < 100; i++) {
          collector.collectEvent({
            type: TraceEventType.TASK_START,
            agentId: `memory-agent-${i % 10}`,
            swarmId: 'memory-swarm',
            data: { batch, index: i, data: 'x'.repeat(100) }
          });
        }

        // Force flush each batch
        await collector.flush();
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be reasonable (less than 50MB)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);

      const metrics = collector.getMetrics();
      expect(metrics.totalEvents).toBe(1000);
    });
  });

  describe('Error Recovery', () => {
    test('should recover from storage failures', async () => {
      collector.start();

      // Generate events
      collector.collectEvent({
        type: TraceEventType.TASK_START,
        agentId: 'recovery-agent',
        swarmId: 'recovery-swarm',
        data: { test: 'recovery' }
      });

      // Simulate storage failure by closing database
      await storage.close();

      // Try to flush (should handle error)
      await collector.flush();

      const metrics = collector.getMetrics();
      expect(metrics.errorCount).toBeGreaterThan(0);
    });

    test('should handle streaming client disconnections', async () => {
      collector.start();

      const port = (streamer as any).server?.address()?.port;
      if (!port) {
        throw new Error('Streamer port not available');
      }

      const ws = new WebSocket(`ws://localhost:${port}`);

      await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 2000);
      });

      // Abruptly close connection
      ws.terminate();

      // Generate events (should not fail even with disconnected client)
      for (let i = 0; i < 10; i++) {
        collector.collectEvent({
          type: TraceEventType.TASK_START,
          agentId: `disconnect-agent-${i}`,
          swarmId: 'disconnect-swarm',
          data: { index: i }
        });
      }

      await collector.flush();

      const metrics = collector.getMetrics();
      expect(metrics.totalEvents).toBe(10);
    });
  });

  describe('Data Consistency', () => {
    test('should maintain data integrity across restarts', async () => {
      collector.start();

      // Generate initial data
      const testEvents = [
        {
          type: TraceEventType.AGENT_SPAWN,
          agentId: 'persistent-agent',
          swarmId: 'persistent-swarm',
          data: { persistent: true }
        },
        {
          type: TraceEventType.TASK_START,
          agentId: 'persistent-agent',
          swarmId: 'persistent-swarm',
          data: { taskId: 'persistent-task' }
        }
      ];

      testEvents.forEach(event => collector.collectEvent(event));
      await collector.flush();

      // Stop and restart components
      collector.stop();
      await storage.close();

      // Recreate storage and collector
      storage = new TraceStorage(
        {
          databasePath: join(tempDir, 'traces.db'),
          maxFileSize: 100 * 1024 * 1024,
          maxFiles: 10,
          compressionLevel: 1000,
          indexingEnabled: true,
          vacuumInterval: 3600
        },
        config
      );

      collector = new TraceCollector(config, storage);
      collector.start();

      // Verify data survived restart
      const storedTraces = await storage.getTracesBySession(sessionId);
      const agentTraces = storedTraces.filter(t => t.agentId === 'persistent-agent');
      
      expect(agentTraces.length).toBe(2);
      expect(agentTraces.some(t => t.data.persistent)).toBe(true);
      expect(agentTraces.some(t => t.data.taskId === 'persistent-task')).toBe(true);
    });

    test('should handle concurrent storage operations', async () => {
      collector.start();

      const concurrentOperations = 50;
      const promises: Promise<void>[] = [];

      // Concurrent event collection
      for (let i = 0; i < concurrentOperations; i++) {
        promises.push(
          Promise.resolve().then(() => {
            collector.collectEvent({
              type: TraceEventType.TASK_START,
              agentId: `concurrent-agent-${i}`,
              swarmId: 'concurrent-swarm',
              data: { 
                index: i, 
                timestamp: Date.now(),
                thread: `thread-${i % 5}`
              }
            });
          })
        );
      }

      await Promise.all(promises);
      await collector.flush();

      // Verify all events were stored
      const storedTraces = await storage.getTracesBySession(sessionId);
      const concurrentTraces = storedTraces.filter(t => 
        t.swarmId === 'concurrent-swarm'
      );

      expect(concurrentTraces.length).toBe(concurrentOperations);
      
      // Verify no data corruption
      const indices = concurrentTraces.map(t => t.data.index);
      const uniqueIndices = new Set(indices);
      expect(uniqueIndices.size).toBe(concurrentOperations);
    });
  });

  describe('Advanced Query Operations', () => {
    test('should support complex trace queries', async () => {
      collector.start();

      // Generate diverse test data
      const agents = ['query-agent-1', 'query-agent-2', 'query-agent-3'];
      const eventTypes = [
        TraceEventType.AGENT_SPAWN,
        TraceEventType.TASK_START,
        TraceEventType.TASK_COMPLETE
      ];

      for (let i = 0; i < 30; i++) {
        collector.collectEvent({
          type: eventTypes[i % eventTypes.length],
          agentId: agents[i % agents.length],
          swarmId: 'query-swarm',
          data: { 
            index: i,
            category: i < 10 ? 'A' : i < 20 ? 'B' : 'C',
            priority: i % 2 === 0 ? 'high' : 'low'
          }
        });
      }

      await collector.flush();

      // Query by agent
      const agent1Traces = await storage.getTracesByAgent('query-agent-1');
      expect(agent1Traces.length).toBe(10);

      // Query by time range
      const now = Date.now();
      const fiveMinutesAgo = now - (5 * 60 * 1000);
      const recentTraces = await storage.getTracesByTimeRange(
        { start: fiveMinutesAgo, end: now },
        { agentIds: agents }
      );
      expect(recentTraces.length).toBe(30);

      // Query with filters
      const taskStartTraces = await storage.getTracesBySession(
        sessionId,
        { eventTypes: [TraceEventType.TASK_START] }
      );
      expect(taskStartTraces.length).toBe(10);
    });

    test('should generate comprehensive trace statistics', async () => {
      collector.start();

      // Generate statistical data
      for (let i = 0; i < 100; i++) {
        const duration = Math.random() * 1000; // Random duration up to 1s
        
        collector.collectEvent({
          type: TraceEventType.TASK_COMPLETE,
          agentId: `stats-agent-${i % 10}`,
          swarmId: 'stats-swarm',
          duration,
          data: { 
            category: i % 3 === 0 ? 'fast' : i % 3 === 1 ? 'medium' : 'slow',
            result: Math.random() > 0.1 ? 'success' : 'failure'
          }
        });
      }

      await collector.flush();

      // Get storage stats
      const stats = storage.getStorageStats();
      expect(stats.traceCount).toBeGreaterThanOrEqual(100);
      expect(stats.sessionCount).toBeGreaterThanOrEqual(1);

      // Get collector metrics
      const metrics = collector.getMetrics();
      expect(metrics.totalEvents).toBe(100);
      expect(metrics.averageProcessingTime).toBeGreaterThan(0);

      // Get agent traces with performance data
      const agentTraces = collector.getAllAgentTraces();
      expect(agentTraces.length).toBe(10);
      
      agentTraces.forEach(trace => {
        expect(trace.performance.taskCount).toBeGreaterThan(0);
        expect(trace.performance.averageResponseTime).toBeGreaterThanOrEqual(0);
      });
    });
  });
});