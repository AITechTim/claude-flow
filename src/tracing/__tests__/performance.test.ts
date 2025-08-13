/**
 * Performance Tests and Benchmarks for Tracing System
 */

import { beforeEach, afterEach, describe, expect, test, jest } from '@jest/globals';
import { performance } from 'perf_hooks';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { TraceCollector } from '../collector/trace-collector';
import { TraceStorage } from '../storage/trace-storage';
import { TraceStreamer } from '../streaming/trace-streamer';
import { 
  TraceEvent, 
  TraceEventType, 
  TracingConfig 
} from '../types';

describe('Tracing System Performance Tests', () => {
  let tempDir: string;
  let storage: TraceStorage;
  let collector: TraceCollector;
  let streamer: TraceStreamer;
  let config: TracingConfig;

  const PERFORMANCE_THRESHOLDS = {
    MAX_COLLECTION_OVERHEAD: 0.05, // 5% max overhead
    MAX_EVENT_PROCESSING_TIME: 1, // 1ms per event
    MAX_FLUSH_TIME: 100, // 100ms for 1000 events
    MAX_QUERY_TIME: 50, // 50ms for complex queries
    MAX_STORAGE_TIME: 200, // 200ms for 10k events
    MIN_THROUGHPUT: 10000, // 10k events per second
    MAX_MEMORY_GROWTH: 50 * 1024 * 1024 // 50MB max memory growth
  };

  beforeEach(async () => {
    // Setup temporary directory
    tempDir = join(tmpdir(), `perf-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    // Performance-optimized configuration
    config = {
      enabled: true,
      samplingRate: 1.0,
      bufferSize: 1000,
      flushInterval: 1000,
      storageRetention: 3600,
      compressionEnabled: false, // Disable for consistent timing
      realtimeStreaming: false, // Disable for pure collection performance
      performanceMonitoring: true
    };

    storage = new TraceStorage(
      {
        databasePath: join(tempDir, 'perf-traces.db'),
        maxFileSize: 1000 * 1024 * 1024, // 1GB
        maxFiles: 1,
        compressionLevel: 0, // No compression for performance tests
        indexingEnabled: true,
        vacuumInterval: 0 // Disable auto-vacuum
      },
      config
    );

    collector = new TraceCollector(config, storage);
  });

  afterEach(async () => {
    collector?.stop();
    await streamer?.stop();
    await storage?.close();
    
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    
    jest.clearAllTimers();
  });

  describe('Collection Performance', () => {
    test('should maintain low overhead during event collection', () => {
      collector.start();
      
      const eventCount = 10000;
      const startTime = performance.now();
      
      // Measure pure application work (without tracing)
      const appWorkStart = performance.now();
      for (let i = 0; i < eventCount; i++) {
        // Simulate minimal application work
        const data = { index: i, timestamp: Date.now() };
      }
      const appWorkTime = performance.now() - appWorkStart;
      
      // Measure total time with tracing
      const totalStart = performance.now();
      for (let i = 0; i < eventCount; i++) {
        collector.collectEvent({
          type: TraceEventType.TASK_START,
          agentId: `perf-agent-${i % 100}`,
          swarmId: `perf-swarm-${i % 10}`,
          data: { index: i, timestamp: Date.now() }
        });
      }
      const totalTime = performance.now() - totalStart;
      
      const overhead = (totalTime - appWorkTime) / totalTime;
      const metrics = collector.getMetrics();
      
      expect(overhead).toBeLessThan(PERFORMANCE_THRESHOLDS.MAX_COLLECTION_OVERHEAD);
      expect(metrics.collectionOverhead).toBeLessThan(PERFORMANCE_THRESHOLDS.MAX_COLLECTION_OVERHEAD);
      expect(metrics.averageProcessingTime).toBeLessThan(PERFORMANCE_THRESHOLDS.MAX_EVENT_PROCESSING_TIME);
      
      console.log(`Collection Overhead: ${(overhead * 100).toFixed(2)}%`);
      console.log(`Average Processing Time: ${metrics.averageProcessingTime.toFixed(3)}ms`);
    });

    test('should achieve high throughput under sustained load', async () => {
      collector.start();
      
      const eventCount = 100000;
      const batchSize = 1000;
      const startTime = performance.now();
      
      // Generate events in batches to avoid overwhelming the system
      for (let batch = 0; batch < eventCount / batchSize; batch++) {
        for (let i = 0; i < batchSize; i++) {
          const eventIndex = batch * batchSize + i;
          collector.collectEvent({
            type: TraceEventType.TASK_START,
            agentId: `throughput-agent-${eventIndex % 50}`,
            swarmId: `throughput-swarm-${eventIndex % 5}`,
            data: { 
              batch, 
              index: i,
              payload: `data-${eventIndex}`
            }
          });
        }
        
        // Small yield to prevent blocking
        if (batch % 10 === 0) {
          await new Promise(resolve => setImmediate(resolve));
        }
      }
      
      const collectionTime = performance.now() - startTime;
      const throughput = eventCount / (collectionTime / 1000);
      
      const metrics = collector.getMetrics();
      
      expect(throughput).toBeGreaterThan(PERFORMANCE_THRESHOLDS.MIN_THROUGHPUT);
      expect(metrics.totalEvents).toBeGreaterThan(eventCount * 0.95); // Account for sampling
      
      console.log(`Throughput: ${throughput.toFixed(0)} events/second`);
      console.log(`Collection Time: ${collectionTime.toFixed(2)}ms`);
    }, 30000);

    test('should handle concurrent collection efficiently', async () => {
      collector.start();
      
      const concurrentWorkers = 10;
      const eventsPerWorker = 5000;
      const startTime = performance.now();
      
      // Create concurrent workers
      const workers = Array.from({ length: concurrentWorkers }, (_, workerId) =>
        Promise.resolve().then(async () => {
          for (let i = 0; i < eventsPerWorker; i++) {
            collector.collectEvent({
              type: TraceEventType.TASK_START,
              agentId: `concurrent-agent-${workerId}-${i}`,
              swarmId: `concurrent-swarm-${workerId}`,
              data: { 
                workerId, 
                index: i,
                threadId: `thread-${workerId}`
              }
            });
            
            // Occasional yield
            if (i % 100 === 0) {
              await new Promise(resolve => setImmediate(resolve));
            }
          }
        })
      );
      
      await Promise.all(workers);
      const collectionTime = performance.now() - startTime;
      
      const totalEvents = concurrentWorkers * eventsPerWorker;
      const throughput = totalEvents / (collectionTime / 1000);
      const metrics = collector.getMetrics();
      
      expect(throughput).toBeGreaterThan(PERFORMANCE_THRESHOLDS.MIN_THROUGHPUT * 0.8); // Allow lower throughput for concurrency
      expect(metrics.totalEvents).toBeGreaterThan(totalEvents * 0.95);
      expect(metrics.errorCount).toBe(0);
      
      console.log(`Concurrent Throughput: ${throughput.toFixed(0)} events/second`);
      console.log(`Error Count: ${metrics.errorCount}`);
    }, 30000);
  });

  describe('Storage Performance', () => {
    test('should flush events to storage within time limits', async () => {
      collector.start();
      
      const eventCount = 10000;
      const events = Array.from({ length: eventCount }, (_, i) => ({
        type: TraceEventType.TASK_START,
        agentId: `storage-agent-${i % 100}`,
        swarmId: `storage-swarm-${i % 10}`,
        data: { 
          index: i,
          timestamp: Date.now(),
          payload: `event-data-${i}`
        }
      }));
      
      // Collect all events
      events.forEach(event => collector.collectEvent(event));
      
      // Measure flush time
      const flushStart = performance.now();
      await collector.flush();
      const flushTime = performance.now() - flushStart;
      
      expect(flushTime).toBeLessThan(PERFORMANCE_THRESHOLDS.MAX_FLUSH_TIME * (eventCount / 1000));
      
      console.log(`Storage Flush Time: ${flushTime.toFixed(2)}ms for ${eventCount} events`);
      console.log(`Storage Rate: ${(eventCount / (flushTime / 1000)).toFixed(0)} events/second`);
    });

    test('should handle large batch storage efficiently', async () => {
      const sessionId = await storage.createSession('Performance Test');
      
      const batchSizes = [1000, 5000, 10000, 20000];
      const results: Array<{ batchSize: number; time: number; rate: number }> = [];
      
      for (const batchSize of batchSizes) {
        const events: TraceEvent[] = Array.from({ length: batchSize }, (_, i) => ({
          id: `perf-event-${i}`,
          sessionId,
          timestamp: Date.now() + i,
          type: TraceEventType.TASK_START,
          agentId: `batch-agent-${i % 50}`,
          swarmId: 'batch-swarm',
          data: { 
            index: i,
            batchSize,
            payload: `batch-data-${i}` 
          },
          metadata: {
            source: 'performance-test',
            severity: 'low' as const,
            tags: ['performance', 'batch'],
            correlationId: `batch-${Math.floor(i / 100)}`
          }
        }));
        
        const startTime = performance.now();
        await storage.storeBatch(events);
        const endTime = performance.now();
        
        const time = endTime - startTime;
        const rate = batchSize / (time / 1000);
        
        results.push({ batchSize, time, rate });
        
        expect(time).toBeLessThan(PERFORMANCE_THRESHOLDS.MAX_STORAGE_TIME * (batchSize / 10000));
        
        console.log(`Batch ${batchSize}: ${time.toFixed(2)}ms (${rate.toFixed(0)} events/sec)`);
      }
      
      // Verify storage scaling is reasonable (not exponential)
      const scalingFactors = results.slice(1).map((result, i) => 
        result.time / results[i].time
      );
      
      scalingFactors.forEach(factor => {
        expect(factor).toBeLessThan(3); // Time shouldn't increase by more than 3x for larger batches
      });
    });

    test('should query data efficiently', async () => {
      collector.start();
      
      const sessionId = await storage.createSession('Query Performance Test');
      
      // Generate test data with variety
      const agents = Array.from({ length: 100 }, (_, i) => `query-agent-${i}`);
      const eventTypes = [
        TraceEventType.AGENT_SPAWN,
        TraceEventType.TASK_START,
        TraceEventType.TASK_COMPLETE,
        TraceEventType.MESSAGE_SEND
      ];
      
      const eventCount = 50000;
      for (let i = 0; i < eventCount; i++) {
        collector.collectEvent({
          type: eventTypes[i % eventTypes.length],
          agentId: agents[i % agents.length],
          swarmId: `query-swarm-${i % 20}`,
          data: { 
            index: i,
            category: i % 5,
            timestamp: Date.now() + i * 1000 // Spread over time
          }
        });
      }
      
      await collector.flush();
      
      // Test various query patterns
      const queryTests = [
        {
          name: 'Get all traces by session',
          query: () => storage.getTracesBySession(sessionId)
        },
        {
          name: 'Get traces by agent',
          query: () => storage.getTracesByAgent('query-agent-0')
        },
        {
          name: 'Get traces by time range',
          query: () => storage.getTracesByTimeRange(
            { start: Date.now(), end: Date.now() + 10000000 }
          )
        },
        {
          name: 'Get traces with filters',
          query: () => storage.getTracesBySession(sessionId, {
            eventTypes: [TraceEventType.TASK_START],
            agentIds: agents.slice(0, 10),
            limit: 1000
          })
        },
        {
          name: 'Build trace graph',
          query: () => storage.getTraceGraph(sessionId)
        }
      ];
      
      for (const test of queryTests) {
        const startTime = performance.now();
        const result = await test.query();
        const queryTime = performance.now() - startTime;
        
        expect(queryTime).toBeLessThan(PERFORMANCE_THRESHOLDS.MAX_QUERY_TIME * 2); // Allow 2x threshold for complex queries
        expect(Array.isArray(result) ? result.length : 1).toBeGreaterThan(0);
        
        console.log(`${test.name}: ${queryTime.toFixed(2)}ms`);
      }
    });
  });

  describe('Memory Performance', () => {
    test('should maintain stable memory usage', async () => {
      collector.start();
      
      const initialMemory = process.memoryUsage();
      const eventCount = 100000;
      const memoryCheckpoints: number[] = [];
      
      // Generate events in batches with memory monitoring
      const batchSize = 10000;
      for (let batch = 0; batch < eventCount / batchSize; batch++) {
        for (let i = 0; i < batchSize; i++) {
          collector.collectEvent({
            type: TraceEventType.TASK_START,
            agentId: `memory-agent-${i % 100}`,
            swarmId: `memory-swarm-${i % 10}`,
            data: {
              batch,
              index: i,
              payload: `memory-test-data-${batch}-${i}`
            }
          });
        }
        
        // Flush to prevent buffer accumulation
        await collector.flush();
        
        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }
        
        memoryCheckpoints.push(process.memoryUsage().heapUsed);
      }
      
      const finalMemory = process.memoryUsage();
      const memoryGrowth = finalMemory.heapUsed - initialMemory.heapUsed;
      
      expect(memoryGrowth).toBeLessThan(PERFORMANCE_THRESHOLDS.MAX_MEMORY_GROWTH);
      
      // Verify memory doesn't grow excessively over time
      const avgGrowthPerBatch = memoryCheckpoints.reduce((sum, mem, i) => {
        if (i === 0) return 0;
        return sum + (mem - memoryCheckpoints[i - 1]);
      }, 0) / (memoryCheckpoints.length - 1);
      
      expect(Math.abs(avgGrowthPerBatch)).toBeLessThan(5 * 1024 * 1024); // Less than 5MB per batch on average
      
      console.log(`Memory Growth: ${(memoryGrowth / 1024 / 1024).toFixed(2)} MB`);
      console.log(`Average Growth Per Batch: ${(avgGrowthPerBatch / 1024 / 1024).toFixed(2)} MB`);
    }, 60000);

    test('should handle agent trace memory limits', async () => {
      collector.start();
      
      const agentId = 'memory-limit-agent';
      const eventsPerAgent = 5000; // Exceeds typical limit of 1000
      
      const initialMemory = process.memoryUsage().heapUsed;
      
      // Generate many events for single agent
      for (let i = 0; i < eventsPerAgent; i++) {
        collector.collectEvent({
          type: TraceEventType.TASK_START,
          agentId,
          swarmId: 'memory-limit-swarm',
          data: {
            index: i,
            largePayload: 'x'.repeat(1000) // 1KB per event
          }
        });
      }
      
      const agentTrace = collector.getAgentTrace(agentId);
      expect(agentTrace).toBeDefined();
      expect(agentTrace!.events.length).toBeLessThanOrEqual(1000); // Should be limited
      
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryGrowth = finalMemory - initialMemory;
      
      // Memory growth should be bounded despite large number of events
      expect(memoryGrowth).toBeLessThan(50 * 1024 * 1024); // Less than 50MB
      
      console.log(`Agent Events: ${agentTrace!.events.length} (limited from ${eventsPerAgent})`);
      console.log(`Memory Growth: ${(memoryGrowth / 1024 / 1024).toFixed(2)} MB`);
    });
  });

  describe('Streaming Performance', () => {
    test('should stream events with minimal latency', async () => {
      // Enable streaming for this test
      const streamingConfig = { ...config, realtimeStreaming: true };
      
      streamer = new TraceStreamer({
        port: 0,
        maxConnections: 100,
        heartbeatInterval: 30000,
        compressionEnabled: false,
        rateLimiting: {
          windowMs: 60000,
          maxMessages: 10000,
          maxBytesPerWindow: 10 * 1024 * 1024
        },
        auth: { enabled: false },
        backpressure: {
          highWaterMark: 1000,
          lowWaterMark: 500,
          maxQueueSize: 5000,
          dropOldest: true
        }
      });
      
      await streamer.start();
      
      collector = new TraceCollector(streamingConfig, storage, streamer);
      collector.start();
      
      const port = (streamer as any).server?.address()?.port;
      if (!port) throw new Error('Streamer port not available');
      
      // Connect WebSocket client
      const WebSocket = (await import('ws')).default;
      const ws = new WebSocket(`ws://localhost:${port}`);
      
      const latencies: number[] = [];
      let receivedCount = 0;
      
      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => resolve());
        ws.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 2000);
      });
      
      ws.on('message', (data) => {
        const event = JSON.parse(data.toString());
        if (event.type === 'trace_event' && event.data?.performanceTest) {
          const sendTime = event.data.sendTime;
          const receiveTime = Date.now();
          const latency = receiveTime - sendTime;
          latencies.push(latency);
          receivedCount++;
        }
      });
      
      // Generate events with timestamps
      const eventCount = 1000;
      for (let i = 0; i < eventCount; i++) {
        const sendTime = Date.now();
        collector.collectEvent({
          type: TraceEventType.TASK_START,
          agentId: `streaming-agent-${i}`,
          swarmId: 'streaming-swarm',
          data: {
            performanceTest: true,
            sendTime,
            index: i
          }
        });
        
        // Small delay to prevent overwhelming
        if (i % 100 === 0) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
      
      // Wait for all events to be received
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      ws.close();
      
      if (latencies.length > 0) {
        const avgLatency = latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
        const maxLatency = Math.max(...latencies);
        
        expect(avgLatency).toBeLessThan(100); // Average latency under 100ms
        expect(maxLatency).toBeLessThan(500); // Max latency under 500ms
        expect(receivedCount).toBeGreaterThan(eventCount * 0.9); // Receive at least 90% of events
        
        console.log(`Streaming - Received: ${receivedCount}/${eventCount}`);
        console.log(`Average Latency: ${avgLatency.toFixed(2)}ms`);
        console.log(`Max Latency: ${maxLatency}ms`);
      }
    }, 15000);
  });

  describe('Stress Tests', () => {
    test('should survive extreme load conditions', async () => {
      collector.start();
      
      const extremeEventCount = 1000000; // 1 million events
      const batchSize = 50000;
      const startTime = performance.now();
      
      let totalGenerated = 0;
      let errors = 0;
      
      for (let batch = 0; batch < extremeEventCount / batchSize; batch++) {
        try {
          const batchEvents = Array.from({ length: batchSize }, (_, i) => {
            const eventIndex = batch * batchSize + i;
            return {
              type: eventIndex % 4 === 0 ? TraceEventType.AGENT_SPAWN :
                    eventIndex % 4 === 1 ? TraceEventType.TASK_START :
                    eventIndex % 4 === 2 ? TraceEventType.TASK_COMPLETE :
                    TraceEventType.MESSAGE_SEND,
              agentId: `extreme-agent-${eventIndex % 1000}`,
              swarmId: `extreme-swarm-${eventIndex % 100}`,
              data: {
                batch,
                index: i,
                eventIndex,
                timestamp: Date.now()
              }
            };
          });
          
          batchEvents.forEach(event => {
            try {
              collector.collectEvent(event);
              totalGenerated++;
            } catch (error) {
              errors++;
            }
          });
          
          // Periodic flush to manage memory
          if (batch % 5 === 0) {
            await collector.flush();
          }
          
          // Yield control periodically
          await new Promise(resolve => setImmediate(resolve));
          
        } catch (error) {
          console.error(`Batch ${batch} failed:`, error);
          errors++;
        }
      }
      
      // Final flush
      await collector.flush();
      
      const totalTime = performance.now() - startTime;
      const throughput = totalGenerated / (totalTime / 1000);
      const errorRate = errors / totalGenerated;
      
      const metrics = collector.getMetrics();
      
      expect(totalGenerated).toBeGreaterThan(extremeEventCount * 0.95); // At least 95% generated
      expect(errorRate).toBeLessThan(0.01); // Less than 1% error rate
      expect(throughput).toBeGreaterThan(5000); // Maintain at least 5k events/sec under extreme load
      expect(metrics.collectionOverhead).toBeLessThan(0.1); // Less than 10% overhead even under stress
      
      console.log(`Extreme Load Results:`);
      console.log(`- Generated: ${totalGenerated.toLocaleString()} events`);
      console.log(`- Time: ${(totalTime / 1000).toFixed(2)} seconds`);
      console.log(`- Throughput: ${throughput.toFixed(0)} events/second`);
      console.log(`- Error Rate: ${(errorRate * 100).toFixed(3)}%`);
      console.log(`- Collection Overhead: ${(metrics.collectionOverhead * 100).toFixed(2)}%`);
      
    }, 120000); // 2 minute timeout for extreme test

    test('should handle rapid start/stop cycles', async () => {
      const cycles = 100;
      const eventsPerCycle = 100;
      
      const cycleResults: Array<{
        startTime: number;
        stopTime: number;
        flushTime: number;
        eventCount: number;
      }> = [];
      
      for (let cycle = 0; cycle < cycles; cycle++) {
        const startTime = performance.now();
        collector.start();
        const startCompleteTime = performance.now();
        
        // Generate events
        for (let i = 0; i < eventsPerCycle; i++) {
          collector.collectEvent({
            type: TraceEventType.TASK_START,
            agentId: `cycle-agent-${cycle}-${i}`,
            swarmId: `cycle-swarm-${cycle}`,
            data: { cycle, index: i }
          });
        }
        
        const flushStartTime = performance.now();
        collector.stop(); // This should flush
        const stopTime = performance.now();
        
        cycleResults.push({
          startTime: startCompleteTime - startTime,
          stopTime: stopTime - flushStartTime,
          flushTime: stopTime - flushStartTime,
          eventCount: eventsPerCycle
        });
        
        // Create new collector for next cycle
        if (cycle < cycles - 1) {
          collector = new TraceCollector(config, storage);
        }
      }
      
      // Analyze results
      const avgStartTime = cycleResults.reduce((sum, r) => sum + r.startTime, 0) / cycles;
      const avgStopTime = cycleResults.reduce((sum, r) => sum + r.stopTime, 0) / cycles;
      const maxStartTime = Math.max(...cycleResults.map(r => r.startTime));
      const maxStopTime = Math.max(...cycleResults.map(r => r.stopTime));
      
      expect(avgStartTime).toBeLessThan(10); // Average start time under 10ms
      expect(avgStopTime).toBeLessThan(100); // Average stop time under 100ms
      expect(maxStartTime).toBeLessThan(50); // Max start time under 50ms
      expect(maxStopTime).toBeLessThan(500); // Max stop time under 500ms
      
      console.log(`Start/Stop Cycle Performance:`);
      console.log(`- Average Start Time: ${avgStartTime.toFixed(2)}ms`);
      console.log(`- Average Stop Time: ${avgStopTime.toFixed(2)}ms`);
      console.log(`- Max Start Time: ${maxStartTime.toFixed(2)}ms`);
      console.log(`- Max Stop Time: ${maxStopTime.toFixed(2)}ms`);
    });
  });

  describe('Resource Efficiency', () => {
    test('should optimize database operations', async () => {
      const sessionId = await storage.createSession('Database Optimization Test');
      
      // Test different batch sizes for optimal performance
      const batchSizes = [100, 500, 1000, 2000, 5000];
      const results: Array<{ size: number; time: number; rate: number }> = [];
      
      for (const batchSize of batchSizes) {
        const events: TraceEvent[] = Array.from({ length: batchSize }, (_, i) => ({
          id: `opt-event-${i}`,
          sessionId,
          timestamp: Date.now() + i,
          type: TraceEventType.TASK_START,
          agentId: `opt-agent-${i % 10}`,
          swarmId: 'opt-swarm',
          data: { index: i, size: batchSize },
          metadata: {
            source: 'optimization-test',
            severity: 'low' as const,
            tags: ['optimization'],
            correlationId: `opt-${Math.floor(i / 100)}`
          }
        }));
        
        // Warm up database
        if (batchSize === batchSizes[0]) {
          await storage.storeBatch(events.slice(0, 10));
        }
        
        const startTime = performance.now();
        await storage.storeBatch(events);
        const endTime = performance.now();
        
        const time = endTime - startTime;
        const rate = batchSize / (time / 1000);
        
        results.push({ size: batchSize, time, rate });
        
        console.log(`Batch Size ${batchSize}: ${time.toFixed(2)}ms (${rate.toFixed(0)} events/sec)`);
      }
      
      // Find optimal batch size (highest rate)
      const optimalResult = results.reduce((best, current) => 
        current.rate > best.rate ? current : best
      );
      
      expect(optimalResult.rate).toBeGreaterThan(PERFORMANCE_THRESHOLDS.MIN_THROUGHPUT * 0.5);
      
      console.log(`Optimal Batch Size: ${optimalResult.size} (${optimalResult.rate.toFixed(0)} events/sec)`);
    });

    test('should demonstrate scalable indexing performance', async () => {
      const sessionId = await storage.createSession('Indexing Performance Test');
      
      // Generate base dataset
      const baseEventCount = 10000;
      for (let i = 0; i < baseEventCount; i++) {
        await storage.storeTrace({
          id: `index-event-${i}`,
          sessionId,
          timestamp: Date.now() + i * 1000,
          type: TraceEventType.TASK_START,
          agentId: `index-agent-${i % 100}`,
          swarmId: `index-swarm-${i % 10}`,
          data: { index: i },
          metadata: {
            source: 'indexing-test',
            severity: 'low' as const,
            tags: ['indexing'],
            correlationId: `index-${Math.floor(i / 1000)}`
          }
        });
      }
      
      // Test query performance as data grows
      const querySizes = [1000, 5000, 10000];
      
      for (const querySize of querySizes) {
        const timeRange = {
          start: Date.now(),
          end: Date.now() + querySize * 1000
        };
        
        const queryStart = performance.now();
        const results = await storage.getTracesByTimeRange(timeRange, {
          sessionIds: [sessionId],
          limit: querySize
        });
        const queryTime = performance.now() - queryStart;
        
        expect(queryTime).toBeLessThan(100); // Queries should remain fast
        expect(results.length).toBeGreaterThan(0);
        
        console.log(`Query ${querySize} events: ${queryTime.toFixed(2)}ms`);
      }
      
      // Test index efficiency
      const stats = storage.getStorageStats();
      expect(stats.traceCount).toBe(baseEventCount);
      
      console.log(`Storage Stats:`, {
        traces: stats.traceCount,
        fileSize: `${(stats.fileSize / 1024 / 1024).toFixed(2)} MB`,
        relationships: stats.relationshipCount
      });
    });
  });
});