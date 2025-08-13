/**
 * Comprehensive tests for WebSocket trace streaming server
 */

import { TraceStreamer, StreamingConfig } from '../../../src/tracing/streaming/trace-streamer.js';
import { TraceStreamingClient } from '../../../src/tracing/streaming/example-client.js';
import { EventBus } from '../../../src/core/event-bus.js';
import { TraceStorage } from '../../../src/tracing/storage/trace-storage.js';
import { TraceEvent, TraceEventType, TracingConfig } from '../../../src/tracing/types.js';
import WebSocket from 'ws';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';

describe('TraceStreamer', () => {
  let streamer: TraceStreamer;
  let eventBus: EventBus;
  let storage: TraceStorage;
  let config: StreamingConfig;
  let dbPath: string;

  beforeEach(async () => {
    // Create temporary database
    dbPath = join(tmpdir(), `test-traces-${Date.now()}.db`);
    
    // Setup configuration
    config = {
      enabled: true,
      port: 8081,
      maxConnections: 100,
      heartbeatInterval: 5000,
      compressionEnabled: true,
      batchSize: 10,
      batchTimeout: 1000,
      maxMessageSize: 1024 * 1024,
      auth: {
        enabled: false
      },
      rateLimit: {
        windowMs: 60000,
        maxMessages: 100,
        maxBytesPerWindow: 1024 * 1024
      },
      backpressure: {
        highWaterMark: 64 * 1024,
        lowWaterMark: 16 * 1024,
        maxQueueSize: 1000,
        dropOldest: true
      },
      binaryProtocol: false,
      reconnectSupport: true,
      historicalDataLimit: 1000
    };

    const tracingConfig: TracingConfig = {
      enabled: true,
      samplingRate: 1.0,
      bufferSize: 1000,
      flushInterval: 5000,
      storageRetention: 86400000,
      compressionEnabled: true,
      realtimeStreaming: true,
      performanceMonitoring: true
    };

    // Initialize components
    eventBus = EventBus.getInstance();
    storage = new TraceStorage({
      databasePath: dbPath,
      maxFileSize: 10 * 1024 * 1024,
      maxFiles: 5,
      compressionLevel: 6,
      indexingEnabled: true,
      vacuumInterval: 3600000
    }, tracingConfig);

    streamer = new TraceStreamer(config, eventBus, storage, tracingConfig);
    await streamer.start();
    
    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterEach(async () => {
    await streamer.stop();
    eventBus.removeAllListeners();
    
    // Clean up database
    try {
      unlinkSync(dbPath);
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Basic WebSocket Functionality', () => {
    test('should accept client connections', async () => {
      const client = new TraceStreamingClient({
        serverUrl: 'ws://localhost:8081'
      });

      const connected = new Promise(resolve => {
        client.on('connected', resolve);
      });

      await client.connect();
      const connectionInfo = await connected;

      expect(connectionInfo).toBeDefined();
      expect(connectionInfo.clientId).toBeDefined();
      expect(connectionInfo.serverInfo.version).toBe('2.0.0');

      client.disconnect();
    });

    test('should enforce connection limits', async () => {
      // Set low connection limit
      const limitedConfig = { ...config, maxConnections: 1 };
      await streamer.stop();
      streamer = new TraceStreamer(limitedConfig, eventBus, storage, {
        enabled: true,
        samplingRate: 1.0,
        bufferSize: 1000,
        flushInterval: 5000,
        storageRetention: 86400000,
        compressionEnabled: true,
        realtimeStreaming: true,
        performanceMonitoring: true
      });
      await streamer.start();
      await new Promise(resolve => setTimeout(resolve, 100));

      // First connection should succeed
      const client1 = new TraceStreamingClient({
        serverUrl: 'ws://localhost:8081'
      });
      await client1.connect();

      // Second connection should be rejected
      const client2 = new TraceStreamingClient({
        serverUrl: 'ws://localhost:8081'
      });
      
      await expect(client2.connect()).rejects.toThrow();
      client1.disconnect();
    });

    test('should handle heartbeat and ping/pong', async () => {
      const client = new TraceStreamingClient({
        serverUrl: 'ws://localhost:8081',
        heartbeatInterval: 1000
      });

      const heartbeats = [];
      client.on('heartbeat', (data) => {
        heartbeats.push(data);
      });

      await client.connect();
      
      // Wait for at least 2 heartbeats
      await new Promise(resolve => setTimeout(resolve, 2500));
      
      expect(heartbeats.length).toBeGreaterThanOrEqual(2);
      client.disconnect();
    });
  });

  describe('Event Broadcasting', () => {
    test('should broadcast trace events to subscribed clients', async () => {
      const client = new TraceStreamingClient({
        serverUrl: 'ws://localhost:8081'
      });

      const traceEvents = [];
      client.on('trace_event', (event) => {
        traceEvents.push(event);
      });

      await client.connect();
      client.subscribeToSession('test-session');

      // Wait for subscription to be processed
      await new Promise(resolve => setTimeout(resolve, 100));

      // Create and broadcast a trace event
      const testTrace: TraceEvent = {
        id: 'test-trace-1',
        timestamp: Date.now(),
        type: TraceEventType.AGENT_SPAWN,
        agentId: 'test-agent',
        swarmId: 'test-session',
        data: {
          agentType: 'test',
          capabilities: ['test']
        }
      };

      streamer.broadcastTraceEvent(testTrace);

      // Wait for event to be received
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(traceEvents.length).toBe(1);
      expect(traceEvents[0].id).toBe('test-trace-1');

      client.disconnect();
    });

    test('should broadcast system events', async () => {
      const client = new TraceStreamingClient({
        serverUrl: 'ws://localhost:8081'
      });

      const systemEvents = [];
      client.on('system_event', (event) => {
        systemEvents.push(event);
      });

      await client.connect();

      // Wait for connection to be established
      await new Promise(resolve => setTimeout(resolve, 100));

      // Broadcast a system event
      await streamer.broadcastSystemEvent('swarm:topology_change', {
        oldTopology: 'mesh',
        newTopology: 'hierarchical'
      });

      // Wait for event to be received
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(systemEvents.length).toBe(1);
      expect(systemEvents[0].event).toBe('swarm:topology_change');

      client.disconnect();
    });

    test('should handle event batching', async () => {
      const client = new TraceStreamingClient({
        serverUrl: 'ws://localhost:8081'
      });

      const receivedEvents = [];
      client.on('trace_event', (event) => {
        receivedEvents.push(event);
      });

      await client.connect();
      client.subscribeToSession('batch-test');

      // Wait for subscription
      await new Promise(resolve => setTimeout(resolve, 100));

      // Send multiple events quickly to trigger batching
      for (let i = 0; i < 15; i++) {
        const testTrace: TraceEvent = {
          id: `batch-trace-${i}`,
          timestamp: Date.now(),
          type: TraceEventType.TASK_START,
          agentId: 'batch-agent',
          swarmId: 'batch-test',
          data: { taskId: i }
        };
        streamer.broadcastTraceEvent(testTrace);
      }

      // Wait for all events to be received
      await new Promise(resolve => setTimeout(resolve, 2000));

      expect(receivedEvents.length).toBe(15);
      client.disconnect();
    });
  });

  describe('Client Filtering and Subscriptions', () => {
    test('should filter events by session subscription', async () => {
      const client = new TraceStreamingClient({
        serverUrl: 'ws://localhost:8081'
      });

      const receivedEvents = [];
      client.on('trace_event', (event) => {
        receivedEvents.push(event);
      });

      await client.connect();
      client.subscribeToSession('filtered-session');

      await new Promise(resolve => setTimeout(resolve, 100));

      // Send event for subscribed session (should receive)
      const subscribedTrace: TraceEvent = {
        id: 'subscribed-trace',
        timestamp: Date.now(),
        type: TraceEventType.AGENT_SPAWN,
        agentId: 'test-agent',
        swarmId: 'filtered-session',
        data: {}
      };

      // Send event for different session (should not receive)
      const unsubscribedTrace: TraceEvent = {
        id: 'unsubscribed-trace',
        timestamp: Date.now(),
        type: TraceEventType.AGENT_SPAWN,
        agentId: 'test-agent',
        swarmId: 'other-session',
        data: {}
      };

      streamer.broadcastTraceEvent(subscribedTrace);
      streamer.broadcastTraceEvent(unsubscribedTrace);

      await new Promise(resolve => setTimeout(resolve, 500));

      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0].id).toBe('subscribed-trace');

      client.disconnect();
    });

    test('should filter events by agent IDs', async () => {
      const client = new TraceStreamingClient({
        serverUrl: 'ws://localhost:8081'
      });

      const receivedEvents = [];
      client.on('trace_event', (event) => {
        receivedEvents.push(event);
      });

      await client.connect();
      client.subscribeToSession('agent-filter-test');
      client.filterAgents(['agent-1', 'agent-2']);

      await new Promise(resolve => setTimeout(resolve, 100));

      // Send events from different agents
      const allowedTrace: TraceEvent = {
        id: 'allowed-trace',
        timestamp: Date.now(),
        type: TraceEventType.TASK_START,
        agentId: 'agent-1',
        swarmId: 'agent-filter-test',
        data: {}
      };

      const blockedTrace: TraceEvent = {
        id: 'blocked-trace',
        timestamp: Date.now(),
        type: TraceEventType.TASK_START,
        agentId: 'agent-3',
        swarmId: 'agent-filter-test',
        data: {}
      };

      streamer.broadcastTraceEvent(allowedTrace);
      streamer.broadcastTraceEvent(blockedTrace);

      await new Promise(resolve => setTimeout(resolve, 500));

      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0].agentId).toBe('agent-1');

      client.disconnect();
    });
  });

  describe('Historical Data and Time Travel', () => {
    test('should send historical data on request', async () => {
      // First, store some historical data
      const historicalTrace: TraceEvent = {
        id: 'historical-trace',
        timestamp: Date.now() - 10000,
        type: TraceEventType.TASK_COMPLETE,
        agentId: 'history-agent',
        swarmId: 'history-session',
        data: { result: 'success' }
      };

      await storage.storeTrace(historicalTrace);
      await new Promise(resolve => setTimeout(resolve, 100));

      const client = new TraceStreamingClient({
        serverUrl: 'ws://localhost:8081'
      });

      const historicalData = [];
      client.on('historical_data', (data) => {
        historicalData.push(data);
      });

      await client.connect();
      client.subscribeToSession('history-session');
      
      await new Promise(resolve => setTimeout(resolve, 100));

      client.requestHistory({
        start: Date.now() - 20000,
        end: Date.now()
      });

      await new Promise(resolve => setTimeout(resolve, 1000));

      expect(historicalData.length).toBeGreaterThan(0);
      client.disconnect();
    });

    test('should handle time travel requests', async () => {
      const client = new TraceStreamingClient({
        serverUrl: 'ws://localhost:8081'
      });

      const timeTravelStates = [];
      client.on('time_travel_state', (state) => {
        timeTravelStates.push(state);
      });

      await client.connect();
      client.subscribeToSession('time-travel-test');

      await new Promise(resolve => setTimeout(resolve, 100));

      const targetTime = Date.now() - 5000;
      client.timeTravel(targetTime);

      await new Promise(resolve => setTimeout(resolve, 500));

      expect(timeTravelStates.length).toBe(1);
      expect(timeTravelStates[0].timestamp).toBe(targetTime);

      client.disconnect();
    });
  });

  describe('Rate Limiting', () => {
    test('should enforce rate limits when enabled', async () => {
      // Enable strict rate limiting
      const rateLimitConfig = {
        ...config,
        rateLimit: {
          windowMs: 1000,
          maxMessages: 3,
          maxBytesPerWindow: 1024
        }
      };

      await streamer.stop();
      streamer = new TraceStreamer(rateLimitConfig, eventBus, storage, {
        enabled: true,
        samplingRate: 1.0,
        bufferSize: 1000,
        flushInterval: 5000,
        storageRetention: 86400000,
        compressionEnabled: true,
        realtimeStreaming: true,
        performanceMonitoring: true
      });
      await streamer.start();
      await new Promise(resolve => setTimeout(resolve, 100));

      const client = new TraceStreamingClient({
        serverUrl: 'ws://localhost:8081'
      });

      const errors = [];
      client.on('server_error', (error) => {
        errors.push(error);
      });

      await client.connect();

      // Send messages rapidly to exceed rate limit
      for (let i = 0; i < 10; i++) {
        client.subscribeToSession(`session-${i}`);
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      // Should have received rate limit errors
      const rateLimitErrors = errors.filter(e => e.code === 'rate_limit_exceeded');
      expect(rateLimitErrors.length).toBeGreaterThan(0);

      client.disconnect();
    });
  });

  describe('Breakpoints', () => {
    test('should set and remove breakpoints', async () => {
      const client = new TraceStreamingClient({
        serverUrl: 'ws://localhost:8081'
      });

      const responses = [];
      client.on('connected', () => {
        // Set up message listener for all responses
        const originalOn = client.on.bind(client);
        client.on = (event, listener) => {
          if (typeof listener === 'function') {
            const wrappedListener = (data) => {
              if (data && (data.type === 'breakpoint_set' || data.type === 'breakpoint_removed')) {
                responses.push(data);
              }
              return listener(data);
            };
            return originalOn(event, wrappedListener);
          }
          return originalOn(event, listener);
        };
      });

      await client.connect();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Set breakpoint
      client.setBreakpoint('trace-123', 'data.status === "error"');

      // Remove breakpoint
      client.removeBreakpoint('trace-123');

      await new Promise(resolve => setTimeout(resolve, 500));

      client.disconnect();
    });
  });

  describe('Performance and Metrics', () => {
    test('should track streaming metrics', async () => {
      const client = new TraceStreamingClient({
        serverUrl: 'ws://localhost:8081'
      });

      await client.connect();
      client.subscribeToSession('metrics-test');

      // Generate some activity
      for (let i = 0; i < 5; i++) {
        const trace: TraceEvent = {
          id: `metrics-trace-${i}`,
          timestamp: Date.now(),
          type: TraceEventType.MESSAGE_SEND,
          agentId: 'metrics-agent',
          swarmId: 'metrics-test',
          data: { message: `Test message ${i}` }
        };
        streamer.broadcastTraceEvent(trace);
      }

      await new Promise(resolve => setTimeout(resolve, 1000));

      const metrics = streamer.getMetrics();
      expect(metrics.connectionsActive).toBe(1);
      expect(metrics.messagesSent).toBeGreaterThan(0);

      const clientMetrics = client.getMetrics();
      expect(clientMetrics.messagesReceived).toBeGreaterThan(0);

      client.disconnect();
    });

    test('should handle multiple concurrent clients', async () => {
      const clients = [];
      const numClients = 5;

      // Connect multiple clients
      for (let i = 0; i < numClients; i++) {
        const client = new TraceStreamingClient({
          serverUrl: 'ws://localhost:8081'
        });
        clients.push(client);
        await client.connect();
      }

      await new Promise(resolve => setTimeout(resolve, 200));

      const metrics = streamer.getMetrics();
      expect(metrics.connectionsActive).toBe(numClients);

      // Disconnect all clients
      for (const client of clients) {
        client.disconnect();
      }

      await new Promise(resolve => setTimeout(resolve, 100));

      const finalMetrics = streamer.getMetrics();
      expect(finalMetrics.connectionsActive).toBe(0);
    });
  });
});