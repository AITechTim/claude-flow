/**
 * Comprehensive tests for the Time-Travel Debugging Engine
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { TimeTravelEngine } from '../time-travel-engine.js';
import { StateReconstructor } from '../state-reconstructor.js';
import { BreakpointManager } from '../breakpoint-manager.js';
import { TraceStorage } from '../../storage/trace-storage.js';
import { TraceEvent, SystemState } from '../../types.js';

// Mock storage and dependencies
jest.mock('../../storage/trace-storage.js');
jest.mock('../../core/logger.js');
jest.mock('../../utils/helpers.js', () => ({
  generateId: jest.fn((prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`)
}));

describe('TimeTravelEngine', () => {
  let engine: TimeTravelEngine;
  let mockStorage: jest.Mocked<TraceStorage>;
  let sampleEvents: TraceEvent[];
  let sampleState: SystemState;

  beforeEach(() => {
    mockStorage = new TraceStorage({
      databasePath: ':memory:',
      maxFileSize: 1000000,
      maxFiles: 10,
      compressionLevel: 1024,
      indexingEnabled: true,
      vacuumInterval: 3600000
    }, {
      enabled: true,
      samplingRate: 1.0,
      bufferSize: 1000,
      flushInterval: 1000,
      storageRetention: 86400000,
      compressionEnabled: true,
      realtimeStreaming: false,
      performanceMonitoring: true
    }) as jest.Mocked<TraceStorage>;

    engine = new TimeTravelEngine(mockStorage);

    // Create sample events
    sampleEvents = [
      {
        id: 'event-1',
        timestamp: 1000,
        type: 'agent_method',
        phase: 'start',
        sessionId: 'session-1',
        agentId: 'agent-1',
        data: { method: 'spawn' },
        metadata: { correlationId: 'corr-1' },
        performance: { duration: 100, memoryUsage: 1024, cpuTime: 50 }
      },
      {
        id: 'event-2',
        timestamp: 2000,
        type: 'task_execution',
        phase: 'start',
        sessionId: 'session-1',
        agentId: 'agent-1',
        data: { task: { taskId: 'task-1', type: 'analyze' } },
        metadata: { correlationId: 'corr-2' },
        performance: { duration: 500, memoryUsage: 2048, cpuTime: 250 }
      },
      {
        id: 'event-3',
        timestamp: 3000,
        type: 'error',
        phase: 'error',
        sessionId: 'session-1',
        agentId: 'agent-1',
        data: { error: { type: 'timeout', message: 'Operation timed out' } },
        metadata: { correlationId: 'corr-3' },
        performance: { duration: 10000, memoryUsage: 4096, cpuTime: 100 }
      }
    ];

    // Create sample state
    sampleState = {
      timestamp: 2000,
      agents: {
        'agent-1': {
          id: 'agent-1',
          status: 'busy',
          variables: { lastResult: null },
          context: {},
          performance: { duration: 500, memoryUsage: 2048, cpuTime: 250 },
          createdAt: 1000,
          lastActivity: 2000
        }
      },
      tasks: {
        'task-1': {
          id: 'task-1',
          agentId: 'agent-1',
          type: 'analyze',
          status: 'running',
          progress: 50,
          startedAt: 2000
        }
      },
      memory: {},
      communications: {},
      resources: {}
    };

    // Setup mock methods
    mockStorage.getTracesBySession.mockResolvedValue(sampleEvents);
    mockStorage.getTrace.mockImplementation(async (id: string) => 
      sampleEvents.find(e => e.id === id) || null
    );
  });

  describe('Debug Session Management', () => {
    it('should create a debug session', async () => {
      const sessionId = await engine.createDebugSession('session-1', 'Test Session');
      
      expect(sessionId).toBeDefined();
      
      const session = engine.getDebugSession(sessionId);
      expect(session).toBeTruthy();
      expect(session!.name).toBe('Test Session');
      expect(session!.sessionId).toBe('session-1');
      expect(session!.status).toBe('active');
    });

    it('should return null for non-existent debug session', () => {
      const session = engine.getDebugSession('non-existent');
      expect(session).toBeNull();
    });
  });

  describe('Time Navigation', () => {
    let debugSessionId: string;

    beforeEach(async () => {
      debugSessionId = await engine.createDebugSession('session-1', 'Test Session');
    });

    it('should set current position in time', async () => {
      // Mock state reconstruction
      jest.spyOn(engine['stateReconstructor'], 'reconstructState')
        .mockResolvedValue(sampleState);

      const state = await engine.setCurrentPosition(debugSessionId, 2000);
      
      expect(state).toEqual(sampleState);
      
      const session = engine.getDebugSession(debugSessionId);
      expect(session!.currentTimestamp).toBe(2000);
    });

    it('should step forward in time', async () => {
      const session = engine.getDebugSession(debugSessionId);
      session!.timeline = [
        { timestamp: 1000, event: sampleEvents[0], state: sampleState },
        { timestamp: 2000, event: sampleEvents[1], state: sampleState },
        { timestamp: 3000, event: sampleEvents[2], state: sampleState }
      ];
      session!.currentTimestamp = 1000;

      jest.spyOn(engine, 'setCurrentPosition').mockResolvedValue(sampleState);

      const result = await engine.step(debugSessionId, { type: 'forward', count: 1 });
      
      expect(result.timestamp).toBe(2000);
    });

    it('should step backward in time', async () => {
      const session = engine.getDebugSession(debugSessionId);
      session!.timeline = [
        { timestamp: 1000, event: sampleEvents[0], state: sampleState },
        { timestamp: 2000, event: sampleEvents[1], state: sampleState },
        { timestamp: 3000, event: sampleEvents[2], state: sampleState }
      ];
      session!.currentTimestamp = 3000;

      jest.spyOn(engine, 'setCurrentPosition').mockResolvedValue(sampleState);

      const result = await engine.step(debugSessionId, { type: 'backward', count: 1 });
      
      expect(result.timestamp).toBe(2000);
    });

    it('should jump to specific timestamp', async () => {
      jest.spyOn(engine, 'setCurrentPosition').mockResolvedValue(sampleState);

      const result = await engine.step(debugSessionId, { 
        type: 'to_timestamp', 
        targetTimestamp: 2500 
      });
      
      expect(result.timestamp).toBe(2500);
    });

    it('should jump to specific event', async () => {
      jest.spyOn(engine, 'setCurrentPosition').mockResolvedValue(sampleState);

      const result = await engine.step(debugSessionId, { 
        type: 'to_event', 
        targetEventId: 'event-2' 
      });
      
      expect(result.timestamp).toBe(2000);
    });
  });

  describe('Breakpoint Management', () => {
    let debugSessionId: string;

    beforeEach(async () => {
      debugSessionId = await engine.createDebugSession('session-1', 'Test Session');
    });

    it('should add a breakpoint', () => {
      const condition = (state: SystemState, event: TraceEvent) => 
        event.type === 'error';

      const breakpointId = engine.addBreakpoint(debugSessionId, condition, {
        description: 'Error breakpoint',
        action: 'pause'
      });
      
      expect(breakpointId).toBeDefined();
      
      const session = engine.getDebugSession(debugSessionId);
      expect(session!.breakpoints.has(breakpointId)).toBe(true);
    });

    it('should remove a breakpoint', () => {
      const condition = () => true;
      const breakpointId = engine.addBreakpoint(debugSessionId, condition);
      
      const removed = engine.removeBreakpoint(debugSessionId, breakpointId);
      expect(removed).toBe(true);
      
      const session = engine.getDebugSession(debugSessionId);
      expect(session!.breakpoints.has(breakpointId)).toBe(false);
    });
  });

  describe('State Analysis', () => {
    let debugSessionId: string;

    beforeEach(async () => {
      debugSessionId = await engine.createDebugSession('session-1', 'Test Session');
    });

    it('should get state at timestamp', async () => {
      jest.spyOn(engine['stateReconstructor'], 'reconstructState')
        .mockResolvedValue(sampleState);

      const state = await engine.getStateAtTimestamp(debugSessionId, 2000);
      
      expect(state).toEqual(sampleState);
    });

    it('should get state diff between timestamps', async () => {
      const mockDiff = { agentChanges: { added: [], removed: [], modified: [] } };
      
      jest.spyOn(engine['stateReconstructor'], 'getStateDiff')
        .mockResolvedValue(mockDiff);

      const diff = await engine.getStateDiff(debugSessionId, 1000, 2000);
      
      expect(diff).toEqual(mockDiff);
    });

    it('should export current state', async () => {
      jest.spyOn(engine, 'getStateAtTimestamp').mockResolvedValue(sampleState);

      const session = engine.getDebugSession(debugSessionId);
      session!.currentTimestamp = 2000;

      const exported = await engine.exportCurrentState(debugSessionId);
      
      expect(exported.timestamp).toBe(2000);
      expect(exported.state).toEqual(sampleState);
      expect(exported.events).toEqual(sampleEvents);
    });
  });

  describe('Critical Path Analysis', () => {
    let debugSessionId: string;

    beforeEach(async () => {
      debugSessionId = await engine.createDebugSession('session-1', 'Test Session');
    });

    it('should get critical path', async () => {
      const mockCriticalPath = {
        events: sampleEvents,
        totalDuration: 10600,
        bottlenecks: [],
        parallelizationOpportunities: []
      };

      jest.spyOn(engine['stateReconstructor'], 'getCriticalPath')
        .mockResolvedValue(mockCriticalPath);

      const criticalPath = await engine.getCriticalPath(debugSessionId);
      
      expect(criticalPath).toEqual(mockCriticalPath);
    });
  });

  describe('Anomaly Detection', () => {
    let debugSessionId: string;

    beforeEach(async () => {
      debugSessionId = await engine.createDebugSession('session-1', 'Test Session');
    });

    it('should detect anomalies', async () => {
      const anomalies = await engine.detectAnomalies(debugSessionId);
      
      expect(Array.isArray(anomalies)).toBe(true);
      // Should detect performance and error anomalies from sample events
      expect(anomalies.length).toBeGreaterThan(0);
      
      const performanceAnomalies = anomalies.filter(a => a.type === 'performance');
      expect(performanceAnomalies.length).toBeGreaterThan(0);
      
      const errorAnomalies = anomalies.filter(a => a.type === 'error');
      expect(errorAnomalies.length).toBeGreaterThan(0);
    });

    it('should sort anomalies by severity', async () => {
      const anomalies = await engine.detectAnomalies(debugSessionId);
      
      for (let i = 0; i < anomalies.length - 1; i++) {
        const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
        const current = severityOrder[anomalies[i].severity];
        const next = severityOrder[anomalies[i + 1].severity];
        expect(current).toBeGreaterThanOrEqual(next);
      }
    });
  });

  describe('Bookmarks', () => {
    let debugSessionId: string;

    beforeEach(async () => {
      debugSessionId = await engine.createDebugSession('session-1', 'Test Session');
    });

    it('should add and retrieve bookmarks', async () => {
      const session = engine.getDebugSession(debugSessionId);
      session!.currentTimestamp = 2000;

      jest.spyOn(engine as any, 'getTimelinePoint').mockResolvedValue({
        timestamp: 2000,
        event: sampleEvents[1],
        state: sampleState
      });

      const bookmarkId = await engine.addBookmark(debugSessionId, 'Test Bookmark');
      
      expect(bookmarkId).toBeDefined();
      expect(session!.bookmarks.has(bookmarkId)).toBe(true);
    });

    it('should jump to bookmark', async () => {
      const session = engine.getDebugSession(debugSessionId);
      const timelinePoint = {
        timestamp: 2000,
        event: sampleEvents[1],
        state: sampleState
      };

      // Add bookmark manually for test
      const bookmarkId = 'bookmark-1';
      session!.bookmarks.set(bookmarkId, timelinePoint);

      jest.spyOn(engine, 'setCurrentPosition').mockResolvedValue(sampleState);

      const result = await engine.jumpToBookmark(debugSessionId, bookmarkId);
      
      expect(result).toEqual(timelinePoint);
    });
  });

  describe('Memory Analysis', () => {
    let debugSessionId: string;

    beforeEach(async () => {
      debugSessionId = await engine.createDebugSession('session-1', 'Test Session');
    });

    it('should analyze memory usage over time', async () => {
      const memoryAnalysis = await engine.getMemoryAnalysis(debugSessionId);
      
      expect(memoryAnalysis.timeline).toBeDefined();
      expect(memoryAnalysis.peaks).toBeDefined();
      expect(memoryAnalysis.leaks).toBeDefined();
      
      expect(memoryAnalysis.timeline.length).toBeGreaterThan(0);
      expect(memoryAnalysis.timeline[0]).toHaveProperty('timestamp');
      expect(memoryAnalysis.timeline[0]).toHaveProperty('memoryUsage');
    });

    it('should detect memory peaks', async () => {
      // Add events with memory spike pattern
      const memoryEvents = [
        { ...sampleEvents[0], performance: { ...sampleEvents[0].performance, memoryUsage: 1000 } },
        { ...sampleEvents[1], performance: { ...sampleEvents[1].performance, memoryUsage: 5000 } }, // Peak
        { ...sampleEvents[2], performance: { ...sampleEvents[2].performance, memoryUsage: 2000 } }
      ];
      
      mockStorage.getTracesBySession.mockResolvedValue(memoryEvents);

      const memoryAnalysis = await engine.getMemoryAnalysis(debugSessionId);
      
      expect(memoryAnalysis.peaks.length).toBeGreaterThan(0);
      expect(memoryAnalysis.peaks[0].memoryUsage).toBe(5000);
    });
  });

  describe('Timeline Generation', () => {
    let debugSessionId: string;

    beforeEach(async () => {
      debugSessionId = await engine.createDebugSession('session-1', 'Test Session');
    });

    it('should generate complete timeline', async () => {
      jest.spyOn(engine, 'getStateAtTimestamp').mockResolvedValue(sampleState);

      const timeline = await engine.generateTimeline(debugSessionId);
      
      expect(timeline.length).toBe(sampleEvents.length);
      expect(timeline[0].timestamp).toBe(1000);
      expect(timeline[0].event).toEqual(sampleEvents[0]);
      expect(timeline[0].state).toEqual(sampleState);
    });

    it('should include state diffs in timeline', async () => {
      const mockDiff = { agentChanges: { added: [], removed: [], modified: [] } };
      
      jest.spyOn(engine, 'getStateAtTimestamp').mockResolvedValue(sampleState);
      jest.spyOn(engine['stateReconstructor'], 'computeStateDiff')
        .mockResolvedValue(mockDiff);

      const timeline = await engine.generateTimeline(debugSessionId);
      
      // First event won't have diff, subsequent ones should
      if (timeline.length > 1) {
        expect(timeline[1].stateDiff).toEqual(mockDiff);
      }
    });
  });

  describe('Condition Origin Finding', () => {
    let debugSessionId: string;

    beforeEach(async () => {
      debugSessionId = await engine.createDebugSession('session-1', 'Test Session');
    });

    it('should find when condition was first met', async () => {
      const mockResult = { timestamp: 2000, event: sampleEvents[1] };
      
      jest.spyOn(engine['stateReconstructor'], 'findConditionOrigin')
        .mockResolvedValue(mockResult);

      const condition = (state: SystemState) => state.agents['agent-1']?.status === 'busy';
      const result = await engine.findConditionOrigin(debugSessionId, condition);
      
      expect(result).toEqual(mockResult);
    });
  });
});

describe('BreakpointManager', () => {
  let manager: BreakpointManager;
  let sampleEvent: TraceEvent;
  let sampleState: SystemState;

  beforeEach(() => {
    manager = new BreakpointManager();
    
    sampleEvent = {
      id: 'event-1',
      timestamp: 1000,
      type: 'task_execution',
      phase: 'complete',
      sessionId: 'session-1',
      agentId: 'agent-1',
      data: { task: { result: 'success' } },
      metadata: { correlationId: 'corr-1' },
      performance: { duration: 5000, memoryUsage: 1024, cpuTime: 2500 }
    };

    sampleState = {
      timestamp: 1000,
      agents: {
        'agent-1': {
          id: 'agent-1',
          status: 'idle',
          variables: { result: 'success' },
          context: {},
          performance: { duration: 5000, memoryUsage: 1024, cpuTime: 2500 },
          createdAt: 500,
          lastActivity: 1000
        }
      },
      tasks: {},
      memory: {},
      communications: {},
      resources: {}
    };
  });

  describe('Breakpoint CRUD Operations', () => {
    it('should add a breakpoint', () => {
      const id = manager.addBreakpoint({
        name: 'Test Breakpoint',
        condition: { type: 'expression', expression: 'event.type === "error"' },
        action: { type: 'pause' }
      });

      expect(id).toBeDefined();
      
      const breakpoint = manager.getBreakpoint(id);
      expect(breakpoint).toBeTruthy();
      expect(breakpoint!.name).toBe('Test Breakpoint');
    });

    it('should remove a breakpoint', () => {
      const id = manager.addBreakpoint({
        condition: { type: 'expression', expression: 'true' }
      });

      const removed = manager.removeBreakpoint(id);
      expect(removed).toBe(true);
      expect(manager.getBreakpoint(id)).toBeNull();
    });

    it('should update a breakpoint', () => {
      const id = manager.addBreakpoint({
        name: 'Original Name',
        condition: { type: 'expression', expression: 'true' }
      });

      const updated = manager.updateBreakpoint(id, { name: 'Updated Name' });
      expect(updated).toBe(true);
      
      const breakpoint = manager.getBreakpoint(id);
      expect(breakpoint!.name).toBe('Updated Name');
    });

    it('should toggle breakpoint enabled state', () => {
      const id = manager.addBreakpoint({
        condition: { type: 'expression', expression: 'true' },
        enabled: true
      });

      manager.toggleBreakpoint(id, false);
      expect(manager.getBreakpoint(id)!.enabled).toBe(false);

      manager.toggleBreakpoint(id, true);
      expect(manager.getBreakpoint(id)!.enabled).toBe(true);
    });
  });

  describe('Breakpoint Evaluation', () => {
    it('should evaluate expression breakpoint', async () => {
      const id = manager.addBreakpoint({
        condition: { type: 'expression', expression: 'event.type === "task_execution"' },
        action: { type: 'log' }
      });

      const hits = await manager.evaluateBreakpoints(sampleState, sampleEvent);
      
      expect(hits.length).toBe(1);
      expect(hits[0].breakpointId).toBe(id);
      expect(hits[0].triggerReason).toContain('Expression');
    });

    it('should evaluate performance breakpoint', async () => {
      const id = manager.addBreakpoint({
        condition: { 
          type: 'performance',
          performance: { metric: 'duration', operator: '>', threshold: 1000 }
        },
        action: { type: 'log' }
      });

      const hits = await manager.evaluateBreakpoints(sampleState, sampleEvent);
      
      expect(hits.length).toBe(1);
      expect(hits[0].triggerReason).toContain('Performance condition met');
    });

    it('should evaluate error breakpoint', async () => {
      const errorEvent = {
        ...sampleEvent,
        type: 'error',
        phase: 'error',
        data: { error: { message: 'Network timeout error' } }
      };

      const id = manager.addBreakpoint({
        condition: { type: 'error', errorPattern: 'timeout' },
        action: { type: 'log' }
      });

      const hits = await manager.evaluateBreakpoints(sampleState, errorEvent);
      
      expect(hits.length).toBe(1);
      expect(hits[0].triggerReason).toContain('Error pattern matched');
    });

    it('should respect agent filter', async () => {
      const id = manager.addBreakpoint({
        condition: { type: 'expression', expression: 'true' },
        agentFilter: ['agent-2'], // Different agent
        action: { type: 'log' }
      });

      const hits = await manager.evaluateBreakpoints(sampleState, sampleEvent);
      
      expect(hits.length).toBe(0); // Should not trigger due to filter
    });

    it('should respect event type filter', async () => {
      const id = manager.addBreakpoint({
        condition: { type: 'expression', expression: 'true' },
        eventTypeFilter: ['error'], // Different event type
        action: { type: 'log' }
      });

      const hits = await manager.evaluateBreakpoints(sampleState, sampleEvent);
      
      expect(hits.length).toBe(0); // Should not trigger due to filter
    });

    it('should respect time window', async () => {
      const id = manager.addBreakpoint({
        condition: { type: 'expression', expression: 'true' },
        timeWindow: { start: 2000, end: 3000 }, // Event is at timestamp 1000
        action: { type: 'log' }
      });

      const hits = await manager.evaluateBreakpoints(sampleState, sampleEvent);
      
      expect(hits.length).toBe(0); // Should not trigger due to time window
    });

    it('should handle skip count', async () => {
      const id = manager.addBreakpoint({
        condition: { type: 'expression', expression: 'true' },
        skipCount: 2,
        action: { type: 'log' }
      });

      // First two evaluations should skip
      let hits = await manager.evaluateBreakpoints(sampleState, sampleEvent);
      expect(hits.length).toBe(0);

      hits = await manager.evaluateBreakpoints(sampleState, sampleEvent);
      expect(hits.length).toBe(0);

      // Third should trigger
      hits = await manager.evaluateBreakpoints(sampleState, sampleEvent);
      expect(hits.length).toBe(1);
    });

    it('should handle max hits', async () => {
      const id = manager.addBreakpoint({
        condition: { type: 'expression', expression: 'true' },
        maxHits: 2,
        action: { type: 'log' }
      });

      // First two should trigger
      let hits = await manager.evaluateBreakpoints(sampleState, sampleEvent);
      expect(hits.length).toBe(1);

      hits = await manager.evaluateBreakpoints(sampleState, sampleEvent);
      expect(hits.length).toBe(1);

      // Third should not trigger (breakpoint disabled)
      hits = await manager.evaluateBreakpoints(sampleState, sampleEvent);
      expect(hits.length).toBe(0);
      expect(manager.getBreakpoint(id)!.enabled).toBe(false);
    });
  });

  describe('Data Collection', () => {
    it('should collect specified data paths', async () => {
      const id = manager.addBreakpoint({
        condition: { type: 'expression', expression: 'true' },
        action: { 
          type: 'collect',
          collectData: ['event.agentId', 'state.agents.agent-1.status']
        }
      });

      const hits = await manager.evaluateBreakpoints(sampleState, sampleEvent);
      
      expect(hits.length).toBe(1);
      expect(hits[0].collectedData).toBeDefined();
      expect(hits[0].collectedData!['event.agentId']).toBe('agent-1');
      expect(hits[0].collectedData!['state.agents.agent-1.status']).toBe('idle');
    });
  });

  describe('Statistics and History', () => {
    it('should track hit history', async () => {
      const id = manager.addBreakpoint({
        condition: { type: 'expression', expression: 'true' },
        action: { type: 'log' }
      });

      await manager.evaluateBreakpoints(sampleState, sampleEvent);
      
      const history = manager.getHitHistory();
      expect(history.length).toBe(1);
      expect(history[0].breakpointId).toBe(id);
    });

    it('should provide statistics', async () => {
      const id = manager.addBreakpoint({
        condition: { type: 'expression', expression: 'true' },
        action: { type: 'log' }
      });

      await manager.evaluateBreakpoints(sampleState, sampleEvent);
      
      const stats = manager.getStatistics();
      expect(stats.totalBreakpoints).toBe(1);
      expect(stats.enabledBreakpoints).toBe(1);
      expect(stats.totalHits).toBe(1);
      expect(stats.hitsByBreakpoint[id]).toBe(1);
    });

    it('should clear hit history', async () => {
      const id = manager.addBreakpoint({
        condition: { type: 'expression', expression: 'true' },
        action: { type: 'log' }
      });

      await manager.evaluateBreakpoints(sampleState, sampleEvent);
      expect(manager.getHitHistory().length).toBe(1);

      manager.clearHitHistory();
      expect(manager.getHitHistory().length).toBe(0);
    });
  });

  describe('Import/Export', () => {
    it('should export breakpoints', () => {
      const id1 = manager.addBreakpoint({
        name: 'Breakpoint 1',
        condition: { type: 'expression', expression: 'true' }
      });
      
      const id2 = manager.addBreakpoint({
        name: 'Breakpoint 2',
        condition: { type: 'expression', expression: 'false' }
      });

      const exported = manager.exportBreakpoints();
      expect(exported.length).toBe(2);
      expect(exported.map(bp => bp.name)).toContain('Breakpoint 1');
      expect(exported.map(bp => bp.name)).toContain('Breakpoint 2');
    });

    it('should import breakpoints', () => {
      const configs = [
        {
          name: 'Imported 1',
          condition: { type: 'expression', expression: 'true' }
        },
        {
          name: 'Imported 2',
          condition: { type: 'expression', expression: 'false' }
        }
      ];

      const importedIds = manager.importBreakpoints(configs);
      
      expect(importedIds.length).toBe(2);
      expect(manager.getAllBreakpoints().length).toBe(2);
    });
  });
});