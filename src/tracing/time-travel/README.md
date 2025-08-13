# Time-Travel Debugging Engine

A comprehensive debugging solution that allows developers to step through system execution history, analyze state changes, detect anomalies, and set sophisticated breakpoints for complex distributed systems.

## Features

### 🕰️ **Time Navigation**
- **Forward/Backward Stepping**: Move through execution timeline step by step
- **Jump to Timestamp**: Navigate directly to specific points in time
- **Jump to Event**: Navigate directly to specific trace events
- **Bookmarks**: Save and return to important debugging positions
- **Timeline Generation**: Visual representation of execution flow

### 🔍 **State Reconstruction**  
- **Point-in-Time State**: Reconstruct complete system state at any timestamp
- **Incremental Building**: Efficient state building from event history
- **Snapshot Management**: Performance-optimized with automatic snapshots
- **State Diffing**: Compare states between different time points
- **Memory Caching**: LRU cache for frequently accessed states

### 🎯 **Advanced Breakpoints**
- **Conditional Logic**: JavaScript expressions, performance thresholds, error patterns
- **Data Collection**: Automatically collect relevant data when triggered
- **Smart Filtering**: Agent-specific, event-type, and time-window filters
- **Hit Management**: Skip counts, max hits, automatic disabling
- **Action System**: Pause, log, alert, script execution, webhooks

### 🚨 **Anomaly Detection**
- **Performance Anomalies**: Slow operations, high CPU/memory usage
- **Memory Analysis**: Leak detection, usage spikes, instability patterns
- **Error Pattern Detection**: Cascading errors, recurring issues
- **Behavior Analysis**: Unusual agent patterns, infinite loops

### 📊 **Analytics & Insights**
- **Critical Path Analysis**: Identify bottlenecks and optimization opportunities  
- **Memory Timeline**: Track memory usage patterns over time
- **Performance Metrics**: Detailed timing and resource usage analysis
- **Parallelization Opportunities**: Identify tasks that can be parallelized

## Quick Start

```typescript
import { TimeTravelEngine } from '@claude-flow/time-travel';
import { TraceStorage } from '@claude-flow/tracing';

// Initialize storage and engine
const storage = new TraceStorage({
  databasePath: './debug.db',
  maxFileSize: 100 * 1024 * 1024, // 100MB
  maxFiles: 10,
  compressionLevel: 1024,
  indexingEnabled: true,
  vacuumInterval: 3600000
});

const engine = new TimeTravelEngine(storage);

// Create debug session
const debugSessionId = await engine.createDebugSession(
  'production-session-123',
  'Production Issue Investigation'
);

// Navigate through time
await engine.setCurrentPosition(debugSessionId, issueTimestamp);
const timelinePoint = await engine.step(debugSessionId, { type: 'forward', count: 5 });

// Add breakpoints
const breakpointId = engine.addBreakpoint(debugSessionId, 
  (state, event) => event.performance?.duration > 5000,
  { description: 'Slow operation detector', action: 'pause' }
);

// Detect anomalies
const anomalies = await engine.detectAnomalies(debugSessionId);
console.log(`Found ${anomalies.length} anomalies`);
```

## Core Components

### TimeTravelEngine

The main debugging engine that orchestrates all time-travel functionality.

```typescript
interface TimeTravelEngine {
  // Session Management
  createDebugSession(sessionId: string, name: string): Promise<string>
  getDebugSession(debugSessionId: string): DebugSession | null
  
  // Time Navigation
  setCurrentPosition(debugSessionId: string, timestamp: number): Promise<SystemState>
  step(debugSessionId: string, direction: StepDirection): Promise<TimelinePoint>
  
  // Breakpoint Management  
  addBreakpoint(debugSessionId: string, condition: Function, config?: BreakpointConfig): string
  removeBreakpoint(debugSessionId: string, breakpointId: string): boolean
  
  // State Analysis
  getStateAtTimestamp(debugSessionId: string, timestamp: number): Promise<SystemState>
  getStateDiff(debugSessionId: string, from: number, to: number): Promise<StateDiff>
  exportCurrentState(debugSessionId: string): Promise<StateExport>
  
  // Analysis Tools
  detectAnomalies(debugSessionId: string): Promise<AnomalyDetection[]>
  getCriticalPath(debugSessionId: string): Promise<CriticalPath>
  getMemoryAnalysis(debugSessionId: string): Promise<MemoryAnalysis>
  findConditionOrigin(debugSessionId: string, condition: Function): Promise<OriginPoint>
  
  // Bookmarks
  addBookmark(debugSessionId: string, name: string): Promise<string>
  jumpToBookmark(debugSessionId: string, bookmarkId: string): Promise<TimelinePoint>
}
```

### StateReconstructor

Handles efficient state reconstruction from event history with snapshot optimization.

```typescript
interface StateReconstructor {
  reconstructState(sessionId: string, timestamp: number): Promise<SystemState>
  getStateDiff(sessionId: string, fromTime: number, toTime: number): Promise<StateDiff>
  replayEvents(sessionId: string, timeRange: TimeRange, callback: Function): Promise<void>
  findConditionOrigin(sessionId: string, condition: Function, maxTime: number): Promise<OriginPoint>
  getCriticalPath(sessionId: string, endTime: number): Promise<CriticalPath>
}
```

### BreakpointManager

Advanced breakpoint system with conditional logic and smart filtering.

```typescript
interface BreakpointManager {
  addBreakpoint(config: BreakpointConfig): string
  removeBreakpoint(id: string): boolean
  updateBreakpoint(id: string, updates: Partial<BreakpointConfig>): boolean
  toggleBreakpoint(id: string, enabled?: boolean): boolean
  
  evaluateBreakpoints(state: SystemState, event: TraceEvent): Promise<BreakpointHit[]>
  getHitHistory(breakpointId?: string, limit?: number): BreakpointHit[]
  getStatistics(): BreakpointStatistics
  
  importBreakpoints(configs: BreakpointConfig[]): string[]
  exportBreakpoints(ids?: string[]): BreakpointConfig[]
}
```

## Breakpoint Types

### 1. Expression Breakpoints
Use JavaScript expressions for complex conditional logic:

```typescript
const breakpointId = engine.addBreakpoint(debugSessionId,
  (state, event) => {
    // Complex condition using JavaScript
    return event.type === 'task_execution' && 
           event.phase === 'complete' &&
           state.agents[event.agentId]?.performance?.duration > 10000 &&
           Object.keys(state.tasks).filter(id => 
             state.tasks[id].status === 'running'
           ).length === 0;
  },
  {
    description: 'Complex business logic breakpoint',
    action: 'collect',
    collectData: ['event.data.result', 'state.agents[event.agentId].performance']
  }
);
```

### 2. Performance Breakpoints
Trigger on performance thresholds:

```typescript
const manager = new BreakpointManager();
const perfBreakpoint = manager.addBreakpoint({
  condition: {
    type: 'performance',
    performance: {
      metric: 'duration',
      operator: '>',
      threshold: 30000 // 30 seconds
    }
  },
  action: { type: 'alert', alertMessage: 'Critical performance degradation' }
});
```

### 3. Error Pattern Breakpoints
Match error patterns with regex:

```typescript
const errorBreakpoint = manager.addBreakpoint({
  condition: {
    type: 'error',
    errorPattern: '(connection|database|timeout)'
  },
  action: { type: 'script', scriptPath: './recovery-script.js' }
});
```

### 4. Data Change Breakpoints
Monitor specific data paths:

```typescript
const dataBreakpoint = manager.addBreakpoint({
  condition: {
    type: 'data_change',
    dataPath: 'agents.coordinator.status'
  },
  action: { type: 'log', logLevel: 'warn' }
});
```

## Anomaly Detection

The engine automatically detects various types of anomalies:

### Performance Anomalies
- Slow operations (> 10 seconds)
- High memory usage (> 100MB)  
- High CPU usage (> 5 seconds CPU time)

### Memory Anomalies
- Rapid memory growth (> 50% in short time)
- Memory oscillation patterns
- Potential memory leaks

### Error Anomalies
- Error spikes (>= 5 similar errors)
- Recurring error patterns
- Error cascades

### Behavior Anomalies  
- Unusually long operation duration
- Repetitive behavior patterns
- Agent performance degradation

## Memory Analysis

Comprehensive memory usage analysis over time:

```typescript
const memoryAnalysis = await engine.getMemoryAnalysis(debugSessionId);

console.log('Memory Analysis:', {
  timelinePoints: memoryAnalysis.timeline.length,
  peaksDetected: memoryAnalysis.peaks.length,
  leaksDetected: memoryAnalysis.leaks.length
});

// Analyze potential memory leaks
for (const leak of memoryAnalysis.leaks) {
  console.log('Memory Leak:', {
    agent: leak.agentId,
    duration: `${(leak.endTime - leak.startTime) / 1000}s`,
    growthRate: `${(leak.growthRate * 100).toFixed(2)}%/s`
  });
}
```

## Critical Path Analysis

Identify performance bottlenecks and optimization opportunities:

```typescript
const criticalPath = await engine.getCriticalPath(debugSessionId);

console.log('Critical Path:', {
  totalDuration: criticalPath.totalDuration,
  bottlenecks: criticalPath.bottlenecks.length,
  parallelizationOpportunities: criticalPath.parallelizationOpportunities.length
});

// Analyze bottlenecks
for (const bottleneck of criticalPath.bottlenecks) {
  console.log(`Bottleneck: ${bottleneck.duration}ms ${bottleneck.type} (${bottleneck.severity})`);
}
```

## Advanced Usage Examples

### Complex Conditional Debugging

```typescript
// Find when specific workflow pattern occurs
const workflowCondition = (state: SystemState): boolean => {
  const coordinator = Object.values(state.agents)
    .find(agent => agent.variables.type === 'coordinator');
  
  const idleWorkers = Object.values(state.agents)
    .filter(agent => agent.variables.type === 'worker' && agent.status === 'idle');
  
  const totalMemory = Object.values(state.agents)
    .reduce((sum, agent) => sum + agent.performance.memoryUsage, 0);
  
  return coordinator?.status === 'busy' && 
         idleWorkers.length >= 3 && 
         totalMemory > 500 * 1024 * 1024;
};

const origin = await engine.findConditionOrigin(debugSessionId, workflowCondition);
if (origin) {
  console.log('Pattern first occurred:', new Date(origin.timestamp));
  await engine.setCurrentPosition(debugSessionId, origin.timestamp);
}
```

### Deadlock Detection

```typescript
const deadlockBreakpoint = manager.addBreakpoint({
  name: 'Deadlock Detection',
  condition: {
    type: 'custom',
    customFunction: (state: SystemState) => {
      // Detect circular dependencies in waiting agents
      const waitingAgents = Object.values(state.agents)
        .filter(agent => agent.status === 'busy' && agent.variables.waitingFor);
      
      const dependencies = new Map();
      waitingAgents.forEach(agent => 
        dependencies.set(agent.id, agent.variables.waitingFor)
      );
      
      // Simple cycle detection
      for (const [agentId] of dependencies) {
        const visited = new Set([agentId]);
        let current = dependencies.get(agentId);
        
        while (current && dependencies.has(current)) {
          if (visited.has(current)) return true; // Cycle found
          visited.add(current);
          current = dependencies.get(current);
        }
      }
      return false;
    }
  },
  action: { type: 'pause' }
});
```

## Configuration

### Storage Configuration

```typescript
const storageConfig = {
  databasePath: './debug.db',           // SQLite database path
  maxFileSize: 100 * 1024 * 1024,     // Maximum file size (100MB)
  maxFiles: 10,                         // Maximum number of files
  compressionLevel: 1024,               // Compress data > 1KB
  indexingEnabled: true,                // Enable database indexing
  vacuumInterval: 3600000              // Vacuum interval (1 hour)
};
```

### Snapshot Configuration

```typescript
const snapshotConfig = {
  interval: 30000,          // Snapshot interval (30 seconds)
  maxSnapshots: 50,         // Maximum snapshots to keep
  compressionEnabled: true, // Enable snapshot compression
  persistenceEnabled: true  // Persist snapshots to disk
};
```

### Breakpoint Configuration

```typescript
const breakpointConfig = {
  name: 'Custom Breakpoint',
  condition: { /* condition config */ },
  action: { /* action config */ },
  enabled: true,
  skipCount: 0,            // Skip first N hits
  maxHits: undefined,      // Maximum hits before auto-disable
  timeWindow: {            // Only active in time window
    start: Date.now() - 3600000,
    end: Date.now()
  },
  agentFilter: ['agent-1', 'agent-2'], // Agent-specific
  eventTypeFilter: ['error', 'performance'] // Event type filter
};
```

## Performance Considerations

### Memory Management
- LRU cache for frequently accessed states (default: 100 entries)
- Automatic snapshot creation to avoid full reconstruction
- Configurable compression for large data structures
- Memory usage monitoring and leak detection

### Query Optimization
- Database indexing on timestamp, session, and agent columns
- Batch processing for event storage
- Connection pooling for concurrent access
- Automatic database vacuuming

### Scalability
- Efficient state reconstruction with minimal event replay
- Snapshot-based optimization for large sessions
- Configurable retention policies
- Background processing for analysis tasks

## Testing

Run the comprehensive test suite:

```bash
npm test src/tracing/time-travel/__tests__/
```

The tests cover:
- Time navigation functionality
- State reconstruction accuracy
- Breakpoint condition evaluation
- Anomaly detection algorithms
- Memory analysis correctness
- Critical path calculation

## Examples

See detailed usage examples in `/src/tracing/time-travel/usage-examples.ts`:

1. **Basic Time-Travel Session**: Simple navigation and state inspection
2. **Advanced Breakpoints**: Complex conditional breakpoints
3. **Anomaly Detection**: Comprehensive anomaly analysis
4. **Critical Path Analysis**: Performance bottleneck identification
5. **Conditional Debugging**: Complex workflow pattern detection
6. **Breakpoint Manager**: Advanced breakpoint management
7. **Complete Workflow**: End-to-end debugging process

## API Reference

### Types

```typescript
interface DebugSession {
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

interface TimelinePoint {
  timestamp: number;
  event: TraceEvent;
  state: SystemState;
  stateDiff?: StateDiff;
  breakpoints?: string[];
  anomalies?: AnomalyDetection[];
}

interface AnomalyDetection {
  type: 'performance' | 'memory' | 'error' | 'behavior' | 'resource';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  timestamp: number;
  eventId: string;
  agentId?: string;
  details: Record<string, any>;
  suggestions?: string[];
}

interface BreakpointConfig {
  id: string;
  name: string;
  condition: BreakpointCondition;
  action: BreakpointAction;
  enabled: boolean;
  hitCount: number;
  maxHits?: number;
  skipCount?: number;
  timeWindow?: { start: number; end: number };
  agentFilter?: string[];
  eventTypeFilter?: string[];
  metadata: Record<string, any>;
  createdAt: number;
  lastHit?: number;
}
```

## Contributing

1. Follow the existing code style and patterns
2. Add comprehensive tests for new features
3. Update documentation for API changes
4. Ensure performance benchmarks pass
5. Add usage examples for complex features

## License

MIT License - see LICENSE file for details.