/**
 * TracingDashboard - Complete dashboard component for trace visualization
 * Features: Real-time updates, time travel, responsive design, keyboard shortcuts
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { TraceGraph } from './TraceGraph';
import { TimelineView } from './TimelineView';
import { AgentPanel } from './AgentPanel';
import { DebugPanel } from './DebugPanel';
import { SessionSelector } from './SessionSelector';
import { FilterControls } from './FilterControls';
import { ExportImportPanel } from './ExportImportPanel';
import { SearchPanel } from './SearchPanel';
import { StatsDashboard } from './StatsDashboard';
import { useTraceWebSocket } from '../hooks/useTraceWebSocket';
import { useTimeTravel } from '../hooks/useTimeTravel';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useTheme } from '../hooks/useTheme';

// Types for dashboard state
interface DashboardFilters {
  agentIds: string[];
  eventTypes: string[];
  timeRange: [number, number] | null;
  searchQuery: string;
}

interface LayoutState {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  panelSizes: { [key: string]: number };
  fullScreen: boolean;
}

export interface TracingDashboardProps {
  onEventSelect?: (event: any) => void;
  className?: string;
  initialView?: 'graph' | 'timeline' | 'agents';
  sessionId?: string;
  enableTimeTravel?: boolean;
  maxEvents?: number;
}

export const TracingDashboard: React.FC<TracingDashboardProps> = React.memo(({
  onEventSelect,
  className = '',
  initialView = 'graph',
  sessionId,
  enableTimeTravel = true,
  maxEvents = 10000
}) => {
  // Refs for performance optimization
  const dashboardRef = useRef<HTMLDivElement>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  
  // Theme management
  const { theme, toggleTheme } = useTheme();
  
  // Persistent state management
  const [layoutState, setLayoutState] = useLocalStorage<LayoutState>('dashboard-layout', {
    sidebarWidth: 320,
    sidebarCollapsed: false,
    panelSizes: {},
    fullScreen: false
  });
  
  // Dashboard state
  const [activeView, setActiveView] = useState<'graph' | 'timeline' | 'agents'>(initialView);
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const [selectedSession, setSelectedSession] = useState<string>(sessionId || '');
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [exportPanelOpen, setExportPanelOpen] = useState(false);
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Filter state
  const [filters, setFilters] = useState<DashboardFilters>({
    agentIds: [],
    eventTypes: [],
    timeRange: null,
    searchQuery: ''
  });

  // WebSocket connection for real-time events
  const {
    isConnected,
    events: rawEvents,
    agents,
    connectionStatus,
    sendMessage,
    disconnect,
    reconnect,
    lastMessage
  } = useTraceWebSocket(selectedSession, {
    maxEvents,
    autoReconnect: true,
    bufferSize: 1000
  });
  
  // Filter and process events
  const events = useMemo(() => {
    let filtered = rawEvents;
    
    // Apply agent filter
    if (filters.agentIds.length > 0) {
      filtered = filtered.filter(event => filters.agentIds.includes(event.agentId));
    }
    
    // Apply event type filter
    if (filters.eventTypes.length > 0) {
      filtered = filtered.filter(event => filters.eventTypes.includes(event.type));
    }
    
    // Apply time range filter
    if (filters.timeRange) {
      const [start, end] = filters.timeRange;
      filtered = filtered.filter(event => 
        event.timestamp >= start && event.timestamp <= end
      );
    }
    
    // Apply search query
    if (filters.searchQuery) {
      const query = filters.searchQuery.toLowerCase();
      filtered = filtered.filter(event =>
        event.id.toLowerCase().includes(query) ||
        event.type.toLowerCase().includes(query) ||
        event.agentId.toLowerCase().includes(query) ||
        (event.data && JSON.stringify(event.data).toLowerCase().includes(query))
      );
    }
    
    return filtered.slice(-maxEvents); // Keep only recent events
  }, [rawEvents, filters, maxEvents]);

  // Time travel functionality
  const {
    isTimeTravelMode,
    currentTimestamp,
    availableSnapshots,
    goToTime,
    exitTimeTravel,
    createSnapshot,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
    playbackSpeed,
    setPlaybackSpeed
  } = useTimeTravel({ enabled: enableTimeTravel });
  
  // Available sessions from WebSocket or local storage
  const availableSessions = useMemo(() => {
    // This would typically come from an API or WebSocket
    const savedSessions = JSON.parse(localStorage.getItem('trace-sessions') || '[]');
    return savedSessions;
  }, []);
  
  // Statistics for the dashboard
  const statistics = useMemo(() => {
    const uniqueAgents = new Set(events.map(e => e.agentId)).size;
    const eventTypes = new Set(events.map(e => e.type));
    const timeSpan = events.length > 0 ? 
      Math.max(...events.map(e => e.timestamp)) - Math.min(...events.map(e => e.timestamp)) : 0;
    
    return {
      totalEvents: events.length,
      activeAgents: uniqueAgents,
      eventTypes: eventTypes.size,
      timeSpan,
      avgDuration: events.filter(e => e.duration).reduce((acc, e) => acc + (e.duration || 0), 0) / events.filter(e => e.duration).length || 0
    };
  }, [events]);

  // Event handlers
  const handleEventSelect = useCallback((event: any) => {
    setSelectedEvent(event);
    onEventSelect?.(event);
  }, [onEventSelect]);

  const handleTimeTravelToggle = useCallback(() => {
    if (isTimeTravelMode) {
      exitTimeTravel();
    } else {
      // Enter time travel mode at current time
      goToTime(Date.now());
    }
  }, [isTimeTravelMode, exitTimeTravel, goToTime]);

  const handleCreateSnapshot = useCallback(() => {
    createSnapshot(`Manual snapshot ${new Date().toLocaleTimeString()}`);
  }, [createSnapshot]);
  
  const handleSessionChange = useCallback((sessionId: string) => {
    setSelectedSession(sessionId);
    setSelectedEvent(null);
    setError(null);
  }, []);
  
  const handleViewChange = useCallback((view: 'graph' | 'timeline' | 'agents') => {
    setActiveView(view);
    setSelectedEvent(null);
  }, []);
  
  const handleFilterChange = useCallback((newFilters: Partial<DashboardFilters>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
    setSelectedEvent(null);
  }, []);
  
  const handleToggleSidebar = useCallback(() => {
    setLayoutState(prev => ({
      ...prev,
      sidebarCollapsed: !prev.sidebarCollapsed
    }));
  }, [setLayoutState]);
  
  const handleToggleFullScreen = useCallback(() => {
    setLayoutState(prev => ({
      ...prev,
      fullScreen: !prev.fullScreen
    }));
    
    if (!layoutState.fullScreen) {
      dashboardRef.current?.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }, [layoutState.fullScreen, setLayoutState]);
  
  const handleExport = useCallback(async (format: 'json' | 'csv' | 'png') => {
    setLoading(true);
    try {
      const data = {
        events: events,
        agents: agents,
        filters: filters,
        timestamp: Date.now(),
        session: selectedSession
      };
      
      let blob: Blob;
      let filename: string;
      
      switch (format) {
        case 'json':
          blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          filename = `trace-data-${new Date().toISOString().split('T')[0]}.json`;
          break;
        case 'csv':
          const csvData = events.map(event => ({
            id: event.id,
            type: event.type,
            agentId: event.agentId,
            timestamp: new Date(event.timestamp).toISOString(),
            duration: event.duration || '',
            data: JSON.stringify(event.data)
          }));
          const csvContent = [
            Object.keys(csvData[0] || {}).join(','),
            ...csvData.map(row => Object.values(row).map(val => `"${val}"`).join(','))
          ].join('\n');
          blob = new Blob([csvContent], { type: 'text/csv' });
          filename = `trace-data-${new Date().toISOString().split('T')[0]}.csv`;
          break;
        case 'png':
          // This would require canvas/svg export - placeholder for now
          throw new Error('PNG export not yet implemented');
        default:
          throw new Error(`Unsupported format: ${format}`);
      }
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setLoading(false);
    }
  }, [events, agents, filters, selectedSession]);
  
  const handleImport = useCallback(async (file: File) => {
    setLoading(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      
      // Validate imported data structure
      if (!data.events || !Array.isArray(data.events)) {
        throw new Error('Invalid trace data format');
      }
      
      // This would need to integrate with the WebSocket hook to load data
      console.log('Imported trace data:', data);
      // TODO: Implement data loading into the trace system
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setLoading(false);
    }
  }, []);

  // Enhanced keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case '1':
            e.preventDefault();
            handleViewChange('graph');
            break;
          case '2':
            e.preventDefault();
            handleViewChange('timeline');
            break;
          case '3':
            e.preventDefault();
            handleViewChange('agents');
            break;
          case 'd':
            e.preventDefault();
            setDebugPanelOpen(prev => !prev);
            break;
          case 't':
            e.preventDefault();
            handleTimeTravelToggle();
            break;
          case 'e':
            e.preventDefault();
            setExportPanelOpen(prev => !prev);
            break;
          case 'f':
            e.preventDefault();
            setSearchPanelOpen(prev => !prev);
            break;
          case 'Enter':
            e.preventDefault();
            handleToggleFullScreen();
            break;
          case 's':
            e.preventDefault();
            handleCreateSnapshot();
            break;
        }
      } else {
        switch (e.key) {
          case 'Escape':
            e.preventDefault();
            setSelectedEvent(null);
            setDebugPanelOpen(false);
            setExportPanelOpen(false);
            setSearchPanelOpen(false);
            if (isTimeTravelMode) {
              exitTimeTravel();
            }
            break;
          case 'ArrowLeft':
            if (isTimeTravelMode && canGoBack) {
              e.preventDefault();
              goBack();
            }
            break;
          case 'ArrowRight':
            if (isTimeTravelMode && canGoForward) {
              e.preventDefault();
              goForward();
            }
            break;
          case ' ':
            if (isTimeTravelMode) {
              e.preventDefault();
              // Toggle playback - this would need implementation in useTimeTravel
            }
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [handleTimeTravelToggle, handleViewChange, isTimeTravelMode, canGoBack, canGoForward, goBack, goForward, exitTimeTravel, handleToggleFullScreen, handleCreateSnapshot]);
  
  // Error handling for WebSocket connection
  useEffect(() => {
    if (connectionStatus === 'error') {
      setError('Connection to trace server failed');
    } else if (connectionStatus === 'connected') {
      setError(null);
    }
  }, [connectionStatus]);
  
  // Responsive layout handling
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768 && !layoutState.sidebarCollapsed) {
        setLayoutState(prev => ({ ...prev, sidebarCollapsed: true }));
      }
    };
    
    window.addEventListener('resize', handleResize);
    handleResize(); // Initial check
    
    return () => window.removeEventListener('resize', handleResize);
  }, [layoutState.sidebarCollapsed, setLayoutState]);

  // Render loading state
  if (loading) {
    return (
      <div className={`tracing-dashboard loading ${className}`}>
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading trace data...</p>
        </div>
      </div>
    );
  }

  return (
    <div 
      ref={dashboardRef}
      className={`tracing-dashboard ${theme} ${layoutState.fullScreen ? 'fullscreen' : ''} ${className}`}
      data-testid="tracing-dashboard"
    >
      {/* Enhanced Header */}
      <header className="dashboard-header">
        <div className="header-left">
          <div className="title-section">
            <h1>Claude Flow Tracing</h1>
            <div className="connection-status">
              <span className={`status-indicator ${connectionStatus}`}>
                {connectionStatus === 'connected' ? '🟢' : connectionStatus === 'connecting' ? '🟡' : '🔴'}
              </span>
              <span className="status-text">{connectionStatus}</span>
              {connectionStatus !== 'connected' && (
                <button 
                  className="reconnect-btn"
                  onClick={reconnect}
                  title="Reconnect"
                >
                  🔄
                </button>
              )}
            </div>
          </div>
          
          {/* Session Selector */}
          <SessionSelector
            sessions={availableSessions}
            selectedSession={selectedSession}
            onSessionChange={handleSessionChange}
          />
        </div>
        
        <div className="header-center">
          <nav className="view-tabs">
            <button 
              className={`tab ${activeView === 'graph' ? 'active' : ''}`}
              onClick={() => handleViewChange('graph')}
              title="Graph View (Ctrl+1)"
            >
              📊 Graph
            </button>
            <button 
              className={`tab ${activeView === 'timeline' ? 'active' : ''}`}
              onClick={() => handleViewChange('timeline')}
              title="Timeline View (Ctrl+2)"
            >
              📈 Timeline
            </button>
            <button 
              className={`tab ${activeView === 'agents' ? 'active' : ''}`}
              onClick={() => handleViewChange('agents')}
              title="Agents View (Ctrl+3)"
            >
              🤖 Agents
            </button>
          </nav>
        </div>

        <div className="header-right">
          {/* Enhanced Time Travel Controls */}
          {enableTimeTravel && (
            <div className="time-travel-controls">
              <button
                className={`time-travel-toggle ${isTimeTravelMode ? 'active' : ''}`}
                onClick={handleTimeTravelToggle}
                title="Toggle Time Travel (Ctrl+T)"
                disabled={events.length === 0}
              >
                {isTimeTravelMode ? '⏰' : '⏱️'} 
                {isTimeTravelMode ? 'Exit' : 'Time Travel'}
              </button>
              
              {isTimeTravelMode && (
                <div className="time-controls">
                  <button
                    className="time-nav-btn"
                    onClick={goBack}
                    disabled={!canGoBack}
                    title="Go Back (←)"
                  >
                    ⏮️
                  </button>
                  
                  <input
                    type="range"
                    className="time-slider"
                    min={events.length > 0 ? Math.min(...events.map(e => e.timestamp)) : 0}
                    max={events.length > 0 ? Math.max(...events.map(e => e.timestamp)) : Date.now()}
                    value={currentTimestamp}
                    onChange={(e) => goToTime(parseInt(e.target.value))}
                  />
                  
                  <button
                    className="time-nav-btn"
                    onClick={goForward}
                    disabled={!canGoForward}
                    title="Go Forward (→)"
                  >
                    ⏭️
                  </button>
                  
                  <div className="time-display">
                    <span className="time-text">
                      {new Date(currentTimestamp).toLocaleTimeString()}
                    </span>
                    <div className="playback-speed">
                      <label>Speed:</label>
                      <select 
                        value={playbackSpeed} 
                        onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
                      >
                        <option value={0.25}>0.25x</option>
                        <option value={0.5}>0.5x</option>
                        <option value={1}>1x</option>
                        <option value={2}>2x</option>
                        <option value={4}>4x</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Enhanced Toolbar */}
          <div className="toolbar">
            <button
              onClick={() => setSearchPanelOpen(prev => !prev)}
              className={`toolbar-button ${searchPanelOpen ? 'active' : ''}`}
              title="Search (Ctrl+F)"
            >
              🔍
            </button>
            
            <button
              onClick={() => setExportPanelOpen(prev => !prev)}
              className={`toolbar-button ${exportPanelOpen ? 'active' : ''}`}
              title="Export/Import (Ctrl+E)"
            >
              📤
            </button>
            
            <button
              onClick={handleCreateSnapshot}
              title="Create Snapshot (Ctrl+S)"
              className="toolbar-button"
              disabled={events.length === 0}
            >
              📷
            </button>
            
            <button
              onClick={() => setDebugPanelOpen(prev => !prev)}
              className={`toolbar-button ${debugPanelOpen ? 'active' : ''}`}
              title="Debug Panel (Ctrl+D)"
            >
              🔧
            </button>
            
            <button
              onClick={toggleTheme}
              className="toolbar-button"
              title="Toggle Theme"
            >
              {theme === 'dark' ? '🌙' : '☀️'}
            </button>
            
            <button
              onClick={handleToggleFullScreen}
              className="toolbar-button"
              title="Full Screen (Ctrl+Enter)"
            >
              {layoutState.fullScreen ? '📱' : '🖥️'}
            </button>
            
            <button
              onClick={handleToggleSidebar}
              className="toolbar-button"
              title="Toggle Sidebar"
            >
              {layoutState.sidebarCollapsed ? '▶️' : '◀️'}
            </button>
          </div>
        </div>
      </header>

      {/* Filter Controls Bar */}
      <div className="filter-controls-bar">
        <FilterControls
          events={rawEvents}
          agents={agents}
          filters={filters}
          onFiltersChange={handleFilterChange}
          statistics={statistics}
        />
      </div>

      {/* Main Content with Resizable Layout */}
      <div className="dashboard-content">
        {/* Primary View */}
        <main 
          className="main-view"
          style={{
            width: layoutState.sidebarCollapsed ? '100%' : `calc(100% - ${layoutState.sidebarWidth}px)`
          }}
        >
          {error && (
            <div className="error-banner">
              <span className="error-icon">⚠️</span>
              <span className="error-text">{error}</span>
              <button 
                className="error-dismiss"
                onClick={() => setError(null)}
              >
                ✕
              </button>
            </div>
          )}
          
          {activeView === 'graph' && (
            <TraceGraph
              events={events}
              agents={agents}
              selectedEvent={selectedEvent}
              onEventSelect={handleEventSelect}
              isTimeTravelMode={isTimeTravelMode}
              currentTimestamp={currentTimestamp}
              filters={filters}
              theme={theme}
              fullScreen={layoutState.fullScreen}
            />
          )}
          
          {activeView === 'timeline' && (
            <TimelineView
              events={events}
              agents={agents}
              selectedEvent={selectedEvent}
              onEventSelect={handleEventSelect}
              isTimeTravelMode={isTimeTravelMode}
              currentTimestamp={currentTimestamp}
              filters={filters}
              theme={theme}
            />
          )}
          
          {activeView === 'agents' && (
            <AgentPanel
              agents={agents}
              events={events}
              selectedAgent={selectedEvent?.agentId}
              onAgentSelect={(agentId) => {
                const agentEvents = events.filter(e => e.agentId === agentId);
                if (agentEvents.length > 0) {
                  handleEventSelect(agentEvents[0]);
                }
              }}
              statistics={statistics}
              theme={theme}
            />
          )}
        </main>

        {/* Enhanced Resizable Sidebar */}
        {!layoutState.sidebarCollapsed && (
          <aside 
            className="sidebar"
            style={{ width: `${layoutState.sidebarWidth}px` }}
          >
            {/* Resize Handle */}
            <div 
              className="resize-handle"
              onMouseDown={(e) => {
                const startX = e.clientX;
                const startWidth = layoutState.sidebarWidth;
                
                const handleMouseMove = (e: MouseEvent) => {
                  const newWidth = Math.max(250, Math.min(600, startWidth - (e.clientX - startX)));
                  setLayoutState(prev => ({ ...prev, sidebarWidth: newWidth }));
                };
                
                const handleMouseUp = () => {
                  document.removeEventListener('mousemove', handleMouseMove);
                  document.removeEventListener('mouseup', handleMouseUp);
                };
                
                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', handleMouseUp);
              }}
            />
            
            {/* Sidebar Tabs */}
            <div className="sidebar-tabs">
              <button className="sidebar-tab active">Details</button>
              <button className="sidebar-tab">Stats</button>
              <button className="sidebar-tab">History</button>
            </div>
            
            {/* Event Details Section */}
            <div className="sidebar-section event-details-section">
              <div className="section-header">
                <h3>Event Details</h3>
                {selectedEvent && (
                  <button 
                    className="clear-selection"
                    onClick={() => setSelectedEvent(null)}
                    title="Clear Selection"
                  >
                    ✕
                  </button>
                )}
              </div>
              
              {selectedEvent ? (
                <div className="event-details">
                  <div className="detail-grid">
                    <div className="detail-row">
                      <span className="label">ID:</span>
                      <span className="value selectable" title={selectedEvent.id}>
                        {selectedEvent.id.substring(0, 8)}...
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="label">Type:</span>
                      <span className={`value type-badge type-${selectedEvent.type}`}>
                        {selectedEvent.type}
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="label">Agent:</span>
                      <span className="value agent-badge">{selectedEvent.agentId}</span>
                    </div>
                    <div className="detail-row">
                      <span className="label">Timestamp:</span>
                      <span className="value timestamp">
                        {new Date(selectedEvent.timestamp).toLocaleString()}
                      </span>
                    </div>
                    {selectedEvent.duration && (
                      <div className="detail-row">
                        <span className="label">Duration:</span>
                        <span className={`value duration ${selectedEvent.duration > 1000 ? 'slow' : 'fast'}`}>
                          {selectedEvent.duration}ms
                        </span>
                      </div>
                    )}
                    {selectedEvent.status && (
                      <div className="detail-row">
                        <span className="label">Status:</span>
                        <span className={`value status status-${selectedEvent.status}`}>
                          {selectedEvent.status}
                        </span>
                      </div>
                    )}
                  </div>
                  
                  {/* Event Data */}
                  {selectedEvent.data && (
                    <div className="event-data">
                      <div className="data-header">
                        <h4>Event Data</h4>
                        <button 
                          className="copy-data"
                          onClick={() => {
                            navigator.clipboard.writeText(JSON.stringify(selectedEvent.data, null, 2));
                          }}
                          title="Copy to clipboard"
                        >
                          📋
                        </button>
                      </div>
                      <pre className="data-content">
                        {JSON.stringify(selectedEvent.data, null, 2)}
                      </pre>
                    </div>
                  )}
                  
                  {/* Related Events */}
                  {selectedEvent.relatedEvents && selectedEvent.relatedEvents.length > 0 && (
                    <div className="related-events">
                      <h4>Related Events</h4>
                      <div className="related-list">
                        {selectedEvent.relatedEvents.map((relatedId: string) => {
                          const related = events.find(e => e.id === relatedId);
                          return related ? (
                            <button
                              key={relatedId}
                              className="related-event"
                              onClick={() => handleEventSelect(related)}
                            >
                              {related.type} - {new Date(related.timestamp).toLocaleTimeString()}
                            </button>
                          ) : null;
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="no-selection">
                  <div className="no-selection-icon">👆</div>
                  <p>Select an event to view details</p>
                  <p className="hint">Click on nodes in the graph or timeline</p>
                </div>
              )}
            </div>

            {/* Statistics Dashboard */}
            <div className="sidebar-section stats-section">
              <h3>Live Statistics</h3>
              <StatsDashboard 
                statistics={statistics}
                events={events}
                agents={agents}
                connectionStatus={connectionStatus}
                isTimeTravelMode={isTimeTravelMode}
              />
            </div>
            
            {/* Snapshots Section */}
            {availableSnapshots.length > 0 && (
              <div className="sidebar-section snapshots-section">
                <div className="section-header">
                  <h3>Snapshots</h3>
                  <span className="count-badge">{availableSnapshots.length}</span>
                </div>
                <div className="snapshots-list">
                  {availableSnapshots.slice(-5).map((snapshot) => (
                    <button
                      key={snapshot.id}
                      className={`snapshot-item ${currentTimestamp === snapshot.timestamp ? 'active' : ''}`}
                      onClick={() => goToTime(snapshot.timestamp)}
                      title={snapshot.description}
                    >
                      <div className="snapshot-time">
                        {new Date(snapshot.timestamp).toLocaleTimeString()}
                      </div>
                      <div className="snapshot-desc">{snapshot.description}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* Floating Panels */}
      {searchPanelOpen && (
        <SearchPanel
          events={events}
          agents={agents}
          searchQuery={filters.searchQuery}
          onSearchChange={(query) => handleFilterChange({ searchQuery: query })}
          onEventSelect={handleEventSelect}
          onClose={() => setSearchPanelOpen(false)}
        />
      )}
      
      {exportPanelOpen && (
        <ExportImportPanel
          onExport={handleExport}
          onImport={handleImport}
          onClose={() => setExportPanelOpen(false)}
          eventCount={events.length}
          isExporting={loading}
        />
      )}

      {debugPanelOpen && (
        <DebugPanel
          events={events}
          agents={agents}
          connectionStatus={connectionStatus}
          lastMessage={lastMessage}
          filters={filters}
          layoutState={layoutState}
          onClose={() => setDebugPanelOpen(false)}
          onSendMessage={sendMessage}
          onClearEvents={() => {
            // This would need to be implemented in the WebSocket hook
            console.log('Clear events requested');
          }}
        />
      )}

      {/* Enhanced Status Messages */}
      <div className="status-messages">
        {!isConnected && connectionStatus !== 'connecting' && (
          <div className="status-message warning slide-in">
            <span className="status-icon">⚠️</span>
            <div className="status-content">
              <strong>Connection Lost</strong>
              <p>Real-time updates unavailable. <button onClick={reconnect}>Reconnect</button></p>
            </div>
            <button 
              className="status-dismiss"
              onClick={() => {/* dismiss */}}
            >
              ✕
            </button>
          </div>
        )}

        {isTimeTravelMode && (
          <div className="status-message info slide-in">
            <span className="status-icon">⏰</span>
            <div className="status-content">
              <strong>Time Travel Active</strong>
              <p>Viewing state at {new Date(currentTimestamp).toLocaleString()}</p>
            </div>
            <button 
              className="status-action"
              onClick={exitTimeTravel}
            >
              Exit
            </button>
          </div>
        )}
        
        {loading && (
          <div className="status-message info slide-in">
            <span className="status-icon spinning">⏳</span>
            <div className="status-content">
              <strong>Processing...</strong>
              <p>Please wait while we process your request</p>
            </div>
          </div>
        )}
      </div>
      
      {/* Keyboard Shortcuts Help */}
      <div className="keyboard-shortcuts-hint">
        <span className="hint-text">Press ? for keyboard shortcuts</span>
      </div>
    </div>
  );
};

});

// Performance optimization with React.memo
export default React.memo(TracingDashboard);

// Export types for external use
export type { DashboardFilters, LayoutState };