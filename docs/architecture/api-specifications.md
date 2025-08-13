# Claude-Flow Tracing System - API Specifications

## Overview

This document defines the complete API specifications for the Claude-Flow Tracing and Visualization System, including REST endpoints, WebSocket protocols, and internal service interfaces.

## Base Configuration

```
Base URL: http://localhost:8080/api/v1
WebSocket URL: ws://localhost:8080/ws
Authentication: Bearer token or API key
Content-Type: application/json
```

## REST API Endpoints

### Trace Management

#### List Traces
```http
GET /api/v1/traces
```

**Query Parameters:**
```typescript
{
  page?: number;          // Default: 1
  limit?: number;         // Default: 20, Max: 100
  status?: 'active' | 'completed' | 'stopped' | 'error';
  sessionId?: string;
  startTime?: number;     // Unix timestamp
  endTime?: number;       // Unix timestamp
  agentCount?: number;    // Minimum agent count
  hasErrors?: boolean;
  sortBy?: 'startTime' | 'duration' | 'eventCount' | 'errorCount';
  sortOrder?: 'asc' | 'desc';
}
```

**Response:**
```typescript
{
  success: boolean;
  data: {
    traces: TraceSummary[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      hasNext: boolean;
      hasPrev: boolean;
    };
  };
  timestamp: number;
}
```

#### Get Trace Details
```http
GET /api/v1/traces/:traceId
```

**Response:**
```typescript
{
  success: boolean;
  data: TraceDetails;
  timestamp: number;
}
```

#### Stop Trace
```http
POST /api/v1/traces/:traceId/stop
```

**Request Body:**
```typescript
{
  reason?: string;
  graceful?: boolean; // Default: true
}
```

#### Delete Trace
```http
DELETE /api/v1/traces/:traceId
```

**Query Parameters:**
```typescript
{
  deleteEvents?: boolean;    // Default: true
  deleteSnapshots?: boolean; // Default: true
  archive?: boolean;         // Default: false
}
```

### Event Querying

#### Get Trace Events
```http
GET /api/v1/traces/:traceId/events
```

**Query Parameters:**
```typescript
{
  page?: number;
  limit?: number;
  startTime?: number;
  endTime?: number;
  agentId?: string;
  eventType?: EventType;
  level?: 'debug' | 'info' | 'warn' | 'error';
  parentId?: string;
  includeMetadata?: boolean; // Default: true
  includeStackTrace?: boolean; // Default: false
}
```

#### Search Events
```http
GET /api/v1/traces/:traceId/events/search
```

**Query Parameters:**
```typescript
{
  query: string;           // Search query
  fields?: string[];       // Fields to search in
  fuzzy?: boolean;         // Default: false
  limit?: number;          // Default: 100
  includeContext?: boolean; // Include surrounding events
  contextSize?: number;    // Default: 5
}
```

#### Get Event Range
```http
GET /api/v1/traces/:traceId/events/range
```

**Query Parameters:**
```typescript
{
  startTime: number;       // Required
  endTime: number;         // Required
  agentIds?: string[];
  eventTypes?: EventType[];
  minLevel?: 'debug' | 'info' | 'warn' | 'error';
  includeChildren?: boolean; // Include child events
}
```

#### Get Event Hierarchy
```http
GET /api/v1/events/:eventId/hierarchy
```

**Query Parameters:**
```typescript
{
  depth?: number;          // Default: unlimited
  direction?: 'up' | 'down' | 'both'; // Default: 'both'
}
```

### Agent Management

#### List Agents
```http
GET /api/v1/traces/:traceId/agents
```

**Query Parameters:**
```typescript
{
  status?: AgentStatus;
  type?: string;
  includeMetrics?: boolean;
  timestamp?: number; // Get state at specific time
}
```

#### Get Agent Details
```http
GET /api/v1/agents/:agentId
```

**Query Parameters:**
```typescript
{
  traceId: string;
  includeEvents?: boolean;
  eventLimit?: number;
  includeConnections?: boolean;
  includeMetrics?: boolean;
}
```

#### Get Agent Timeline
```http
GET /api/v1/agents/:agentId/timeline
```

**Query Parameters:**
```typescript
{
  traceId: string;
  startTime?: number;
  endTime?: number;
  eventTypes?: EventType[];
  granularity?: 'second' | 'minute' | 'hour';
}
```

#### Get Agent Connections
```http
GET /api/v1/agents/:agentId/connections
```

**Query Parameters:**
```typescript
{
  traceId: string;
  connectionType?: 'communication' | 'coordination' | 'dependency';
  timestamp?: number;
  includeMetrics?: boolean;
}
```

### Time-Travel and Snapshots

#### List Snapshots
```http
GET /api/v1/traces/:traceId/snapshots
```

**Query Parameters:**
```typescript
{
  snapshotType?: SnapshotType;
  agentId?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
}
```

#### Get Snapshot
```http
GET /api/v1/snapshots/:snapshotId
```

**Query Parameters:**
```typescript
{
  decompress?: boolean;    // Default: true
  includeMetadata?: boolean; // Default: true
}
```

#### Create Snapshot
```http
POST /api/v1/traces/:traceId/snapshots
```

**Request Body:**
```typescript
{
  timestamp?: number;      // Default: current time
  snapshotType: SnapshotType;
  scopeId?: string;        // agent_id, task_id, etc.
  includeMemory?: boolean; // Default: true
  compress?: boolean;      // Default: true
}
```

#### Restore State
```http
POST /api/v1/traces/:traceId/restore
```

**Request Body:**
```typescript
{
  timestamp: number;
  snapshotId?: string;     // If not provided, find nearest
  reconstructionStrategy?: 'nearest_snapshot' | 'event_replay' | 'hybrid';
}
```

### Memory Operations

#### Get Memory State
```http
GET /api/v1/traces/:traceId/memory
```

**Query Parameters:**
```typescript
{
  timestamp?: number;
  agentId?: string;
  namespace?: string;
  keys?: string[];
  includeHistory?: boolean;
}
```

#### Get Memory History
```http
GET /api/v1/memory/:key/history
```

**Query Parameters:**
```typescript
{
  traceId: string;
  namespace?: string;
  startTime?: number;
  endTime?: number;
  includeDeleted?: boolean;
}
```

### Performance and Metrics

#### Get Performance Metrics
```http
GET /api/v1/metrics/performance
```

**Query Parameters:**
```typescript
{
  component?: 'collector' | 'storage' | 'streaming' | 'ui';
  metricType?: string;
  startTime?: number;
  endTime?: number;
  granularity?: 'minute' | 'hour' | 'day';
  aggregation?: 'avg' | 'min' | 'max' | 'sum';
}
```

#### Get Storage Metrics
```http
GET /api/v1/metrics/storage
```

**Response:**
```typescript
{
  success: boolean;
  data: {
    totalSizeBytes: number;
    compressedSizeBytes: number;
    compressionRatio: number;
    traceCount: number;
    eventCount: number;
    snapshotCount: number;
    oldestTrace: number;
    newestTrace: number;
    storageEfficiency: number;
    recommendations: string[];
  };
}
```

#### Get Overhead Analysis
```http
GET /api/v1/metrics/overhead
```

**Query Parameters:**
```typescript
{
  timeframe?: string;      // e.g., '1h', '24h', '7d'
  includeBreakdown?: boolean;
  includeRecommendations?: boolean;
}
```

### System Health

#### Health Check
```http
GET /api/v1/health
```

**Response:**
```typescript
{
  status: 'healthy' | 'degraded' | 'critical';
  timestamp: number;
  uptime: number;
  version: string;
  components: {
    collector: ComponentHealth;
    storage: ComponentHealth;
    streaming: ComponentHealth;
    ui: ComponentHealth;
  };
  issues: HealthIssue[];
}
```

#### Get System Status
```http
GET /api/v1/status
```

**Response:**
```typescript
{
  activeTraces: number;
  totalConnections: number;
  eventsPerSecond: number;
  storageUsage: number;
  cpuUsage: number;
  memoryUsage: number;
  lastActivity: number;
}
```

## WebSocket Protocol

### Connection Establishment

```javascript
const ws = new WebSocket('ws://localhost:8080/ws');
```

**Authentication:**
```json
{
  "type": "authenticate",
  "payload": {
    "token": "bearer_token_here",
    "clientInfo": {
      "name": "Trace Visualizer",
      "version": "1.0.0"
    }
  }
}
```

### Message Format

All WebSocket messages follow this structure:

```typescript
interface WSMessage {
  type: WSMessageType;
  id?: string;             // For request-response correlation
  timestamp: number;
  payload: any;
  compression?: 'lz4' | 'none';
}
```

### Message Types

#### Authentication Messages

**Client → Server: Authentication Request**
```json
{
  "type": "auth_request",
  "timestamp": 1234567890000,
  "payload": {
    "token": "bearer_token",
    "clientInfo": {
      "name": "Client Name",
      "version": "1.0.0",
      "capabilities": ["streaming", "time_travel"]
    }
  }
}
```

**Server → Client: Authentication Response**
```json
{
  "type": "auth_response",
  "timestamp": 1234567890000,
  "payload": {
    "success": true,
    "clientId": "client-uuid",
    "permissions": ["read", "subscribe"],
    "limits": {
      "maxSubscriptions": 10,
      "rateLimit": 100
    }
  }
}
```

#### Subscription Messages

**Client → Server: Subscribe to Trace**
```json
{
  "type": "subscribe",
  "id": "req-123",
  "timestamp": 1234567890000,
  "payload": {
    "traceId": "trace-uuid",
    "filters": {
      "agentIds": ["agent1", "agent2"],
      "eventTypes": ["task.start", "task.complete"],
      "minLevel": "info"
    },
    "realTime": true,
    "backfill": {
      "enabled": true,
      "duration": 300000  // Last 5 minutes
    }
  }
}
```

**Server → Client: Subscription Acknowledgment**
```json
{
  "type": "subscription_ack",
  "id": "req-123",
  "timestamp": 1234567890000,
  "payload": {
    "success": true,
    "subscriptionId": "sub-uuid",
    "backfillEvents": 1250
  }
}
```

#### Real-time Event Streaming

**Server → Client: Trace Events**
```json
{
  "type": "trace_events",
  "timestamp": 1234567890000,
  "payload": {
    "traceId": "trace-uuid",
    "batchId": "batch-uuid",
    "sequenceNumber": 1234,
    "events": [
      {
        "id": "event-uuid",
        "agentId": "agent1",
        "eventType": "task.start",
        "timestamp": 1234567890000,
        "message": "Started processing task",
        "metadata": {}
      }
    ]
  }
}
```

**Server → Client: Agent State Update**
```json
{
  "type": "agent_update",
  "timestamp": 1234567890000,
  "payload": {
    "traceId": "trace-uuid",
    "agentId": "agent1",
    "status": "busy",
    "metrics": {
      "cpuUsage": 0.45,
      "memoryUsage": 128000000,
      "taskCount": 3
    },
    "position": { "x": 100, "y": 200 }
  }
}
```

#### Control Messages

**Client → Server: Time Travel Request**
```json
{
  "type": "time_travel",
  "id": "req-456",
  "timestamp": 1234567890000,
  "payload": {
    "traceId": "trace-uuid",
    "targetTime": 1234567800000,
    "includeAgentStates": true,
    "includeConnections": true
  }
}
```

**Server → Client: Time Travel Response**
```json
{
  "type": "time_travel_result",
  "id": "req-456",
  "timestamp": 1234567890000,
  "payload": {
    "success": true,
    "reconstructedState": {
      "timestamp": 1234567800000,
      "agents": {},
      "connections": [],
      "systemMetrics": {}
    },
    "snapshotUsed": "snapshot-uuid"
  }
}
```

**Client → Server: Playback Control**
```json
{
  "type": "playback_control",
  "id": "req-789",
  "timestamp": 1234567890000,
  "payload": {
    "traceId": "trace-uuid",
    "action": "play" | "pause" | "stop" | "seek",
    "speed": 1.0,           // 0.1x to 10x
    "startTime": 1234567800000,
    "endTime": 1234567900000
  }
}
```

#### System Messages

**Server → Client: Heartbeat**
```json
{
  "type": "heartbeat",
  "timestamp": 1234567890000,
  "payload": {
    "serverTime": 1234567890000,
    "connections": 42,
    "systemHealth": "healthy"
  }
}
```

**Client → Server: Heartbeat Response**
```json
{
  "type": "heartbeat_response",
  "timestamp": 1234567890000,
  "payload": {
    "clientTime": 1234567890000,
    "status": "active"
  }
}
```

**Server → Client: Error**
```json
{
  "type": "error",
  "id": "req-123",
  "timestamp": 1234567890000,
  "payload": {
    "code": "TRACE_NOT_FOUND",
    "message": "Trace with ID 'invalid-id' not found",
    "details": {},
    "recoverable": false
  }
}
```

#### Rate Limiting and Backpressure

**Server → Client: Rate Limit Warning**
```json
{
  "type": "rate_limit_warning",
  "timestamp": 1234567890000,
  "payload": {
    "currentRate": 150,
    "maxRate": 100,
    "action": "throttling",
    "retryAfter": 1000
  }
}
```

**Server → Client: Backpressure Notification**
```json
{
  "type": "backpressure",
  "timestamp": 1234567890000,
  "payload": {
    "queueDepth": 1000,
    "droppedMessages": 50,
    "recommendation": "reduce_subscription_filters"
  }
}
```

## Internal Service APIs

### TraceCollector Service

```typescript
interface TraceCollectorAPI {
  // Event collection
  collectEvent(event: TraceEvent): Promise<void>;
  collectBatch(events: TraceEvent[]): Promise<BatchResult>;
  
  // Configuration
  updateFilters(filters: FilterRule[]): Promise<void>;
  setSamplingRate(rate: number): Promise<void>;
  
  // Status and metrics
  getStatus(): Promise<CollectorStatus>;
  getMetrics(): Promise<CollectorMetrics>;
  
  // Control
  start(): Promise<void>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
}
```

### Storage Service

```typescript
interface StorageAPI {
  // Trace operations
  createTrace(trace: TraceMetadata): Promise<string>;
  getTrace(traceId: string): Promise<TraceDetails>;
  updateTrace(traceId: string, updates: Partial<TraceMetadata>): Promise<void>;
  deleteTrace(traceId: string): Promise<void>;
  
  // Event operations
  storeEvents(traceId: string, events: TraceEvent[]): Promise<void>;
  getEvents(query: EventQuery): Promise<PaginatedResponse<TraceEvent>>;
  searchEvents(query: SearchQuery): Promise<TraceEvent[]>;
  
  // Snapshot operations
  createSnapshot(snapshot: Snapshot): Promise<string>;
  getSnapshot(snapshotId: string): Promise<Snapshot>;
  listSnapshots(traceId: string, filters?: SnapshotFilter): Promise<SnapshotMetadata[]>;
  
  // Cleanup and maintenance
  cleanup(policy: CleanupPolicy): Promise<CleanupResult>;
  vacuum(): Promise<void>;
  getStorageStats(): Promise<StorageStats>;
}
```

### Streaming Service

```typescript
interface StreamingAPI {
  // Connection management
  addConnection(ws: WebSocket, clientInfo: ClientInfo): Promise<string>;
  removeConnection(clientId: string): Promise<void>;
  
  // Broadcasting
  broadcast(message: StreamMessage, filter?: ClientFilter): Promise<void>;
  unicast(clientId: string, message: StreamMessage): Promise<void>;
  
  // Subscription management
  subscribe(clientId: string, subscription: Subscription): Promise<string>;
  unsubscribe(clientId: string, subscriptionId: string): Promise<void>;
  
  // Status and control
  getConnections(): Promise<ConnectionInfo[]>;
  getStats(): Promise<StreamingStats>;
  throttle(clientId: string, rate: number): Promise<void>;
}
```

## Error Codes and Responses

### HTTP Error Codes

| Code | Status | Description |
|------|---------|-------------|
| 400 | Bad Request | Invalid query parameters or request body |
| 401 | Unauthorized | Invalid or missing authentication |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Trace, event, or resource not found |
| 409 | Conflict | Resource already exists or state conflict |
| 413 | Payload Too Large | Request body exceeds size limit |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Unexpected server error |
| 503 | Service Unavailable | Service temporarily unavailable |

### WebSocket Error Codes

| Code | Description |
|------|-------------|
| WS_AUTH_FAILED | Authentication failed |
| WS_INVALID_MESSAGE | Invalid message format |
| WS_SUBSCRIPTION_DENIED | Subscription request denied |
| WS_RATE_LIMITED | Client exceeded rate limit |
| WS_TRACE_NOT_FOUND | Requested trace not found |
| WS_INTERNAL_ERROR | Internal server error |

## Rate Limiting

### REST API Limits
- **Default**: 100 requests per minute per client
- **Authenticated**: 1000 requests per minute per client
- **Search endpoints**: 10 requests per minute per client
- **Bulk operations**: 5 requests per minute per client

### WebSocket Limits
- **Default**: 100 messages per second per connection
- **Subscription events**: 1000 events per second per connection
- **Control messages**: 10 messages per second per connection

### Backpressure Handling
- **Queue depth > 1000**: Start dropping old messages
- **CPU usage > 80%**: Reduce sampling rate
- **Memory usage > 90%**: Pause non-critical operations
- **Network congestion**: Compress messages, batch smaller

This comprehensive API specification provides the foundation for building clients and integrating with the Claude-Flow Tracing and Visualization System while ensuring performance, reliability, and scalability.