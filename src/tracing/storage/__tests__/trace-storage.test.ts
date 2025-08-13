/**
 * Tests for TraceStorage SQLite implementation
 */

import { TraceStorage, StorageConfig } from '../trace-storage.js';
import { TraceEvent, TracingConfig } from '../../types.js';
import { generateId } from '../../../utils/helpers.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';

describe('TraceStorage', () => {
  let storage: TraceStorage;
  let tempDbPath: string;
  let config: StorageConfig;
  let tracingConfig: TracingConfig;

  beforeEach(() => {
    tempDbPath = path.join(tmpdir(), `test-traces-${Date.now()}.db`);
    
    config = {
      databasePath: tempDbPath,
      maxFileSize: 100 * 1024 * 1024, // 100MB
      maxFiles: 10,
      compressionLevel: 1000,
      indexingEnabled: true,
      vacuumInterval: 3600000
    };
    
    tracingConfig = {
      enabled: true,
      samplingRate: 1.0,
      bufferSize: 1000,
      flushInterval: 1000,
      storageRetention: 86400000,
      compressionEnabled: true,
      realtimeStreaming: false,
      performanceMonitoring: true,
      level: 'debug'
    };
    
    storage = new TraceStorage(config, tracingConfig);
  });

  afterEach(async () => {
    await storage.close();
    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }
  });

  describe('Basic Operations', () => {
    test('should create and store a trace event', async () => {
      const sessionId = await storage.createSession('test-session');
      
      const trace: TraceEvent = {
        id: generateId('trace'),
        timestamp: Date.now(),
        sessionId,
        type: 'task_start',
        data: { action: 'test' },
        metadata: {
          source: 'test',
          severity: 'low',
          tags: ['test'],
          correlationId: generateId('corr')
        },
        performance: { duration: 100 }
      };
      
      await storage.storeTrace(trace);
      
      // Flush to ensure storage
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      const retrieved = await storage.getTrace(trace.id);
      expect(retrieved).toBeTruthy();
      expect(retrieved?.id).toBe(trace.id);
      expect(retrieved?.type).toBe(trace.type);
    });

    test('should handle batch storage', async () => {
      const sessionId = await storage.createSession('batch-test');
      
      const traces: TraceEvent[] = Array.from({ length: 5 }, (_, i) => ({
        id: generateId('trace'),
        timestamp: Date.now() + i,
        sessionId,
        type: 'task_start',
        data: { index: i },
        metadata: {
          source: 'test',
          severity: 'low',
          tags: ['batch'],
          correlationId: generateId('corr')
        },
        performance: { duration: 100 + i }
      }));
      
      await storage.storeBatch(traces);
      
      const retrieved = await storage.getTracesBySession(sessionId);
      expect(retrieved).toHaveLength(5);
    });

    test('should create session with metadata', async () => {
      const metadata = { purpose: 'testing', version: '1.0' };
      const sessionId = await storage.createSession('test-session', metadata);
      
      const session = await storage.getSession(sessionId);
      expect(session).toBeTruthy();
      expect(session?.name).toBe('test-session');
      expect(session?.metadata).toEqual(metadata);
    });
  });

  describe('Querying', () => {
    test('should query traces by time range', async () => {
      const sessionId = await storage.createSession('time-test');
      const baseTime = Date.now();
      
      const traces: TraceEvent[] = [
        {
          id: generateId('trace'),
          timestamp: baseTime,
          sessionId,
          type: 'task_start',
          data: {},
          metadata: { source: 'test', severity: 'low', tags: [], correlationId: generateId('corr') }
        },
        {
          id: generateId('trace'),
          timestamp: baseTime + 5000,
          sessionId,
          type: 'task_complete',
          data: {},
          metadata: { source: 'test', severity: 'low', tags: [], correlationId: generateId('corr') }
        }
      ];
      
      await storage.storeBatch(traces);
      
      const results = await storage.getTracesByTimeRange({
        start: baseTime - 1000,
        end: baseTime + 2000
      });
      
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('task_start');
    });

    test('should build trace graph', async () => {
      const sessionId = await storage.createSession('graph-test');
      
      const parentTrace: TraceEvent = {
        id: generateId('parent'),
        timestamp: Date.now(),
        sessionId,
        type: 'task_start',
        data: {},
        metadata: { source: 'test', severity: 'low', tags: [], correlationId: generateId('corr') }
      };
      
      const childTrace: TraceEvent = {
        id: generateId('child'),
        timestamp: Date.now() + 1000,
        sessionId,
        type: 'task_complete',
        data: {},
        metadata: { 
          source: 'test', 
          severity: 'low', 
          tags: [], 
          correlationId: generateId('corr'),
          parentId: parentTrace.id
        }
      };
      
      await storage.storeBatch([parentTrace, childTrace]);
      
      const graph = await storage.getTraceGraph(sessionId);
      expect(graph.nodes).toHaveLength(2);
      expect(graph.edges).toHaveLength(1);
      expect(graph.metadata.nodeCount).toBe(2);
      expect(graph.metadata.edgeCount).toBe(1);
    });
  });

  describe('Performance Features', () => {
    test('should store and retrieve performance snapshots', async () => {
      const sessionId = await storage.createSession('perf-test');
      const metrics = { cpu: 50, memory: 1024 * 1024, tasks: 5 };
      
      await storage.storePerformanceSnapshot(sessionId, metrics);
      
      const snapshots = await storage.getPerformanceSnapshots(sessionId, {
        start: Date.now() - 1000,
        end: Date.now() + 1000
      });
      
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].metrics).toEqual(metrics);
    });

    test('should track resource usage', async () => {
      const agentId = generateId('agent');
      
      await storage.storeResourceUsage(agentId, 75.5, 2048 * 1024, 1024, 500, 300, 10);
      
      const usage = await storage.getResourceUsage(agentId, {
        start: Date.now() - 1000,
        end: Date.now() + 1000
      });
      
      expect(usage).toHaveLength(1);
      expect(usage[0].cpuPercent).toBe(75.5);
      expect(usage[0].memoryBytes).toBe(2048 * 1024);
    });
  });

  describe('Error Handling', () => {
    test('should store and retrieve error events', async () => {
      const sessionId = await storage.createSession('error-test');
      
      const trace: TraceEvent = {
        id: generateId('trace'),
        timestamp: Date.now(),
        sessionId,
        type: 'task_fail',
        data: { error: 'test error' },
        metadata: { source: 'test', severity: 'high', tags: [], correlationId: generateId('corr') }
      };
      
      await storage.storeTrace(trace);
      await storage.storeErrorEvent(
        trace.id,
        'RuntimeError',
        'Test error message',
        'Error: test\\n  at test.js:1',
        'Restarted task'
      );
      
      const errors = await storage.getErrorEvents({ traceId: trace.id });
      expect(errors).toHaveLength(1);
      expect(errors[0].errorType).toBe('RuntimeError');
      expect(errors[0].errorMessage).toBe('Test error message');
    });
  });

  describe('Storage Management', () => {
    test('should provide storage statistics', () => {
      const stats = storage.getStorageStats();
      expect(stats).toHaveProperty('traceCount');
      expect(stats).toHaveProperty('sessionCount');
      expect(stats).toHaveProperty('fileSize');
    });

    test('should provide comprehensive statistics', () => {
      const stats = storage.getComprehensiveStats();
      expect(stats).toHaveProperty('storage');
      expect(stats).toHaveProperty('performance');
      expect(stats).toHaveProperty('health');
      expect(stats.health.uptime).toBeGreaterThan(0);
    });

    test('should optimize database', async () => {
      await expect(storage.optimize()).resolves.not.toThrow();
    });
  });

  describe('Data Compression', () => {
    test('should handle large trace data with compression', async () => {
      const sessionId = await storage.createSession('compression-test');
      
      // Create large data object
      const largeData = {
        content: 'x'.repeat(2000), // Trigger compression
        metadata: { details: 'y'.repeat(1000) }
      };
      
      const trace: TraceEvent = {
        id: generateId('large'),
        timestamp: Date.now(),
        sessionId,
        type: 'data_processing',
        data: largeData,
        metadata: { source: 'test', severity: 'low', tags: [], correlationId: generateId('corr') }
      };
      
      await storage.storeTrace(trace);
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      const retrieved = await storage.getTrace(trace.id);
      expect(retrieved).toBeTruthy();
      expect(retrieved?.data.content).toBe(largeData.content);
    });
  });
});