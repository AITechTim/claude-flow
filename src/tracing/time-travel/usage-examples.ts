/**
 * Usage Examples for Time-Travel Debugging Engine
 * Demonstrates common debugging scenarios and use cases
 */

import { TimeTravelEngine, BreakpointConfig, AnomalyDetection } from './time-travel-engine.js';
import { BreakpointManager } from './breakpoint-manager.js';
import { TraceStorage } from '../storage/trace-storage.js';
import { SystemState, TraceEvent } from '../types.js';

/**
 * Example 1: Basic Time-Travel Debugging Session
 */
export async function basicTimeTravelExample() {
  // Initialize storage and engine
  const storage = new TraceStorage({
    databasePath: './debug.db',
    maxFileSize: 100 * 1024 * 1024, // 100MB
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
  });

  const engine = new TimeTravelEngine(storage);
  
  // Create debug session
  const debugSessionId = await engine.createDebugSession(
    'production-session-123',
    'Production Issue Investigation'
  );
  
  console.log(`Created debug session: ${debugSessionId}`);
  
  // Set initial position to start of issue
  const issueStartTime = Date.now() - 3600000; // 1 hour ago
  await engine.setCurrentPosition(debugSessionId, issueStartTime);
  
  // Step forward through events to understand the sequence
  const firstEvent = await engine.step(debugSessionId, { type: 'forward', count: 1 });
  console.log('First event:', firstEvent.event.type, 'at', new Date(firstEvent.timestamp));
  
  // Jump to a specific problematic event
  await engine.step(debugSessionId, { 
    type: 'to_event', 
    targetEventId: 'error-event-456' 
  });
  
  // Export the state at this point for analysis
  const problemState = await engine.exportCurrentState(debugSessionId);
  console.log('Problem state exported:', problemState.metadata);
  
  return debugSessionId;
}

/**
 * Example 2: Advanced Breakpoint Usage
 */
export async function advancedBreakpointExample() {
  const engine = new TimeTravelEngine(new TraceStorage({
    databasePath: ':memory:',
    maxFileSize: 10 * 1024 * 1024,
    maxFiles: 5,
    compressionLevel: 512,
    indexingEnabled: true,
    vacuumInterval: 3600000
  }, {
    enabled: true,
    samplingRate: 1.0,
    bufferSize: 500,
    flushInterval: 1000,
    storageRetention: 43200000,
    compressionEnabled: true,
    realtimeStreaming: false,
    performanceMonitoring: true
  }));

  const debugSessionId = await engine.createDebugSession('session-1', 'Breakpoint Demo');
  
  // 1. Performance-based breakpoint
  const perfBreakpoint = engine.addBreakpoint(debugSessionId, 
    (state, event) => {
      return event.performance?.duration > 5000; // > 5 seconds
    },
    {
      description: 'Slow operation detector',
      action: 'log',
      maxHits: 10
    }
  );
  
  // 2. Memory leak detection breakpoint
  const memoryBreakpoint = engine.addBreakpoint(debugSessionId,
    (state, event) => {
      const agent = state.agents[event.agentId || ''];
      return agent?.performance.memoryUsage > 100 * 1024 * 1024; // > 100MB
    },
    {
      description: 'High memory usage detector',
      action: 'alert'
    }
  );
  
  // 3. Error cascade breakpoint
  const errorCascadeBreakpoint = engine.addBreakpoint(debugSessionId,
    (state, event) => {
      // Count errors in the last 5 events
      const recentErrors = Object.values(state.agents)
        .filter(agent => agent.variables.lastError)
        .length;
      return recentErrors >= 3;
    },
    {
      description: 'Error cascade detector',
      action: 'pause'
    }
  );
  
  // 4. Agent state transition breakpoint
  const stateTransitionBreakpoint = engine.addBreakpoint(debugSessionId,
    (state, event) => {
      // Break when any agent transitions from 'busy' to 'error'
      if (event.type === 'agent_method' && event.phase === 'error') {
        const agent = state.agents[event.agentId || ''];
        return agent?.status === 'error';
      }
      return false;
    },
    {
      description: 'Agent error transition detector',
      action: 'collect'
    }
  );
  
  console.log('Created breakpoints:', {
    performance: perfBreakpoint,
    memory: memoryBreakpoint,
    errorCascade: errorCascadeBreakpoint,
    stateTransition: stateTransitionBreakpoint
  });
  
  return debugSessionId;
}

/**
 * Example 3: Anomaly Detection and Analysis
 */
export async function anomalyDetectionExample() {
  const engine = new TimeTravelEngine(new TraceStorage({
    databasePath: './anomaly-analysis.db',
    maxFileSize: 50 * 1024 * 1024,
    maxFiles: 5,
    compressionLevel: 1024,
    indexingEnabled: true,
    vacuumInterval: 3600000
  }, {
    enabled: true,
    samplingRate: 1.0,
    bufferSize: 1000,
    flushInterval: 500,
    storageRetention: 86400000,
    compressionEnabled: true,
    realtimeStreaming: false,
    performanceMonitoring: true
  }));

  const debugSessionId = await engine.createDebugSession(
    'anomaly-session',
    'Anomaly Detection Analysis'
  );
  
  // Detect all anomalies in the session
  const anomalies = await engine.detectAnomalies(debugSessionId);
  
  console.log(`Found ${anomalies.length} anomalies`);
  
  // Group anomalies by type and severity
  const groupedAnomalies = anomalies.reduce((groups, anomaly) => {
    const key = `${anomaly.type}-${anomaly.severity}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(anomaly);
    return groups;
  }, {} as Record<string, AnomalyDetection[]>);
  
  // Analyze critical performance anomalies
  const criticalPerformance = groupedAnomalies['performance-critical'] || [];
  for (const anomaly of criticalPerformance) {
    console.log(`Critical Performance Anomaly:`, {
      time: new Date(anomaly.timestamp).toISOString(),
      description: anomaly.description,
      agent: anomaly.agentId,
      suggestions: anomaly.suggestions
    });
    
    // Jump to the anomaly timestamp for investigation
    await engine.setCurrentPosition(debugSessionId, anomaly.timestamp);
    const state = await engine.exportCurrentState(debugSessionId);
    
    console.log('State at anomaly:', {
      agentStates: Object.keys(state.state.agents).length,
      runningTasks: Object.keys(state.state.tasks).length,
      memoryEntries: Object.keys(state.state.memory).length
    });
  }
  
  // Memory analysis
  const memoryAnalysis = await engine.getMemoryAnalysis(debugSessionId);
  console.log('Memory Analysis:', {
    timelinePoints: memoryAnalysis.timeline.length,
    peaksDetected: memoryAnalysis.peaks.length,
    leaksDetected: memoryAnalysis.leaks.length
  });
  
  // Report potential memory leaks
  for (const leak of memoryAnalysis.leaks) {
    console.log('Potential Memory Leak:', {
      agent: leak.agentId,
      duration: `${(leak.endTime - leak.startTime) / 1000}s`,
      growthRate: `${(leak.growthRate * 100).toFixed(2)}%/s`
    });
  }
  
  return { debugSessionId, anomalies, memoryAnalysis };
}

/**
 * Example 4: Critical Path Analysis
 */
export async function criticalPathAnalysisExample() {
  const engine = new TimeTravelEngine(new TraceStorage({
    databasePath: './critical-path.db',
    maxFileSize: 25 * 1024 * 1024,
    maxFiles: 3,
    compressionLevel: 512,
    indexingEnabled: true,
    vacuumInterval: 1800000
  }, {
    enabled: true,
    samplingRate: 1.0,
    bufferSize: 500,
    flushInterval: 1000,
    storageRetention: 43200000,
    compressionEnabled: true,
    realtimeStreaming: false,
    performanceMonitoring: true
  }));

  const debugSessionId = await engine.createDebugSession(
    'perf-analysis',
    'Performance Critical Path Analysis'
  );
  
  // Get the critical path for the entire session
  const criticalPath = await engine.getCriticalPath(debugSessionId);
  
  console.log('Critical Path Analysis:', {
    totalEvents: criticalPath.events.length,
    totalDuration: `${criticalPath.totalDuration}ms`,
    bottlenecks: criticalPath.bottlenecks.length,
    optimizationOpportunities: criticalPath.parallelizationOpportunities.length
  });
  
  // Analyze bottlenecks
  console.log('\nBottlenecks Found:');
  for (const bottleneck of criticalPath.bottlenecks) {
    console.log(`- ${bottleneck.type} bottleneck: ${bottleneck.duration}ms (${bottleneck.severity})`);
    
    // Jump to bottleneck for detailed analysis
    const event = criticalPath.events.find(e => e.id === bottleneck.eventId);
    if (event) {
      await engine.setCurrentPosition(debugSessionId, event.timestamp);
      const state = await engine.getStateAtTimestamp(debugSessionId, event.timestamp);
      
      console.log(`  Event: ${event.type} by ${event.agentId}`);
      console.log(`  Agent state: ${state.agents[event.agentId || '']?.status}`);
    }
  }
  
  // Analyze parallelization opportunities
  console.log('\nParallelization Opportunities:');
  for (const opportunity of criticalPath.parallelizationOpportunities) {
    console.log(`- Potential ${opportunity.potentialSpeedup.toFixed(2)}x speedup`);
    console.log(`  Events: ${opportunity.events.join(', ')}`);
    console.log(`  Constraints: ${opportunity.constraints.join(', ')}`);
  }
  
  return { debugSessionId, criticalPath };
}

/**
 * Example 5: Conditional Debugging with Complex Logic
 */
export async function conditionalDebuggingExample() {
  const engine = new TimeTravelEngine(new TraceStorage({
    databasePath: './conditional-debug.db',
    maxFileSize: 20 * 1024 * 1024,
    maxFiles: 3,
    compressionLevel: 256,
    indexingEnabled: true,
    vacuumInterval: 1800000
  }, {
    enabled: true,
    samplingRate: 1.0,
    bufferSize: 300,
    flushInterval: 1000,
    storageRetention: 21600000,
    compressionEnabled: true,
    realtimeStreaming: false,
    performanceMonitoring: true
  }));

  const debugSessionId = await engine.createDebugSession(
    'conditional-debug',
    'Conditional Logic Debugging'
  );
  
  // Complex condition: Find when a specific workflow pattern occurs
  const workflowPatternCondition = (state: SystemState): boolean => {
    // Look for pattern: coordinator agent busy + multiple workers idle + high memory usage
    const coordinatorAgent = Object.values(state.agents)
      .find(agent => agent.variables.type === 'coordinator');
    
    if (!coordinatorAgent || coordinatorAgent.status !== 'busy') return false;
    
    const idleWorkers = Object.values(state.agents)
      .filter(agent => agent.variables.type === 'worker' && agent.status === 'idle');
    
    const totalMemory = Object.values(state.agents)
      .reduce((sum, agent) => sum + agent.performance.memoryUsage, 0);
    
    return idleWorkers.length >= 3 && totalMemory > 500 * 1024 * 1024; // 500MB
  };
  
  // Find when this condition first occurred
  const conditionOrigin = await engine.findConditionOrigin(
    debugSessionId, 
    workflowPatternCondition
  );
  
  if (conditionOrigin) {
    console.log('Workflow pattern first occurred at:', {
      timestamp: new Date(conditionOrigin.timestamp).toISOString(),
      event: conditionOrigin.event.type,
      agent: conditionOrigin.event.agentId
    });
    
    // Jump to that point
    await engine.setCurrentPosition(debugSessionId, conditionOrigin.timestamp);
    
    // Add a bookmark for easy return
    const bookmarkId = await engine.addBookmark(debugSessionId, 'Workflow Pattern Origin');
    console.log(`Added bookmark: ${bookmarkId}`);
    
    // Analyze the state at this point
    const state = await engine.getStateAtTimestamp(debugSessionId, conditionOrigin.timestamp);
    console.log('State analysis:', {
      totalAgents: Object.keys(state.agents).length,
      busyAgents: Object.values(state.agents).filter(a => a.status === 'busy').length,
      runningTasks: Object.keys(state.tasks).filter(id => state.tasks[id].status === 'running').length,
      memoryUsage: Object.values(state.agents).reduce((sum, a) => sum + a.performance.memoryUsage, 0)
    });
    
    // Step through the next few events to see the evolution
    console.log('\nEvolution of the pattern:');
    for (let i = 0; i < 5; i++) {
      const timelinePoint = await engine.step(debugSessionId, { type: 'forward', count: 1 });
      console.log(`Step ${i + 1}:`, {
        time: new Date(timelinePoint.timestamp).toISOString(),
        event: timelinePoint.event.type,
        agentStatus: timelinePoint.state.agents[timelinePoint.event.agentId || '']?.status
      });
    }
  } else {
    console.log('Workflow pattern never occurred in this session');
  }
  
  return { debugSessionId, conditionOrigin };
}

/**
 * Example 6: Advanced Breakpoint Manager Usage
 */
export async function advancedBreakpointManagerExample() {
  const manager = new BreakpointManager();
  
  // 1. Expression-based breakpoint with complex logic
  const complexExpressionBp = manager.addBreakpoint({
    name: 'Complex Business Logic Breakpoint',
    condition: {
      type: 'expression',
      expression: `
        event.type === 'task_execution' && 
        event.phase === 'complete' &&
        event.data.task?.type === 'analysis' &&
        state.agents[event.agentId]?.performance?.duration > 10000 &&
        Object.keys(state.tasks).filter(id => 
          state.tasks[id].status === 'running' && 
          state.tasks[id].agentId === event.agentId
        ).length === 0
      `
    },
    action: {
      type: 'collect',
      collectData: [
        'event.data.task.result',
        'state.agents[event.agentId].performance',
        'state.memory'
      ]
    },
    agentFilter: ['analyzer-1', 'analyzer-2'],
    timeWindow: {
      start: Date.now() - 3600000, // Last hour
      end: Date.now()
    }
  });
  
  // 2. Performance threshold breakpoint with webhook notification
  const performanceBp = manager.addBreakpoint({
    name: 'Performance Threshold Alert',
    condition: {
      type: 'performance',
      performance: {
        metric: 'duration',
        operator: '>',
        threshold: 30000 // 30 seconds
      }
    },
    action: {
      type: 'alert',
      alertMessage: 'Critical performance degradation detected',
      webhookUrl: 'https://alerts.example.com/webhook'
    },
    maxHits: 5 // Don't spam alerts
  });
  
  // 3. Error pattern breakpoint with script execution
  const errorPatternBp = manager.addBreakpoint({
    name: 'Database Connection Error Handler',
    condition: {
      type: 'error',
      errorPattern: '(connection|database|timeout)'
    },
    action: {
      type: 'script',
      scriptPath: './scripts/db-error-recovery.js'
    },
    skipCount: 1 // Skip the first occurrence (might be transient)
  });
  
  // 4. Custom function breakpoint for complex state analysis
  const customFunctionBp = manager.addBreakpoint({
    name: 'Deadlock Detection',
    condition: {
      type: 'custom',
      customFunction: (state: SystemState, event: TraceEvent) => {
        // Detect potential deadlock: multiple agents waiting for each other
        const waitingAgents = Object.values(state.agents)
          .filter(agent => agent.status === 'busy' && agent.variables.waitingFor);
        
        if (waitingAgents.length < 2) return false;
        
        // Check for circular dependency
        const dependencies = new Map<string, string>();
        for (const agent of waitingAgents) {
          dependencies.set(agent.id, agent.variables.waitingFor);
        }
        
        // Simple cycle detection
        for (const [agentId, waitingFor] of dependencies) {
          let current = waitingFor;
          const visited = new Set([agentId]);
          
          while (current && dependencies.has(current)) {
            if (visited.has(current)) {
              return true; // Cycle detected
            }
            visited.add(current);
            current = dependencies.get(current);
          }
        }
        
        return false;
      }
    },
    action: {
      type: 'pause' // Critical issue - pause for investigation
    }
  });
  
  console.log('Created advanced breakpoints:', {
    complexExpression: complexExpressionBp,
    performance: performanceBp,
    errorPattern: errorPatternBp,
    customFunction: customFunctionBp
  });
  
  // Simulate breakpoint evaluation with sample data
  const sampleState: SystemState = {
    timestamp: Date.now(),
    agents: {
      'analyzer-1': {
        id: 'analyzer-1',
        status: 'busy',
        variables: { waitingFor: 'analyzer-2' },
        context: {},
        performance: { duration: 35000, memoryUsage: 1024 * 1024, cpuTime: 15000 },
        createdAt: Date.now() - 60000,
        lastActivity: Date.now() - 1000
      },
      'analyzer-2': {
        id: 'analyzer-2',
        status: 'busy',
        variables: { waitingFor: 'analyzer-1' },
        context: {},
        performance: { duration: 32000, memoryUsage: 2048 * 1024, cpuTime: 18000 },
        createdAt: Date.now() - 60000,
        lastActivity: Date.now() - 500
      }
    },
    tasks: {},
    memory: {},
    communications: {},
    resources: {}
  };
  
  const sampleEvent: TraceEvent = {
    id: 'event-deadlock',
    timestamp: Date.now(),
    type: 'task_execution',
    phase: 'complete',
    sessionId: 'session-1',
    agentId: 'analyzer-1',
    data: {
      task: { type: 'analysis', result: 'completed' }
    },
    metadata: { correlationId: 'test-correlation' },
    performance: { duration: 35000, memoryUsage: 1024 * 1024, cpuTime: 15000 }
  };
  
  // Evaluate all breakpoints
  const hits = await manager.evaluateBreakpoints(sampleState, sampleEvent);
  
  console.log(`\nBreakpoint evaluation results: ${hits.length} hits`);
  for (const hit of hits) {
    const bp = manager.getBreakpoint(hit.breakpointId);
    console.log(`- ${bp?.name}: ${hit.triggerReason}`);
    if (hit.collectedData) {
      console.log(`  Collected data keys: ${Object.keys(hit.collectedData).join(', ')}`);
    }
  }
  
  // Show statistics
  const stats = manager.getStatistics();
  console.log('\nBreakpoint Manager Statistics:', stats);
  
  // Export configuration for reuse
  const exportedBreakpoints = manager.exportBreakpoints();
  console.log(`\nExported ${exportedBreakpoints.length} breakpoint configurations`);
  
  return { manager, hits, stats };
}

/**
 * Example 7: Complete Debugging Workflow
 */
export async function completeDebuggingWorkflow() {
  console.log('=== Starting Complete Time-Travel Debugging Workflow ===\n');
  
  // 1. Basic setup
  const basicSession = await basicTimeTravelExample();
  console.log('✓ Basic time-travel session created\n');
  
  // 2. Advanced breakpoints
  await advancedBreakpointExample();
  console.log('✓ Advanced breakpoints configured\n');
  
  // 3. Anomaly detection
  const { anomalies } = await anomalyDetectionExample();
  console.log(`✓ Anomaly detection completed: ${anomalies.length} anomalies found\n`);
  
  // 4. Critical path analysis
  const { criticalPath } = await criticalPathAnalysisExample();
  console.log(`✓ Critical path analyzed: ${criticalPath.bottlenecks.length} bottlenecks identified\n`);
  
  // 5. Conditional debugging
  const { conditionOrigin } = await conditionalDebuggingExample();
  console.log(`✓ Conditional debugging: ${conditionOrigin ? 'Pattern found' : 'Pattern not found'}\n`);
  
  // 6. Advanced breakpoint management
  const { hits } = await advancedBreakpointManagerExample();
  console.log(`✓ Advanced breakpoint evaluation: ${hits.length} breakpoints triggered\n`);
  
  console.log('=== Time-Travel Debugging Workflow Complete ===');
  
  return {
    basicSession,
    anomalyCount: anomalies.length,
    bottleneckCount: criticalPath.bottlenecks.length,
    conditionFound: !!conditionOrigin,
    breakpointHits: hits.length
  };
}

// Helper function to run all examples
if (require.main === module) {
  completeDebuggingWorkflow()
    .then(results => {
      console.log('\n=== Final Results ===');
      console.log(JSON.stringify(results, null, 2));
    })
    .catch(error => {
      console.error('Error running debugging workflow:', error);
      process.exit(1);
    });
}