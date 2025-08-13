/**
 * Advanced Breakpoint Management System
 * Provides sophisticated debugging breakpoints with conditional logic,
 * data collection, and automated analysis
 */

import { TraceEvent, SystemState } from '../types.js';
import { Logger } from '../../core/logger.js';
import { generateId } from '../../utils/helpers.js';

export interface ConditionalBreakpoint {
  id: string;
  name: string;
  condition: BreakpointCondition;
  action: BreakpointAction;
  enabled: boolean;
  hitCount: number;
  maxHits?: number;
  skipCount?: number; // Skip first N hits
  timeWindow?: { start: number; end: number }; // Only active in time window
  agentFilter?: string[]; // Only trigger for specific agents
  eventTypeFilter?: string[]; // Only trigger for specific event types
  metadata: Record<string, any>;
  createdAt: number;
  lastHit?: number;
}

export interface BreakpointCondition {
  type: 'expression' | 'data_change' | 'performance' | 'error' | 'custom';
  expression?: string; // JavaScript expression to evaluate
  dataPath?: string; // Path to monitor for changes (e.g., 'agents.agent1.status')
  performance?: {
    metric: 'duration' | 'memory' | 'cpu';
    operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
    threshold: number;
  };
  errorPattern?: string; // Regex pattern to match errors
  customFunction?: (state: SystemState, event: TraceEvent) => boolean;
}

export interface BreakpointAction {
  type: 'pause' | 'log' | 'collect' | 'alert' | 'script';
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  collectData?: string[]; // What data to collect when triggered
  alertMessage?: string;
  scriptPath?: string; // Path to script to execute
  webhookUrl?: string; // URL to POST when triggered
}

export interface BreakpointHit {
  breakpointId: string;
  timestamp: number;
  event: TraceEvent;
  state: SystemState;
  collectedData?: Record<string, any>;
  triggerReason: string;
  executionTime?: number; // Time spent evaluating condition
}

export class BreakpointManager {
  private logger: Logger;
  private breakpoints = new Map<string, ConditionalBreakpoint>();
  private hitHistory: BreakpointHit[] = [];
  private maxHistorySize = 1000;
  private evaluationCache = new Map<string, { result: boolean; expiry: number }>();

  constructor() {
    this.logger = new Logger('BreakpointManager');
  }

  /**
   * Add a new breakpoint
   */
  addBreakpoint(config: Partial<ConditionalBreakpoint>): string {
    const id = generateId('bp');
    
    const breakpoint: ConditionalBreakpoint = {
      id,
      name: config.name || `Breakpoint ${id}`,
      condition: config.condition || { type: 'expression', expression: 'true' },
      action: config.action || { type: 'pause' },
      enabled: config.enabled !== false,
      hitCount: 0,
      skipCount: config.skipCount || 0,
      maxHits: config.maxHits,
      timeWindow: config.timeWindow,
      agentFilter: config.agentFilter,
      eventTypeFilter: config.eventTypeFilter,
      metadata: config.metadata || {},
      createdAt: Date.now()
    };

    this.breakpoints.set(id, breakpoint);
    this.logger.info(`Added breakpoint ${id}: ${breakpoint.name}`);
    
    return id;
  }

  /**
   * Remove a breakpoint
   */
  removeBreakpoint(id: string): boolean {
    const removed = this.breakpoints.delete(id);
    if (removed) {
      this.logger.info(`Removed breakpoint ${id}`);
      // Clean up related cache entries
      this.cleanupCache(id);
    }
    return removed;
  }

  /**
   * Update a breakpoint
   */
  updateBreakpoint(id: string, updates: Partial<ConditionalBreakpoint>): boolean {
    const breakpoint = this.breakpoints.get(id);
    if (!breakpoint) return false;

    Object.assign(breakpoint, updates);
    this.logger.info(`Updated breakpoint ${id}`);
    
    // Clear cache for this breakpoint
    this.cleanupCache(id);
    
    return true;
  }

  /**
   * Enable/disable a breakpoint
   */
  toggleBreakpoint(id: string, enabled?: boolean): boolean {
    const breakpoint = this.breakpoints.get(id);
    if (!breakpoint) return false;

    breakpoint.enabled = enabled !== undefined ? enabled : !breakpoint.enabled;
    this.logger.info(`${breakpoint.enabled ? 'Enabled' : 'Disabled'} breakpoint ${id}`);
    
    return true;
  }

  /**
   * Get all breakpoints
   */
  getAllBreakpoints(): ConditionalBreakpoint[] {
    return Array.from(this.breakpoints.values());
  }

  /**
   * Get a specific breakpoint
   */
  getBreakpoint(id: string): ConditionalBreakpoint | null {
    return this.breakpoints.get(id) || null;
  }

  /**
   * Evaluate all breakpoints against current state and event
   */
  async evaluateBreakpoints(state: SystemState, event: TraceEvent): Promise<BreakpointHit[]> {
    const hits: BreakpointHit[] = [];
    const timestamp = event.timestamp;

    for (const [id, breakpoint] of this.breakpoints) {
      if (!breakpoint.enabled) continue;
      
      // Check time window
      if (breakpoint.timeWindow) {
        if (timestamp < breakpoint.timeWindow.start || timestamp > breakpoint.timeWindow.end) {
          continue;
        }
      }

      // Check agent filter
      if (breakpoint.agentFilter && breakpoint.agentFilter.length > 0) {
        if (!event.agentId || !breakpoint.agentFilter.includes(event.agentId)) {
          continue;
        }
      }

      // Check event type filter
      if (breakpoint.eventTypeFilter && breakpoint.eventTypeFilter.length > 0) {
        if (!breakpoint.eventTypeFilter.includes(event.type)) {
          continue;
        }
      }

      const startTime = performance.now();
      const shouldTrigger = await this.evaluateCondition(breakpoint, state, event);
      const evaluationTime = performance.now() - startTime;

      if (shouldTrigger) {
        // Check skip count
        if (breakpoint.skipCount && breakpoint.hitCount < breakpoint.skipCount) {
          breakpoint.hitCount++;
          continue;
        }

        // Check max hits
        if (breakpoint.maxHits && breakpoint.hitCount >= breakpoint.maxHits) {
          breakpoint.enabled = false;
          this.logger.info(`Breakpoint ${id} disabled after reaching max hits`);
          continue;
        }

        breakpoint.hitCount++;
        breakpoint.lastHit = timestamp;

        const hit: BreakpointHit = {
          breakpointId: id,
          timestamp,
          event,
          state,
          triggerReason: this.getTriggerReason(breakpoint, state, event),
          executionTime: evaluationTime
        };

        // Execute action
        await this.executeAction(breakpoint, hit);
        
        hits.push(hit);
        this.addToHistory(hit);

        this.logger.info(`Breakpoint ${id} triggered: ${hit.triggerReason}`);
      }
    }

    return hits;
  }

  /**
   * Get breakpoint hit history
   */
  getHitHistory(breakpointId?: string, limit?: number): BreakpointHit[] {
    let history = this.hitHistory;
    
    if (breakpointId) {
      history = history.filter(hit => hit.breakpointId === breakpointId);
    }
    
    if (limit) {
      history = history.slice(-limit);
    }
    
    return history.reverse(); // Most recent first
  }

  /**
   * Clear hit history
   */
  clearHitHistory(breakpointId?: string): void {
    if (breakpointId) {
      this.hitHistory = this.hitHistory.filter(hit => hit.breakpointId !== breakpointId);
    } else {
      this.hitHistory = [];
    }
  }

  /**
   * Get breakpoint statistics
   */
  getStatistics(): {
    totalBreakpoints: number;
    enabledBreakpoints: number;
    totalHits: number;
    hitsByBreakpoint: Record<string, number>;
    averageEvaluationTime: number;
  } {
    const enabled = Array.from(this.breakpoints.values()).filter(bp => bp.enabled);
    const totalHits = this.hitHistory.length;
    const hitsByBreakpoint: Record<string, number> = {};
    
    for (const breakpoint of this.breakpoints.values()) {
      hitsByBreakpoint[breakpoint.id] = breakpoint.hitCount;
    }

    const avgEvaluationTime = this.hitHistory.reduce((sum, hit) => 
      sum + (hit.executionTime || 0), 0) / totalHits || 0;

    return {
      totalBreakpoints: this.breakpoints.size,
      enabledBreakpoints: enabled.length,
      totalHits,
      hitsByBreakpoint,
      averageEvaluationTime: avgEvaluationTime
    };
  }

  /**
   * Import breakpoints from configuration
   */
  importBreakpoints(config: Partial<ConditionalBreakpoint>[]): string[] {
    const importedIds: string[] = [];
    
    for (const bpConfig of config) {
      try {
        const id = this.addBreakpoint(bpConfig);
        importedIds.push(id);
      } catch (error) {
        this.logger.error('Failed to import breakpoint:', error, bpConfig);
      }
    }
    
    this.logger.info(`Imported ${importedIds.length}/${config.length} breakpoints`);
    return importedIds;
  }

  /**
   * Export breakpoints to configuration
   */
  exportBreakpoints(ids?: string[]): ConditionalBreakpoint[] {
    let breakpoints = Array.from(this.breakpoints.values());
    
    if (ids) {
      breakpoints = breakpoints.filter(bp => ids.includes(bp.id));
    }
    
    return breakpoints;
  }

  // Private methods

  private async evaluateCondition(
    breakpoint: ConditionalBreakpoint, 
    state: SystemState, 
    event: TraceEvent
  ): Promise<boolean> {
    const cacheKey = `${breakpoint.id}:${event.id}`;
    
    // Check cache first (with 1 second expiry)
    const cached = this.evaluationCache.get(cacheKey);
    if (cached && cached.expiry > Date.now()) {
      return cached.result;
    }

    let result = false;

    try {
      switch (breakpoint.condition.type) {
        case 'expression':
          result = this.evaluateExpression(breakpoint.condition.expression!, state, event);
          break;
          
        case 'data_change':
          result = this.evaluateDataChange(breakpoint.condition.dataPath!, state, event);
          break;
          
        case 'performance':
          result = this.evaluatePerformance(breakpoint.condition.performance!, event);
          break;
          
        case 'error':
          result = this.evaluateError(breakpoint.condition.errorPattern!, event);
          break;
          
        case 'custom':
          result = breakpoint.condition.customFunction!(state, event);
          break;
          
        default:
          this.logger.warn(`Unknown breakpoint condition type: ${breakpoint.condition.type}`);
          result = false;
      }
    } catch (error) {
      this.logger.error(`Error evaluating breakpoint ${breakpoint.id}:`, error);
      result = false;
    }

    // Cache result
    this.evaluationCache.set(cacheKey, {
      result,
      expiry: Date.now() + 1000
    });

    return result;
  }

  private evaluateExpression(expression: string, state: SystemState, event: TraceEvent): boolean {
    try {
      // Create safe evaluation context
      const context = {
        state,
        event,
        timestamp: event.timestamp,
        agentId: event.agentId,
        type: event.type,
        phase: event.phase,
        data: event.data,
        performance: event.performance,
        metadata: event.metadata,
        // Helper functions
        hasAgent: (id: string) => id in state.agents,
        getAgent: (id: string) => state.agents[id],
        hasTask: (id: string) => id in state.tasks,
        getTask: (id: string) => state.tasks[id],
        getMemory: (key: string) => state.memory[key]?.value,
        // Math functions
        Math,
        Date,
        // Utility functions
        JSON
      };
      
      // Use Function constructor for safer evaluation than eval
      const func = new Function(...Object.keys(context), `return (${expression})`);
      return Boolean(func(...Object.values(context)));
    } catch (error) {
      this.logger.error(`Error evaluating expression "${expression}":`, error);
      return false;
    }
  }

  private evaluateDataChange(dataPath: string, state: SystemState, event: TraceEvent): boolean {
    // This would require tracking previous state - simplified for now
    const pathParts = dataPath.split('.');
    let current: any = state;
    
    for (const part of pathParts) {
      if (current && typeof current === 'object') {
        current = current[part];
      } else {
        return false;
      }
    }
    
    // For now, just check if the value exists and has changed recently
    return current !== undefined;
  }

  private evaluatePerformance(
    condition: { metric: string; operator: string; threshold: number },
    event: TraceEvent
  ): boolean {
    if (!event.performance) return false;
    
    const value = event.performance[condition.metric];
    if (value === undefined) return false;
    
    switch (condition.operator) {
      case '>': return value > condition.threshold;
      case '<': return value < condition.threshold;
      case '>=': return value >= condition.threshold;
      case '<=': return value <= condition.threshold;
      case '==': return value === condition.threshold;
      case '!=': return value !== condition.threshold;
      default: return false;
    }
  }

  private evaluateError(pattern: string, event: TraceEvent): boolean {
    if (event.type !== 'error' && event.phase !== 'error') return false;
    
    const errorData = event.data.error;
    if (!errorData) return false;
    
    const regex = new RegExp(pattern, 'i');
    const message = errorData.message || '';
    const stack = errorData.stack || '';
    
    return regex.test(message) || regex.test(stack);
  }

  private getTriggerReason(
    breakpoint: ConditionalBreakpoint,
    state: SystemState,
    event: TraceEvent
  ): string {
    switch (breakpoint.condition.type) {
      case 'expression':
        return `Expression "${breakpoint.condition.expression}" evaluated to true`;
      case 'data_change':
        return `Data change detected at path: ${breakpoint.condition.dataPath}`;
      case 'performance':
        const perf = breakpoint.condition.performance!;
        const value = event.performance?.[perf.metric] || 0;
        return `Performance condition met: ${perf.metric} ${perf.operator} ${perf.threshold} (actual: ${value})`;
      case 'error':
        return `Error pattern matched: ${breakpoint.condition.errorPattern}`;
      case 'custom':
        return 'Custom condition evaluated to true';
      default:
        return 'Unknown condition';
    }
  }

  private async executeAction(breakpoint: ConditionalBreakpoint, hit: BreakpointHit): Promise<void> {
    const action = breakpoint.action;
    
    try {
      switch (action.type) {
        case 'log':
          const level = action.logLevel || 'info';
          this.logger[level](`Breakpoint ${breakpoint.name}:`, {
            reason: hit.triggerReason,
            event: hit.event,
            timestamp: new Date(hit.timestamp).toISOString()
          });
          break;
          
        case 'collect':
          if (action.collectData) {
            hit.collectedData = this.collectData(action.collectData, hit.state, hit.event);
          }
          break;
          
        case 'alert':
          this.logger.warn(`ALERT - Breakpoint ${breakpoint.name}: ${action.alertMessage || hit.triggerReason}`);
          break;
          
        case 'script':
          if (action.scriptPath) {
            await this.executeScript(action.scriptPath, hit);
          }
          break;
          
        case 'pause':
          // Pause would be handled by the calling system
          break;
          
        default:
          this.logger.warn(`Unknown action type: ${action.type}`);
      }
      
      // Webhook notification
      if (action.webhookUrl) {
        await this.sendWebhook(action.webhookUrl, breakpoint, hit);
      }
    } catch (error) {
      this.logger.error(`Error executing breakpoint action:`, error);
    }
  }

  private collectData(paths: string[], state: SystemState, event: TraceEvent): Record<string, any> {
    const collected: Record<string, any> = {};
    
    for (const path of paths) {
      try {
        if (path.startsWith('event.')) {
          const eventPath = path.substring(6);
          collected[path] = this.getNestedValue(event, eventPath);
        } else if (path.startsWith('state.')) {
          const statePath = path.substring(6);
          collected[path] = this.getNestedValue(state, statePath);
        } else {
          // Direct state path
          collected[path] = this.getNestedValue(state, path);
        }
      } catch (error) {
        collected[path] = `Error: ${error.message}`;
      }
    }
    
    return collected;
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => 
      current && typeof current === 'object' ? current[key] : undefined, obj
    );
  }

  private async executeScript(scriptPath: string, hit: BreakpointHit): Promise<void> {
    // In a real implementation, this would execute a script file
    this.logger.info(`Would execute script: ${scriptPath}`, hit);
  }

  private async sendWebhook(url: string, breakpoint: ConditionalBreakpoint, hit: BreakpointHit): Promise<void> {
    try {
      const payload = {
        breakpoint: {
          id: breakpoint.id,
          name: breakpoint.name,
          condition: breakpoint.condition
        },
        hit: {
          timestamp: hit.timestamp,
          reason: hit.triggerReason,
          eventId: hit.event.id,
          agentId: hit.event.agentId,
          collectedData: hit.collectedData
        }
      };
      
      // In a real implementation, this would make an HTTP POST request
      this.logger.info(`Would send webhook to ${url}:`, payload);
    } catch (error) {
      this.logger.error(`Failed to send webhook:`, error);
    }
  }

  private addToHistory(hit: BreakpointHit): void {
    this.hitHistory.push(hit);
    
    // Trim history if it gets too large
    if (this.hitHistory.length > this.maxHistorySize) {
      this.hitHistory = this.hitHistory.slice(-this.maxHistorySize);
    }
  }

  private cleanupCache(breakpointId: string): void {
    for (const [key] of this.evaluationCache) {
      if (key.startsWith(`${breakpointId}:`)) {
        this.evaluationCache.delete(key);
      }
    }
  }
}