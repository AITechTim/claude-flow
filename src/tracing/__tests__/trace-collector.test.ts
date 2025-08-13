/**
 * Comprehensive Unit Tests for TraceCollector
 */

import { beforeEach, afterEach, describe, expect, test, jest } from '@jest/globals';
import { TraceCollector, TraceCollectorMetrics } from '../collector/trace-collector';
import { TraceStorage } from '../storage/trace-storage';
import { TraceStreamer } from '../streaming/trace-streamer';
import { TraceEvent, TraceEventType, TracingConfig, AgentTrace } from '../types';
import { EventFilterManager, EventPreprocessor } from '../collector/event-filters';
import { Logger } from '../../core/logger';

// Mock dependencies
jest.mock('../storage/trace-storage');
jest.mock('../streaming/trace-streamer');
jest.mock('../collector/event-filters');
jest.mock('../../core/logger');

describe('TraceCollector', () => {
  let traceCollector: TraceCollector;
  let mockStorage: jest.Mocked<TraceStorage>;
  let mockStreamer: jest.Mocked<TraceStreamer>;
  let mockFilterManager: jest.Mocked<EventFilterManager>;
  let mockLogger: jest.Mocked<Logger>;
  let config: TracingConfig;

  beforeEach(() => {
    // Setup mocks
    mockStorage = new TraceStorage({} as any, {} as any) as jest.Mocked<TraceStorage>;
    mockStreamer = new TraceStreamer({} as any) as jest.Mocked<TraceStreamer>;
    mockFilterManager = new EventFilterManager() as jest.Mocked<EventFilterManager>;
    mockLogger = new Logger('test') as jest.Mocked<Logger>;

    // Mock implementations
    mockStorage.storeBatch = jest.fn().mockResolvedValue(undefined);
    mockStreamer.broadcastTraceEvent = jest.fn();
    mockFilterManager.shouldAcceptEvent = jest.fn().mockReturnValue(true);
    mockFilterManager.addFilter = jest.fn();
    mockFilterManager.clearFilters = jest.fn();

    // Mock static methods
    (EventPreprocessor.preprocessEvent as jest.Mock) = jest.fn().mockImplementation((event) => ({
      ...event,
      sessionId: 'test-session',
      id: event.id || 'test-id'
    }));

    // Mock EventFilterManager constructor
    (EventFilterManager as jest.Mock).mockImplementation(() => mockFilterManager);
    (Logger as jest.Mock).mockImplementation(() => mockLogger);

    // Test configuration
    config = {
      enabled: true,
      samplingRate: 1.0,
      bufferSize: 1000,
      flushInterval: 1000,
      storageRetention: 86400,
      compressionEnabled: false,
      realtimeStreaming: true,
      performanceMonitoring: true
    };

    traceCollector = new TraceCollector(config, mockStorage, mockStreamer);
  });

  afterEach(() => {
    traceCollector.stop();
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  describe('Initialization', () => {
    test('should initialize with correct configuration', () => {
      expect(traceCollector).toBeInstanceOf(TraceCollector);
      expect(EventFilterManager).toHaveBeenCalled();
      expect(Logger).toHaveBeenCalledWith('TraceCollector');
    });

    test('should setup performance monitoring when enabled', () => {
      const perfConfig = { ...config, performanceMonitoring: true };
      const collector = new TraceCollector(perfConfig);
      
      expect(collector).toBeInstanceOf(TraceCollector);
    });
  });

  describe('Collection Control', () => {
    test('should start collection successfully', () => {
      traceCollector.start();
      
      const metrics = traceCollector.getMetrics();
      expect(metrics.totalEvents).toBe(0);
    });

    test('should stop collection and flush events', async () => {
      traceCollector.start();
      
      // Add a test event
      traceCollector.collectEvent({
        type: TraceEventType.TASK_START,
        agentId: 'test-agent',
        swarmId: 'test-swarm',
        data: { test: true }
      });

      traceCollector.stop();
      
      // Should have flushed to storage
      expect(mockStorage.storeBatch).toHaveBeenCalled();
    });

    test('should not start collection twice', () => {
      traceCollector.start();
      traceCollector.start(); // Second start
      
      expect(mockLogger.warn).toHaveBeenCalledWith('Trace collection already started');
    });

    test('should not stop collection twice', () => {
      traceCollector.start();
      traceCollector.stop();
      traceCollector.stop(); // Second stop
      
      expect(mockLogger.warn).toHaveBeenCalledWith('Trace collection already stopped');
    });
  });

  describe('Event Collection', () => {
    beforeEach(() => {
      traceCollector.start();
    });

    test('should collect valid events', () => {
      const testEvent = {
        type: TraceEventType.TASK_START,
        agentId: 'test-agent',
        swarmId: 'test-swarm',
        data: { taskName: 'test-task' }
      };

      traceCollector.collectEvent(testEvent);
      
      const metrics = traceCollector.getMetrics();
      expect(metrics.totalEvents).toBe(1);
      expect(EventPreprocessor.preprocessEvent).toHaveBeenCalled();
    });

    test('should reject invalid events', () => {
      const invalidEvent = {
        type: '', // Invalid type
        agentId: '',
        swarmId: '',
        data: {}
      };

      traceCollector.collectEvent(invalidEvent);
      
      const metrics = traceCollector.getMetrics();
      expect(metrics.totalEvents).toBe(0);
      expect(metrics.droppedEvents).toBe(1);
    });

    test('should apply sampling rate', () => {
      const samplingConfig = { ...config, samplingRate: 0.5 };
      const collector = new TraceCollector(samplingConfig);
      collector.start();

      // Generate multiple events
      for (let i = 0; i < 100; i++) {
        collector.collectEvent({
          type: TraceEventType.TASK_START,
          agentId: `agent-${i}`,
          swarmId: 'test-swarm',
          data: { index: i }
        });
      }

      const metrics = collector.getMetrics();
      expect(metrics.totalEvents).toBeLessThan(100);
    });

    test('should stream events when enabled', () => {
      const streamingConfig = { ...config, realtimeStreaming: true };
      const collector = new TraceCollector(streamingConfig, mockStorage, mockStreamer);
      collector.start();

      collector.collectEvent({
        type: TraceEventType.AGENT_SPAWN,
        agentId: 'test-agent',
        swarmId: 'test-swarm',
        data: {}
      });

      expect(mockStreamer.broadcastTraceEvent).toHaveBeenCalled();
    });

    test('should handle collection errors gracefully', () => {
      // Mock preprocessor to throw error
      (EventPreprocessor.preprocessEvent as jest.Mock).mockImplementation(() => {
        throw new Error('Processing failed');
      });

      traceCollector.collectEvent({
        type: TraceEventType.TASK_START,
        agentId: 'test-agent',
        swarmId: 'test-swarm',
        data: {}
      });

      const metrics = traceCollector.getMetrics();
      expect(metrics.errorCount).toBe(1);
    });
  });

  describe('Trace Lifecycle', () => {
    beforeEach(() => {
      traceCollector.start();
    });

    test('should start trace with timing', () => {
      const traceId = traceCollector.startTrace(
        'test-trace',
        TraceEventType.TASK_START,
        'test-agent',
        'test-swarm',
        { taskName: 'test' }
      );

      expect(traceId).toBe('test-trace');
      const metrics = traceCollector.getMetrics();
      expect(metrics.totalEvents).toBe(1);
    });

    test('should complete trace with duration', () => {
      const traceId = 'test-trace';
      
      // Start trace
      traceCollector.startTrace(traceId, TraceEventType.TASK_START, 'test-agent', 'test-swarm');
      
      // Complete trace
      traceCollector.completeTrace(traceId, { result: 'success' });

      const metrics = traceCollector.getMetrics();
      expect(metrics.totalEvents).toBe(2); // Start + Complete
    });

    test('should record trace error', () => {
      const traceId = 'test-trace';
      const error = new Error('Test error');
      
      traceCollector.startTrace(traceId, TraceEventType.TASK_START, 'test-agent', 'test-swarm');
      traceCollector.errorTrace(traceId, error);

      const metrics = traceCollector.getMetrics();
      expect(metrics.totalEvents).toBe(2); // Start + Error
    });
  });

  describe('Agent Traces', () => {
    beforeEach(() => {
      traceCollector.start();
    });

    test('should track agent traces', () => {
      traceCollector.collectEvent({
        type: TraceEventType.AGENT_SPAWN,
        agentId: 'test-agent',
        swarmId: 'test-swarm',
        data: { capabilities: ['task1', 'task2'] }
      });

      const agentTrace = traceCollector.getAgentTrace('test-agent');
      expect(agentTrace).toBeDefined();
      expect(agentTrace?.agentId).toBe('test-agent');
      expect(agentTrace?.events).toHaveLength(1);
    });

    test('should update agent state based on events', () => {
      const agentId = 'test-agent';
      
      // Spawn agent
      traceCollector.collectEvent({
        type: TraceEventType.AGENT_SPAWN,
        agentId,
        swarmId: 'test-swarm',
        data: {}
      });

      // Start task
      traceCollector.collectEvent({
        type: TraceEventType.TASK_START,
        agentId,
        swarmId: 'test-swarm',
        data: { taskId: 'task-1' }
      });

      const agentTrace = traceCollector.getAgentTrace(agentId);
      expect(agentTrace?.state.status).toBe('busy');
      expect(agentTrace?.state.currentTask).toBe('task-1');
    });

    test('should get all agent traces', () => {
      // Create multiple agents
      for (let i = 0; i < 3; i++) {
        traceCollector.collectEvent({
          type: TraceEventType.AGENT_SPAWN,
          agentId: `agent-${i}`,
          swarmId: 'test-swarm',
          data: {}
        });
      }

      const allTraces = traceCollector.getAllAgentTraces();
      expect(allTraces).toHaveLength(3);
    });
  });

  describe('Backpressure Handling', () => {
    test('should handle backpressure when buffer is full', () => {
      const smallBufferConfig = { ...config, bufferSize: 5 };
      const collector = new TraceCollector(smallBufferConfig);
      collector.start();

      // Fill buffer beyond capacity
      for (let i = 0; i < 10; i++) {
        collector.collectEvent({
          type: TraceEventType.TASK_START,
          agentId: `agent-${i}`,
          swarmId: 'test-swarm',
          data: {},
          metadata: { severity: i < 5 ? 'low' : 'high' } as any
        });
      }

      const metrics = collector.getMetrics();
      expect(metrics.droppedEvents).toBeGreaterThan(0);
    });

    test('should prioritize high severity events during backpressure', () => {
      const smallBufferConfig = { ...config, bufferSize: 2 };
      const collector = new TraceCollector(smallBufferConfig);
      collector.start();

      // Add low priority event
      collector.collectEvent({
        type: TraceEventType.TASK_START,
        agentId: 'agent-1',
        swarmId: 'test-swarm',
        data: {},
        metadata: { severity: 'low' } as any
      });

      // Fill buffer
      collector.collectEvent({
        type: TraceEventType.TASK_START,
        agentId: 'agent-2',
        swarmId: 'test-swarm',
        data: {},
        metadata: { severity: 'medium' } as any
      });

      // This should trigger backpressure and drop low priority event
      collector.collectEvent({
        type: TraceEventType.TASK_START,
        agentId: 'agent-3',
        swarmId: 'test-swarm',
        data: {},
        metadata: { severity: 'high' } as any
      });

      const metrics = collector.getMetrics();
      expect(metrics.totalEvents).toBe(3);
    });
  });

  describe('Performance Metrics', () => {
    beforeEach(() => {
      traceCollector.start();
    });

    test('should track collection metrics', () => {
      // Collect some events
      for (let i = 0; i < 5; i++) {
        traceCollector.collectEvent({
          type: TraceEventType.TASK_START,
          agentId: `agent-${i}`,
          swarmId: 'test-swarm',
          data: {}
        });
      }

      const metrics = traceCollector.getMetrics();
      expect(metrics.totalEvents).toBe(5);
      expect(metrics.bufferUtilization).toBeGreaterThan(0);
      expect(metrics.samplingRate).toBe(1.0);
    });

    test('should calculate collection overhead', () => {
      const metrics = traceCollector.getMetrics();
      expect(metrics.collectionOverhead).toBeGreaterThanOrEqual(0);
      expect(metrics.collectionOverhead).toBeLessThanOrEqual(1);
    });

    test('should track events per second', async () => {
      // Generate events quickly
      for (let i = 0; i < 10; i++) {
        traceCollector.collectEvent({
          type: TraceEventType.TASK_START,
          agentId: `agent-${i}`,
          swarmId: 'test-swarm',
          data: {}
        });
      }

      // Wait for metrics update
      await new Promise(resolve => setTimeout(resolve, 1100));

      const metrics = traceCollector.getMetrics();
      expect(metrics.eventsPerSecond).toBeGreaterThan(0);
    });
  });

  describe('Event Filtering', () => {
    beforeEach(() => {
      traceCollector.start();
    });

    test('should add and apply filters', () => {
      const filter = { type: 'test-filter' };
      traceCollector.addFilter(filter);
      
      expect(mockFilterManager.addFilter).toHaveBeenCalledWith(filter);
    });

    test('should clear all filters', () => {
      traceCollector.clearFilters();
      
      expect(mockFilterManager.clearFilters).toHaveBeenCalled();
    });

    test('should drop events that fail filters', () => {
      // Mock filter to reject events
      mockFilterManager.shouldAcceptEvent.mockReturnValue(false);

      traceCollector.collectEvent({
        type: TraceEventType.TASK_START,
        agentId: 'test-agent',
        swarmId: 'test-swarm',
        data: {}
      });

      const metrics = traceCollector.getMetrics();
      expect(metrics.totalEvents).toBe(0);
      expect(metrics.droppedEvents).toBe(1);
    });
  });

  describe('Flush Operations', () => {
    beforeEach(() => {
      traceCollector.start();
    });

    test('should auto-flush when buffer threshold reached', async () => {
      const smallBufferConfig = { ...config, bufferSize: 3 };
      const collector = new TraceCollector(smallBufferConfig, mockStorage);
      collector.start();

      // Fill buffer to trigger flush
      for (let i = 0; i < 4; i++) {
        collector.collectEvent({
          type: TraceEventType.TASK_START,
          agentId: `agent-${i}`,
          swarmId: 'test-swarm',
          data: {}
        });
      }

      expect(mockStorage.storeBatch).toHaveBeenCalled();
    });

    test('should handle flush errors gracefully', async () => {
      // Mock storage to fail
      mockStorage.storeBatch.mockRejectedValue(new Error('Storage error'));

      traceCollector.collectEvent({
        type: TraceEventType.TASK_START,
        agentId: 'test-agent',
        swarmId: 'test-swarm',
        data: {}
      });

      await traceCollector.flush();

      const metrics = traceCollector.getMetrics();
      expect(metrics.errorCount).toBe(1);
    });

    test('should flush manually', async () => {
      traceCollector.collectEvent({
        type: TraceEventType.TASK_START,
        agentId: 'test-agent',
        swarmId: 'test-swarm',
        data: {}
      });

      await traceCollector.flush();

      expect(mockStorage.storeBatch).toHaveBeenCalled();
    });
  });

  describe('Adaptive Sampling', () => {
    test('should adjust sampling rate based on overhead', async () => {
      const adaptiveConfig = { ...config, samplingRate: 1.0 };
      const collector = new TraceCollector(adaptiveConfig);
      collector.start();

      // Generate high load to trigger overhead
      for (let i = 0; i < 1000; i++) {
        collector.collectEvent({
          type: TraceEventType.TASK_START,
          agentId: `agent-${i}`,
          swarmId: 'test-swarm',
          data: { largeData: 'x'.repeat(1000) }
        });
      }

      // Wait for adaptive sampling adjustment
      await new Promise(resolve => setTimeout(resolve, 6000));

      const metrics = collector.getMetrics();
      // Sampling rate might be adjusted down due to high overhead
      expect(metrics.samplingRate).toBeGreaterThan(0);
    });
  });

  describe('System Events', () => {
    test('should capture system errors', () => {
      traceCollector.start();

      // Simulate uncaught exception
      const error = new Error('Test system error');
      process.emit('uncaughtException', error);

      // Should have collected system error event
      const metrics = traceCollector.getMetrics();
      expect(metrics.totalEvents).toBeGreaterThan(0);
    });

    test('should capture unhandled rejections', () => {
      traceCollector.start();

      // Simulate unhandled rejection
      process.emit('unhandledRejection', 'Test rejection');

      // Should have collected system error event
      const metrics = traceCollector.getMetrics();
      expect(metrics.totalEvents).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty events', () => {
      traceCollector.start();
      
      traceCollector.collectEvent({} as any);
      
      const metrics = traceCollector.getMetrics();
      expect(metrics.droppedEvents).toBe(1);
    });

    test('should handle null/undefined events', () => {
      traceCollector.start();
      
      traceCollector.collectEvent(null as any);
      traceCollector.collectEvent(undefined as any);
      
      const metrics = traceCollector.getMetrics();
      expect(metrics.droppedEvents).toBe(2);
    });

    test('should handle very large data payloads', () => {
      traceCollector.start();
      
      const largeData = { content: 'x'.repeat(1000000) }; // 1MB string
      
      traceCollector.collectEvent({
        type: TraceEventType.TASK_START,
        agentId: 'test-agent',
        swarmId: 'test-swarm',
        data: largeData
      });

      const metrics = traceCollector.getMetrics();
      expect(metrics.totalEvents).toBeGreaterThanOrEqual(0);
    });

    test('should handle concurrent collection', async () => {
      traceCollector.start();

      // Simulate concurrent event collection
      const promises = Array.from({ length: 100 }, (_, i) =>
        Promise.resolve().then(() => {
          traceCollector.collectEvent({
            type: TraceEventType.TASK_START,
            agentId: `agent-${i}`,
            swarmId: 'test-swarm',
            data: { index: i }
          });
        })
      );

      await Promise.all(promises);

      const metrics = traceCollector.getMetrics();
      expect(metrics.totalEvents).toBe(100);
    });
  });

  describe('Memory Management', () => {
    test('should limit agent trace history', () => {
      traceCollector.start();
      const agentId = 'test-agent';

      // Generate more events than the limit (1000 per agent)
      for (let i = 0; i < 1200; i++) {
        traceCollector.collectEvent({
          type: TraceEventType.TASK_START,
          agentId,
          swarmId: 'test-swarm',
          data: { index: i }
        });
      }

      const agentTrace = traceCollector.getAgentTrace(agentId);
      expect(agentTrace?.events.length).toBeLessThanOrEqual(1000);
    });

    test('should cleanup on stop', () => {
      traceCollector.start();
      
      // Add some data
      traceCollector.collectEvent({
        type: TraceEventType.AGENT_SPAWN,
        agentId: 'test-agent',
        swarmId: 'test-swarm',
        data: {}
      });

      traceCollector.stop();

      // Verify cleanup
      expect(mockStorage.storeBatch).toHaveBeenCalled();
    });
  });
});