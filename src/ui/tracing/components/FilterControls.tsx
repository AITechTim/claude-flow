/**
 * FilterControls - Advanced filtering controls for trace events
 */

import React, { useMemo } from 'react';

interface DashboardFilters {
  agentIds: string[];
  eventTypes: string[];
  timeRange: [number, number] | null;
  searchQuery: string;
}

interface FilterControlsProps {
  events: any[];
  agents: any[];
  filters: DashboardFilters;
  onFiltersChange: (filters: Partial<DashboardFilters>) => void;
  statistics: {
    totalEvents: number;
    activeAgents: number;
    eventTypes: number;
    timeSpan: number;
    avgDuration: number;
  };
}

export const FilterControls: React.FC<FilterControlsProps> = React.memo(({
  events,
  agents,
  filters,
  onFiltersChange,
  statistics
}) => {
  // Extract unique event types and agents
  const { uniqueEventTypes, uniqueAgentIds, timeRange } = useMemo(() => {
    const eventTypes = new Set(events.map(e => e.type));
    const agentIds = new Set(events.map(e => e.agentId));
    const timestamps = events.map(e => e.timestamp);
    const range: [number, number] = [
      Math.min(...timestamps) || 0,
      Math.max(...timestamps) || Date.now()
    ];
    
    return {
      uniqueEventTypes: Array.from(eventTypes),
      uniqueAgentIds: Array.from(agentIds),
      timeRange: range
    };
  }, [events]);

  const handleTimeRangeChange = (start?: number, end?: number) => {
    if (start !== undefined && end !== undefined) {
      onFiltersChange({ timeRange: [start, end] });
    } else {
      onFiltersChange({ timeRange: null });
    }
  };

  const handleAgentToggle = (agentId: string) => {
    const newAgentIds = filters.agentIds.includes(agentId)
      ? filters.agentIds.filter(id => id !== agentId)
      : [...filters.agentIds, agentId];
    onFiltersChange({ agentIds: newAgentIds });
  };

  const handleEventTypeToggle = (eventType: string) => {
    const newEventTypes = filters.eventTypes.includes(eventType)
      ? filters.eventTypes.filter(type => type !== eventType)
      : [...filters.eventTypes, eventType];
    onFiltersChange({ eventTypes: newEventTypes });
  };

  const clearAllFilters = () => {
    onFiltersChange({
      agentIds: [],
      eventTypes: [],
      timeRange: null,
      searchQuery: ''
    });
  };

  const hasActiveFilters = filters.agentIds.length > 0 || 
                          filters.eventTypes.length > 0 || 
                          filters.timeRange !== null || 
                          filters.searchQuery.length > 0;

  return (
    <div className="filter-controls">
      {/* Quick Stats */}
      <div className="filter-stats">
        <div className="stat-item">
          <span className="stat-value">{statistics.totalEvents}</span>
          <span className="stat-label">Events</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{statistics.activeAgents}</span>
          <span className="stat-label">Agents</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{statistics.eventTypes}</span>
          <span className="stat-label">Types</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{Math.round(statistics.avgDuration)}ms</span>
          <span className="stat-label">Avg Duration</span>
        </div>
      </div>

      {/* Search Box */}
      <div className="filter-group search-group">
        <div className="search-input-wrapper">
          <input
            type="text"
            placeholder="Search events, agents, or data..."
            className="search-input"
            value={filters.searchQuery}
            onChange={(e) => onFiltersChange({ searchQuery: e.target.value })}
          />
          <span className="search-icon">🔍</span>
        </div>
      </div>

      {/* Agent Filters */}
      <div className="filter-group">
        <div className="filter-header">
          <span className="filter-label">Agents</span>
          <span className="filter-count">
            {filters.agentIds.length > 0 && `${filters.agentIds.length} selected`}
          </span>
        </div>
        <div className="filter-chips">
          {uniqueAgentIds.slice(0, 8).map((agentId) => (
            <button
              key={agentId}
              className={`filter-chip agent-chip ${
                filters.agentIds.includes(agentId) ? 'active' : ''
              }`}
              onClick={() => handleAgentToggle(agentId)}
              title={agentId}
            >
              {agentId.length > 10 ? `${agentId.substring(0, 10)}...` : agentId}
            </button>
          ))}
          {uniqueAgentIds.length > 8 && (
            <span className="more-indicator">+{uniqueAgentIds.length - 8} more</span>
          )}
        </div>
      </div>

      {/* Event Type Filters */}
      <div className="filter-group">
        <div className="filter-header">
          <span className="filter-label">Event Types</span>
          <span className="filter-count">
            {filters.eventTypes.length > 0 && `${filters.eventTypes.length} selected`}
          </span>
        </div>
        <div className="filter-chips">
          {uniqueEventTypes.map((eventType) => (
            <button
              key={eventType}
              className={`filter-chip type-chip ${
                filters.eventTypes.includes(eventType) ? 'active' : ''
              } type-${eventType}`}
              onClick={() => handleEventTypeToggle(eventType)}
            >
              {eventType}
            </button>
          ))}
        </div>
      </div>

      {/* Time Range Filter */}
      <div className="filter-group time-group">
        <div className="filter-header">
          <span className="filter-label">Time Range</span>
          {filters.timeRange && (
            <button
              className="clear-time-range"
              onClick={() => handleTimeRangeChange()}
            >
              Clear
            </button>
          )}
        </div>
        <div className="time-range-controls">
          <input
            type="datetime-local"
            className="time-input"
            value={filters.timeRange ? 
              new Date(filters.timeRange[0]).toISOString().slice(0, 16) : 
              new Date(timeRange[0]).toISOString().slice(0, 16)
            }
            onChange={(e) => {
              const start = new Date(e.target.value).getTime();
              const end = filters.timeRange?.[1] || timeRange[1];
              handleTimeRangeChange(start, end);
            }}
          />
          <span className="time-separator">to</span>
          <input
            type="datetime-local"
            className="time-input"
            value={filters.timeRange ? 
              new Date(filters.timeRange[1]).toISOString().slice(0, 16) : 
              new Date(timeRange[1]).toISOString().slice(0, 16)
            }
            onChange={(e) => {
              const end = new Date(e.target.value).getTime();
              const start = filters.timeRange?.[0] || timeRange[0];
              handleTimeRangeChange(start, end);
            }}
          />
        </div>
        
        {/* Quick Time Range Buttons */}
        <div className="quick-time-ranges">
          <button
            className="quick-time-btn"
            onClick={() => {
              const now = Date.now();
              handleTimeRangeChange(now - 60 * 60 * 1000, now); // Last hour
            }}
          >
            1h
          </button>
          <button
            className="quick-time-btn"
            onClick={() => {
              const now = Date.now();
              handleTimeRangeChange(now - 24 * 60 * 60 * 1000, now); // Last 24h
            }}
          >
            24h
          </button>
          <button
            className="quick-time-btn"
            onClick={() => {
              const now = Date.now();
              handleTimeRangeChange(now - 7 * 24 * 60 * 60 * 1000, now); // Last week
            }}
          >
            7d
          </button>
        </div>
      </div>

      {/* Clear Filters */}
      {hasActiveFilters && (
        <div className="filter-actions">
          <button 
            className="clear-all-filters"
            onClick={clearAllFilters}
          >
            Clear All Filters
          </button>
          <span className="active-filters-count">
            {[
              filters.agentIds.length > 0 && `${filters.agentIds.length} agents`,
              filters.eventTypes.length > 0 && `${filters.eventTypes.length} types`,
              filters.timeRange && 'time range',
              filters.searchQuery && 'search'
            ].filter(Boolean).join(', ')} active
          </span>
        </div>
      )}
    </div>
  );
});

FilterControls.displayName = 'FilterControls';