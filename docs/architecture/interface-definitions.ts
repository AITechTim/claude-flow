/**
 * Claude-Flow Tracing and Visualization System - Interface Definitions
 * 
 * Complete TypeScript interface definitions for all system components
 */

// ============================================================================
// Core Data Types
// ============================================================================

export interface TraceEvent {
  id: string;
  traceId: string;
  parentId?: string;
  agentId: string;
  eventType: EventType;
  timestamp: number;
  duration?: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  metadata: Record<string, any>;
  stackTrace?: string;
}

export type EventType =
  | 'agent.spawn'
  | 'agent.destroy'
  | 'agent.idle'
  | 'agent.busy'
  | 'task.assign'
  | 'task.start'
  | 'task.progress'
  | 'task.complete'
  | 'task.error'
  | 'communication.send'
  | 'communication.receive'
  | 'coordination.decision'
  | 'coordination.vote'
  | 'topology.change'
  | 'memory.store'
  | 'memory.retrieve'
  | 'performance.metric'
  | 'error.critical'
  | 'debug.internal';

export type Priority = 'critical' | 'high' | 'medium' | 'low';

export interface TimeRange {
  start: number;
  end: number;
}

export interface AgentMetrics {
  cpuUsage: number;
  memoryUsage: number;
  taskCount: number;
  messagesSent: number;
  messagesReceived: number;
  avgResponseTime: number;
  errorCount: number;
}

// ============================================================================
// TraceCollector Components
// ============================================================================

export interface TraceCollector {
  eventFilter: EventFilter;
  batchBuffer: BatchBuffer;
  compressionEngine: CompressionEngine;
  performanceMonitor: PerformanceMonitor;
  
  start(): Promise<void>;
  stop(): Promise<void>;
  collectEvent(event: TraceEvent): void;
  getMetrics(): CollectorMetrics;
}

export interface EventFilter {
  samplingRate: number;
  priorityLevels: Map<EventType, Priority>;
  activeFilters: Set<FilterRule>;
  
  shouldCapture(event: TraceEvent): boolean;
  updateSamplingRate(cpuUsage: number): void;
  addFilter(rule: FilterRule): void;
  removeFilter(ruleId: string): void;
}

export interface FilterRule {
  id: string;
  type: 'include' | 'exclude';
  field: keyof TraceEvent;
  operator: 'equals' | 'contains' | 'regex' | 'gt' | 'lt';
  value: any;
  priority: Priority;
}

export interface BatchBuffer {
  maxBatchSize: number;
  flushIntervalMs: number;
  buffer: TraceEvent[];
  
  add(event: TraceEvent): void;
  flush(): Promise<TraceEvent[]>;
  smartMerge(events: TraceEvent[]): TraceEvent[];
  clear(): void;
}

export interface CompressedBatch {
  id: string;
  data: Uint8Array;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  checksum: string;
  metadata: BatchMetadata;
}

export interface BatchMetadata {
  eventCount: number;
  timeRange: TimeRange;
  agentIds: string[];
  eventTypes: EventType[];
  priority: Priority;
}

export interface CompressionEngine {
  compress(batch: TraceEvent[]): CompressedBatch;
  decompress(batch: CompressedBatch): TraceEvent[];
  validateSchema(batch: TraceEvent[]): boolean;
  getCompressionStats(): CompressionStats;
}

export interface CompressionStats {
  totalCompressed: number;
  totalUncompressed: number;
  averageRatio: number;
  totalSavings: number;
}

export interface PerformanceMonitor {
  cpuUsage: number;
  memoryUsage: number;
  eventRate: number;
  overhead: number;
  
  startMonitoring(): void;
  stopMonitoring(): void;
  getOverheadPercentage(): number;
  shouldThrottle(): boolean;
}

export interface CollectorMetrics {
  eventsCollected: number;
  eventsFiltered: number;
  batchesProduced: number;
  compressionRatio: number;
  cpuOverhead: number;
  memoryOverhead: number;
  averageLatency: number;
}

// ============================================================================
// WebSocket Streaming Server
// ============================================================================

export interface StreamingServer {
  connectionManager: ConnectionManager;
  broadcastEngine: BroadcastEngine;
  backpressureControl: BackpressureControl;
  
  start(port: number): Promise<void>;
  stop(): Promise<void>;
  broadcast(message: StreamMessage): void;
  getStats(): ServerStats;
}

export interface ConnectionManager {
  connections: Map<string, ClientConnection>;
  healthChecker: HealthChecker;
  
  authenticate(token: string): Promise<ClientInfo>;
  addConnection(ws: WebSocket, clientInfo: ClientInfo): string;
  removeConnection(clientId: string): void;
  getConnection(clientId: string): ClientConnection | undefined;
  broadcastToAll(message: StreamMessage): void;
}

export interface ClientConnection {
  id: string;
  websocket: WebSocket;
  info: ClientInfo;
  lastHeartbeat: number;
  messageQueue: StreamMessage[];
  isHealthy: boolean;
  rateLimit: RateLimit;
}

export interface ClientInfo {
  userId: string;
  sessionId: string;
  subscriptions: string[];
  permissions: string[];
  connectedAt: number;
}

export interface HealthChecker {
  checkInterval: number;
  timeoutMs: number;
  
  startChecking(): void;
  stopChecking(): void;
  checkConnection(clientId: string): Promise<boolean>;
  markUnhealthy(clientId: string): void;
}

export interface BroadcastEngine {
  fanOutRatio: number;
  messageQueue: PriorityQueue<StreamMessage>;
  
  broadcast(message: StreamMessage, filter?: ClientFilter): void;
  unicast(clientId: string, message: StreamMessage): void;
  multicast(clientIds: string[], message: StreamMessage): void;
  subscribeToTrace(clientId: string, traceId: string): void;
  unsubscribeFromTrace(clientId: string, traceId: string): void;
}

export interface ClientFilter {
  traceIds?: string[];
  agentIds?: string[];
  eventTypes?: EventType[];
  minLevel?: 'debug' | 'info' | 'warn' | 'error';
  permissions?: string[];
}

export interface BackpressureControl {
  rateLimiter: RateLimiter;
  queueManager: QueueManager;
  
  shouldThrottle(clientId: string): boolean;
  adjustRate(clientId: string, latency: number): void;
  dropOldMessages(maxAge: number): number;
  getQueueDepth(clientId: string): number;
}

export interface RateLimit {
  maxMessagesPerSecond: number;
  currentRate: number;
  windowStart: number;
  messageCount: number;
}

export interface RateLimiter {
  checkLimit(clientId: string): boolean;
  updateRate(clientId: string, newRate: number): void;
  resetWindow(clientId: string): void;
  getStats(clientId: string): RateLimitStats;
}

export interface RateLimitStats {
  currentRate: number;
  maxRate: number;
  droppedMessages: number;
  throttledDuration: number;
}

export interface QueueManager {
  maxQueueSize: number;
  
  enqueue(clientId: string, message: StreamMessage): boolean;
  dequeue(clientId: string): StreamMessage | undefined;
  getQueueSize(clientId: string): number;
  clearQueue(clientId: string): void;
  prioritize(clientId: string, priority: Priority): void;
}

export interface PriorityQueue<T> {
  enqueue(item: T, priority: Priority): void;
  dequeue(): T | undefined;
  peek(): T | undefined;
  size(): number;
  clear(): void;
}

export interface ServerStats {
  connections: number;
  messagesSent: number;
  messagesDropped: number;
  averageLatency: number;
  queueDepth: number;
  cpuUsage: number;
  memoryUsage: number;
}

// ============================================================================
// WebSocket Protocol
// ============================================================================

export interface StreamMessage {
  type: StreamMessageType;
  timestamp: number;
  traceId: string;
  sequenceNumber: number;
  payload: any;
  compression?: 'lz4' | 'none';
  checksum?: string;
}

export type StreamMessageType =
  | 'trace_event'
  | 'trace_start'
  | 'trace_end'
  | 'agent_update'
  | 'heartbeat'
  | 'error'
  | 'subscription_ack'
  | 'rate_limit_exceeded';

export interface TraceEventMessage extends StreamMessage {
  type: 'trace_event';
  payload: {
    events: TraceEvent[];
    batchId: string;
    metadata: BatchMetadata;
  };
}

export interface TraceStartMessage extends StreamMessage {
  type: 'trace_start';
  payload: {
    traceId: string;
    sessionId: string;
    agentCount: number;
    topology: string;
  };
}

export interface TraceEndMessage extends StreamMessage {
  type: 'trace_end';
  payload: {
    traceId: string;
    reason: 'completed' | 'stopped' | 'error';
    summary: TraceSummary;
  };
}

export interface AgentUpdateMessage extends StreamMessage {
  type: 'agent_update';
  payload: {
    agentId: string;
    status: AgentStatus;
    metrics: AgentMetrics;
    position?: { x: number; y: number };
  };
}

export interface HeartbeatMessage extends StreamMessage {
  type: 'heartbeat';
  payload: {
    serverTime: number;
    connectionCount: number;
    systemHealth: SystemHealth;
  };
}

export interface ErrorMessage extends StreamMessage {
  type: 'error';
  payload: {
    error: string;
    code: ErrorCode;
    details: any;
    recoverable: boolean;
  };
}

export type ErrorCode = 
  | 'AUTHENTICATION_FAILED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'TRACE_NOT_FOUND'
  | 'SUBSCRIPTION_DENIED'
  | 'SERVER_ERROR'
  | 'CLIENT_ERROR';

// ============================================================================
// Database Models
// ============================================================================

export interface TraceSummary {
  id: string;
  sessionId: string;
  startTime: number;
  endTime?: number;
  status: 'active' | 'completed' | 'stopped' | 'error';
  agentCount: number;
  eventCount: number;
  totalDurationMs?: number;
  errorCount: number;
  topology: string;
}

export interface TraceDetails extends TraceSummary {
  agents: AgentSummary[];
  metrics: TraceMetrics;
  configuration: TraceConfiguration;
}

export interface AgentSummary {
  id: string;
  name: string;
  type: string;
  status: AgentStatus;
  spawnTime: number;
  destroyTime?: number;
  taskCount: number;
  errorCount: number;
  metrics: AgentMetrics;
}

export type AgentStatus = 'spawning' | 'idle' | 'busy' | 'error' | 'destroyed';

export interface TraceMetrics {
  totalEvents: number;
  eventsPerSecond: number;
  averageEventProcessingTime: number;
  peakMemoryUsage: number;
  peakCpuUsage: number;
  networkTraffic: number;
  errorRate: number;
}

export interface TraceConfiguration {
  samplingRate: number;
  eventFilters: FilterRule[];
  retentionPolicy: RetentionPolicy;
  compressionEnabled: boolean;
  realTimeStreaming: boolean;
}

export interface RetentionPolicy {
  maxAge: number; // milliseconds
  maxEvents: number;
  autoCleanup: boolean;
  archiveAfter: number; // milliseconds
}

export interface Snapshot {
  id: string;
  traceId: string;
  timestamp: number;
  agentId: string;
  stateType: SnapshotType;
  stateData: any;
  checksum: string;
  sizeBytes: number;
  compressed: boolean;
}

export type SnapshotType = 'agent_state' | 'memory_state' | 'task_state' | 'coordination_state';

export interface SnapshotMetadata {
  id: string;
  traceId: string;
  timestamp: number;
  agentId: string;
  stateType: SnapshotType;
  sizeBytes: number;
  checksum: string;
}

// ============================================================================
// React Component Interfaces
// ============================================================================

export interface TraceVisualizationProps {
  traceId: string;
  realTimeMode: boolean;
  timeRange?: TimeRange;
  onTimeRangeChange?: (range: TimeRange) => void;
  onEventSelect?: (event: TraceEvent) => void;
}

export interface TraceVisualizationState {
  currentTrace: TraceState;
  selectedTimepoint: number;
  viewportState: ViewportState;
  isLoading: boolean;
  error?: string;
}

export interface TraceState {
  metadata: TraceDetails;
  events: TraceEvent[];
  agents: Map<string, AgentState>;
  snapshots: SnapshotMetadata[];
  currentTime: number;
  totalDuration: number;
}

export interface AgentState {
  info: AgentSummary;
  currentTask?: TaskInfo;
  recentEvents: TraceEvent[];
  connections: AgentConnection[];
  position: { x: number; y: number };
  metrics: AgentMetrics;
}

export interface AgentConnection {
  targetAgentId: string;
  type: 'communication' | 'coordination' | 'dependency';
  strength: number;
  latency?: number;
  messageCount: number;
  lastInteraction: number;
}

export interface TaskInfo {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  startTime: number;
  estimatedCompletion?: number;
  dependencies: string[];
}

export interface ViewportState {
  zoom: number;
  centerX: number;
  centerY: number;
  selectedAgentId?: string;
  selectedEventId?: string;
  showTimeline: boolean;
  showMetrics: boolean;
  showConnections: boolean;
}

export interface D3GraphRenderer {
  svg: d3.Selection<SVGGElement, unknown, HTMLElement, any>;
  simulation: d3.Simulation<AgentNode, AgentLink>;
  
  initialize(container: HTMLElement): void;
  renderAgents(agents: AgentNode[]): void;
  renderConnections(links: AgentLink[]): void;
  updateAgentStates(updates: Map<string, AgentState>): void;
  animateTransition(fromState: GraphState, toState: GraphState, duration: number): void;
  handleZoom(transform: d3.ZoomTransform): void;
  highlightPath(agentIds: string[]): void;
  dispose(): void;
}

export interface AgentNode extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  type: string;
  status: AgentStatus;
  metrics: AgentMetrics;
  radius: number;
  color: string;
  currentTask?: TaskInfo;
  fx?: number; // Fixed position
  fy?: number;
}

export interface AgentLink extends d3.SimulationLinkDatum<AgentNode> {
  source: string | AgentNode;
  target: string | AgentNode;
  type: 'communication' | 'coordination' | 'dependency';
  strength: number;
  latency?: number;
  messageCount: number;
  strokeWidth: number;
  color: string;
}

export interface GraphState {
  nodes: AgentNode[];
  links: AgentLink[];
  timestamp: number;
  zoom: number;
  center: { x: number; y: number };
}

export interface TimelineViewProps {
  events: TraceEvent[];
  timeRange: TimeRange;
  currentTime: number;
  onTimeChange: (time: number) => void;
  onTimeRangeChange: (range: TimeRange) => void;
}

export interface AgentDetailsPanelProps {
  agentId: string;
  agentState: AgentState;
  events: TraceEvent[];
  onClose: () => void;
}

// ============================================================================
// Time Travel Engine
// ============================================================================

export interface TimeTravelEngine {
  currentTimestamp: number;
  availableSnapshots: SnapshotMetadata[];
  stateCache: Map<number, ReconstructedState>;
  
  jumpToTime(timestamp: number): Promise<ReconstructedState>;
  playForward(fromTime: number, toTime: number, speed: number): AsyncGenerator<ReconstructedState>;
  replayEvents(events: TraceEvent[], speed: number): AsyncGenerator<TraceEvent>;
  diffStates(state1: ReconstructedState, state2: ReconstructedState): StateDiff;
  createSnapshot(state: ReconstructedState): Promise<SnapshotMetadata>;
  restoreFromSnapshot(snapshotId: string): Promise<ReconstructedState>;
}

export interface StateReconstructor {
  reconstructState(timestamp: number, events: TraceEvent[], snapshots: Snapshot[]): Promise<ReconstructedState>;
  findNearestSnapshot(timestamp: number, snapshots: SnapshotMetadata[]): SnapshotMetadata | null;
  applyEventsToState(baseState: ReconstructedState, events: TraceEvent[]): ReconstructedState;
  validateStateConsistency(state: ReconstructedState): boolean;
}

export interface ReconstructedState {
  timestamp: number;
  agents: Map<string, AgentState>;
  globalMemory: Map<string, any>;
  activeConnections: AgentConnection[];
  taskStates: Map<string, TaskInfo>;
  systemMetrics: SystemMetrics;
  checksum: string;
}

export interface StateDiff {
  timestamp: number;
  agentChanges: Map<string, AgentDiff>;
  memoryChanges: Map<string, ValueDiff>;
  connectionChanges: ConnectionDiff[];
  taskChanges: Map<string, TaskDiff>;
  metricsChanges: MetricsDiff;
}

export interface AgentDiff {
  agentId: string;
  statusChanged: boolean;
  oldStatus?: AgentStatus;
  newStatus?: AgentStatus;
  positionChanged: boolean;
  oldPosition?: { x: number; y: number };
  newPosition?: { x: number; y: number };
  metricsChanged: boolean;
  taskChanged: boolean;
  eventsAdded: TraceEvent[];
}

export interface ValueDiff {
  key: string;
  operation: 'added' | 'removed' | 'modified';
  oldValue?: any;
  newValue?: any;
}

export interface ConnectionDiff {
  sourceAgentId: string;
  targetAgentId: string;
  operation: 'added' | 'removed' | 'modified';
  oldConnection?: AgentConnection;
  newConnection?: AgentConnection;
}

export interface TaskDiff {
  taskId: string;
  operation: 'added' | 'removed' | 'modified';
  oldTask?: TaskInfo;
  newTask?: TaskInfo;
  progressChanged: boolean;
  statusChanged: boolean;
}

export interface MetricsDiff {
  cpuUsageChange: number;
  memoryUsageChange: number;
  eventRateChange: number;
  errorCountChange: number;
  performanceScoreChange: number;
}

export interface SystemMetrics {
  cpuUsage: number;
  memoryUsage: number;
  eventRate: number;
  errorCount: number;
  activeConnections: number;
  totalAgents: number;
  activeAgents: number;
  performanceScore: number;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'critical';
  issues: HealthIssue[];
  uptime: number;
  lastCheck: number;
}

export interface HealthIssue {
  severity: 'low' | 'medium' | 'high' | 'critical';
  component: string;
  message: string;
  timestamp: number;
  resolved: boolean;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: number;
  timestamp: number;
}

export interface PerformanceMetrics {
  collectionOverhead: number;
  storageOverhead: number;
  networkOverhead: number;
  totalOverhead: number;
  systemImpact: 'minimal' | 'low' | 'medium' | 'high';
  recommendations: string[];
}

export interface StorageMetrics {
  totalSizeBytes: number;
  compressedSizeBytes: number;
  compressionRatio: number;
  traceCount: number;
  eventCount: number;
  snapshotCount: number;
  oldestTrace: number;
  newestTrace: number;
}