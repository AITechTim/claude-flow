/**
 * Real-time trace streaming with WebSocket support
 * Provides live updates to visualization clients
 */

import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { 
  TraceEvent, 
  StreamEvent, 
  ClientMessage, 
  CompressedBatch,
  TimeRange,
  TracingConfig 
} from '../types.js';
import { Logger } from '../../core/logger.js';
import { generateId } from '../../utils/helpers.js';
import { EventBus } from '../../core/event-bus.js';
import { TraceStorage } from '../storage/trace-storage.js';

export interface StreamingConfig {
  enabled: boolean;
  port: number;
  maxConnections: number;
  heartbeatInterval: number;
  compressionEnabled: boolean;
  batchSize: number;
  batchTimeout: number;
  maxMessageSize: number;
}

export class TraceStreamer extends EventEmitter {
  private wss?: WebSocketServer;
  private clients = new Map<string, TraceClient>();
  private config: StreamingConfig;
  private logger: Logger;
  private eventBus: EventBus;
  private storage: TraceStorage;
  
  // Event batching
  private eventBatcher: EventBatcher;
  private heartbeatTimer?: NodeJS.Timeout;
  
  // Performance monitoring
  private metrics = {
    connectionsTotal: 0,
    connectionsActive: 0,
    messagessSent: 0,
    messagesSentBytes: 0,
    eventsQueued: 0,
    eventsDropped: 0
  };

  constructor(
    config: StreamingConfig,
    eventBus: EventBus,
    storage: TraceStorage,
    tracingConfig: TracingConfig
  ) {
    super();
    
    this.config = config;
    this.logger = new Logger('TraceStreamer');
    this.eventBus = eventBus;
    this.storage = storage;
    
    this.eventBatcher = new EventBatcher({
      batchSize: config.batchSize,
      batchTimeout: config.batchTimeout,
      compressionEnabled: config.compressionEnabled
    });
    
    if (config.enabled) {
      this.setupWebSocketServer();
      this.setupEventListeners();
      this.startHeartbeat();
    }
  }

  /**
   * Start the streaming server
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info('Streaming disabled in configuration');
      return;
    }
    
    if (this.wss) {
      this.logger.warn('Streaming server already started');
      return;
    }
    
    this.logger.info(`Starting trace streaming server on port ${this.config.port}`);
    this.setupWebSocketServer();
    this.emit('started');
  }

  /**
   * Stop the streaming server
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping trace streaming server');
    
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    
    // Gracefully close all client connections
    for (const client of this.clients.values()) {
      client.close();
    }
    
    if (this.wss) {
      this.wss.close();
      this.wss = undefined;
    }
    
    this.emit('stopped');
  }

  /**
   * Broadcast a trace event to interested clients
   */
  broadcastTraceEvent(event: TraceEvent): void {
    const streamEvent: StreamEvent = {
      type: 'trace_event',
      event: event.type,
      data: event,
      timestamp: Date.now(),
      sessionId: event.sessionId
    };
    
    this.eventBatcher.addEvent(streamEvent, (batch) => {
      this.broadcastToClients(batch);
    });
  }

  /**
   * Broadcast a system event
   */
  broadcastSystemEvent(event: string, data: any): void {
    const streamEvent: StreamEvent = {
      type: 'system_event',
      event,
      data,
      timestamp: Date.now(),
      sessionId: 'system'
    };
    
    this.broadcastToClients(streamEvent);
  }

  /**
   * Get streaming metrics
   */
  getMetrics(): any {
    return {
      ...this.metrics,
      clients: this.clients.size,
      batcher: this.eventBatcher.getMetrics()
    };
  }

  // Private methods

  private setupWebSocketServer(): void {
    this.wss = new WebSocketServer({ 
      port: this.config.port,
      maxPayload: this.config.maxMessageSize
    });
    
    this.wss.on('connection', (ws, req) => {
      this.handleNewConnection(ws, req);
    });
    
    this.wss.on('error', (error) => {
      this.logger.error('WebSocket server error:', error);
      this.emit('error', error);
    });
    
    this.logger.info(`WebSocket server listening on port ${this.config.port}`);
  }

  private handleNewConnection(ws: WebSocket, req: any): void {
    const clientId = generateId('client');
    const client = new TraceClient(clientId, ws, this.logger);
    
    this.metrics.connectionsTotal++;
    this.metrics.connectionsActive++;
    
    // Check connection limit
    if (this.clients.size >= this.config.maxConnections) {
      this.logger.warn(`Connection limit reached, rejecting client ${clientId}`);
      ws.close(1008, 'Connection limit reached');
      return;
    }
    
    this.clients.set(clientId, client);
    
    this.logger.info(`New client connected: ${clientId} (${this.clients.size} total)`);
    
    // Set up client event handlers
    client.on('message', (message: ClientMessage) => {
      this.handleClientMessage(client, message);
    });
    
    client.on('close', () => {
      this.clients.delete(clientId);
      this.metrics.connectionsActive--;
      this.logger.info(`Client disconnected: ${clientId} (${this.clients.size} remaining)`);
    });
    
    client.on('error', (error) => {
      this.logger.error(`Client error ${clientId}:`, error);
    });
    
    // Send initial connection message
    client.send({
      type: 'connection',
      clientId,
      serverInfo: {
        version: '1.0.0',
        capabilities: ['real-time', 'time-travel', 'compression'],
        limits: {
          maxMessageSize: this.config.maxMessageSize,
          batchSize: this.config.batchSize
        }
      }
    });
    
    this.emit('client_connected', { clientId, client });
  }

  private async handleClientMessage(client: TraceClient, message: ClientMessage): Promise<void> {
    try {
      this.logger.debug(`Message from ${client.id}:`, message.type);
      
      switch (message.type) {
        case 'subscribe_session':
          await this.subscribeToSession(client, message.sessionId!);
          break;
          
        case 'request_history':
          await this.sendHistoricalData(client, message.timeRange!);
          break;
          
        case 'time_travel':
          await this.handleTimeTravel(client, message.timestamp!);
          break;
          
        case 'filter_agents':
          client.setAgentFilter(message.agentIds!);
          break;
          
        case 'set_breakpoint':
          client.addBreakpoint(message.traceId!, message.condition);
          break;
          
        default:
          this.logger.warn(`Unknown message type: ${message.type}`);
      }
    } catch (error) {
      this.logger.error('Error handling client message:', error);
      client.sendError('message_error', error instanceof Error ? error.message : String(error));
    }
  }

  private async subscribeToSession(client: TraceClient, sessionId: string): Promise<void> {
    client.subscribeToSession(sessionId);
    
    // Send initial session state
    try {
      const session = await this.storage.getSession(sessionId);
      if (session) {
        client.send({
          type: 'session_info',
          session
        });
      }
      
      // Send recent traces
      const recentTraces = await this.storage.getTracesBySession(sessionId, {
        limit: 100
      });
      
      if (recentTraces.length > 0) {
        client.send({
          type: 'initial_traces',
          traces: recentTraces
        });
      }
      
    } catch (error) {
      this.logger.error('Error sending initial session state:', error);
      client.sendError('session_error', 'Failed to load session data');
    }
  }

  private async sendHistoricalData(client: TraceClient, timeRange: TimeRange): Promise<void> {
    if (!client.currentSession) {
      client.sendError('no_session', 'No session subscribed');
      return;
    }
    
    try {
      const traces = await this.storage.getTracesBySession(client.currentSession, {
        timeRange,
        limit: 1000 // Prevent overwhelming the client
      });
      
      client.send({
        type: 'historical_data',
        timeRange,
        traces,
        total: traces.length
      });
      
    } catch (error) {
      this.logger.error('Error sending historical data:', error);
      client.sendError('history_error', 'Failed to load historical data');
    }
  }

  private async handleTimeTravel(client: TraceClient, timestamp: number): Promise<void> {
    if (!client.currentSession) {
      client.sendError('no_session', 'No session subscribed');
      return;
    }
    
    try {
      // Get traces up to the specified timestamp
      const traces = await this.storage.getTracesBySession(client.currentSession, {
        timeRange: { start: 0, end: timestamp },
        limit: 1000
      });
      
      client.send({
        type: 'time_travel_state',
        timestamp,
        traces,
        total: traces.length
      });
      
    } catch (error) {
      this.logger.error('Error handling time travel:', error);
      client.sendError('time_travel_error', 'Failed to load time travel state');
    }
  }

  private setupEventListeners(): void {
    // Listen for trace events from the event bus
    this.eventBus.on('trace:*', (event: string, data: any) => {
      if (data && data.trace) {
        this.broadcastTraceEvent(data.trace);
      }
    });
    
    // Listen for agent events
    this.eventBus.on('agent:*', (event: string, data: any) => {
      this.broadcastSystemEvent(event, data);
    });
    
    // Listen for system events
    this.eventBus.on('swarm:*', (event: string, data: any) => {
      this.broadcastSystemEvent(event, data);
    });
    
    // Listen for performance events
    this.eventBus.on('performance:*', (event: string, data: any) => {
      this.broadcastSystemEvent(event, data);
    });
  }

  private broadcastToClients(message: any): void {
    const serialized = JSON.stringify(message);
    const compressed = this.config.compressionEnabled ? gzipSync(serialized) : serialized;
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const client of this.clients.values()) {
      if (client.isInterestedIn(message)) {
        try {
          client.sendRaw(compressed);
          successCount++;
        } catch (error) {
          errorCount++;
          this.logger.debug(`Failed to send to client ${client.id}:`, error);
        }
      }
    }
    
    this.metrics.messagessSent += successCount;
    this.metrics.messagesSentBytes += compressed.length * successCount;
    
    if (errorCount > 0) {
      this.logger.warn(`Failed to send message to ${errorCount} clients`);
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.broadcastToClients({
        type: 'heartbeat',
        timestamp: Date.now(),
        metrics: this.getMetrics()
      });
    }, this.config.heartbeatInterval);
  }
}

/**
 * Individual client connection wrapper
 */
class TraceClient extends EventEmitter {
  public readonly id: string;
  public currentSession?: string;
  
  private ws: WebSocket;
  private logger: Logger;
  private subscriptions = new Set<string>();
  private agentFilter?: string[];
  private breakpoints = new Map<string, string>(); // traceId -> condition
  private isAlive = true;

  constructor(id: string, ws: WebSocket, logger: Logger) {
    super();
    
    this.id = id;
    this.ws = ws;
    this.logger = logger;
    
    this.setupWebSocket();
  }

  send(message: any): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  sendRaw(data: Buffer | string): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  sendError(code: string, message: string): void {
    this.send({
      type: 'error',
      error: { code, message },
      timestamp: Date.now()
    });
  }

  subscribeToSession(sessionId: string): void {
    this.currentSession = sessionId;
    this.subscriptions.add(sessionId);
  }

  setAgentFilter(agentIds: string[]): void {
    this.agentFilter = agentIds;
  }

  addBreakpoint(traceId: string, condition?: string): void {
    this.breakpoints.set(traceId, condition || 'true');
  }

  removeBreakpoint(traceId: string): void {
    this.breakpoints.delete(traceId);
  }

  isInterestedIn(message: any): boolean {
    // Check session subscription
    if (message.sessionId && !this.subscriptions.has(message.sessionId)) {
      return false;
    }
    
    // Check agent filter
    if (this.agentFilter && message.data?.agentId) {
      return this.agentFilter.includes(message.data.agentId);
    }
    
    return true;
  }

  close(): void {
    this.ws.close();
  }

  private setupWebSocket(): void {
    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.emit('message', message);
      } catch (error) {
        this.logger.error(`Invalid JSON from client ${this.id}:`, error);
        this.sendError('invalid_json', 'Invalid JSON message');
      }
    });
    
    this.ws.on('close', () => {
      this.isAlive = false;
      this.emit('close');
    });
    
    this.ws.on('error', (error) => {
      this.emit('error', error);
    });
    
    this.ws.on('pong', () => {
      this.isAlive = true;
    });
    
    // Set up ping/pong for connection health
    const pingInterval = setInterval(() => {
      if (!this.isAlive) {
        this.ws.terminate();
        clearInterval(pingInterval);
        return;
      }
      
      this.isAlive = false;
      this.ws.ping();
    }, 30000);
  }
}

/**
 * Event batching for efficient streaming
 */
class EventBatcher {
  private config: {
    batchSize: number;
    batchTimeout: number;
    compressionEnabled: boolean;
  };
  
  private batches = new Map<string, StreamEvent[]>();
  private timers = new Map<string, NodeJS.Timeout>();
  private metrics = {
    batchesCreated: 0,
    eventsProcessed: 0,
    compressionRatio: 0
  };

  constructor(config: {
    batchSize: number;
    batchTimeout: number;
    compressionEnabled: boolean;
  }) {
    this.config = config;
  }

  addEvent(event: StreamEvent, callback: (batch: CompressedBatch) => void): void {
    const key = event.sessionId || 'default';
    
    if (!this.batches.has(key)) {
      this.batches.set(key, []);
    }
    
    const batch = this.batches.get(key)!;
    batch.push(event);
    
    if (batch.length >= this.config.batchSize) {
      this.flushBatch(key, callback);
    } else if (!this.timers.has(key)) {
      const timer = setTimeout(() => {
        this.flushBatch(key, callback);
      }, this.config.batchTimeout);
      this.timers.set(key, timer);
    }
  }

  getMetrics(): any {
    return { ...this.metrics };
  }

  private flushBatch(key: string, callback: (batch: CompressedBatch) => void): void {
    const batch = this.batches.get(key);
    if (!batch || batch.length === 0) return;
    
    const compressed = this.compressBatch(batch);
    callback(compressed);
    
    this.batches.delete(key);
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
    
    this.metrics.batchesCreated++;
    this.metrics.eventsProcessed += batch.length;
  }

  private compressBatch(events: StreamEvent[]): CompressedBatch {
    if (!this.config.compressionEnabled) {
      return {
        events: events as any,
        compression: 'none',
        timestamp: Date.now()
      };
    }
    
    // Simple delta compression
    const compressed = events.map((event, index) => {
      const prev = index > 0 ? events[index - 1] : null;
      
      return {
        id: event.data?.id || generateId('event'),
        t: event.timestamp,
        a: event.data?.agentId,
        type: event.event,
        data: this.deltaCompress(event.data, prev?.data)
      };
    });
    
    return {
      events: compressed,
      compression: 'delta',
      timestamp: Date.now(),
      checksum: this.calculateChecksum(compressed)
    };
  }

  private deltaCompress(current: any, previous?: any): any {
    if (!previous || typeof current !== 'object') {
      return current;
    }
    
    // Simple delta compression - only include changed fields
    const delta: any = {};
    for (const [key, value] of Object.entries(current)) {
      if (JSON.stringify(value) !== JSON.stringify(previous[key])) {
        delta[key] = value;
      }
    }
    
    return Object.keys(delta).length > 0 ? delta : null;
  }

  private calculateChecksum(data: any): string {
    return createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex')
      .substring(0, 16);
  }
}