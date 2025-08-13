/**
 * Core Types and Interfaces for Tracing System
 */

export interface TraceEvent {
  id: string;
  timestamp: number;
  type: TraceEventType | string;
  agentId?: string;
  swarmId?: string;
  sessionId: string;
  data: Record<string, any>;
  duration?: number;
  parentId?: string;
  children?: string[];
  metadata?: EventMetadata & {
    parentId?: string;
    correlationId?: string;
  };
  performance?: Record<string, any>;
  phase?: string;
}

export enum TraceEventType {
  AGENT_SPAWN = 'AGENT_SPAWN',
  AGENT_DESTROY = 'AGENT_DESTROY',
  TASK_START = 'TASK_START',
  TASK_COMPLETE = 'TASK_COMPLETE',
  TASK_FAIL = 'TASK_FAIL',
  MESSAGE_SEND = 'MESSAGE_SEND',
  MESSAGE_RECEIVE = 'MESSAGE_RECEIVE',
  STATE_CHANGE = 'STATE_CHANGE',
  COORDINATION_EVENT = 'COORDINATION_EVENT',
  PERFORMANCE_METRIC = 'PERFORMANCE_METRIC'
}

export interface EventMetadata {
  source: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  tags: string[];
  correlationId?: string;
}

export interface AgentTrace {
  agentId: string;
  agentType: string;
  events: TraceEvent[];
  startTime: number;
  endTime?: number;
  state: AgentState;
  performance: PerformanceMetrics;
}

export interface AgentState {
  id: string;
  status: 'idle' | 'busy' | 'error' | 'terminated' | 'spawning';
  currentTask?: string;
  capabilities?: string[];
  variables: Record<string, any>;
  context: Record<string, any>;
  performance: {
    duration: number;
    memoryUsage: number;
    cpuTime: number;
  };
  createdAt: number;
  lastActivity: number;
  resources?: ResourceUsage;
  memory?: Record<string, any>;
}

export interface PerformanceMetrics {
  cpuUsage: number;
  memoryUsage: number;
  taskCount: number;
  averageResponseTime: number;
  throughput: number;
  errorRate: number;
}

export interface ResourceUsage {
  cpu: number;
  memory: number;
  disk: number;
  network: number;
}

export interface TraceSnapshot {
  id: string;
  timestamp: number;
  swarmState: SwarmState;
  agentStates: Map<string, AgentState>;
  eventCount: number;
  version: string;
}

export interface SwarmState {
  id: string;
  topology: 'mesh' | 'hierarchical' | 'ring' | 'star';
  activeAgents: string[];
  runningTasks: string[];
  coordinationStatus: 'active' | 'degraded' | 'failed';
}

export interface TracingConfig {
  enabled: boolean;
  samplingRate: number;
  bufferSize: number;
  flushInterval: number;
  storageRetention: number;
  compressionEnabled: boolean;
  realtimeStreaming: boolean;
  performanceMonitoring: boolean;
  level?: string;
}

// Additional interfaces needed for storage
export interface TraceSession {
  id: string;
  name: string;
  startTime: number;
  endTime?: number;
  status: string;
  metadata: Record<string, any>;
  agentCount: number;
  traceCount: number;
}

export interface TraceGraph {
  nodes: TraceNode[];
  edges: TraceEdge[];
  layout: {
    type: string;
    direction: string;
    spacing: { x: number; y: number };
    nodeSize?: { width: number; height: number };
    rankSep?: number;
    nodeSep?: number;
  };
  metadata: {
    nodeCount: number;
    edgeCount: number;
    depth: number;
    width: number;
    complexity: number;
    criticalPath: string[];
    rootNodes?: number;
    executionTime?: number;
  };
}

export interface TraceNode {
  id: string;
  label: string;
  type: string;
  agentId?: string;
  timestamp: number;
  duration: number;
  data: Record<string, any>;
  position: { x: number; y: number };
  style: Record<string, any>;
}

export interface TraceEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  label: string;
  style: Record<string, any>;
}

export interface TimeRange {
  start: number;
  end: number;
}

export interface SystemState {
  timestamp: number;
  agents: Record<string, AgentState>;
  tasks: Record<string, TaskState>;
  memory: Record<string, MemoryEntry>;
  communications: Record<string, CommunicationEntry[]>;
  resources: Record<string, ResourceState>;
  swarms?: Record<string, SwarmState>;
  metrics?: Record<string, any>;
}

export interface TaskState {
  id: string;
  agentId: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  startedAt?: number;
  completedAt?: number;
  result?: any;
  error?: any;
}

export interface MemoryEntry {
  value: any;
  timestamp: number;
  agentId: string;
  type: string;
}

export interface CommunicationEntry {
  message: string;
  timestamp: number;
  direction: 'inbound' | 'outbound';
  source?: string;
  target?: string;
}

export interface ResourceState {
  id: string;
  type: string;
  status: string;
  allocation: any;
  usage: Record<string, any>;
  timestamp: number;
}

export interface StreamingClient {
  id: string;
  socket: WebSocket;
  filters: EventFilter[];
  lastHeartbeat: number;
  subscriptions: string[];
}

export interface EventFilter {
  type?: TraceEventType[];
  agentId?: string[];
  timeRange?: { start: number; end: number };
  severity?: string[];
  tags?: string[];
}

// Streaming types for WebSocket implementation
export interface StreamEvent {
  type: 'trace_event' | 'system_event' | 'heartbeat' | 'session_info' | 'initial_traces' | 'historical_data' | 'time_travel_state' | 'error' | 'connection';
  event?: string;
  data?: any;
  timestamp: number;
  sessionId?: string;
  clientId?: string;
  serverInfo?: {
    version: string;
    capabilities: string[];
    limits: {
      maxMessageSize: number;
      batchSize: number;
    };
  };
  session?: TraceSession;
  traces?: TraceEvent[];
  timeRange?: TimeRange;
  total?: number;
  error?: {
    code: string;
    message: string;
  };
}

export interface ClientMessage {
  type: 'subscribe_session' | 'request_history' | 'time_travel' | 'filter_agents' | 'set_breakpoint' | 'remove_breakpoint' | 'heartbeat' | 'auth';
  sessionId?: string;
  timeRange?: TimeRange;
  timestamp?: number;
  agentIds?: string[];
  traceId?: string;
  condition?: string;
  token?: string;
}

export interface CompressedBatch {
  events: any[];
  compression: 'none' | 'delta' | 'gzip';
  timestamp: number;
  checksum?: string;
}

export interface TimeRange {
  start: number;
  end: number;
}

export interface TraceSession {
  id: string;
  name?: string;
  startTime: number;
  endTime?: number;
  agentCount: number;
  eventCount: number;
  status: 'active' | 'completed' | 'error';
  metadata?: Record<string, any>;
}

// Rate limiting
export interface RateLimitConfig {
  windowMs: number;
  maxMessages: number;
  maxBytesPerWindow: number;
}

export interface ClientRateLimit {
  windowStart: number;
  messageCount: number;
  bytesCount: number;
}

// Connection health
export interface ConnectionHealth {
  lastPing: number;
  lastPong: number;
  latency: number;
  isHealthy: boolean;
}

// Authentication
export interface AuthConfig {
  enabled: boolean;
  jwtSecret?: string;
  apiKeyHeader?: string;
  validApiKeys?: Set<string>;
}

export interface ClientAuth {
  authenticated: boolean;
  userId?: string;
  permissions?: string[];
  expiresAt?: number;
}

// Binary protocol
export interface BinaryMessage {
  type: number; // Message type as number
  length: number;
  data: Buffer;
  checksum: number;
}

// Backpressure handling
export interface BackpressureConfig {
  highWaterMark: number;
  lowWaterMark: number;
  maxQueueSize: number;
  dropOldest: boolean;
}

export interface ClientBackpressure {
  queueSize: number;
  isBlocked: boolean;
  lastDrop: number;
  droppedCount: number;
}