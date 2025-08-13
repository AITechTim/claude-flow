/**
 * Event Filters - Filtering and preprocessing trace events
 */

import { TraceEvent, TraceEventType, EventFilter } from '../types';

export class EventFilterManager {
  private filters: EventFilter[] = [];
  private globalFilters: EventFilter[] = [];

  /**
   * Add a filter
   */
  addFilter(filter: EventFilter): void {
    this.filters.push(filter);
  }

  /**
   * Add a global filter (applies to all events)
   */
  addGlobalFilter(filter: EventFilter): void {
    this.globalFilters.push(filter);
  }

  /**
   * Remove a filter
   */
  removeFilter(filterIndex: number): void {
    if (filterIndex >= 0 && filterIndex < this.filters.length) {
      this.filters.splice(filterIndex, 1);
    }
  }

  /**
   * Clear all filters
   */
  clearFilters(): void {
    this.filters = [];
  }

  /**
   * Check if event passes all filters
   */
  shouldAcceptEvent(event: TraceEvent): boolean {
    const allFilters = [...this.globalFilters, ...this.filters];
    
    if (allFilters.length === 0) {
      return true;
    }

    return allFilters.every(filter => this.matchesFilter(event, filter));
  }

  /**
   * Filter events from an array
   */
  filterEvents(events: TraceEvent[]): TraceEvent[] {
    return events.filter(event => this.shouldAcceptEvent(event));
  }

  /**
   * Get events matching specific filters
   */
  getMatchingEvents(events: TraceEvent[], filters: EventFilter[]): TraceEvent[] {
    if (filters.length === 0) {
      return events;
    }

    return events.filter(event => 
      filters.some(filter => this.matchesFilter(event, filter))
    );
  }

  /**
   * Check if event matches a specific filter
   */
  private matchesFilter(event: TraceEvent, filter: EventFilter): boolean {
    // Check event type filter
    if (filter.type && filter.type.length > 0) {
      if (!filter.type.includes(event.type)) {
        return false;
      }
    }

    // Check agent ID filter
    if (filter.agentId && filter.agentId.length > 0) {
      if (!filter.agentId.includes(event.agentId)) {
        return false;
      }
    }

    // Check time range filter
    if (filter.timeRange) {
      const { start, end } = filter.timeRange;
      if (event.timestamp < start || event.timestamp > end) {
        return false;
      }
    }

    // Check severity filter
    if (filter.severity && filter.severity.length > 0 && event.metadata?.severity) {
      if (!filter.severity.includes(event.metadata.severity)) {
        return false;
      }
    }

    // Check tags filter
    if (filter.tags && filter.tags.length > 0 && event.metadata?.tags) {
      const hasMatchingTag = filter.tags.some(tag => 
        event.metadata!.tags.includes(tag)
      );
      if (!hasMatchingTag) {
        return false;
      }
    }

    return true;
  }

  /**
   * Create common filters
   */
  static createFilters() {
    return {
      /**
       * Filter by event type
       */
      byEventType(...types: TraceEventType[]): EventFilter {
        return { type: types };
      },

      /**
       * Filter by agent ID
       */
      byAgentId(...agentIds: string[]): EventFilter {
        return { agentId: agentIds };
      },

      /**
       * Filter by time range
       */
      byTimeRange(start: number, end: number): EventFilter {
        return { timeRange: { start, end } };
      },

      /**
       * Filter by last N minutes
       */
      byLastMinutes(minutes: number): EventFilter {
        const now = Date.now();
        const start = now - (minutes * 60 * 1000);
        return { timeRange: { start, end: now } };
      },

      /**
       * Filter by severity
       */
      bySeverity(...severities: string[]): EventFilter {
        return { severity: severities };
      },

      /**
       * Filter by tags
       */
      byTags(...tags: string[]): EventFilter {
        return { tags };
      },

      /**
       * Filter for errors only
       */
      errorsOnly(): EventFilter {
        return {
          type: [TraceEventType.TASK_FAIL],
          severity: ['high', 'critical']
        };
      },

      /**
       * Filter for performance events
       */
      performanceOnly(): EventFilter {
        return {
          type: [TraceEventType.PERFORMANCE_METRIC]
        };
      },

      /**
       * Filter for agent lifecycle events
       */
      lifecycleOnly(): EventFilter {
        return {
          type: [
            TraceEventType.AGENT_SPAWN,
            TraceEventType.AGENT_DESTROY,
            TraceEventType.TASK_START,
            TraceEventType.TASK_COMPLETE
          ]
        };
      }
    };
  }
}

/**
 * Event preprocessor for cleaning and enriching events
 */
export class EventPreprocessor {
  /**
   * Preprocess an event before storage/streaming
   */
  static preprocessEvent(event: TraceEvent): TraceEvent {
    return {
      ...event,
      // Ensure required fields
      id: event.id || this.generateId(),
      timestamp: event.timestamp || Date.now(),
      children: event.children || [],
      
      // Clean sensitive data
      data: this.sanitizeData(event.data),
      
      // Add computed metadata
      metadata: {
        ...event.metadata,
        preprocessed: true,
        processingTime: Date.now()
      }
    };
  }

  /**
   * Sanitize event data
   */
  private static sanitizeData(data: Record<string, any>): Record<string, any> {
    const sanitized = { ...data };
    
    // Remove sensitive fields
    const sensitiveFields = ['password', 'token', 'secret', 'key', 'auth'];
    
    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    }

    // Truncate large strings
    for (const [key, value] of Object.entries(sanitized)) {
      if (typeof value === 'string' && value.length > 1000) {
        sanitized[key] = value.substring(0, 1000) + '... [TRUNCATED]';
      }
    }

    return sanitized;
  }

  /**
   * Generate unique ID
   */
  private static generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}