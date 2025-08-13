/**
 * Main tracing dashboard component with real-time visualization
 * Provides LangGraph Studio-level debugging and monitoring capabilities
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  TraceEvent, 
  TraceSession, 
  DebugState, 
  WatchExpression,
  TimeRange 
} from '../../../tracing/types.js';
import { TraceGraph } from './TraceGraph';
import { TimelineView } from './TimelineView';
import { AgentPanel } from './AgentPanel';
import { DebugPanel } from './DebugPanel';
import { SessionSelector } from './SessionSelector';
import { TimeControls } from './TimeControls';
import { PerformancePanel } from './PerformancePanel';
import { useTraceWebSocket } from '../hooks/useTraceWebSocket';
import { useTimeTravel } from '../hooks/useTimeTravel';
import './TracingDashboard.css';

export interface TracingDashboardProps {
  initialSession?: string;
  autoConnect?: boolean;
  onSessionChange?: (session: TraceSession | null) => void;
  onTraceSelect?: (trace: TraceEvent) => void;
}

export const TracingDashboard: React.FC<TracingDashboardProps> = ({
  initialSession,
  autoConnect = true,
  onSessionChange,
  onTraceSelect
}) => {
  // Core state
  const [session, setSession] = useState<TraceSession | null>(null);
  const [traces, setTraces] = useState<TraceEvent[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<TraceEvent | null>(null);
  const [isLive, setIsLive] = useState(true);
  const [currentTime, setCurrentTime] = useState<number>(Date.now());
  
  // UI state
  const [layout, setLayout] = useState<'horizontal' | 'vertical'>('horizontal');
  const [showPerformance, setShowPerformance] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  
  // Filters and settings
  const [agentFilter, setAgentFilter] = useState<string[]>([]);
  const [eventTypeFilter, setEventTypeFilter] = useState<string[]>([]);
  const [timeRange, setTimeRange] = useState<TimeRange | null>(null);
  
  // Debug state
  const [debugState, setDebugState] = useState<DebugState>({
    mode: 'paused',
    currentTime: Date.now(),
    sessionId: '',
    breakpoints: new Set(),
    watchExpressions: [],
    callStack: []
  });

  // Hooks
  const traceSocket = useTraceWebSocket({
    autoConnect,
    onTraceEvent: handleNewTrace,
    onBatchEvents: handleBatchTraces,
    onSystemEvent: handleSystemEvent,
    onError: handleSocketError
  });
  
  const timeTravel = useTimeTravel(session?.id || '', {
    onStateChange: handleStateChange,
    onError: handleTimeTravelError
  });

  // Effects
  useEffect(() => {
    if (initialSession) {
      loadSession(initialSession);
    }
  }, [initialSession]);

  useEffect(() => {
    if (session) {
      traceSocket.subscribeToSession(session.id);
      setDebugState(prev => ({ ...prev, sessionId: session.id }));
      onSessionChange?.(session);
    }
  }, [session, traceSocket, onSessionChange]);

  // Filtered traces for current view
  const filteredTraces = useMemo(() => {
    let filtered = traces;
    
    // Apply time filter
    if (!isLive && currentTime) {
      filtered = filtered.filter(trace => trace.timestamp <= currentTime);
    }
    
    // Apply agent filter
    if (agentFilter.length > 0) {
      filtered = filtered.filter(trace => agentFilter.includes(trace.agentId));
    }
    
    // Apply event type filter
    if (eventTypeFilter.length > 0) {
      filtered = filtered.filter(trace => eventTypeFilter.includes(trace.type));
    }
    
    // Apply time range filter
    if (timeRange) {
      filtered = filtered.filter(trace => 
        trace.timestamp >= timeRange.start && trace.timestamp <= timeRange.end
      );
    }
    
    return filtered;
  }, [traces, isLive, currentTime, agentFilter, eventTypeFilter, timeRange]);

  // Event handlers
  const handleNewTrace = useCallback((event: TraceEvent) => {
    if (isLive) {
      setTraces(prev => {
        const newTraces = [...prev, event];
        // Keep only last 1000 traces in memory for performance
        return newTraces.slice(-1000);
      });
    }
  }, [isLive]);

  const handleBatchTraces = useCallback((batch: { events: TraceEvent[] }) => {
    if (isLive) {
      setTraces(prev => {
        const newTraces = [...prev, ...batch.events];
        return newTraces.slice(-1000);
      });
    }
  }, [isLive]);

  const handleSystemEvent = useCallback((event: { event: string; data: any }) => {
    console.log('System event:', event);
    // Handle system events like agent status changes, performance alerts, etc.
  }, []);

  const handleSocketError = useCallback((error: Error) => {
    console.error('WebSocket error:', error);
    // Show error notification
  }, []);

  const handleStateChange = useCallback((state: any) => {
    // Handle time travel state changes
    setTraces(state.traces || []);
  }, []);

  const handleTimeTravelError = useCallback((error: Error) => {
    console.error('Time travel error:', error);
  }, []);

  const handleSessionChange = useCallback((newSession: TraceSession | null) => {
    setSession(newSession);
    setTraces([]);
    setSelectedTrace(null);
    setCurrentTime(Date.now());
    setIsLive(true);
  }, []);

  const handleTraceSelect = useCallback((trace: TraceEvent) => {
    setSelectedTrace(trace);
    onTraceSelect?.(trace);
  }, [onTraceSelect]);

  const handleTimeTravel = useCallback((timestamp: number) => {
    setIsLive(false);
    setCurrentTime(timestamp);
    timeTravel.goToTime(timestamp);
  }, [timeTravel]);

  const handleLiveToggle = useCallback((live: boolean) => {
    setIsLive(live);
    if (live) {
      setCurrentTime(Date.now());
    }
  }, []);

  // Debug actions
  const handleStepInto = useCallback(async () => {
    if (!selectedTrace) return;
    
    const childTraces = await timeTravel.getChildTraces(selectedTrace.id);
    if (childTraces.length > 0) {
      handleTraceSelect(childTraces[0]);
      handleTimeTravel(childTraces[0].timestamp);
    }
  }, [selectedTrace, timeTravel, handleTraceSelect, handleTimeTravel]);

  const handleStepOver = useCallback(async () => {
    if (!selectedTrace) return;
    
    const nextTrace = await timeTravel.getNextSiblingTrace(selectedTrace.id);
    if (nextTrace) {
      handleTraceSelect(nextTrace);
      handleTimeTravel(nextTrace.timestamp);
    }
  }, [selectedTrace, timeTravel, handleTraceSelect, handleTimeTravel]);

  const handleStepOut = useCallback(async () => {
    if (!selectedTrace?.metadata.parentId) return;
    
    const parentTrace = await timeTravel.getTrace(selectedTrace.metadata.parentId);
    if (parentTrace) {
      handleTraceSelect(parentTrace);
      handleTimeTravel(parentTrace.timestamp);
    }
  }, [selectedTrace, timeTravel, handleTraceSelect, handleTimeTravel]);

  const handleResume = useCallback(() => {
    setDebugState(prev => ({ ...prev, mode: 'running' }));
    setIsLive(true);
  }, []);

  const handleAddBreakpoint = useCallback((traceId: string, condition?: string) => {
    setDebugState(prev => ({
      ...prev,
      breakpoints: new Set([...prev.breakpoints, traceId])
    }));
    
    traceSocket.setBreakpoint(traceId, condition);
  }, [traceSocket]);

  const handleAddWatchExpression = useCallback((expression: string) => {
    const watchId = `watch_${Date.now()}`;
    const watch: WatchExpression = {
      id: watchId,
      expression,
      value: null,
      type: 'unknown',
      lastUpdated: Date.now()
    };
    
    setDebugState(prev => ({
      ...prev,
      watchExpressions: [...prev.watchExpressions, watch]
    }));
  }, []);

  // Utility functions
  const loadSession = async (sessionId: string) => {
    try {
      // Load session info from API
      const response = await fetch(`/api/sessions/${sessionId}`);
      const sessionData = await response.json();
      setSession(sessionData);
    } catch (error) {
      console.error('Failed to load session:', error);
    }
  };

  const exportTraces = useCallback(() => {
    const dataStr = JSON.stringify(filteredTraces, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `traces-${session?.id || 'unknown'}-${Date.now()}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  }, [filteredTraces, session]);

  return (
    <div className={`tracing-dashboard ${layout} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Header */}
      <div className="dashboard-header">
        <div className="header-left">
          <SessionSelector 
            currentSession={session}
            onSessionChange={handleSessionChange}
          />
          
          <div className="live-indicator">
            <span className={`status-dot ${isLive ? 'live' : 'paused'}`} />
            <span>{isLive ? 'Live' : 'Paused'}</span>
          </div>
        </div>
        
        <div className="header-center">
          <TimeControls 
            currentTime={currentTime}
            isLive={isLive}
            traces={traces}
            onTimeChange={handleTimeTravel}
            onLiveToggle={handleLiveToggle}
          />
        </div>
        
        <div className="header-right">
          <button 
            className="btn btn-icon"
            onClick={() => setLayout(layout === 'horizontal' ? 'vertical' : 'horizontal')}
            title="Toggle Layout"
          >
            📐
          </button>
          
          <button 
            className="btn btn-icon"
            onClick={() => setShowPerformance(!showPerformance)}
            title="Toggle Performance Panel"
          >
            📊
          </button>
          
          <button 
            className="btn btn-icon"
            onClick={exportTraces}
            title="Export Traces"
          >
            💾
          </button>
          
          <button 
            className="btn btn-icon"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title="Toggle Sidebar"
          >
            {sidebarCollapsed ? '→' : '←'}
          </button>
        </div>
      </div>
      
      {/* Main Content */}
      <div className="dashboard-content">
        {/* Left Sidebar */}
        <div className="left-panel">
          <AgentPanel 
            traces={filteredTraces}
            session={session}
            selectedAgents={agentFilter}
            onAgentSelect={setAgentFilter}
            onAgentClick={(agentId) => {
              const agentTraces = filteredTraces.filter(t => t.agentId === agentId);
              if (agentTraces.length > 0) {
                handleTraceSelect(agentTraces[agentTraces.length - 1]);
              }
            }}
          />
        </div>
        
        {/* Main Visualization Area */}
        <div className="main-content">
          <div className="visualization-container">
            <TraceGraph 
              traces={filteredTraces}
              selectedTrace={selectedTrace}
              onNodeClick={handleTraceSelect}
              onNodeDoubleClick={(trace) => {
                handleTraceSelect(trace);
                handleTimeTravel(trace.timestamp);
              }}
              layout="hierarchical"
              showMinimap={true}
              showMetrics={true}
            />
          </div>
          
          <div className="timeline-container">
            <TimelineView 
              traces={filteredTraces}
              currentTime={currentTime}
              selectedTrace={selectedTrace}
              isLive={isLive}
              onTimeSelect={handleTimeTravel}
              onTraceSelect={handleTraceSelect}
              showAgentLanes={true}
              showPerformanceMetrics={true}
            />
          </div>
        </div>
        
        {/* Right Sidebar */}
        <div className="right-panel">
          <DebugPanel 
            selectedTrace={selectedTrace}
            debugState={debugState}
            session={session}
            onStepInto={handleStepInto}
            onStepOver={handleStepOver}
            onStepOut={handleStepOut}
            onResume={handleResume}
            onAddBreakpoint={handleAddBreakpoint}
            onAddWatch={handleAddWatchExpression}
            onVariableInspect={(variable) => {
              // Handle variable inspection
              console.log('Inspect variable:', variable);
            }}
          />
          
          {showPerformance && (
            <PerformancePanel 
              traces={filteredTraces}
              session={session}
              timeRange={timeRange}
              onBottleneckClick={(trace) => {
                handleTraceSelect(trace);
                handleTimeTravel(trace.timestamp);
              }}
            />
          )}
        </div>
      </div>
      
      {/* Status Bar */}
      <div className="dashboard-footer">
        <div className="status-info">
          <span>Traces: {filteredTraces.length}</span>
          <span>Session: {session?.name || 'None'}</span>
          <span>Connection: {traceSocket.isConnected ? 'Connected' : 'Disconnected'}</span>
          {selectedTrace && (
            <span>Selected: {selectedTrace.type} @ {new Date(selectedTrace.timestamp).toLocaleTimeString()}</span>
          )}
        </div>
        
        <div className="status-controls">
          <label>
            Event Types:
            <select 
              multiple 
              value={eventTypeFilter}
              onChange={(e) => setEventTypeFilter(Array.from(e.target.selectedOptions, option => option.value))}
            >
              <option value="agent_method">Agent Methods</option>
              <option value="communication">Communication</option>
              <option value="task_execution">Task Execution</option>
              <option value="memory_access">Memory Access</option>
              <option value="coordination">Coordination</option>
              <option value="error">Errors</option>
              <option value="performance">Performance</option>
            </select>
          </label>
          
          <label>
            Agents:
            <select 
              multiple 
              value={agentFilter}
              onChange={(e) => setAgentFilter(Array.from(e.target.selectedOptions, option => option.value))}
            >
              {Array.from(new Set(traces.map(t => t.agentId))).map(agentId => (
                <option key={agentId} value={agentId}>{agentId}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </div>
  );
};

export default TracingDashboard;