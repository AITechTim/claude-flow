/**
 * StatsDashboard - Real-time statistics and metrics display
 */

import React, { useMemo } from 'react';

interface StatsDashboardProps {
  statistics: {
    totalEvents: number;
    activeAgents: number;
    eventTypes: number;
    timeSpan: number;
    avgDuration: number;
  };
  events: any[];
  agents: any[];
  connectionStatus: string;
  isTimeTravelMode: boolean;
}

export const StatsDashboard: React.FC<StatsDashboardProps> = React.memo(({
  statistics,
  events,
  agents,
  connectionStatus,
  isTimeTravelMode
}) => {
  // Calculate additional metrics
  const metrics = useMemo(() => {
    const eventsByType = events.reduce((acc, event) => {
      acc[event.type] = (acc[event.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const eventsByAgent = events.reduce((acc, event) => {
      acc[event.agentId] = (acc[event.agentId] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const eventsWithDuration = events.filter(e => e.duration);
    const totalDuration = eventsWithDuration.reduce((sum, e) => sum + (e.duration || 0), 0);
    const avgDuration = eventsWithDuration.length > 0 ? totalDuration / eventsWithDuration.length : 0;
    const maxDuration = Math.max(...eventsWithDuration.map(e => e.duration || 0), 0);
    const minDuration = Math.min(...eventsWithDuration.map(e => e.duration || 0), 0);

    // Calculate event rate (events per minute)
    const timeSpanMinutes = statistics.timeSpan / (1000 * 60);
    const eventRate = timeSpanMinutes > 0 ? events.length / timeSpanMinutes : 0;

    // Most active agent
    const mostActiveAgent = Object.entries(eventsByAgent).reduce(
      (max, [agent, count]) => count > max.count ? { agent, count } : max,
      { agent: '', count: 0 }
    );

    // Most common event type
    const mostCommonType = Object.entries(eventsByType).reduce(
      (max, [type, count]) => count > max.count ? { type, count } : max,
      { type: '', count: 0 }
    );

    return {
      eventsByType,
      eventsByAgent,
      avgDuration,
      maxDuration,
      minDuration,
      eventRate,
      mostActiveAgent,
      mostCommonType,
      totalDuration
    };
  }, [events, statistics]);

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const formatTimeSpan = (ms: number) => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
    return `${Math.round(ms / 3600000)}h`;
  };

  return (
    <div className="stats-dashboard">
      {/* System Status */}
      <div className="stats-section system-status">
        <h4>System Status</h4>
        <div className="status-grid">
          <div className={`status-item connection-${connectionStatus}`}>
            <span className="status-icon">
              {connectionStatus === 'connected' ? '🟢' : connectionStatus === 'connecting' ? '🟡' : '🔴'}
            </span>
            <span className="status-label">Connection</span>
          </div>
          {isTimeTravelMode && (
            <div className="status-item time-travel">
              <span className="status-icon">⏰</span>
              <span className="status-label">Time Travel</span>
            </div>
          )}
        </div>
      </div>

      {/* Core Metrics */}
      <div className="stats-section core-metrics">
        <h4>Core Metrics</h4>
        <div className="metrics-grid">
          <div className="metric-item">
            <div className="metric-value">{statistics.totalEvents}</div>
            <div className="metric-label">Total Events</div>
          </div>
          <div className="metric-item">
            <div className="metric-value">{statistics.activeAgents}</div>
            <div className="metric-label">Active Agents</div>
          </div>
          <div className="metric-item">
            <div className="metric-value">{statistics.eventTypes}</div>
            <div className="metric-label">Event Types</div>
          </div>
          <div className="metric-item">
            <div className="metric-value">{formatTimeSpan(statistics.timeSpan)}</div>
            <div className="metric-label">Time Span</div>
          </div>
        </div>
      </div>

      {/* Performance Metrics */}
      <div className="stats-section performance-metrics">
        <h4>Performance</h4>
        <div className="metrics-grid">
          <div className="metric-item">
            <div className="metric-value">{formatDuration(metrics.avgDuration)}</div>
            <div className="metric-label">Avg Duration</div>
          </div>
          <div className="metric-item">
            <div className="metric-value">{formatDuration(metrics.maxDuration)}</div>
            <div className="metric-label">Max Duration</div>
          </div>
          <div className="metric-item">
            <div className="metric-value">{Math.round(metrics.eventRate * 10) / 10}</div>
            <div className="metric-label">Events/Min</div>
          </div>
          <div className="metric-item">
            <div className="metric-value">{formatDuration(metrics.totalDuration)}</div>
            <div className="metric-label">Total Time</div>
          </div>
        </div>
      </div>

      {/* Top Performers */}
      <div className="stats-section top-performers">
        <h4>Top Performers</h4>
        <div className="performer-list">
          {metrics.mostActiveAgent.agent && (
            <div className="performer-item">
              <div className="performer-label">Most Active Agent</div>
              <div className="performer-value">
                <span className="performer-name">{metrics.mostActiveAgent.agent}</span>
                <span className="performer-count">{metrics.mostActiveAgent.count} events</span>
              </div>
            </div>
          )}
          {metrics.mostCommonType.type && (
            <div className="performer-item">
              <div className="performer-label">Most Common Type</div>
              <div className="performer-value">
                <span className="performer-name">{metrics.mostCommonType.type}</span>
                <span className="performer-count">{metrics.mostCommonType.count} events</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Event Distribution */}
      <div className="stats-section event-distribution">
        <h4>Event Types</h4>
        <div className="distribution-list">
          {Object.entries(metrics.eventsByType)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5)
            .map(([type, count]) => (
              <div key={type} className="distribution-item">
                <div className="distribution-bar">
                  <div 
                    className={`distribution-fill type-${type}`}
                    style={{ 
                      width: `${(count / statistics.totalEvents) * 100}%` 
                    }}
                  />
                </div>
                <div className="distribution-label">
                  <span className="distribution-name">{type}</span>
                  <span className="distribution-count">{count}</span>
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Agent Distribution */}
      <div className="stats-section agent-distribution">
        <h4>Agent Activity</h4>
        <div className="distribution-list">
          {Object.entries(metrics.eventsByAgent)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5)
            .map(([agentId, count]) => (
              <div key={agentId} className="distribution-item">
                <div className="distribution-bar">
                  <div 
                    className="distribution-fill agent-fill"
                    style={{ 
                      width: `${(count / statistics.totalEvents) * 100}%` 
                    }}
                  />
                </div>
                <div className="distribution-label">
                  <span className="distribution-name">
                    {agentId.length > 12 ? `${agentId.substring(0, 12)}...` : agentId}
                  </span>
                  <span className="distribution-count">{count}</span>
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Health Indicators */}
      <div className="stats-section health-indicators">
        <h4>Health Check</h4>
        <div className="health-grid">
          <div className={`health-item ${metrics.avgDuration > 5000 ? 'warning' : 'good'}`}>
            <span className="health-icon">
              {metrics.avgDuration > 5000 ? '⚠️' : '✅'}
            </span>
            <span className="health-label">Response Time</span>
          </div>
          <div className={`health-item ${connectionStatus === 'connected' ? 'good' : 'error'}`}>
            <span className="health-icon">
              {connectionStatus === 'connected' ? '✅' : '❌'}
            </span>
            <span className="health-label">Connectivity</span>
          </div>
          <div className={`health-item ${metrics.eventRate > 0 ? 'good' : 'warning'}`}>
            <span className="health-icon">
              {metrics.eventRate > 0 ? '✅' : '⚠️'}
            </span>
            <span className="health-label">Activity</span>
          </div>
        </div>
      </div>
    </div>
  );
});

StatsDashboard.displayName = 'StatsDashboard';