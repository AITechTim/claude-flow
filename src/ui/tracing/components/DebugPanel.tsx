/**
 * DebugPanel - Enhanced debug panel with system information and controls
 */

import React, { useState, useMemo, useCallback } from 'react';

interface DebugPanelProps {
  events: any[];
  agents: any[];
  connectionStatus: string;
  lastMessage?: any;
  filters: any;
  layoutState: any;
  onClose: () => void;
  onSendMessage: (message: any) => void;
  onClearEvents: () => void;
}

export const DebugPanel: React.FC<DebugPanelProps> = React.memo(({
  events,
  agents,
  connectionStatus,
  lastMessage,
  filters,
  layoutState,
  onClose,
  onSendMessage,
  onClearEvents
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'events' | 'agents' | 'network' | 'performance'>('overview');
  const [messageInput, setMessageInput] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);

  // Debug information
  const debugInfo = useMemo(() => {
    const eventsByType = events.reduce((acc, event) => {
      acc[event.type] = (acc[event.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const agentActivity = agents.map(agent => ({
      id: agent.id,
      eventCount: events.filter(e => e.agentId === agent.id).length,
      lastActivity: Math.max(...events.filter(e => e.agentId === agent.id).map(e => e.timestamp), 0)
    }));

    const memoryUsage = {
      events: events.length,
      agents: agents.length,
      estimatedSize: JSON.stringify({ events, agents }).length
    };

    return {
      eventsByType,
      agentActivity,
      memoryUsage,
      filterState: filters,
      layoutState
    };
  }, [events, agents, filters, layoutState]);

  const handleSendMessage = useCallback(() => {
    if (messageInput.trim()) {
      try {
        const message = JSON.parse(messageInput);
        onSendMessage(message);
        setMessageInput('');
      } catch (error) {
        // Try sending as simple text
        onSendMessage({ type: 'debug', data: messageInput });
        setMessageInput('');
      }
    }
  }, [messageInput, onSendMessage]);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const renderOverview = () => (
    <div className="debug-tab-content">
      <div className="debug-section">
        <h4>System Status</h4>
        <div className="debug-grid">
          <div className="debug-item">
            <span className="debug-label">Connection:</span>
            <span className={`debug-value status-${connectionStatus}`}>{connectionStatus}</span>
          </div>
          <div className="debug-item">
            <span className="debug-label">Total Events:</span>
            <span className="debug-value">{events.length}</span>
          </div>
          <div className="debug-item">
            <span className="debug-label">Active Agents:</span>
            <span className="debug-value">{agents.length}</span>
          </div>
          <div className="debug-item">
            <span className="debug-label">Memory Usage:</span>
            <span className="debug-value">{formatBytes(debugInfo.memoryUsage.estimatedSize)}</span>
          </div>
        </div>
      </div>

      <div className="debug-section">
        <h4>Event Distribution</h4>
        <div className="debug-chart">
          {Object.entries(debugInfo.eventsByType).map(([type, count]) => (
            <div key={type} className="chart-bar">
              <span className="chart-label">{type}</span>
              <div className="chart-bar-container">
                <div 
                  className="chart-bar-fill"
                  style={{ width: `${(count / events.length) * 100}%` }}
                />
                <span className="chart-value">{count}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="debug-section">
        <h4>Performance Metrics</h4>
        <div className="debug-grid">
          <div className="debug-item">
            <span className="debug-label">Events/Second:</span>
            <span className="debug-value">
              {events.length > 0 ? 
                Math.round((events.length / ((Date.now() - Math.min(...events.map(e => e.timestamp))) / 1000)) * 100) / 100 : 0
              }
            </span>
          </div>
          <div className="debug-item">
            <span className="debug-label">Avg Event Size:</span>
            <span className="debug-value">
              {events.length > 0 ? formatBytes(debugInfo.memoryUsage.estimatedSize / events.length) : '0 Bytes'}
            </span>
          </div>
          <div className="debug-item">
            <span className="debug-label">Filter Active:</span>
            <span className="debug-value">
              {Object.values(filters).some(v => Array.isArray(v) ? v.length > 0 : !!v) ? 'Yes' : 'No'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  const renderEvents = () => (
    <div className="debug-tab-content">
      <div className="debug-section">
        <div className="debug-section-header">
          <h4>Recent Events ({events.length})</h4>
          <div className="debug-actions">
            <button 
              className="debug-btn secondary"
              onClick={onClearEvents}
            >
              Clear Events
            </button>
          </div>
        </div>
        <div className="events-log">
          {events.slice(-50).reverse().map((event, index) => (
            <div key={`${event.id}-${index}`} className="log-entry">
              <div className="log-header">
                <span className={`log-type type-${event.type}`}>{event.type}</span>
                <span className="log-agent">{event.agentId}</span>
                <span className="log-timestamp">
                  {new Date(event.timestamp).toLocaleTimeString()}
                </span>
              </div>
              {event.data && (
                <div className="log-data">
                  <pre>{JSON.stringify(event.data, null, 2)}</pre>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderAgents = () => (
    <div className="debug-tab-content">
      <div className="debug-section">
        <h4>Agent Activity</h4>
        <div className="agents-list">
          {debugInfo.agentActivity.map(agent => (
            <div key={agent.id} className="agent-debug-item">
              <div className="agent-header">
                <span className="agent-id">{agent.id}</span>
                <span className="agent-events">{agent.eventCount} events</span>
              </div>
              <div className="agent-details">
                <span className="agent-last-activity">
                  Last: {agent.lastActivity > 0 ? new Date(agent.lastActivity).toLocaleString() : 'Never'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderNetwork = () => (
    <div className="debug-tab-content">
      <div className="debug-section">
        <h4>WebSocket Connection</h4>
        <div className="debug-grid">
          <div className="debug-item">
            <span className="debug-label">Status:</span>
            <span className={`debug-value status-${connectionStatus}`}>{connectionStatus}</span>
          </div>
          <div className="debug-item">
            <span className="debug-label">Last Message:</span>
            <span className="debug-value">
              {lastMessage ? new Date(lastMessage.timestamp || Date.now()).toLocaleTimeString() : 'None'}
            </span>
          </div>
        </div>
      </div>

      <div className="debug-section">
        <h4>Send Debug Message</h4>
        <div className="message-sender">
          <textarea
            className="message-input"
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
            placeholder='Enter JSON message or plain text...'
            rows={4}
          />
          <button 
            className="debug-btn primary"
            onClick={handleSendMessage}
            disabled={!messageInput.trim()}
          >
            Send Message
          </button>
        </div>
      </div>

      {lastMessage && (
        <div className="debug-section">
          <h4>Last Received Message</h4>
          <pre className="debug-json">
            {JSON.stringify(lastMessage, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );

  const renderPerformance = () => (
    <div className="debug-tab-content">
      <div className="debug-section">
        <h4>Runtime Information</h4>
        <div className="debug-grid">
          <div className="debug-item">
            <span className="debug-label">User Agent:</span>
            <span className="debug-value small">{navigator.userAgent}</span>
          </div>
          <div className="debug-item">
            <span className="debug-label">Screen Resolution:</span>
            <span className="debug-value">{screen.width} × {screen.height}</span>
          </div>
          <div className="debug-item">
            <span className="debug-label">Viewport Size:</span>
            <span className="debug-value">{window.innerWidth} × {window.innerHeight}</span>
          </div>
          <div className="debug-item">
            <span className="debug-label">Color Scheme:</span>
            <span className="debug-value">
              {window.matchMedia('(prefers-color-scheme: dark)').matches ? 'Dark' : 'Light'}
            </span>
          </div>
        </div>
      </div>

      <div className="debug-section">
        <h4>Layout State</h4>
        <pre className="debug-json">
          {JSON.stringify(layoutState, null, 2)}
        </pre>
      </div>

      <div className="debug-section">
        <h4>Filter State</h4>
        <pre className="debug-json">
          {JSON.stringify(filters, null, 2)}
        </pre>
      </div>
    </div>
  );

  return (
    <div className="debug-panel floating-panel">
      <div className="panel-overlay" onClick={onClose} />
      
      <div className="panel-content debug-panel-content">
        <div className="panel-header">
          <h3>🔧 Debug Panel</h3>
          <div className="debug-controls">
            <label className="auto-scroll-toggle">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
              />
              Auto-scroll
            </label>
            <button className="close-button" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="debug-tabs">
          <button
            className={`debug-tab ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            Overview
          </button>
          <button
            className={`debug-tab ${activeTab === 'events' ? 'active' : ''}`}
            onClick={() => setActiveTab('events')}
          >
            Events ({events.length})
          </button>
          <button
            className={`debug-tab ${activeTab === 'agents' ? 'active' : ''}`}
            onClick={() => setActiveTab('agents')}
          >
            Agents ({agents.length})
          </button>
          <button
            className={`debug-tab ${activeTab === 'network' ? 'active' : ''}`}
            onClick={() => setActiveTab('network')}
          >
            Network
          </button>
          <button
            className={`debug-tab ${activeTab === 'performance' ? 'active' : ''}`}
            onClick={() => setActiveTab('performance')}
          >
            Performance
          </button>
        </div>

        <div className="debug-content">
          {activeTab === 'overview' && renderOverview()}
          {activeTab === 'events' && renderEvents()}
          {activeTab === 'agents' && renderAgents()}
          {activeTab === 'network' && renderNetwork()}
          {activeTab === 'performance' && renderPerformance()}
        </div>
      </div>
    </div>
  );
});

DebugPanel.displayName = 'DebugPanel';