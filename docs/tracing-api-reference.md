# Claude-Flow Tracing System API Reference

## Overview

The Claude-Flow Tracing System provides comprehensive real-time monitoring, debugging, and visualization capabilities for multi-agent swarm operations. This API reference covers all available endpoints, WebSocket protocols, and configuration options.

## Table of Contents

1. [TraceCollector API](#tracecollector-api)
2. [WebSocket Protocol](#websocket-protocol)
3. [Storage API](#storage-api)
4. [Time-Travel Debugging API](#time-travel-debugging-api)
5. [Performance Monitoring](#performance-monitoring)
6. [Configuration](#configuration)
7. [Event Types and Payloads](#event-types-and-payloads)
8. [Error Codes](#error-codes)
9. [Authentication](#authentication)
10. [Rate Limiting](#rate-limiting)
11. [React Hooks](#react-hooks)

---

## TraceCollector API

### Overview

The TraceCollector is the core component for capturing and processing trace events with minimal performance impact.

### Constructor

```typescript
constructor(
  config: TracingConfig,
  storage?: TraceStorage,
  streamer?: TraceStreamer
)
```

**Parameters:**
- `config`: TracingConfig - Core configuration options
- `storage`: TraceStorage (optional) - Storage backend
- `streamer`: TraceStreamer (optional) - Real-time streaming

### Methods

#### start()

Start trace collection with instrumentation hooks.

```typescript
start(): void
```

**Example:**
```typescript
const collector = new TraceCollector(config, storage, streamer);
collector.start();
```

#### stop()

Stop trace collection and flush remaining events.

```typescript
stop(): void
```

#### collectEvent()

Collect a single trace event with full processing pipeline.

```typescript
collectEvent(event: Partial<TraceEvent>): void
```

**Parameters:**
- `event`: Partial<TraceEvent> - Event data to collect

**Example:**
```typescript
collector.collectEvent({
  type: 'TASK_START',
  agentId: 'agent-001',
  swarmId: 'swarm-main',
  data: {
    taskId: 'task-123',
    description: 'Process user request'
  },
  metadata: {
    source: 'coordinator',
    severity: 'normal',
    tags: ['user-task', 'priority-high']
  }
});
```

#### startTrace()

Start a new trace with automatic timing.

```typescript
startTrace(
  traceId: string,
  type: TraceEventType,
  agentId: string,
  swarmId: string,
  data?: any
): string
```

**Parameters:**
- `traceId`: string - Unique identifier for the trace
- `type`: TraceEventType - Type of event
- `agentId`: string - Agent performing the action
- `swarmId`: string - Swarm context
- `data`: any (optional) - Additional data

**Returns:** string - The trace ID

#### completeTrace()

Complete a trace with duration calculation.

```typescript
completeTrace(traceId: string, result?: any): void
```

#### errorTrace()

Record a trace error with stack trace.

```typescript
errorTrace(traceId: string, error: Error | string): void
```

#### getMetrics()

Get comprehensive collector metrics.

```typescript
getMetrics(): TraceCollectorMetrics
```

**Returns:**
```typescript
interface TraceCollectorMetrics {
  totalEvents: number;
  eventsPerSecond: number;
  averageProcessingTime: number;
  bufferUtilization: number;
  samplingRate: number;
  errorCount: number;
  droppedEvents: number;
  collectionOverhead: number;
}
```

#### flush()

Manually flush event buffer to storage.

```typescript
async flush(): Promise<void>
```

---

## WebSocket Protocol

### Connection

Connect to the tracing WebSocket server:

```javascript
const ws = new WebSocket('ws://localhost:8080');
```

### Message Format

All messages use JSON format with the following structure:

```typescript
interface Message {
  type: string;
  data?: any;
  timestamp?: number;
  clientId?: string;
}
```

### Client-to-Server Messages

#### Authentication

```json
{
  "type": "auth",
  "token": "your-auth-token-here"
}
```

#### Subscribe to Session

```json
{
  "type": "subscribe_session",
  "sessionId": "session-123"
}
```

#### Request Historical Data

```json
{
  "type": "request_history",
  "timeRange": {
    "start": 1640995200000,
    "end": 1640998800000
  }
}
```

#### Time Travel

```json
{
  "type": "time_travel",
  "timestamp": 1640997400000
}
```

#### Set Agent Filter

```json
{
  "type": "filter_agents",
  "agentIds": ["agent-001", "agent-002"]
}
```

#### Set Breakpoint

```json
{
  "type": "set_breakpoint",
  "traceId": "trace-456",
  "condition": "data.priority === 'high'"
}
```

#### Remove Breakpoint

```json
{
  "type": "remove_breakpoint",
  "traceId": "trace-456"
}
```

#### Heartbeat

```json
{
  "type": "heartbeat",
  "timestamp": 1640997400000
}
```

### Server-to-Client Messages

#### Connection Established

```json
{
  "type": "connection",
  "clientId": "client-abc123",
  "serverInfo": {
    "version": "2.0.0",
    "capabilities": ["real-time", "time-travel", "compression"],
    "limits": {
      "maxMessageSize": 1048576,
      "batchSize": 50
    },
    "auth": true,
    "binaryProtocol": false
  }
}
```

#### Authentication Response

```json
{
  "type": "auth_response",
  "authenticated": true,
  "timestamp": 1640997400000
}
```

#### Trace Event

```json
{
  "type": "trace_event",
  "event": "TASK_START",
  "data": {
    "id": "trace-789",
    "timestamp": 1640997400000,
    "type": "TASK_START",
    "agentId": "agent-001",
    "swarmId": "swarm-main",
    "data": {
      "taskId": "task-123",
      "description": "Process user request"
    }
  }
}
```

#### Batch Events

```json
{
  "type": "batch_events",
  "events": [...],
  "compression": "delta",
  "timestamp": 1640997400000,
  "checksum": "a1b2c3d4"
}
```

#### Historical Data

```json
{
  "type": "historical_data",
  "timeRange": {
    "start": 1640995200000,
    "end": 1640998800000
  },
  "traces": [...],
  "chunkInfo": {
    "current": 1,
    "total": 5,
    "isLast": false
  },
  "total": 450
}
```

#### Time Travel State

```json
{
  "type": "time_travel_state",
  "timestamp": 1640997400000,
  "traces": [...],
  "total": 234
}
```

#### Error Response

```json
{
  "type": "error",
  "error": {
    "code": "invalid_request",
    "message": "Session ID required"
  },
  "timestamp": 1640997400000
}
```

### WebSocket Events

- `trace:*` - Trace-related events
- `agent:*` - Agent lifecycle events
- `swarm:*` - Swarm coordination events
- `performance:*` - Performance metrics
- `system:*` - System events

---

## Storage API

### TraceStorage Class

High-performance SQLite-based storage with compression and indexing.

#### Constructor

```typescript
constructor(config: StorageConfig, tracingConfig: TracingConfig)
```

#### storeTrace()

Store a single trace event.

```typescript
async storeTrace(trace: TraceEvent): Promise<void>
```

#### storeBatch()

Store multiple trace events efficiently.

```typescript
async storeBatch(traces: TraceEvent[]): Promise<void>
```

#### getTracesBySession()

Retrieve traces for a specific session with filtering.

```typescript
async getTracesBySession(
  sessionId: string, 
  options: {
    timeRange?: TimeRange;
    agentIds?: string[];
    eventTypes?: string[];
    limit?: number;
    offset?: number;
  }
): Promise<TraceEvent[]>
```

**Example:**
```typescript
const traces = await storage.getTracesBySession('session-123', {
  timeRange: { start: Date.now() - 3600000, end: Date.now() },
  agentIds: ['agent-001', 'agent-002'],
  limit: 100
});
```

#### getTrace()

Get a specific trace by ID.

```typescript
async getTrace(id: string): Promise<TraceEvent | null>
```

#### getChildTraces()

Get all child traces for a parent trace.

```typescript
async getChildTraces(parentId: string): Promise<TraceEvent[]>
```

#### getTraceGraph()

Build a complete trace graph for visualization.

```typescript
async getTraceGraph(sessionId: string, options?: any): Promise<TraceGraph>
```

**Returns:**
```typescript
interface TraceGraph {
  nodes: Array<{
    id: string;
    label: string;
    type: string;
    agentId: string;
    timestamp: number;
    data: any;
    style: NodeStyle;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    type: string;
    style: EdgeStyle;
  }>;
  metadata: {
    nodeCount: number;
    edgeCount: number;
    depth: number;
    complexity: number;
    criticalPath: string[];
  };
}
```

#### Session Management

##### createSession()

```typescript
async createSession(
  name: string, 
  metadata?: Record<string, any>
): Promise<string>
```

##### getSession()

```typescript
async getSession(sessionId: string): Promise<TraceSession | null>
```

##### updateSession()

```typescript
async updateSession(
  sessionId: string, 
  updates: { 
    status?: string; 
    endTime?: number; 
    metadata?: Record<string, any> 
  }
): Promise<void>
```

#### Performance Monitoring

##### storePerformanceSnapshot()

```typescript
async storePerformanceSnapshot(
  sessionId: string, 
  metrics: Record<string, any>
): Promise<void>
```

##### getPerformanceSnapshots()

```typescript
async getPerformanceSnapshots(
  sessionId: string, 
  timeRange: TimeRange
): Promise<Array<{ timestamp: number; metrics: any }>>
```

#### Error Tracking

##### storeErrorEvent()

```typescript
async storeErrorEvent(
  traceId: string,
  errorType: string,
  errorMessage: string,
  stackTrace?: string,
  recoveryAction?: string
): Promise<void>
```

##### getErrorEvents()

```typescript
async getErrorEvents(options?: {
  traceId?: string;
  resolved?: boolean;
  timeRange?: TimeRange;
  limit?: number;
}): Promise<ErrorEvent[]>
```

---

## Time-Travel Debugging API

### StateReconstructor

Reconstruct system state at any point in time.

```typescript
async reconstructState(
  sessionId: string, 
  timestamp: number
): Promise<SystemState>
```

### System State Structure

```typescript
interface SystemState {
  agents: Record<string, AgentState>;
  tasks: Record<string, TaskState>;
  memory: Record<string, MemoryEntry>;
  communications: Record<string, CommunicationEntry[]>;
  swarm: SwarmState;
}
```

### Debugging Operations

#### Step Into

Navigate to the first child trace of the current trace.

```typescript
async stepInto(currentTraceId: string): Promise<TraceEvent | null>
```

#### Step Over

Move to the next sibling trace at the same level.

```typescript
async stepOver(currentTraceId: string): Promise<TraceEvent | null>
```

#### Step Out

Navigate to the parent trace.

```typescript
async stepOut(currentTraceId: string): Promise<TraceEvent | null>
```

#### Set Breakpoint

```typescript
setBreakpoint(traceId: string, condition?: string): void
```

#### Variable Inspection

```typescript
inspectVariable(traceId: string, path: string): any
```

---

## Performance Monitoring

### Metrics Collection

#### System Metrics

```typescript
interface SystemMetrics {
  cpu: {
    usage: number;
    loadAverage: number[];
  };
  memory: {
    used: number;
    free: number;
    total: number;
  };
  processes: {
    active: number;
    total: number;
  };
}
```

#### Agent Metrics

```typescript
interface AgentMetrics {
  agentId: string;
  performance: {
    cpuUsage: number;
    memoryUsage: number;
    taskCount: number;
    averageResponseTime: number;
    throughput: number;
    errorRate: number;
  };
  health: {
    status: 'healthy' | 'degraded' | 'critical';
    uptime: number;
    lastActivity: number;
  };
}
```

#### Trace Metrics

```typescript
interface TraceMetrics {
  totalTraces: number;
  tracesPerSecond: number;
  averageTraceTime: number;
  errorRate: number;
  distribution: Record<string, number>;
}
```

### Performance Endpoints

#### Get Real-time Metrics

```http
GET /api/metrics/realtime
```

**Response:**
```json
{
  "timestamp": 1640997400000,
  "system": { ... },
  "agents": [ ... ],
  "traces": { ... }
}
```

#### Get Historical Performance

```http
GET /api/metrics/historical?from={timestamp}&to={timestamp}&interval={interval}
```

**Query Parameters:**
- `from`: number - Start timestamp
- `to`: number - End timestamp  
- `interval`: string - Aggregation interval ('1m', '5m', '1h')

#### Performance Alerts

```http
POST /api/metrics/alerts
```

**Request Body:**
```json
{
  "name": "High CPU Usage",
  "condition": "cpu.usage > 80",
  "threshold": 80,
  "duration": 300,
  "actions": ["email", "webhook"]
}
```

---

## Configuration

### TracingConfig

Main tracing configuration interface:

```typescript
interface TracingConfig {
  enabled: boolean;
  level: 'debug' | 'info' | 'warn' | 'error';
  samplingRate: number;
  bufferSize: number;
  flushInterval: number;
  performanceMonitoring: boolean;
  realtimeStreaming: boolean;
  
  // Storage configuration
  storage: {
    enabled: boolean;
    path: string;
    maxSize: number;
    compression: boolean;
    retention: number; // hours
  };
  
  // Streaming configuration  
  streaming: StreamingConfig;
  
  // Performance tuning
  performance: {
    maxCpuThreshold: number;
    maxMemoryThreshold: number;
    minTraceInterval: number;
  };
}
```

### StreamingConfig

WebSocket streaming configuration:

```typescript
interface StreamingConfig {
  enabled: boolean;
  port: number;
  maxConnections: number;
  heartbeatInterval: number;
  compressionEnabled: boolean;
  batchSize: number;
  batchTimeout: number;
  maxMessageSize: number;
  
  // Authentication
  auth?: {
    enabled: boolean;
    validApiKeys?: Set<string>;
    jwtSecret?: string;
  };
  
  // Rate limiting
  rateLimit?: {
    windowMs: number;
    maxMessages: number;
    maxBytesPerWindow: number;
  };
  
  // Backpressure handling
  backpressure?: {
    highWaterMark: number;
    lowWaterMark: number;
    maxQueueSize: number;
    dropOldest: boolean;
  };
}
```

### StorageConfig

Storage backend configuration:

```typescript
interface StorageConfig {
  databasePath: string;
  maxFileSize: number;
  maxFiles: number;
  compressionLevel: number;
  indexingEnabled: boolean;
  vacuumInterval: number;
}
```

### Configuration Example

```typescript
const config: TracingConfig = {
  enabled: true,
  level: 'info',
  samplingRate: 1.0,
  bufferSize: 1000,
  flushInterval: 5000,
  performanceMonitoring: true,
  realtimeStreaming: true,
  
  storage: {
    enabled: true,
    path: './traces.db',
    maxSize: 1024 * 1024 * 1024, // 1GB
    compression: true,
    retention: 168 // 7 days
  },
  
  streaming: {
    enabled: true,
    port: 8080,
    maxConnections: 100,
    heartbeatInterval: 30000,
    compressionEnabled: true,
    batchSize: 50,
    batchTimeout: 100,
    maxMessageSize: 1024 * 1024, // 1MB
    
    auth: {
      enabled: true,
      validApiKeys: new Set(['api-key-123', 'api-key-456'])
    },
    
    rateLimit: {
      windowMs: 60000, // 1 minute
      maxMessages: 1000,
      maxBytesPerWindow: 10 * 1024 * 1024 // 10MB
    }
  },
  
  performance: {
    maxCpuThreshold: 0.8,
    maxMemoryThreshold: 0.9,
    minTraceInterval: 1
  }
};
```

---

## Event Types and Payloads

### TraceEventType Enum

```typescript
enum TraceEventType {
  // Agent lifecycle
  AGENT_SPAWN = 'AGENT_SPAWN',
  AGENT_DESTROY = 'AGENT_DESTROY',
  AGENT_IDLE = 'AGENT_IDLE',
  
  // Task execution
  TASK_START = 'TASK_START',
  TASK_PROGRESS = 'TASK_PROGRESS', 
  TASK_COMPLETE = 'TASK_COMPLETE',
  TASK_FAIL = 'TASK_FAIL',
  
  // Communication
  MESSAGE_SEND = 'MESSAGE_SEND',
  MESSAGE_RECEIVE = 'MESSAGE_RECEIVE',
  BROADCAST = 'BROADCAST',
  
  // Memory operations
  MEMORY_READ = 'MEMORY_READ',
  MEMORY_WRITE = 'MEMORY_WRITE',
  MEMORY_DELETE = 'MEMORY_DELETE',
  
  // Decision points
  DECISION_START = 'DECISION_START',
  DECISION_COMPLETE = 'DECISION_COMPLETE',
  
  // Performance
  PERFORMANCE_METRIC = 'PERFORMANCE_METRIC',
  RESOURCE_USAGE = 'RESOURCE_USAGE',
  
  // System
  SYSTEM_START = 'SYSTEM_START',
  SYSTEM_SHUTDOWN = 'SYSTEM_SHUTDOWN',
  ERROR = 'ERROR'
}
```

### Event Payload Examples

#### AGENT_SPAWN

```typescript
{
  id: 'trace-001',
  type: 'AGENT_SPAWN',
  agentId: 'agent-001', 
  swarmId: 'swarm-main',
  timestamp: 1640997400000,
  data: {
    agentType: 'researcher',
    capabilities: ['search', 'analyze', 'report'],
    initialMemory: { role: 'researcher', priority: 'high' }
  },
  metadata: {
    source: 'swarm-coordinator',
    severity: 'normal',
    tags: ['lifecycle', 'spawn'],
    correlationId: 'session-123'
  }
}
```

#### TASK_START

```typescript
{
  id: 'trace-002',
  type: 'TASK_START',
  agentId: 'agent-001',
  swarmId: 'swarm-main', 
  timestamp: 1640997401000,
  parentId: 'trace-001',
  data: {
    taskId: 'task-456',
    taskType: 'research',
    description: 'Research AI safety protocols',
    priority: 'high',
    estimatedDuration: 3600000, // 1 hour
    parameters: {
      domain: 'ai-safety',
      depth: 'comprehensive',
      sources: ['academic', 'industry']
    }
  }
}
```

#### COMMUNICATION

```typescript
{
  id: 'trace-003',
  type: 'MESSAGE_SEND',
  agentId: 'agent-001',
  swarmId: 'swarm-main',
  timestamp: 1640997402000,
  data: {
    messageId: 'msg-789',
    sender: 'agent-001',
    recipient: 'agent-002', 
    messageType: 'task-request',
    payload: {
      requestType: 'collaboration',
      task: 'peer-review',
      priority: 'medium'
    },
    deliveryStatus: 'sent'
  }
}
```

#### PERFORMANCE_METRIC

```typescript
{
  id: 'trace-004',
  type: 'PERFORMANCE_METRIC',
  agentId: 'system',
  swarmId: 'system',
  timestamp: 1640997403000,
  data: {
    metricType: 'resource-usage',
    metrics: {
      cpu: { usage: 45.2, cores: 8 },
      memory: { used: 2048, free: 6144, total: 8192 },
      disk: { read: 1024, write: 512 },
      network: { in: 2048, out: 1024 }
    },
    windowSize: 60000 // 1 minute window
  }
}
```

#### ERROR

```typescript
{
  id: 'trace-005',
  type: 'ERROR',
  agentId: 'agent-001',
  swarmId: 'swarm-main',
  timestamp: 1640997404000,
  parentId: 'trace-002',
  data: {
    errorType: 'TaskExecutionError',
    errorMessage: 'Failed to access research database',
    stackTrace: '...',
    context: {
      taskId: 'task-456',
      step: 'data-collection',
      attemptNumber: 3
    },
    recovery: {
      action: 'retry-with-backoff',
      delay: 5000,
      maxRetries: 5
    }
  },
  metadata: {
    severity: 'high',
    tags: ['error', 'recoverable'],
    correlationId: 'task-456'
  }
}
```

---

## Error Codes

### Standard HTTP Status Codes

- **200** - Success
- **400** - Bad Request
- **401** - Unauthorized  
- **403** - Forbidden
- **404** - Not Found
- **429** - Rate Limited
- **500** - Internal Server Error
- **503** - Service Unavailable

### WebSocket Error Codes

| Code | Message | Description |
|------|---------|-------------|
| `invalid_request` | Invalid request format | Request missing required fields |
| `not_authenticated` | Authentication required | Client must authenticate first |
| `invalid_token` | Invalid authentication token | Token expired or malformed |
| `rate_limit_exceeded` | Rate limit exceeded | Client exceeded message/bandwidth limits |
| `session_not_found` | Session not found | Requested session doesn't exist |
| `permission_denied` | Permission denied | Client lacks required permissions |
| `message_too_large` | Message too large | Message exceeds size limit |
| `unknown_message_type` | Unknown message type | Unsupported message type |
| `session_error` | Session error | Error loading session data |
| `history_error` | History error | Error loading historical data |
| `time_travel_error` | Time travel error | Error with time travel operation |
| `no_session` | No session subscribed | Operation requires session subscription |

### Collector Error Codes

| Code | Description |
|------|-------------|
| `BUFFER_OVERFLOW` | Event buffer full, dropping events |
| `STORAGE_FAILURE` | Failed to persist events to storage |
| `INVALID_EVENT` | Event failed validation |
| `SAMPLING_ACTIVE` | Event dropped due to sampling |
| `BACKPRESSURE` | System under load, reducing collection |

### Error Response Format

```json
{
  "type": "error",
  "error": {
    "code": "invalid_request",
    "message": "Session ID required",
    "details": {
      "field": "sessionId",
      "expected": "string",
      "received": "undefined"
    }
  },
  "timestamp": 1640997400000,
  "requestId": "req-123"
}
```

---

## Authentication

### API Key Authentication

Include API key in request headers:

```http
Authorization: Bearer your-api-key-here
```

### WebSocket Authentication

Send auth message after connection:

```json
{
  "type": "auth", 
  "token": "your-api-key-here"
}
```

### JWT Authentication (Optional)

If JWT is enabled, include JWT token:

```json
{
  "type": "auth",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### Permissions

- `read` - View traces and metrics
- `write` - Create traces and events  
- `admin` - Full system access
- `debug` - Time-travel debugging features

### Authentication Configuration

```typescript
const authConfig = {
  enabled: true,
  validApiKeys: new Set([
    'api-key-prod-123',
    'api-key-dev-456'  
  ]),
  jwtSecret: 'your-jwt-secret',
  permissions: {
    'api-key-prod-123': ['read', 'write', 'debug'],
    'api-key-dev-456': ['read']
  }
};
```

---

## Rate Limiting

### Configuration

```typescript
const rateLimitConfig = {
  windowMs: 60000, // 1 minute window
  maxMessages: 1000, // Max messages per window
  maxBytesPerWindow: 10 * 1024 * 1024 // 10MB per window
};
```

### Rate Limit Headers

HTTP responses include rate limit information:

```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1640997460
X-RateLimit-Window: 60
```

### Rate Limit Exceeded Response

```json
{
  "type": "error",
  "error": {
    "code": "rate_limit_exceeded", 
    "message": "Rate limit exceeded",
    "details": {
      "limit": 1000,
      "window": 60000,
      "resetTime": 1640997460000
    }
  }
}
```

### Per-Client Limiting

Each WebSocket client has individual rate limits:

- Message count per time window
- Bandwidth usage per time window
- Burst allowance for short spikes

---

## React Hooks

### useTraceWebSocket

React hook for WebSocket trace streaming with automatic reconnection.

#### Usage

```typescript
import { useTraceWebSocket } from './hooks/useTraceWebSocket';

const TraceViewer = () => {
  const {
    isConnected,
    connectionStatus,
    events,
    agents,
    lastEvent,
    error,
    sendMessage,
    clearEvents,
    setFilters,
    subscribe
  } = useTraceWebSocket({
    url: 'ws://localhost:8080',
    autoReconnect: true,
    reconnectInterval: 5000,
    maxReconnectAttempts: 5,
    bufferSize: 1000
  });

  useEffect(() => {
    if (isConnected) {
      subscribe(['trace-events', 'agent-updates']);
    }
  }, [isConnected, subscribe]);

  return (
    <div>
      <div>Status: {connectionStatus}</div>
      <div>Events: {events.length}</div>
      <div>Agents: {agents.length}</div>
    </div>
  );
};
```

#### Options

```typescript
interface UseTraceWebSocketOptions {
  url: string;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number; 
  bufferSize?: number;
}
```

#### Return Value

```typescript
interface UseTraceWebSocketReturn {
  isConnected: boolean;
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
  events: TraceEvent[];
  agents: Agent[];
  lastEvent: TraceEvent | null;
  error: Error | null;
  sendMessage: (message: any) => void;
  disconnect: () => void;
  reconnect: () => void; 
  clearEvents: () => void;
  setFilters: (filters: any[]) => void;
  subscribe: (channels: string[]) => void;
  unsubscribe: (channels: string[]) => void;
}
```

---

## Examples

### Complete Integration Example

```typescript
import { 
  TraceCollector, 
  TraceStorage, 
  TraceStreamer,
  TracingConfig 
} from 'claude-flow/tracing';

// Configuration
const config: TracingConfig = {
  enabled: true,
  level: 'info',
  samplingRate: 1.0,
  bufferSize: 1000,
  flushInterval: 5000,
  performanceMonitoring: true,
  realtimeStreaming: true,
  storage: {
    enabled: true,
    path: './traces.db',
    maxSize: 1024 * 1024 * 1024,
    compression: true,
    retention: 168
  },
  streaming: {
    enabled: true,
    port: 8080,
    maxConnections: 100,
    heartbeatInterval: 30000,
    compressionEnabled: true,
    batchSize: 50,
    batchTimeout: 100,
    maxMessageSize: 1024 * 1024
  }
};

// Initialize components
const storage = new TraceStorage(config.storage, config);
const streamer = new TraceStreamer(config.streaming, eventBus, storage, config);
const collector = new TraceCollector(config, storage, streamer);

// Start tracing
collector.start();
streamer.start();

// Create session
const sessionId = await storage.createSession('Test Session');

// Collect some events
collector.collectEvent({
  type: 'AGENT_SPAWN',
  agentId: 'agent-001',
  swarmId: 'swarm-main',
  data: {
    agentType: 'researcher',
    capabilities: ['search', 'analyze']
  }
});

// Query traces
const traces = await storage.getTracesBySession(sessionId, {
  limit: 100
});

// Build visualization graph
const graph = await storage.getTraceGraph(sessionId);

// Cleanup
await collector.stop();
await streamer.stop();
await storage.close();
```

### Client-Side Usage

```typescript
// Connect to tracing WebSocket
const ws = new WebSocket('ws://localhost:8080');

// Authenticate
ws.send(JSON.stringify({
  type: 'auth',
  token: 'your-api-key'
}));

// Subscribe to session
ws.send(JSON.stringify({
  type: 'subscribe_session',
  sessionId: 'session-123'
}));

// Handle incoming events
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  switch (message.type) {
    case 'trace_event':
      console.log('New trace:', message.data);
      break;
    case 'batch_events':
      console.log('Batch received:', message.events.length);
      break;
    case 'error':
      console.error('Error:', message.error);
      break;
  }
};
```

---

## Performance Considerations

### Optimization Guidelines

1. **Sampling Rate**: Adjust sampling rate based on system load
2. **Buffer Size**: Larger buffers reduce I/O overhead but use more memory
3. **Batch Size**: Optimize batch size for your storage backend
4. **Compression**: Enable compression for network and storage efficiency
5. **Indexing**: Ensure proper database indexing for queries
6. **Rate Limiting**: Implement rate limiting to prevent client abuse

### Monitoring Performance Impact

- Collection overhead should stay below 5% CPU usage
- Memory usage should remain under 100MB for 10K traces
- Real-time latency should be under 100ms end-to-end

### Scaling Recommendations

- Use connection pooling for high-throughput scenarios
- Consider horizontal scaling with multiple storage instances
- Implement data partitioning for very large datasets
- Use CDN for static assets in web visualization

---

This comprehensive API reference provides complete coverage of the Claude-Flow Tracing System, enabling developers to effectively integrate, configure, and utilize all tracing capabilities for robust multi-agent system monitoring and debugging.