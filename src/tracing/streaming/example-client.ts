/**
 * Example WebSocket client for testing trace streaming
 * Demonstrates all client features including authentication, backpressure, and binary protocol
 */

import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import { Logger } from '../../core/logger.js';
import type { StreamEvent, ClientMessage, BinaryMessage } from '../types.js';

export interface ClientConfig {
  serverUrl: string;
  authToken?: string;
  binaryProtocol?: boolean;
  reconnectAttempts?: number;
  reconnectDelay?: number;
  heartbeatInterval?: number;
}

export class TraceStreamingClient extends EventEmitter {
  private ws?: WebSocket;
  private config: ClientConfig;
  private logger: Logger;
  private clientId?: string;
  private authenticated = false;
  private reconnectCount = 0;
  private heartbeatTimer?: NodeJS.Timeout;
  private connectionState: 'disconnected' | 'connecting' | 'connected' | 'authenticated' = 'disconnected';
  
  // Client-side metrics
  private metrics = {
    messagesReceived: 0,
    bytesReceived: 0,
    reconnections: 0,
    authFailures: 0,
    errors: 0
  };

  constructor(config: ClientConfig) {
    super();
    this.config = {
      reconnectAttempts: 5,
      reconnectDelay: 1000,
      heartbeatInterval: 30000,
      ...config
    };
    this.logger = new Logger({
      level: 'info',
      format: 'text',
      destination: 'console'
    }, { component: 'TraceStreamingClient' });
  }

  /**
   * Connect to the WebSocket server
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.connectionState = 'connecting';
      this.logger.info(`Connecting to ${this.config.serverUrl}`);
      
      this.ws = new WebSocket(this.config.serverUrl);
      
      this.ws.on('open', () => {
        this.connectionState = 'connected';
        this.reconnectCount = 0;
        this.logger.info('Connected to trace streaming server');
        
        this.setupMessageHandlers();
        this.startHeartbeat();
        
        // Authenticate if token provided
        if (this.config.authToken) {
          this.authenticate(this.config.authToken);
        } else {
          this.authenticated = true;
          this.connectionState = 'authenticated';
        }
        
        resolve();
      });
      
      this.ws.on('error', (error) => {
        this.metrics.errors++;
        this.logger.error('WebSocket error:', error);
        reject(error);
      });
      
      this.ws.on('close', (code, reason) => {
        this.connectionState = 'disconnected';
        this.authenticated = false;
        
        if (this.heartbeatTimer) {
          clearInterval(this.heartbeatTimer);
        }
        
        this.logger.info(`Disconnected: ${code} - ${reason}`);
        this.emit('disconnected', { code, reason });
        
        // Auto-reconnect if enabled
        if (this.config.reconnectAttempts && this.reconnectCount < this.config.reconnectAttempts) {
          this.scheduleReconnect();
        }
      });
    });
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
    }
  }

  /**
   * Subscribe to a specific session
   */
  subscribeToSession(sessionId: string): void {
    this.sendMessage({
      type: 'subscribe_session',
      sessionId
    });
  }

  /**
   * Request historical data for a time range
   */
  requestHistory(timeRange: { start: number; end: number }): void {
    this.sendMessage({
      type: 'request_history',
      timeRange
    });
  }

  /**
   * Perform time travel to a specific timestamp
   */
  timeTravel(timestamp: number): void {
    this.sendMessage({
      type: 'time_travel',
      timestamp
    });
  }

  /**
   * Filter events by agent IDs
   */
  filterAgents(agentIds: string[]): void {
    this.sendMessage({
      type: 'filter_agents',
      agentIds
    });
  }

  /**
   * Set a breakpoint on a trace ID
   */
  setBreakpoint(traceId: string, condition?: string): void {
    this.sendMessage({
      type: 'set_breakpoint',
      traceId,
      condition
    });
  }

  /**
   * Remove a breakpoint
   */
  removeBreakpoint(traceId: string): void {
    this.sendMessage({
      type: 'remove_breakpoint',
      traceId
    });
  }

  /**
   * Get client metrics
   */
  getMetrics(): any {
    return {
      ...this.metrics,
      connectionState: this.connectionState,
      authenticated: this.authenticated,
      clientId: this.clientId
    };
  }

  // Private methods

  private authenticate(token: string): void {
    this.sendMessage({
      type: 'auth',
      token
    });
  }

  private sendMessage(message: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.warn('Cannot send message: WebSocket not connected');
      return;
    }

    try {
      if (this.config.binaryProtocol) {
        this.sendBinaryMessage(message);
      } else {
        this.ws.send(JSON.stringify(message));
      }
    } catch (error) {
      this.logger.error('Failed to send message:', error);
    }
  }

  private sendBinaryMessage(message: any): void {
    const payload = Buffer.from(JSON.stringify(message), 'utf8');
    const checksum = this.calculateChecksum(payload);
    
    const binaryMessage: BinaryMessage = {
      type: 1, // JSON message type
      length: payload.length,
      data: payload,
      checksum
    };

    const header = Buffer.allocUnsafe(12);
    header.writeUInt32LE(binaryMessage.type, 0);
    header.writeUInt32LE(binaryMessage.length, 4);
    header.writeUInt32LE(binaryMessage.checksum, 8);

    const fullMessage = Buffer.concat([header, binaryMessage.data]);
    this.ws!.send(fullMessage);
  }

  private calculateChecksum(data: Buffer): number {
    let checksum = 0;
    for (let i = 0; i < data.length; i++) {
      checksum = ((checksum + data[i]) & 0xFFFFFFFF) >>> 0;
    }
    return checksum;
  }

  private setupMessageHandlers(): void {
    this.ws!.on('message', (data) => {
      this.metrics.messagesReceived++;
      this.metrics.bytesReceived += data.length;

      try {
        let message: StreamEvent;

        if (this.config.binaryProtocol && Buffer.isBuffer(data) && data.length > 12) {
          message = this.parseBinaryMessage(data);
        } else {
          message = JSON.parse(data.toString());
        }

        this.handleServerMessage(message);
      } catch (error) {
        this.metrics.errors++;
        this.logger.error('Failed to parse server message:', error);
      }
    });
  }

  private parseBinaryMessage(data: Buffer): StreamEvent {
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
    const calculatedChecksum = this.calculateChecksum(payload);
    
    if (calculatedChecksum !== checksum) {
      throw new Error('Invalid binary message: checksum mismatch');
    }

    return JSON.parse(payload.toString('utf8'));
  }

  private handleServerMessage(message: StreamEvent): void {
    this.logger.debug('Received message:', message.type);

    switch (message.type) {
      case 'connection':
        this.clientId = message.clientId;
        this.logger.info(`Assigned client ID: ${this.clientId}`);
        this.emit('connected', {
          clientId: this.clientId,
          serverInfo: message.serverInfo
        });
        break;

      case 'auth_response':
        this.authenticated = message.data?.authenticated || false;
        if (this.authenticated) {
          this.connectionState = 'authenticated';
          this.logger.info('Authentication successful');
          this.emit('authenticated');
        } else {
          this.metrics.authFailures++;
          this.logger.error('Authentication failed');
          this.emit('auth_failed');
        }
        break;

      case 'trace_event':
        this.emit('trace_event', message.data);
        break;

      case 'system_event':
        this.emit('system_event', message);
        break;

      case 'heartbeat':
        this.emit('heartbeat', message.data);
        break;

      case 'historical_data':
        this.emit('historical_data', message);
        break;

      case 'time_travel_state':
        this.emit('time_travel_state', message);
        break;

      case 'error':
        this.metrics.errors++;
        this.logger.error('Server error:', message.error);
        this.emit('server_error', message.error);
        break;

      default:
        this.logger.warn(`Unknown message type: ${message.type}`);
    }
  }

  private scheduleReconnect(): void {
    this.reconnectCount++;
    this.metrics.reconnections++;
    
    const delay = this.config.reconnectDelay! * Math.pow(2, this.reconnectCount - 1);
    this.logger.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectCount}/${this.config.reconnectAttempts})`);
    
    setTimeout(() => {
      this.connect().catch(error => {
        this.logger.error('Reconnect failed:', error);
      });
    }, delay);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.authenticated) {
        this.sendMessage({
          type: 'heartbeat'
        });
      }
    }, this.config.heartbeatInterval!);
  }
}

// Example usage
if (require.main === module) {
  const client = new TraceStreamingClient({
    serverUrl: 'ws://localhost:8080',
    authToken: 'test-token',
    binaryProtocol: false,
    reconnectAttempts: 3
  });

  client.on('connected', (info) => {
    console.log('Connected to server:', info);
    client.subscribeToSession('example-session');
  });

  client.on('trace_event', (event) => {
    console.log('Trace event:', event);
  });

  client.on('server_error', (error) => {
    console.error('Server error:', error);
  });

  client.connect().catch(console.error);
}