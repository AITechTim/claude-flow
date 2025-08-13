/**
 * Complete Time-Travel Debugging Engine
 * Provides comprehensive debugging capabilities with state reconstruction,
 * breakpoints, timeline generation, and anomaly detection
 */

import { TraceEvent, SystemState, TimeRange } from '../types.js';
import { StateReconstructor, SnapshotConfig } from './state-reconstructor.js';
import { TraceStorage } from '../storage/trace-storage.js';
import { Logger } from '../../core/logger.js';
import { generateId } from '../../utils/helpers.js';

export interface BreakpointConfig {
  id: string;
  sessionId: string;
  condition: (state: SystemState, event: TraceEvent) => boolean;
  action: 'pause' | 'log' | 'collect' | 'alert';
  enabled: boolean;
  hitCount: number;
  maxHits?: number;
  description: string;
  metadata?: Record<string, any>;
}

export interface TimelinePoint {
  timestamp: number;
  event: TraceEvent;
  state: SystemState;
  stateDiff?: any;
  breakpoints?: string[];
  anomalies?: AnomalyDetection[];
}

export interface AnomalyDetection {
  type: 'performance' | 'memory' | 'error' | 'behavior' | 'resource';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  timestamp: number;
  eventId: string;
  agentId?: string;
  details: Record<string, any>;
  suggestions?: string[];
}

export interface DebugSession {
  id: string;
  sessionId: string;
  name: string;
  currentTimestamp: number;
  breakpoints: Map<string, BreakpointConfig>;
  timeline: TimelinePoint[];
  bookmarks: Map<string, TimelinePoint>;
  status: 'active' | 'paused' | 'stopped';
  createdAt: number;
  lastActivity: number;
}

export interface StepDirection {
  type: 'forward' | 'backward' | 'to_timestamp' | 'to_event' | 'to_breakpoint';
  count?: number;
  targetTimestamp?: number;
  targetEventId?: string;
  targetBreakpointId?: string;
}

export class TimeTravelEngine {
  private stateReconstructor: StateReconstructor;
  private storage: TraceStorage;
  private logger: Logger;
  private debugSessions = new Map<string, DebugSession>();
  private anomalyDetectors = new Map<string, AnomalyDetector>();
  private stateCache = new LRUCache<SystemState>(100);

  constructor(
    storage: TraceStorage,
    config: SnapshotConfig = {
      interval: 30000, // 30 seconds
      maxSnapshots: 50,
      compressionEnabled: true,
      persistenceEnabled: true
    }
  ) {
    this.storage = storage;
    this.logger = new Logger('TimeTravelEngine');
    this.stateReconstructor = new StateReconstructor(storage, config);
    
    this.initializeAnomalyDetectors();
  }

  /**
   * Create a new debug session
   */
  async createDebugSession(sessionId: string, name: string): Promise<string> {
    const debugSessionId = generateId('debug');
    
    const debugSession: DebugSession = {
      id: debugSessionId,
      sessionId,
      name,
      currentTimestamp: Date.now(),
      breakpoints: new Map(),
      timeline: [],
      bookmarks: new Map(),
      status: 'active',
      createdAt: Date.now(),
      lastActivity: Date.now()
    };

    this.debugSessions.set(debugSessionId, debugSession);
    
    // Initialize timeline with existing events
    await this.buildTimeline(debugSessionId);
    
    this.logger.info(`Created debug session ${debugSessionId} for session ${sessionId}`);
    return debugSessionId;
  }

  /**
   * Get debug session
   */
  getDebugSession(debugSessionId: string): DebugSession | null {
    return this.debugSessions.get(debugSessionId) || null;
  }

  /**
   * Set current position in time
   */
  async setCurrentPosition(debugSessionId: string, timestamp: number): Promise<SystemState> {
    const debugSession = this.debugSessions.get(debugSessionId);
    if (!debugSession) {
      throw new Error(`Debug session ${debugSessionId} not found`);
    }

    debugSession.currentTimestamp = timestamp;
    debugSession.lastActivity = Date.now();

    // Get the state at this timestamp
    const state = await this.stateReconstructor.reconstructState(
      debugSession.sessionId, 
      timestamp
    );

    this.logger.debug(`Set current position to ${new Date(timestamp).toISOString()}`);
    return state;
  }

  /**
   * Step forward or backward in time
   */
  async step(debugSessionId: string, direction: StepDirection): Promise<TimelinePoint> {
    const debugSession = this.debugSessions.get(debugSessionId);
    if (!debugSession) {
      throw new Error(`Debug session ${debugSessionId} not found`);
    }

    let targetTimestamp: number;
    
    switch (direction.type) {
      case 'forward':
        targetTimestamp = this.findNextTimestamp(debugSession, direction.count || 1);
        break;
        
      case 'backward':
        targetTimestamp = this.findPreviousTimestamp(debugSession, direction.count || 1);
        break;
        
      case 'to_timestamp':
        if (!direction.targetTimestamp) {
          throw new Error('Target timestamp required for to_timestamp step');
        }
        targetTimestamp = direction.targetTimestamp;
        break;
        
      case 'to_event':
        if (!direction.targetEventId) {
          throw new Error('Target event ID required for to_event step');
        }
        targetTimestamp = await this.findEventTimestamp(debugSession.sessionId, direction.targetEventId);
        break;
        
      case 'to_breakpoint':
        if (!direction.targetBreakpointId) {
          throw new Error('Target breakpoint ID required for to_breakpoint step');
        }
        targetTimestamp = await this.findNextBreakpointHit(debugSession, direction.targetBreakpointId);
        break;
        
      default:
        throw new Error(`Unknown step direction: ${direction.type}`);
    }

    const state = await this.setCurrentPosition(debugSessionId, targetTimestamp);
    const timelinePoint = await this.getTimelinePoint(debugSession, targetTimestamp);

    // Check for breakpoints
    await this.checkBreakpoints(debugSession, timelinePoint);

    this.logger.debug(`Stepped ${direction.type} to ${new Date(targetTimestamp).toISOString()}`);
    return timelinePoint;
  }

  /**
   * Add breakpoint
   */
  addBreakpoint(
    debugSessionId: string, 
    condition: (state: SystemState, event: TraceEvent) => boolean,
    config: Partial<BreakpointConfig> = {}
  ): string {
    const debugSession = this.debugSessions.get(debugSessionId);
    if (!debugSession) {
      throw new Error(`Debug session ${debugSessionId} not found`);
    }

    const breakpointId = generateId('breakpoint');
    const breakpoint: BreakpointConfig = {
      id: breakpointId,
      sessionId: debugSession.sessionId,
      condition,
      action: config.action || 'pause',
      enabled: config.enabled !== false,
      hitCount: 0,
      maxHits: config.maxHits,
      description: config.description || 'Custom breakpoint',
      metadata: config.metadata || {}
    };

    debugSession.breakpoints.set(breakpointId, breakpoint);
    
    this.logger.info(`Added breakpoint ${breakpointId}: ${breakpoint.description}`);
    return breakpointId;
  }

  /**
   * Remove breakpoint
   */
  removeBreakpoint(debugSessionId: string, breakpointId: string): boolean {
    const debugSession = this.debugSessions.get(debugSessionId);
    if (!debugSession) {
      return false;
    }

    const removed = debugSession.breakpoints.delete(breakpointId);
    if (removed) {
      this.logger.info(`Removed breakpoint ${breakpointId}`);
    }
    return removed;
  }

  /**
   * Get state at specific timestamp
   */
  async getStateAtTimestamp(debugSessionId: string, timestamp: number): Promise<SystemState> {
    const debugSession = this.debugSessions.get(debugSessionId);
    if (!debugSession) {
      throw new Error(`Debug session ${debugSessionId} not found`);
    }

    const cacheKey = `${debugSession.sessionId}:${timestamp}`;
    
    // Check cache first
    if (this.stateCache.has(cacheKey)) {
      return this.stateCache.get(cacheKey)!;
    }

    const state = await this.stateReconstructor.reconstructState(
      debugSession.sessionId, 
      timestamp
    );

    this.stateCache.set(cacheKey, state);
    return state;
  }

  /**
   * Get state diff between two timestamps
   */
  async getStateDiff(
    debugSessionId: string, 
    fromTimestamp: number, 
    toTimestamp: number
  ): Promise<any> {
    const debugSession = this.debugSessions.get(debugSessionId);
    if (!debugSession) {
      throw new Error(`Debug session ${debugSessionId} not found`);
    }

    return await this.stateReconstructor.getStateDiff(
      debugSession.sessionId,
      fromTimestamp,
      toTimestamp
    );
  }

  /**
   * Export state at current position
   */
  async exportCurrentState(debugSessionId: string): Promise<{
    timestamp: number;
    state: SystemState;
    events: TraceEvent[];
    metadata: any;
  }> {
    const debugSession = this.debugSessions.get(debugSessionId);
    if (!debugSession) {
      throw new Error(`Debug session ${debugSessionId} not found`);
    }

    const state = await this.getStateAtTimestamp(debugSession.id, debugSession.currentTimestamp);
    const events = await this.storage.getTracesBySession(debugSession.sessionId, {
      timeRange: {
        start: debugSession.currentTimestamp - 1000, // 1 second before
        end: debugSession.currentTimestamp + 1000   // 1 second after
      }
    });

    return {
      timestamp: debugSession.currentTimestamp,
      state,
      events,
      metadata: {
        debugSessionId: debugSession.id,
        sessionId: debugSession.sessionId,
        exportedAt: Date.now(),
        position: debugSession.currentTimestamp
      }
    };
  }

  /**
   * Find when a condition was first met
   */
  async findConditionOrigin(
    debugSessionId: string,
    condition: (state: SystemState) => boolean
  ): Promise<{ timestamp: number; event: TraceEvent } | null> {
    const debugSession = this.debugSessions.get(debugSessionId);
    if (!debugSession) {
      throw new Error(`Debug session ${debugSessionId} not found`);
    }

    return await this.stateReconstructor.findConditionOrigin(
      debugSession.sessionId,
      condition,
      debugSession.currentTimestamp
    );
  }

  /**
   * Analyze critical path up to current position
   */
  async getCriticalPath(debugSessionId: string): Promise<any> {
    const debugSession = this.debugSessions.get(debugSessionId);
    if (!debugSession) {
      throw new Error(`Debug session ${debugSessionId} not found`);
    }

    return await this.stateReconstructor.getCriticalPath(
      debugSession.sessionId,
      debugSession.currentTimestamp
    );
  }

  /**
   * Detect anomalies in the trace
   */
  async detectAnomalies(debugSessionId: string): Promise<AnomalyDetection[]> {
    const debugSession = this.debugSessions.get(debugSessionId);
    if (!debugSession) {
      throw new Error(`Debug session ${debugSessionId} not found`);
    }

    const events = await this.storage.getTracesBySession(debugSession.sessionId, {
      timeRange: { start: 0, end: debugSession.currentTimestamp }
    });

    const anomalies: AnomalyDetection[] = [];

    for (const detector of this.anomalyDetectors.values()) {
      const detectorAnomalies = detector.detect(events);
      anomalies.push(...detectorAnomalies);
    }

    // Sort by severity and timestamp
    anomalies.sort((a, b) => {
      const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      const severityDiff = severityOrder[b.severity] - severityOrder[a.severity];
      return severityDiff !== 0 ? severityDiff : b.timestamp - a.timestamp;
    });

    return anomalies;
  }

  /**
   * Add bookmark at current position
   */
  async addBookmark(debugSessionId: string, name: string): Promise<string> {
    const debugSession = this.debugSessions.get(debugSessionId);
    if (!debugSession) {
      throw new Error(`Debug session ${debugSessionId} not found`);
    }

    const bookmarkId = generateId('bookmark');
    const timelinePoint = await this.getTimelinePoint(debugSession, debugSession.currentTimestamp);
    
    debugSession.bookmarks.set(bookmarkId, {
      ...timelinePoint,
      timestamp: debugSession.currentTimestamp
    });

    this.logger.info(`Added bookmark ${bookmarkId}: ${name} at ${new Date(debugSession.currentTimestamp).toISOString()}`);
    return bookmarkId;
  }

  /**
   * Jump to bookmark
   */
  async jumpToBookmark(debugSessionId: string, bookmarkId: string): Promise<TimelinePoint> {
    const debugSession = this.debugSessions.get(debugSessionId);
    if (!debugSession) {
      throw new Error(`Debug session ${debugSessionId} not found`);
    }

    const bookmark = debugSession.bookmarks.get(bookmarkId);
    if (!bookmark) {
      throw new Error(`Bookmark ${bookmarkId} not found`);
    }

    await this.setCurrentPosition(debugSessionId, bookmark.timestamp);
    return bookmark;
  }

  /**
   * Generate complete timeline for visualization
   */
  async generateTimeline(debugSessionId: string): Promise<TimelinePoint[]> {
    const debugSession = this.debugSessions.get(debugSessionId);
    if (!debugSession) {
      throw new Error(`Debug session ${debugSessionId} not found`);
    }

    if (debugSession.timeline.length > 0) {
      return debugSession.timeline;
    }

    return await this.buildTimeline(debugSessionId);
  }

  /**
   * Get memory usage analysis over time
   */
  async getMemoryAnalysis(debugSessionId: string): Promise<{
    timeline: Array<{ timestamp: number; memoryUsage: number; agentId?: string }>;
    peaks: Array<{ timestamp: number; memoryUsage: number; agentId?: string }>;
    leaks: Array<{ startTime: number; endTime: number; growthRate: number; agentId?: string }>;
  }> {
    const debugSession = this.debugSessions.get(debugSessionId);
    if (!debugSession) {
      throw new Error(`Debug session ${debugSessionId} not found`);
    }

    const events = await this.storage.getTracesBySession(debugSession.sessionId, {
      eventTypes: ['performance', 'memory_access'],
      timeRange: { start: 0, end: debugSession.currentTimestamp }
    });

    const timeline: Array<{ timestamp: number; memoryUsage: number; agentId?: string }> = [];
    const peaks: Array<{ timestamp: number; memoryUsage: number; agentId?: string }> = [];
    const leaks: Array<{ startTime: number; endTime: number; growthRate: number; agentId?: string }> = [];

    // Process memory events
    const memoryByAgent = new Map<string, Array<{ timestamp: number; usage: number }>>();

    for (const event of events) {
      if (event.performance?.memoryUsage) {
        const agentId = event.agentId || 'system';
        if (!memoryByAgent.has(agentId)) {
          memoryByAgent.set(agentId, []);
        }
        
        const usage = event.performance.memoryUsage;
        memoryByAgent.get(agentId)!.push({
          timestamp: event.timestamp,
          usage
        });
        
        timeline.push({
          timestamp: event.timestamp,
          memoryUsage: usage,
          agentId: event.agentId
        });
      }
    }

    // Detect peaks and leaks
    for (const [agentId, memoryHistory] of memoryByAgent) {
      memoryHistory.sort((a, b) => a.timestamp - b.timestamp);
      
      // Find peaks
      for (let i = 1; i < memoryHistory.length - 1; i++) {
        const prev = memoryHistory[i - 1];
        const current = memoryHistory[i];
        const next = memoryHistory[i + 1];
        
        if (current.usage > prev.usage && current.usage > next.usage) {
          peaks.push({
            timestamp: current.timestamp,
            memoryUsage: current.usage,
            agentId
          });
        }
      }
      
      // Detect potential memory leaks (sustained growth)
      const windowSize = 10; // Check last 10 measurements
      if (memoryHistory.length >= windowSize) {
        const recent = memoryHistory.slice(-windowSize);
        const growth = (recent[recent.length - 1].usage - recent[0].usage) / recent[0].usage;
        
        if (growth > 0.5) { // 50% growth
          const duration = recent[recent.length - 1].timestamp - recent[0].timestamp;
          const growthRate = growth / (duration / 1000); // per second
          
          leaks.push({
            startTime: recent[0].timestamp,
            endTime: recent[recent.length - 1].timestamp,
            growthRate,
            agentId
          });
        }
      }
    }

    return { timeline, peaks, leaks };
  }

  // Private methods

  private async buildTimeline(debugSessionId: string): Promise<TimelinePoint[]> {
    const debugSession = this.debugSessions.get(debugSessionId);
    if (!debugSession) {
      return [];
    }

    const events = await this.storage.getTracesBySession(debugSession.sessionId);
    const timeline: TimelinePoint[] = [];

    for (const event of events) {
      const state = await this.getStateAtTimestamp(debugSession.id, event.timestamp);
      const anomalies = await this.checkAnomaliesForEvent(event);
      
      timeline.push({
        timestamp: event.timestamp,
        event,
        state,
        anomalies
      });
    }

    // Sort by timestamp
    timeline.sort((a, b) => a.timestamp - b.timestamp);
    
    // Add state diffs
    for (let i = 1; i < timeline.length; i++) {
      const current = timeline[i];
      const previous = timeline[i - 1];
      
      current.stateDiff = await this.stateReconstructor.computeStateDiff(
        previous.state,
        current.state
      );
    }

    debugSession.timeline = timeline;
    return timeline;
  }

  private findNextTimestamp(debugSession: DebugSession, count: number): number {
    const currentIndex = debugSession.timeline.findIndex(
      point => point.timestamp >= debugSession.currentTimestamp
    );
    
    if (currentIndex === -1 || currentIndex + count >= debugSession.timeline.length) {
      return debugSession.timeline[debugSession.timeline.length - 1]?.timestamp || debugSession.currentTimestamp;
    }
    
    return debugSession.timeline[currentIndex + count].timestamp;
  }

  private findPreviousTimestamp(debugSession: DebugSession, count: number): number {
    const currentIndex = debugSession.timeline.findIndex(
      point => point.timestamp >= debugSession.currentTimestamp
    );
    
    if (currentIndex === -1 || currentIndex - count < 0) {
      return debugSession.timeline[0]?.timestamp || debugSession.currentTimestamp;
    }
    
    return debugSession.timeline[currentIndex - count].timestamp;
  }

  private async findEventTimestamp(sessionId: string, eventId: string): Promise<number> {
    const event = await this.storage.getTrace(eventId);
    if (!event) {
      throw new Error(`Event ${eventId} not found`);
    }
    return event.timestamp;
  }

  private async findNextBreakpointHit(debugSession: DebugSession, breakpointId: string): Promise<number> {
    const breakpoint = debugSession.breakpoints.get(breakpointId);
    if (!breakpoint || !breakpoint.enabled) {
      throw new Error(`Breakpoint ${breakpointId} not found or disabled`);
    }

    // Find next event after current timestamp that triggers the breakpoint
    const events = await this.storage.getTracesBySession(debugSession.sessionId, {
      timeRange: { start: debugSession.currentTimestamp + 1, end: Date.now() }
    });

    for (const event of events) {
      const state = await this.getStateAtTimestamp(debugSession.id, event.timestamp);
      if (breakpoint.condition(state, event)) {
        return event.timestamp;
      }
    }

    throw new Error(`No future breakpoint hits found for ${breakpointId}`);
  }

  private async getTimelinePoint(debugSession: DebugSession, timestamp: number): Promise<TimelinePoint> {
    // Find existing timeline point or create new one
    const existing = debugSession.timeline.find(point => point.timestamp === timestamp);
    if (existing) {
      return existing;
    }

    // Find the event at this timestamp
    const events = await this.storage.getTracesBySession(debugSession.sessionId, {
      timeRange: { start: timestamp - 100, end: timestamp + 100 }
    });

    const event = events.find(e => e.timestamp === timestamp) || events[0];
    const state = await this.getStateAtTimestamp(debugSession.id, timestamp);
    const anomalies = event ? await this.checkAnomaliesForEvent(event) : [];

    return {
      timestamp,
      event: event!,
      state,
      anomalies
    };
  }

  private async checkBreakpoints(debugSession: DebugSession, timelinePoint: TimelinePoint): Promise<void> {
    const hitBreakpoints: string[] = [];

    for (const [breakpointId, breakpoint] of debugSession.breakpoints) {
      if (!breakpoint.enabled) continue;
      
      if (breakpoint.maxHits && breakpoint.hitCount >= breakpoint.maxHits) {
        breakpoint.enabled = false;
        continue;
      }

      try {
        if (breakpoint.condition(timelinePoint.state, timelinePoint.event)) {
          breakpoint.hitCount++;
          hitBreakpoints.push(breakpointId);
          
          switch (breakpoint.action) {
            case 'pause':
              debugSession.status = 'paused';
              break;
            case 'log':
              this.logger.info(`Breakpoint ${breakpointId} hit:`, { timelinePoint });
              break;
            case 'alert':
              // Could trigger external alert system
              break;
          }
        }
      } catch (error) {
        this.logger.error(`Error evaluating breakpoint ${breakpointId}:`, error);
      }
    }

    if (hitBreakpoints.length > 0) {
      timelinePoint.breakpoints = hitBreakpoints;
      this.logger.info(`Hit breakpoints at ${new Date(timelinePoint.timestamp).toISOString()}:`, hitBreakpoints);
    }
  }

  private async checkAnomaliesForEvent(event: TraceEvent): Promise<AnomalyDetection[]> {
    const anomalies: AnomalyDetection[] = [];

    for (const detector of this.anomalyDetectors.values()) {
      const eventAnomalies = detector.detectForEvent(event);
      anomalies.push(...eventAnomalies);
    }

    return anomalies;
  }

  private initializeAnomalyDetectors(): void {
    // Performance anomaly detector
    this.anomalyDetectors.set('performance', new PerformanceAnomalyDetector());
    
    // Memory anomaly detector
    this.anomalyDetectors.set('memory', new MemoryAnomalyDetector());
    
    // Error pattern detector
    this.anomalyDetectors.set('error', new ErrorAnomalyDetector());
    
    // Behavior anomaly detector
    this.anomalyDetectors.set('behavior', new BehaviorAnomalyDetector());
  }
}

// Anomaly Detector Classes

abstract class AnomalyDetector {
  abstract detect(events: TraceEvent[]): AnomalyDetection[];
  
  detectForEvent(event: TraceEvent): AnomalyDetection[] {
    return this.detect([event]);
  }
}

class PerformanceAnomalyDetector extends AnomalyDetector {
  detect(events: TraceEvent[]): AnomalyDetection[] {
    const anomalies: AnomalyDetection[] = [];
    
    for (const event of events) {
      if (!event.performance) continue;
      
      const duration = event.performance.duration || 0;
      const memoryUsage = event.performance.memoryUsage || 0;
      const cpuTime = event.performance.cpuTime || 0;
      
      // Detect slow operations
      if (duration > 10000) { // 10 seconds
        anomalies.push({
          type: 'performance',
          severity: duration > 60000 ? 'critical' : 'high',
          description: `Slow operation detected: ${duration}ms`,
          timestamp: event.timestamp,
          eventId: event.id,
          agentId: event.agentId,
          details: { duration, threshold: 10000 },
          suggestions: [
            'Consider optimizing the operation',
            'Check for blocking I/O operations',
            'Review algorithm complexity'
          ]
        });
      }
      
      // Detect high memory usage
      if (memoryUsage > 100 * 1024 * 1024) { // 100MB
        anomalies.push({
          type: 'performance',
          severity: memoryUsage > 500 * 1024 * 1024 ? 'critical' : 'medium',
          description: `High memory usage: ${Math.round(memoryUsage / 1024 / 1024)}MB`,
          timestamp: event.timestamp,
          eventId: event.id,
          agentId: event.agentId,
          details: { memoryUsage, threshold: 100 * 1024 * 1024 },
          suggestions: [
            'Check for memory leaks',
            'Review data structures',
            'Implement garbage collection'
          ]
        });
      }
      
      // Detect high CPU usage
      if (cpuTime > 5000) { // 5 seconds
        anomalies.push({
          type: 'performance',
          severity: cpuTime > 30000 ? 'high' : 'medium',
          description: `High CPU usage: ${cpuTime}ms`,
          timestamp: event.timestamp,
          eventId: event.id,
          agentId: event.agentId,
          details: { cpuTime, threshold: 5000 },
          suggestions: [
            'Optimize computational complexity',
            'Consider parallel processing',
            'Review loop efficiency'
          ]
        });
      }
    }
    
    return anomalies;
  }
}

class MemoryAnomalyDetector extends AnomalyDetector {
  private memoryHistory = new Map<string, number[]>();
  
  detect(events: TraceEvent[]): AnomalyDetection[] {
    const anomalies: AnomalyDetection[] = [];
    
    for (const event of events) {
      const agentId = event.agentId || 'system';
      const memoryUsage = event.performance?.memoryUsage;
      
      if (!memoryUsage) continue;
      
      if (!this.memoryHistory.has(agentId)) {
        this.memoryHistory.set(agentId, []);
      }
      
      const history = this.memoryHistory.get(agentId)!;
      history.push(memoryUsage);
      
      // Keep only last 20 measurements
      if (history.length > 20) {
        history.shift();
      }
      
      if (history.length >= 5) {
        // Detect rapid growth
        const recentGrowth = (history[history.length - 1] - history[history.length - 5]) / history[history.length - 5];
        
        if (recentGrowth > 0.5) { // 50% growth in 5 measurements
          anomalies.push({
            type: 'memory',
            severity: recentGrowth > 2 ? 'critical' : 'high',
            description: `Rapid memory growth detected: ${Math.round(recentGrowth * 100)}%`,
            timestamp: event.timestamp,
            eventId: event.id,
            agentId: event.agentId,
            details: { growth: recentGrowth, measurements: 5 },
            suggestions: [
              'Check for memory leaks',
              'Review object lifecycle',
              'Implement proper cleanup'
            ]
          });
        }
        
        // Detect oscillating memory usage (potential inefficiency)
        const variance = this.calculateVariance(history);
        const mean = history.reduce((a, b) => a + b, 0) / history.length;
        const coefficient = Math.sqrt(variance) / mean;
        
        if (coefficient > 0.3) { // High variability
          anomalies.push({
            type: 'memory',
            severity: 'medium',
            description: `Unstable memory usage pattern detected`,
            timestamp: event.timestamp,
            eventId: event.id,
            agentId: event.agentId,
            details: { coefficient, variance, mean },
            suggestions: [
              'Review allocation patterns',
              'Consider memory pooling',
              'Optimize data structures'
            ]
          });
        }
      }
    }
    
    return anomalies;
  }
  
  private calculateVariance(numbers: number[]): number {
    const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
    return numbers.reduce((variance, num) => variance + Math.pow(num - mean, 2), 0) / numbers.length;
  }
}

class ErrorAnomalyDetector extends AnomalyDetector {
  private errorCounts = new Map<string, number>();
  private errorPatterns = new Map<string, number>();
  
  detect(events: TraceEvent[]): AnomalyDetection[] {
    const anomalies: AnomalyDetection[] = [];
    
    for (const event of events) {
      if (event.type === 'error' || event.phase === 'error') {
        const agentId = event.agentId || 'system';
        const errorType = event.data.error?.type || 'unknown';
        const errorMessage = event.data.error?.message || '';
        
        // Track error frequency
        const errorKey = `${agentId}:${errorType}`;
        this.errorCounts.set(errorKey, (this.errorCounts.get(errorKey) || 0) + 1);
        
        const count = this.errorCounts.get(errorKey)!;
        
        // Detect error spikes
        if (count >= 5) {
          anomalies.push({
            type: 'error',
            severity: count >= 20 ? 'critical' : count >= 10 ? 'high' : 'medium',
            description: `Error spike detected: ${count} occurrences of ${errorType}`,
            timestamp: event.timestamp,
            eventId: event.id,
            agentId: event.agentId,
            details: { errorType, count, message: errorMessage },
            suggestions: [
              'Investigate root cause',
              'Implement error handling',
              'Add circuit breakers'
            ]
          });
        }
        
        // Track error patterns
        const pattern = this.extractErrorPattern(errorMessage);
        if (pattern) {
          this.errorPatterns.set(pattern, (this.errorPatterns.get(pattern) || 0) + 1);
          
          if (this.errorPatterns.get(pattern)! >= 3) {
            anomalies.push({
              type: 'error',
              severity: 'medium',
              description: `Recurring error pattern detected: ${pattern}`,
              timestamp: event.timestamp,
              eventId: event.id,
              agentId: event.agentId,
              details: { pattern, occurrences: this.errorPatterns.get(pattern) },
              suggestions: [
                'Review error handling logic',
                'Fix underlying issue',
                'Add pattern-specific handling'
              ]
            });
          }
        }
      }
    }
    
    return anomalies;
  }
  
  private extractErrorPattern(message: string): string | null {
    // Simple pattern extraction - look for common error patterns
    const patterns = [
      /timeout/i,
      /connection refused/i,
      /network error/i,
      /file not found/i,
      /permission denied/i,
      /out of memory/i,
      /null pointer/i
    ];
    
    for (const pattern of patterns) {
      if (pattern.test(message)) {
        return pattern.source;
      }
    }
    
    return null;
  }
}

class BehaviorAnomalyDetector extends AnomalyDetector {
  private agentBehaviors = new Map<string, AgentBehaviorProfile>();
  
  detect(events: TraceEvent[]): AnomalyDetection[] {
    const anomalies: AnomalyDetection[] = [];
    
    for (const event of events) {
      if (!event.agentId) continue;
      
      if (!this.agentBehaviors.has(event.agentId)) {
        this.agentBehaviors.set(event.agentId, new AgentBehaviorProfile());
      }
      
      const profile = this.agentBehaviors.get(event.agentId)!;
      profile.addEvent(event);
      
      const behaviorAnomalies = profile.detectAnomalies(event);
      anomalies.push(...behaviorAnomalies);
    }
    
    return anomalies;
  }
}

class AgentBehaviorProfile {
  private eventTypes = new Map<string, number>();
  private avgDuration = new Map<string, number>();
  private eventSequences: string[] = [];
  private totalEvents = 0;
  
  addEvent(event: TraceEvent): void {
    this.totalEvents++;
    
    // Track event type frequency
    this.eventTypes.set(event.type, (this.eventTypes.get(event.type) || 0) + 1);
    
    // Track average duration for event types
    const duration = event.performance?.duration || 0;
    const currentAvg = this.avgDuration.get(event.type) || 0;
    const count = this.eventTypes.get(event.type)!;
    const newAvg = (currentAvg * (count - 1) + duration) / count;
    this.avgDuration.set(event.type, newAvg);
    
    // Track event sequences
    this.eventSequences.push(event.type);
    if (this.eventSequences.length > 50) {
      this.eventSequences.shift();
    }
  }
  
  detectAnomalies(event: TraceEvent): AnomalyDetection[] {
    const anomalies: AnomalyDetection[] = [];
    
    if (this.totalEvents < 10) return anomalies; // Need baseline
    
    // Detect unusual event duration
    const expectedDuration = this.avgDuration.get(event.type) || 0;
    const actualDuration = event.performance?.duration || 0;
    
    if (expectedDuration > 0 && actualDuration > expectedDuration * 3) {
      anomalies.push({
        type: 'behavior',
        severity: actualDuration > expectedDuration * 10 ? 'high' : 'medium',
        description: `Agent taking unusually long for ${event.type}`,
        timestamp: event.timestamp,
        eventId: event.id,
        agentId: event.agentId,
        details: {
          expected: expectedDuration,
          actual: actualDuration,
          ratio: actualDuration / expectedDuration
        },
        suggestions: [
          'Check agent performance',
          'Review agent configuration',
          'Monitor resource usage'
        ]
      });
    }
    
    // Detect unusual event frequency
    const eventTypeCount = this.eventTypes.get(event.type) || 0;
    const frequency = eventTypeCount / this.totalEvents;
    
    // If this event type is becoming very frequent suddenly
    if (frequency > 0.8 && this.totalEvents > 20) {
      anomalies.push({
        type: 'behavior',
        severity: 'medium',
        description: `Agent showing repetitive behavior: ${event.type}`,
        timestamp: event.timestamp,
        eventId: event.id,
        agentId: event.agentId,
        details: {
          eventType: event.type,
          frequency,
          count: eventTypeCount,
          totalEvents: this.totalEvents
        },
        suggestions: [
          'Check for infinite loops',
          'Review agent logic',
          'Implement circuit breakers'
        ]
      });
    }
    
    return anomalies;
  }
}

// LRU Cache implementation
class LRUCache<T> {
  private capacity: number;
  private cache = new Map<string, T>();
  
  constructor(capacity: number) {
    this.capacity = capacity;
  }
  
  get(key: string): T | undefined {
    if (this.cache.has(key)) {
      // Move to end (most recently used)
      const value = this.cache.get(key);
      this.cache.delete(key);
      this.cache.set(key, value!);
      return value;
    }
    return undefined;
  }
  
  set(key: string, value: T): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      // Remove least recently used (first item)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }
  
  has(key: string): boolean {
    return this.cache.has(key);
  }
}