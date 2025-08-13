/**
 * TypeScript type definitions for the TracingDashboard system
 */

// Core trace event structure
export interface TraceEvent {
  id: string;
  type: string;
  agentId: string;
  timestamp: number;
  duration?: number;
  status?: 'pending' | 'success' | 'error';
  data?: Record<string, any>;
  relatedEvents?: string[];
  metadata?: {
    source?: string;
    version?: string;
    tags?: string[];
  };
}

// Agent information
export interface TraceAgent {
  id: string;
  name?: string;
  type?: string;
  status: 'active' | 'idle' | 'error';
  capabilities?: string[];
  metadata?: Record<string, any>;
  startTime: number;
  lastActivity: number;
}

// Session management
export interface TraceSession {
  id: string;
  name: string;
  startTime: number;
  endTime?: number;
  eventCount: number;
  agentCount: number;
  status: 'active' | 'completed' | 'error';
  description?: string;
  metadata?: Record<string, any>;
}

// Dashboard configuration
export interface DashboardConfig {
  maxEvents: number;
  autoReconnect: boolean;
  bufferSize: number;
  reconnectInterval: number;
  enableTimeTravel: boolean;
  theme: 'light' | 'dark' | 'auto';
  defaultView: 'graph' | 'timeline' | 'agents';
}

// Filter system
export interface DashboardFilters {
  agentIds: string[];
  eventTypes: string[];
  timeRange: [number, number] | null;
  searchQuery: string;
  statusFilter?: ('pending' | 'success' | 'error')[];
  durationFilter?: {
    min?: number;
    max?: number;
  };
}

// Layout management
export interface LayoutState {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  panelSizes: Record<string, number>;
  fullScreen: boolean;
  activeView: 'graph' | 'timeline' | 'agents';
  debugPanelOpen: boolean;
  searchPanelOpen: boolean;
  exportPanelOpen: boolean;
}

// Statistics and metrics
export interface DashboardStatistics {
  totalEvents: number;
  activeAgents: number;
  eventTypes: number;
  timeSpan: number;
  avgDuration: number;
  eventRate: number;
  errorRate: number;
  memoryUsage: {
    events: number;
    agents: number;
    estimatedSize: number;
  };
}

// Time travel system
export interface TimeSnapshot {
  id: string;
  timestamp: number;
  description: string;
  eventCount: number;
  agentCount: number;
  filters?: DashboardFilters;
}

export interface TimeTravelState {
  isActive: boolean;
  currentTimestamp: number;
  availableSnapshots: TimeSnapshot[];
  playbackSpeed: number;
  canGoBack: boolean;
  canGoForward: boolean;
}

// WebSocket connection
export interface WebSocketState {
  isConnected: boolean;
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'error';
  lastMessage?: any;
  messageQueue: any[];
  reconnectAttempts: number;
  latency?: number;
}

// Search functionality
export interface SearchResult {
  event: TraceEvent;
  matchType: 'id' | 'type' | 'agent' | 'data' | 'timestamp';
  matchText: string;
  score: number;
  highlights?: {
    field: string;
    matches: Array<{ start: number; end: number }>;
  }[];
}

export interface SearchOptions {
  mode: 'simple' | 'regex' | 'json';
  caseSensitive: boolean;
  includeEventData: boolean;
  sortBy: 'relevance' | 'timestamp' | 'duration';
  limit: number;
}

// Export/Import system
export interface ExportOptions {
  format: 'json' | 'csv' | 'png' | 'svg';
  includeFilters: boolean;
  includeStatistics: boolean;
  dateRange?: [number, number];
  compression?: boolean;
}

export interface ExportData {
  version: string;
  timestamp: number;
  sessionInfo: TraceSession;
  events: TraceEvent[];
  agents: TraceAgent[];
  statistics: DashboardStatistics;
  filters?: DashboardFilters;
  snapshots?: TimeSnapshot[];
}

// Component props interfaces
export interface TracingDashboardProps {
  onEventSelect?: (event: TraceEvent) => void;
  onAgentSelect?: (agent: TraceAgent) => void;
  onSessionChange?: (session: TraceSession) => void;
  className?: string;
  initialView?: 'graph' | 'timeline' | 'agents';
  sessionId?: string;
  enableTimeTravel?: boolean;
  maxEvents?: number;
  config?: Partial<DashboardConfig>;
  customTheme?: Record<string, string>;
}

export interface SessionSelectorProps {
  sessions: TraceSession[];
  selectedSession: string;
  onSessionChange: (sessionId: string) => void;
  loading?: boolean;
  error?: string;
}

export interface FilterControlsProps {
  events: TraceEvent[];
  agents: TraceAgent[];
  filters: DashboardFilters;
  onFiltersChange: (filters: Partial<DashboardFilters>) => void;
  statistics: DashboardStatistics;
  disabled?: boolean;
}

export interface SearchPanelProps {
  events: TraceEvent[];
  agents: TraceAgent[];
  searchQuery: string;
  searchOptions: SearchOptions;
  onSearchChange: (query: string) => void;
  onOptionsChange: (options: Partial<SearchOptions>) => void;
  onEventSelect: (event: TraceEvent) => void;
  onClose: () => void;
  maxResults?: number;
}

export interface ExportImportPanelProps {
  onExport: (options: ExportOptions) => Promise<void>;
  onImport: (file: File) => Promise<void>;
  onClose: () => void;
  eventCount: number;
  isExporting: boolean;
  supportedFormats: ExportOptions['format'][];
}

export interface StatsDashboardProps {
  statistics: DashboardStatistics;
  events: TraceEvent[];
  agents: TraceAgent[];
  connectionStatus: WebSocketState['connectionStatus'];
  isTimeTravelMode: boolean;
  refreshInterval?: number;
}

export interface DebugPanelProps {
  events: TraceEvent[];
  agents: TraceAgent[];
  connectionStatus: WebSocketState['connectionStatus'];
  lastMessage?: any;
  filters: DashboardFilters;
  layoutState: LayoutState;
  webSocketState: WebSocketState;
  onClose: () => void;
  onSendMessage: (message: any) => void;
  onClearEvents: () => void;
  onExportDebugInfo: () => void;
}

// Visualization components
export interface TraceGraphProps {
  events: TraceEvent[];
  agents: TraceAgent[];
  selectedEvent?: TraceEvent;
  onEventSelect: (event: TraceEvent) => void;
  isTimeTravelMode: boolean;
  currentTimestamp: number;
  filters: DashboardFilters;
  theme: 'light' | 'dark';
  fullScreen: boolean;
  layout?: 'force' | 'hierarchical' | 'circular';
}

export interface TimelineViewProps {
  events: TraceEvent[];
  agents: TraceAgent[];
  selectedEvent?: TraceEvent;
  onEventSelect: (event: TraceEvent) => void;
  isTimeTravelMode: boolean;
  currentTimestamp: number;
  filters: DashboardFilters;
  theme: 'light' | 'dark';
  zoomLevel?: number;
  showMinimap?: boolean;
}

export interface AgentPanelProps {
  agents: TraceAgent[];
  events: TraceEvent[];
  selectedAgent?: string;
  onAgentSelect: (agentId: string) => void;
  statistics: DashboardStatistics;
  theme: 'light' | 'dark';
  viewMode?: 'grid' | 'list' | 'tree';
}

// Hook interfaces
export interface UseLocalStorageResult<T> {
  value: T;
  setValue: (value: T | ((prev: T) => T)) => void;
  removeValue: () => void;
}

export interface UseThemeResult {
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  isDark: boolean;
  systemTheme: 'light' | 'dark';
}

export interface UseTraceWebSocketResult {
  isConnected: boolean;
  events: TraceEvent[];
  agents: TraceAgent[];
  connectionStatus: WebSocketState['connectionStatus'];
  lastMessage?: any;
  sendMessage: (message: any) => void;
  disconnect: () => void;
  reconnect: () => void;
  clearEvents: () => void;
  webSocketState: WebSocketState;
}

export interface UseTimeTravelResult {
  isTimeTravelMode: boolean;
  currentTimestamp: number;
  availableSnapshots: TimeSnapshot[];
  playbackSpeed: number;
  canGoBack: boolean;
  canGoForward: boolean;
  goToTime: (timestamp: number) => void;
  goBack: () => void;
  goForward: () => void;
  exitTimeTravel: () => void;
  createSnapshot: (description: string) => void;
  deleteSnapshot: (id: string) => void;
  setPlaybackSpeed: (speed: number) => void;
  state: TimeTravelState;
}

// Event handlers and callbacks
export type EventHandler<T = any> = (data: T) => void;
export type AsyncEventHandler<T = any> = (data: T) => Promise<void>;

export interface DashboardEventHandlers {
  onEventSelect: EventHandler<TraceEvent>;
  onAgentSelect: EventHandler<TraceAgent>;
  onSessionChange: EventHandler<string>;
  onFiltersChange: EventHandler<Partial<DashboardFilters>>;
  onViewChange: EventHandler<'graph' | 'timeline' | 'agents'>;
  onThemeChange: EventHandler<'light' | 'dark'>;
  onLayoutChange: EventHandler<Partial<LayoutState>>;
  onError: EventHandler<Error>;
  onExport: AsyncEventHandler<ExportOptions>;
  onImport: AsyncEventHandler<File>;
}

// Utility types
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;

export type OptionalFields<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

// Error types
export class DashboardError extends Error {
  constructor(message: string, public code?: string, public details?: any) {
    super(message);
    this.name = 'DashboardError';
  }
}

export class WebSocketError extends DashboardError {
  constructor(message: string, public wsError?: Event) {
    super(message, 'WEBSOCKET_ERROR');
  }
}

export class ExportError extends DashboardError {
  constructor(message: string, public exportOptions?: ExportOptions) {
    super(message, 'EXPORT_ERROR');
  }
}

export class ImportError extends DashboardError {
  constructor(message: string, public file?: File) {
    super(message, 'IMPORT_ERROR');
  }
}

// Constants
export const DASHBOARD_CONSTANTS = {
  MAX_EVENTS_DEFAULT: 10000,
  RECONNECT_INTERVAL_DEFAULT: 5000,
  SEARCH_DEBOUNCE_MS: 300,
  STATS_UPDATE_INTERVAL_MS: 1000,
  TIME_TRAVEL_STEP_MS: 1000,
  MIN_SIDEBAR_WIDTH: 200,
  MAX_SIDEBAR_WIDTH: 800,
  DEFAULT_PLAYBACK_SPEEDS: [0.25, 0.5, 1, 2, 4],
} as const;

export const EVENT_TYPES = {
  AGENT_START: 'agent_start',
  AGENT_STOP: 'agent_stop',
  TASK_START: 'task_start',
  TASK_COMPLETE: 'task_complete',
  ERROR: 'error',
  LOG: 'log',
  METRIC: 'metric',
  COMMUNICATION: 'communication',
} as const;

export const AGENT_STATUSES = {
  ACTIVE: 'active',
  IDLE: 'idle',
  ERROR: 'error',
} as const;

export const CONNECTION_STATUSES = {
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  ERROR: 'error',
} as const;