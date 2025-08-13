/**
 * Real-time trace streaming with WebSocket support
 * Provides live updates to visualization clients
 */

import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
// import * as jwt from 'jsonwebtoken'; // Optional JWT support - uncomment if needed
import { 
  TraceEvent, 
  StreamEvent, 
  ClientMessage, 
  CompressedBatch,
  TimeRange,
  TracingConfig,
  TraceSession,
  RateLimitConfig,
  ClientRateLimit,
  ConnectionHealth,
  AuthConfig,
  ClientAuth,
  BinaryMessage,
  BackpressureConfig,
  ClientBackpressure
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
  auth?: AuthConfig;
  rateLimit?: RateLimitConfig;
  backpressure?: BackpressureConfig;
  binaryProtocol?: boolean;
  reconnectSupport?: boolean;
  historicalDataLimit?: number;
  compressionLevel?: number;
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
    messagesSent: 0,
    messagesSentBytes: 0,
    eventsQueued: 0,
    eventsDropped: 0,
    rateLimitHits: 0,
    backpressureEvents: 0,
    authFailures: 0,
    binaryMessages: 0
  };
  
  // Rate limiting and backpressure
  private rateLimiter = new Map<string, ClientRateLimit>();
  private backpressureMonitor = new Map<string, ClientBackpressure>();
  private connectionHealth = new Map<string, ConnectionHealth>();

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
      event: event.type as string,
      data: event,
      timestamp: Date.now(),
      sessionId: event.swarmId // Use swarmId as sessionId
    };
    
    this.eventBatcher.addEvent(streamEvent, async (batch) => {
      await this.broadcastToClients(batch);
    });
  }

  /**
   * Broadcast a system event
   */
  async broadcastSystemEvent(event: string, data: any): Promise<void> {
    const streamEvent: StreamEvent = {
      type: 'system_event',
      event,
      data,
      timestamp: Date.now(),
      sessionId: 'system'
    };
    
    await this.broadcastToClients(streamEvent);
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
    const clientIP = req.socket.remoteAddress || 'unknown';
    
    this.metrics.connectionsTotal++;
    
    // Check connection limit
    if (this.clients.size >= this.config.maxConnections) {
      this.logger.warn(`Connection limit reached, rejecting client from ${clientIP}`);
      ws.close(1008, 'Connection limit reached');
      return;
    }
    
    // Initialize rate limiting if enabled
    if (this.config.rateLimit) {
      this.rateLimiter.set(clientId, {
        windowStart: Date.now(),
        messageCount: 0,
        bytesCount: 0
      });
    }
    
    // Initialize backpressure monitoring if enabled
    if (this.config.backpressure) {
      this.backpressureMonitor.set(clientId, {
        queueSize: 0,
        isBlocked: false,
        lastDrop: 0,
        droppedCount: 0
      });
    }
    
    // Initialize connection health monitoring
    this.connectionHealth.set(clientId, {
      lastPing: Date.now(),
      lastPong: Date.now(),
      latency: 0,
      isHealthy: true
    });
    
    const client = new TraceClient(
      clientId, 
      ws, 
      this.logger, 
      this.config.auth,
      this.config.binaryProtocol
    );
    
    this.clients.set(clientId, client);
    this.metrics.connectionsActive++;
    
    this.logger.info(`New client connected: ${clientId} from ${clientIP} (${this.clients.size} total)`);
    
    // Set up client event handlers
    client.on('message', async (message: ClientMessage) => {
      if (await this.checkRateLimit(clientId, JSON.stringify(message).length)) {
        await this.handleClientMessage(client, message);
      }
    });
    
    client.on('close', () => {
      this.cleanupClient(clientId);
      this.logger.info(`Client disconnected: ${clientId} (${this.clients.size} remaining)`);
    });
    
    client.on('error', (error) => {
      this.logger.error(`Client error ${clientId}:`, error);
    });
    
    client.on('pong', () => {
      this.updateConnectionHealth(clientId);
    });
    
    // Send initial connection message with capabilities
    const capabilities = this.buildCapabilities();
    client.send({
      type: 'connection',
      clientId,
      serverInfo: {
        version: '2.0.0',
        capabilities,
        limits: {
          maxMessageSize: this.config.maxMessageSize,
          batchSize: this.config.batchSize
        },
        auth: this.config.auth?.enabled || false,
        binaryProtocol: this.config.binaryProtocol || false
      }
    });
    
    this.emit('client_connected', { clientId, client });
  }

  private async handleClientMessage(client: TraceClient, message: ClientMessage): Promise<void> {
    try {
      client.updateActivity();
      this.logger.debug(`Message from ${client.id}:`, message.type);
      
      // Handle authentication first
      if (message.type === 'auth') {
        const authenticated = await this.authenticateClient(client, message.token);
        client.send({
          type: 'auth_response',
          authenticated,
          timestamp: Date.now()
        });
        
        if (!authenticated) {
          client.close();
        }
        return;
      }
      
      // Check authentication for all other message types
      if (!client.isAuthenticated()) {
        client.sendError('not_authenticated', 'Authentication required');
        return;
      }
      
      switch (message.type) {
        case 'subscribe_session':
          if (message.sessionId) {
            await this.subscribeToSession(client, message.sessionId);
          } else {
            client.sendError('invalid_request', 'Session ID required');
          }
          break;
          
        case 'request_history':
          if (message.timeRange) {
            await this.sendHistoricalData(client, message.timeRange);
          } else {
            client.sendError('invalid_request', 'Time range required');
          }
          break;
          
        case 'time_travel':
          if (message.timestamp !== undefined) {
            await this.handleTimeTravel(client, message.timestamp);
          } else {
            client.sendError('invalid_request', 'Timestamp required');
          }
          break;
          
        case 'filter_agents':
          if (message.agentIds) {
            client.setAgentFilter(message.agentIds);
            client.send({
              type: 'filter_applied',
              agentIds: message.agentIds,
              timestamp: Date.now()
            });
          } else {
            client.sendError('invalid_request', 'Agent IDs required');
          }
          break;
          
        case 'set_breakpoint':
          if (message.traceId) {
            client.addBreakpoint(message.traceId, message.condition);
            client.send({
              type: 'breakpoint_set',
              traceId: message.traceId,
              condition: message.condition,
              timestamp: Date.now()
            });
          } else {
            client.sendError('invalid_request', 'Trace ID required');
          }
          break;
          
        case 'remove_breakpoint':
          if (message.traceId) {
            client.removeBreakpoint(message.traceId);
            client.send({
              type: 'breakpoint_removed',
              traceId: message.traceId,
              timestamp: Date.now()
            });
          } else {
            client.sendError('invalid_request', 'Trace ID required');
          }
          break;
          
        case 'heartbeat':
          client.send({
            type: 'heartbeat_response',
            timestamp: Date.now(),
            clientMetrics: this.getClientMetrics(client.id)
          });
          break;
          
        default:
          this.logger.warn(`Unknown message type: ${message.type}`);
          client.sendError('unknown_message_type', `Unknown message type: ${message.type}`);
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
      const limit = this.config.historicalDataLimit || 1000;
      const traces = await this.storage.getTracesBySession(client.currentSession, {
        timeRange,
        limit
      });
      
      // Send data in chunks to avoid overwhelming the client
      const chunkSize = 100;
      const totalChunks = Math.ceil(traces.length / chunkSize);
      
      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, traces.length);
        const chunk = traces.slice(start, end);
        
        const message = {
          type: 'historical_data',
          timeRange,
          traces: chunk,
          chunkInfo: {
            current: i + 1,
            total: totalChunks,
            isLast: i === totalChunks - 1
          },
          total: traces.length,
          timestamp: Date.now()
        };
        
        if (this.config.backpressure && client.getWebSocket().bufferedAmount > this.config.backpressure.highWaterMark) {
          // Queue message if client is under backpressure
          client.queueMessage(message);
        } else {
          client.send(message);
        }
        
        // Small delay between chunks to prevent overwhelming
        if (i < totalChunks - 1) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
      
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

  private async broadcastToClients(message: any): Promise<void> {
    const serialized = JSON.stringify(message);
    let data: Buffer | string = serialized;
    
    if (this.config.compressionEnabled) {
      data = gzipSync(serialized);
    }
    
    let successCount = 0;
    let errorCount = 0;
    let backpressureCount = 0;
    
    const promises: Promise<void>[] = [];
    
    for (const client of this.clients.values()) {
      if (client.isInterestedIn(message)) {
        const sendPromise = this.sendToClientWithBackpressure(client, data)
          .then(() => {
            successCount++;
          })
          .catch((error) => {
            if (error.message.includes('backpressure')) {
              backpressureCount++;
              this.metrics.backpressureEvents++;
            } else {
              errorCount++;
              this.logger.debug(`Failed to send to client ${client.id}:`, error);
            }
          });
        
        promises.push(sendPromise);
      }
    }
    
    await Promise.allSettled(promises);
    
    this.metrics.messagesSent += successCount;
    this.metrics.messagesSentBytes += (typeof data === 'string' ? Buffer.byteLength(data) : data.length) * successCount;
    
    if (errorCount > 0) {
      this.logger.warn(`Failed to send message to ${errorCount} clients`);
    }
    
    if (backpressureCount > 0) {
      this.logger.debug(`Backpressure affected ${backpressureCount} clients`);
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(async () => {
      const now = Date.now();
      
      // Send heartbeat and ping clients
      const heartbeatPromises: Promise<void>[] = [];
      
      for (const client of this.clients.values()) {
        heartbeatPromises.push(
          this.sendHeartbeatToClient(client, now)
        );
      }
      
      await Promise.allSettled(heartbeatPromises);
      
      // Clean up stale connections
      this.cleanupStaleConnections(now);
      
      // Reset rate limit windows
      this.resetRateLimitWindows(now);
      
    }, this.config.heartbeatInterval);
  }
  
  // New helper methods for enhanced functionality
  
  private buildCapabilities(): string[] {
    const capabilities = ['real-time', 'time-travel', 'compression', 'batching'];
    
    if (this.config.auth?.enabled) {
      capabilities.push('authentication');
    }
    
    if (this.config.binaryProtocol) {
      capabilities.push('binary-protocol');
    }
    
    if (this.config.rateLimit) {
      capabilities.push('rate-limiting');
    }
    
    if (this.config.backpressure) {
      capabilities.push('backpressure-handling');
    }
    
    if (this.config.reconnectSupport) {
      capabilities.push('auto-reconnect');
    }
    
    return capabilities;
  }
  
  private async checkRateLimit(clientId: string, messageSize: number): Promise<boolean> {
    if (!this.config.rateLimit) {
      return true;
    }
    
    const now = Date.now();
    const limit = this.rateLimiter.get(clientId);
    
    if (!limit) {
      return true;
    }
    
    // Reset window if expired
    if (now - limit.windowStart >= this.config.rateLimit.windowMs) {
      limit.windowStart = now;
      limit.messageCount = 0;
      limit.bytesCount = 0;
    }
    
    // Check limits
    if (limit.messageCount >= this.config.rateLimit.maxMessages ||
        limit.bytesCount + messageSize > this.config.rateLimit.maxBytesPerWindow) {
      this.metrics.rateLimitHits++;
      
      const client = this.clients.get(clientId);
      if (client) {
        client.sendError('rate_limit_exceeded', 'Rate limit exceeded');
      }
      
      return false;
    }
    
    // Update counters
    limit.messageCount++;
    limit.bytesCount += messageSize;
    
    return true;
  }
  
  private async sendToClientWithBackpressure(client: TraceClient, data: Buffer | string): Promise<void> {
    if (!this.config.backpressure) {
      client.sendRaw(data);
      return;
    }
    
    const backpressure = this.backpressureMonitor.get(client.id);
    if (!backpressure) {
      client.sendRaw(data);
      return;
    }
    
    // Check if client is under backpressure
    if (backpressure.isBlocked) {
      if (this.config.backpressure.dropOldest && 
          backpressure.queueSize >= this.config.backpressure.maxQueueSize) {
        backpressure.droppedCount++;
        backpressure.lastDrop = Date.now();
        this.metrics.eventsDropped++;
        throw new Error('backpressure: message dropped');
      }
    }
    
    // Monitor queue size (WebSocket internal buffer)
    const ws = client.getWebSocket();
    if (ws && ws.bufferedAmount > this.config.backpressure.highWaterMark) {
      backpressure.isBlocked = true;
      backpressure.queueSize = ws.bufferedAmount;
    } else if (ws && ws.bufferedAmount < this.config.backpressure.lowWaterMark) {
      backpressure.isBlocked = false;
      backpressure.queueSize = ws.bufferedAmount;
    }
    
    client.sendRaw(data);
  }
  
  private async sendHeartbeatToClient(client: TraceClient, timestamp: number): Promise<void> {
    try {
      // Send heartbeat
      client.send({
        type: 'heartbeat',
        timestamp,
        metrics: this.getClientMetrics(client.id)
      });
      
      // Send ping for connection health
      client.ping();
      
    } catch (error) {
      this.logger.debug(`Failed to send heartbeat to client ${client.id}:`, error);
    }
  }
  
  private getClientMetrics(clientId: string): any {
    const backpressure = this.backpressureMonitor.get(clientId);
    const health = this.connectionHealth.get(clientId);
    const rateLimit = this.rateLimiter.get(clientId);
    
    return {
      clientId,
      backpressure: backpressure ? {
        queueSize: backpressure.queueSize,
        isBlocked: backpressure.isBlocked,
        droppedCount: backpressure.droppedCount
      } : null,
      health: health ? {
        latency: health.latency,
        isHealthy: health.isHealthy
      } : null,
      rateLimit: rateLimit ? {
        messageCount: rateLimit.messageCount,
        bytesCount: rateLimit.bytesCount
      } : null
    };
  }
  
  private cleanupClient(clientId: string): void {
    this.clients.delete(clientId);
    this.rateLimiter.delete(clientId);
    this.backpressureMonitor.delete(clientId);
    this.connectionHealth.delete(clientId);
    this.metrics.connectionsActive--;
  }
  
  private cleanupStaleConnections(now: number): void {
    const staleTimeout = 60000; // 60 seconds
    
    for (const [clientId, health] of this.connectionHealth.entries()) {
      if (now - health.lastPong > staleTimeout) {
        health.isHealthy = false;
        
        const client = this.clients.get(clientId);
        if (client) {
          this.logger.info(`Terminating stale connection: ${clientId}`);
          client.close();
        }
      }
    }
  }
  
  private updateConnectionHealth(clientId: string): void {
    const health = this.connectionHealth.get(clientId);
    if (health) {
      const now = Date.now();
      health.lastPong = now;
      health.latency = now - health.lastPing;
      health.isHealthy = true;
    }
  }
  
  private resetRateLimitWindows(now: number): void {
    if (!this.config.rateLimit) return;
    
    for (const [clientId, limit] of this.rateLimiter.entries()) {
      if (now - limit.windowStart >= this.config.rateLimit.windowMs) {
        limit.windowStart = now;
        limit.messageCount = 0;
        limit.bytesCount = 0;
      }
    }
  }
  
  // Enhanced authentication helper
  private async authenticateClient(client: TraceClient, token?: string): Promise<boolean> {
    if (!this.config.auth?.enabled) {
      return true;
    }
    
    if (!token) {
      this.metrics.authFailures++;
      return false;
    }
    
    try {
      if (this.config.auth.validApiKeys?.has(token)) {
        client.setAuth({
          authenticated: true,
          userId: `api-key-${token.substring(0, 8)}`,
          permissions: ['read', 'subscribe']
        });
        return true;
      }
      
      // JWT validation would go here if enabled
      if (this.config.auth.jwtSecret) {
        // JWT validation implementation
        // This would require a JWT library like jsonwebtoken
        // const decoded = jwt.verify(token, this.config.auth.jwtSecret);
        // client.setAuth({
        //   authenticated: true,
        //   userId: decoded.sub,
        //   permissions: decoded.permissions || ['read'],
        //   expiresAt: decoded.exp * 1000
        // });
        // return true;
      }
      
    } catch (error) {
      this.logger.error('Authentication error:', error);
    }
    
    this.metrics.authFailures++;
    return false;
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
  private authConfig?: AuthConfig;
  private binaryProtocol: boolean;
  private auth: ClientAuth = { authenticated: false };
  
  // Message queue for backpressure handling
  private messageQueue: Array<{ data: any; timestamp: number }> = [];
  private lastActivity = Date.now();

  constructor(
    id: string, 
    ws: WebSocket, 
    logger: Logger,
    authConfig?: AuthConfig,
    binaryProtocol?: boolean
  ) {
    super();
    
    this.id = id;
    this.ws = ws;
    this.logger = logger;
    this.authConfig = authConfig;
    this.binaryProtocol = binaryProtocol || false;
    
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
    // Check authentication first
    if (!this.isAuthenticated()) {
      return false;
    }
    
    // Check session subscription
    if (message.sessionId && !this.subscriptions.has(message.sessionId)) {
      return false;
    }
    
    // Check agent filter
    if (this.agentFilter && message.data?.agentId) {
      return this.agentFilter.includes(message.data.agentId);
    }
    
    // Check permissions
    if (this.auth.permissions && message.type === 'system_event') {
      return this.auth.permissions.includes('admin');
    }
    
    return true;
  }

  close(): void {
    this.ws.close();
  }
  
  ping(): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.ping();
    }
  }
  
  getWebSocket(): WebSocket {
    return this.ws;
  }
  
  setAuth(auth: ClientAuth): void {
    this.auth = auth;
  }
  
  getAuth(): ClientAuth {
    return this.auth;
  }
  
  isAuthenticated(): boolean {
    if (!this.authConfig?.enabled) {
      return true;
    }
    
    if (!this.auth.authenticated) {
      return false;
    }
    
    // Check expiration
    if (this.auth.expiresAt && Date.now() > this.auth.expiresAt) {
      this.auth.authenticated = false;
      return false;
    }
    
    return true;
  }
  
  updateActivity(): void {
    this.lastActivity = Date.now();
  }
  
  getLastActivity(): number {
    return this.lastActivity;
  }
  
  // Enhanced binary protocol support
  sendBinary(message: BinaryMessage): void {
    if (!this.binaryProtocol || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    
    const header = Buffer.allocUnsafe(12); // type(4) + length(4) + checksum(4)
    header.writeUInt32LE(message.type, 0);
    header.writeUInt32LE(message.length, 4);
    header.writeUInt32LE(message.checksum, 8);
    
    const fullMessage = Buffer.concat([header, message.data]);
    this.ws.send(fullMessage);
  }
  
  // Queue management for backpressure
  queueMessage(data: any): void {
    this.messageQueue.push({
      data,
      timestamp: Date.now()
    });
  }
  
  flushQueue(maxMessages = 10): number {
    let sent = 0;
    while (this.messageQueue.length > 0 && sent < maxMessages) {
      const message = this.messageQueue.shift()!;
      try {
        this.send(message.data);
        sent++;
      } catch (error) {
        // Re-queue message if send fails
        this.messageQueue.unshift(message);
        break;
      }
    }
    return sent;
  }
  
  getQueueSize(): number {
    return this.messageQueue.length;
  }
  
  clearQueue(): void {
    this.messageQueue = [];
  }

  private setupWebSocket(): void {
    this.ws.on('message', (data) => {
      this.updateActivity();
      
      try {
        let message: any;
        
        if (this.binaryProtocol && Buffer.isBuffer(data) && data.length > 12) {
          // Handle binary protocol
          message = this.parseBinaryMessage(data);
        } else {
          // Handle JSON protocol
          message = JSON.parse(data.toString());
        }
        
        this.emit('message', message);
      } catch (error) {
        this.logger.error(`Invalid message from client ${this.id}:`, error);
        this.sendError('invalid_message', 'Invalid message format');
      }
    });
    
    this.ws.on('close', (code, reason) => {
      this.isAlive = false;
      this.clearQueue();
      this.logger.debug(`Client ${this.id} closed connection: ${code} - ${reason}`);
      this.emit('close');
    });
    
    this.ws.on('error', (error) => {
      this.logger.error(`WebSocket error for client ${this.id}:`, error);
      this.emit('error', error);
    });
    
    this.ws.on('pong', () => {
      this.isAlive = true;
      this.emit('pong');
    });
    
    // Set up ping/pong for connection health with enhanced monitoring
    const pingInterval = setInterval(() => {
      if (!this.isAlive) {
        this.logger.info(`Terminating unresponsive client: ${this.id}`);
        this.ws.terminate();
        clearInterval(pingInterval);
        return;
      }
      
      if (this.ws.readyState === WebSocket.OPEN) {
        this.isAlive = false;
        this.ws.ping();
      }
    }, 30000);
    
    // Clean up interval on close
    this.ws.on('close', () => {
      clearInterval(pingInterval);
    });
  }
  
  private parseBinaryMessage(data: Buffer): any {
    if (data.length < 12) {
      throw new Error('Invalid binary message: header too short');
    }
    
    const type = data.readUInt32LE(0);
    const length = data.readUInt32LE(4);
    const checksum = data.readUInt32LE(8);
    
    if (data.length !== length + 12) {
      throw new Error('Invalid binary message: length mismatch');
    }
    
    const payload = data.slice(12);
    
    // Simple checksum validation (could be enhanced with CRC32)
    const calculatedChecksum = this.simpleChecksum(payload);
    if (calculatedChecksum !== checksum) {
      throw new Error('Invalid binary message: checksum mismatch');
    }
    
    // Parse payload based on message type
    try {
      return JSON.parse(payload.toString('utf8'));
    } catch (error) {
      throw new Error('Invalid binary message: payload not valid JSON');
    }
  }
  
  private simpleChecksum(data: Buffer): number {
    let checksum = 0;
    for (let i = 0; i < data.length; i++) {
      checksum = ((checksum + data[i]) & 0xFFFFFFFF) >>> 0;
    }
    return checksum;
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

  addEvent(event: StreamEvent, callback: (batch: CompressedBatch) => Promise<void>): void {
    const key = event.sessionId || 'default';
    
    if (!this.batches.has(key)) {
      this.batches.set(key, []);
    }
    
    const batch = this.batches.get(key)!;
    batch.push(event);
    
    if (batch.length >= this.config.batchSize) {
      await this.flushBatch(key, callback);
    } else if (!this.timers.has(key)) {
      const timer = setTimeout(async () => {
        await this.flushBatch(key, callback);
      }, this.config.batchTimeout);
      this.timers.set(key, timer);
    }
  }

  getMetrics(): any {
    return { ...this.metrics };
  }

  private async flushBatch(key: string, callback: (batch: CompressedBatch) => Promise<void>): Promise<void> {
    const batch = this.batches.get(key);
    if (!batch || batch.length === 0) return;
    
    const compressed = this.compressBatch(batch);
    await callback(compressed);
    
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