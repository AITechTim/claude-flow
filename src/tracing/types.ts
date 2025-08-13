/**
 * Core tracing types and interfaces for Claude-Flow
 * Provides type definitions for the tracing and visualization system
 */

export type TraceEventType = 
  | 'agent_method'
  | 'communication' 
  | 'task_execution'
  | 'memory_access'
  | 'coordination'
  | 'error'
  | 'performance'
  | 'decision_point';

export type TracePhase = 'start' | 'progress' | 'complete' | 'error';

export type TracePriority = 'low' | 'normal' | 'high' | 'critical';

export interface TraceEvent {
  id: string;
  timestamp: number;
  sessionId: string;
  agentId: string;
  type: TraceEventType;
  phase: TracePhase;
  data: TraceEventData;
  metadata: TraceMetadata;
  performance: PerformanceMetrics;
}

export interface TraceEventData {
  // Input/Output traces
  prompt?: string;
  response?: string;
  tools?: ToolCall[];
  
  // Communication traces
  message?: AgentMessage;
  coordination?: CoordinationEvent;
  
  // Execution traces
  task?: TaskExecution;
  decision?: DecisionPoint;
  
  // Memory traces
  memoryAccess?: MemoryOperation;
  context?: ContextUpdate;
  
  // Error traces
  error?: ErrorDetails;
  
  // Custom data
  [key: string]: any;
}

export interface TraceMetadata {
  parentId?: string;
  causationId?: string;
  correlationId: string;
  tags: string[];
  priority: TracePriority;
  retention: number; // hours
  compressed?: boolean;
  archived?: boolean;
}

export interface PerformanceMetrics {
  duration: number;
  memoryUsage: number;
  tokenCount?: number;
  cpuTime: number;
  networkLatency?: number;
}

export interface ToolCall {
  name: string;
  args: Record<string, any>;
  result?: any;
  error?: string;
  duration: number;
}

export interface AgentMessage {
  from: string;
  to: string[];
  content: any;
  type: string;
  timestamp: number;
}

export interface CoordinationEvent {
  type: 'task_assignment' | 'resource_allocation' | 'synchronization';
  participants: string[];
  details: Record<string, any>;
}

export interface TaskExecution {
  taskId: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: any;
  error?: string;
}

export interface DecisionPoint {
  context: string;
  options: Array<{
    choice: string;
    rationale: string;
    confidence: number;
  }>;
  selected: string;
  reasoning: string;
}

export interface MemoryOperation {
  type: 'read' | 'write' | 'delete';
  key: string;
  value?: any;
  namespace: string;
}

export interface ContextUpdate {
  type: 'add' | 'remove' | 'modify';
  context: Record<string, any>;
  reason: string;
}

export interface ErrorDetails {
  message: string;
  stack?: string;
  code?: string;
  recoverable: boolean;
  context?: Record<string, any>;
}

// Session and Graph types
export interface TraceSession {
  id: string;
  name: string;
  startTime: number;
  endTime?: number;
  status: 'active' | 'completed' | 'failed';
  metadata: Record<string, any>;
  agentCount: number;
  traceCount: number;
}

export interface TraceGraph {
  nodes: TraceNode[];
  edges: TraceEdge[];
  layout: GraphLayout;
  metadata: GraphMetadata;
}

export interface TraceNode {
  id: string;
  trace: TraceEvent;
  label: string;
  type: TraceEventType;
  status: 'active' | 'completed' | 'error';
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  children: string[];
  parent?: string;
}

export interface TraceEdge {
  id: string;
  source: string;
  target: string;
  type: 'sequence' | 'parallel' | 'spawn' | 'callback' | 'communication';
  label?: string;
  weight: number;
  animated?: boolean;
}

export interface GraphLayout {
  type: 'hierarchical' | 'force' | 'timeline' | 'circular';
  direction?: 'TB' | 'BT' | 'LR' | 'RL';
  spacing: { x: number; y: number };
  rankSeparation?: number;
  nodeSeparation?: number;
}

export interface GraphMetadata {
  nodeCount: number;
  edgeCount: number;
  depth: number;
  width: number;
  complexity: number;
  criticalPath: string[];
}

// Time Travel types
export interface DebugState {
  mode: 'paused' | 'running' | 'stepping';
  currentTrace?: TraceEvent;
  currentTime: number;
  sessionId: string;
  breakpoints: Set<string>;
  watchExpressions: WatchExpression[];
  callStack: CallStackFrame[];
}

export interface WatchExpression {
  id: string;
  expression: string;
  value: any;
  type: string;
  lastUpdated: number;
  error?: string;
}

export interface CallStackFrame {
  id: string;
  traceId: string;
  functionName: string;
  agentId: string;
  timestamp: number;
  variables: Record<string, any>;
  source?: string;
  line?: number;
}

export interface SystemState {
  timestamp: number;
  agents: Record<string, AgentState>;
  tasks: Record<string, TaskState>;
  memory: Record<string, MemoryEntry>;
  communications: Record<string, CommunicationEntry[]>;
  resources: Record<string, ResourceState>;
}

export interface AgentState {
  id: string;
  status: string;
  currentTask?: string;
  variables: Record<string, any>;
  context: Record<string, any>;
  performance: PerformanceMetrics;
  createdAt: number;
  lastActivity: number;
}

export interface TaskState {
  id: string;
  agentId: string;
  type: string;
  status: string;
  progress: number;
  result?: any;
  error?: string;
  startedAt: number;
  completedAt?: number;
}

export interface MemoryEntry {
  value: any;
  timestamp: number;
  agentId: string;
  type: string;
  ttl?: number;
}

export interface CommunicationEntry {
  message: any;
  timestamp: number;
  direction: 'inbound' | 'outbound';
  target?: string;
  source?: string;
}

export interface ResourceState {
  id: string;
  type: string;
  status: string;
  allocation: Record<string, any>;
  usage: Record<string, number>;
  timestamp: number;
}

// Configuration types
export interface TracingConfig {
  enabled: boolean;
  level: 'minimal' | 'standard' | 'verbose' | 'debug';
  maxCpuThreshold: number;
  maxMemoryThreshold: number;
  minTraceInterval: number;
  retention: {
    default: number; // hours
    error: number;
    performance: number;
    debug: number;
  };
  compression: {
    enabled: boolean;
    threshold: number; // bytes
    algorithm: 'gzip' | 'lz4' | 'snappy';
  };
  sampling: {
    enabled: boolean;
    rate: number; // 0-1
    adaptiveRates: Record<TraceEventType, number>;
  };
  filters: {
    excludeEvents: TraceEventType[];
    includeAgents: string[];
    excludeAgents: string[];
    minimumPriority: TracePriority;
  };
  performance: {
    batchSize: number;
    flushInterval: number;
    maxQueueSize: number;
    asyncProcessing: boolean;
  };
  storage: {
    backend: 'sqlite' | 'memory' | 'hybrid';
    maxFileSize: number;
    maxFiles: number;
    compressionLevel: number;
  };
  realtime: {
    enabled: boolean;
    port: number;
    maxConnections: number;
    heartbeatInterval: number;
    compressionEnabled: boolean;
  };
}

// Streaming types
export interface StreamEvent {
  type: 'trace_event' | 'agent_event' | 'system_event' | 'batch_events';
  event: string;
  data: any;
  timestamp: number;
  sessionId: string;
}

export interface ClientMessage {
  type: 'subscribe_session' | 'request_history' | 'time_travel' | 'filter_agents' | 'set_breakpoint';
  sessionId?: string;
  timeRange?: TimeRange;
  timestamp?: number;
  agentIds?: string[];
  traceId?: string;
  condition?: string;
}

export interface TimeRange {
  start: number;
  end: number;
}

export interface CompressedBatch {
  events: CompressedEvent[];
  compression: 'delta' | 'gzip' | 'none';
  timestamp: number;
  checksum?: string;
}

export interface CompressedEvent {
  id: string;
  t: number; // timestamp
  a: string; // agentId
  type: string;
  data: any;
  p?: string; // parentId
}

// Visualization types
export interface VisualizationConfig {
  theme: 'light' | 'dark';
  layout: GraphLayout;
  animation: {
    enabled: boolean;
    duration: number;
    easing: string;
  };
  interaction: {
    zoomEnabled: boolean;
    panEnabled: boolean;
    selectionEnabled: boolean;
    tooltipsEnabled: boolean;
  };
  rendering: {
    maxNodes: number;
    lodThreshold: number;
    labelThreshold: number;
    edgeThreshold: number;
  };
}

export interface NodeStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  size: number;
  shape: 'circle' | 'square' | 'triangle' | 'diamond';
  label: {
    visible: boolean;
    color: string;
    fontSize: number;
    fontFamily: string;
  };
}

export interface EdgeStyle {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  marker: {
    start?: string;
    end?: string;
  };
  animation?: {
    flow: boolean;
    speed: number;
  };
}

// Export utility types
export type TraceEventHandler = (event: TraceEvent) => void | Promise<void>;
export type TraceFilter = (event: TraceEvent) => boolean;
export type TraceTransform = (event: TraceEvent) => TraceEvent;

export interface TraceCollectorOptions {
  config: TracingConfig;
  filters: TraceFilter[];
  transforms: TraceTransform[];
  handlers: TraceEventHandler[];
}

export interface GraphBuilderOptions {
  layout: GraphLayout;
  filters: {
    timeRange?: TimeRange;
    agentIds?: string[];
    eventTypes?: TraceEventType[];
    minPriority?: TracePriority;
  };
  aggregation: {
    enabled: boolean;
    threshold: number;
    method: 'time' | 'type' | 'agent';
  };
}