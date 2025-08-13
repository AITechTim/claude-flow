/**
 * Complete usage example for TraceStorage SQLite backend
 * Demonstrates all major features and best practices
 */

import { TraceStorage, StorageConfig } from '../trace-storage.js';
import { TraceEvent, TracingConfig } from '../../types.js';
import { generateId } from '../../../utils/helpers.js';

// Configuration for high-performance tracing
const storageConfig: StorageConfig = {
  databasePath: './traces-production.db',
  maxFileSize: 100 * 1024 * 1024, // 100MB before archiving
  maxFiles: 7, // 7 days retention
  compressionLevel: 1000, // Compress payloads > 1KB
  indexingEnabled: true,
  vacuumInterval: 60 * 60 * 1000 // 1 hour vacuum interval
};

const tracingConfig: TracingConfig = {
  enabled: true,
  samplingRate: 1.0, // Capture 100% of traces
  bufferSize: 1000, // Batch size for writes
  flushInterval: 1000, // 1 second flush interval
  storageRetention: 7 * 24 * 60 * 60 * 1000, // 7 days
  compressionEnabled: true,
  realtimeStreaming: false,
  performanceMonitoring: true,
  level: 'info'
};

export async function demonstrateTraceStorage() {
  console.log('🚀 Initializing TraceStorage...');
  const storage = new TraceStorage(storageConfig, tracingConfig);
  
  try {
    // 1. Create a tracing session
    console.log('📝 Creating tracing session...');
    const sessionId = await storage.createSession('Agent Swarm Execution', {
      purpose: 'Multi-agent task processing',
      environment: 'production',
      version: '2.0.0'
    });
    
    // 2. Simulate agent lifecycle traces
    console.log('🤖 Simulating agent lifecycle...');
    await simulateAgentLifecycle(storage, sessionId);
    
    // 3. Demonstrate batch processing for performance
    console.log('⚡ Testing batch processing...');
    await demonstrateBatchProcessing(storage, sessionId);
    
    // 4. Query traces with various filters  
    console.log('🔍 Querying traces...');
    await demonstrateQuerying(storage, sessionId);
    
    // 5. Build and analyze trace graph
    console.log('📊 Building trace graph...');
    await demonstrateGraphAnalysis(storage, sessionId);
    
    // 6. Error tracking and resolution
    console.log('🚨 Error tracking example...');
    await demonstrateErrorTracking(storage, sessionId);
    
    // 7. Performance monitoring
    console.log('📈 Performance monitoring...');
    await demonstratePerformanceMonitoring(storage, sessionId);
    
    // 8. Storage management
    console.log('💾 Storage management...');
    await demonstrateStorageManagement(storage);
    
    // 9. Complete session
    await storage.updateSession(sessionId, {
      status: 'completed',
      endTime: Date.now()
    });
    
    console.log('✅ TraceStorage demonstration completed successfully!');
    
  } catch (error) {
    console.error('❌ Error during demonstration:', error);
  } finally {
    await storage.close();
  }
}

async function simulateAgentLifecycle(storage: TraceStorage, sessionId: string) {
  const agentId = generateId('agent');
  const taskId = generateId('task');
  
  const traces: TraceEvent[] = [
    // Agent spawn
    {
      id: generateId('trace'),
      timestamp: Date.now(),
      sessionId,
      type: 'agent_spawn',
      agentId,
      data: {
        agentType: 'coordinator',
        capabilities: ['task_management', 'resource_allocation'],
        initialConfig: { maxTasks: 10, timeout: 30000 }
      },
      metadata: {
        source: 'swarm-manager',
        severity: 'low',
        tags: ['lifecycle', 'spawn'],
        correlationId: generateId('corr')
      },
      performance: { duration: 150 }
    },
    
    // Task assignment
    {
      id: generateId('trace'),
      timestamp: Date.now() + 100,
      sessionId,
      type: 'task_start',
      agentId,
      data: {
        taskId,
        taskType: 'data_processing',
        payload: { items: 100, complexity: 'medium' },
        priority: 'high'
      },
      metadata: {
        source: 'task-scheduler',
        severity: 'medium',
        tags: ['task', 'processing'],
        correlationId: generateId('corr')
      },
      performance: { duration: 50 }
    },
    
    // Task completion
    {
      id: generateId('trace'),
      timestamp: Date.now() + 5000,
      sessionId,
      type: 'task_complete',
      agentId,
      data: {
        taskId,
        result: { processed: 100, success: 98, failed: 2 },
        executionTime: 4850
      },
      metadata: {
        source: 'task-executor',
        severity: 'low',
        tags: ['task', 'completion'],
        correlationId: generateId('corr')
      },
      performance: { duration: 25 }
    }
  ];
  
  // Store batch for better performance
  await storage.storeBatch(traces);
  
  // Store additional monitoring data
  await storage.storeTaskExecution(
    taskId,
    agentId,
    sessionId,
    'data_processing',
    'completed',
    'high',
    { items: 100, complexity: 'medium' },
    Date.now() + 100
  );
  
  await storage.updateTaskExecution(
    taskId,
    'completed',
    { processed: 100, success: 98, failed: 2 },
    undefined
  );
  
  console.log(`   ✓ Stored ${traces.length} lifecycle traces for agent ${agentId}`);
}

async function demonstrateBatchProcessing(storage: TraceStorage, sessionId: string) {
  const batchSize = 100;
  const agentIds = Array.from({ length: 5 }, () => generateId('agent'));
  
  const startTime = Date.now();
  
  // Generate large batch of traces
  const traces: TraceEvent[] = Array.from({ length: batchSize }, (_, i) => ({
    id: generateId('trace'),
    timestamp: startTime + i * 10,
    sessionId,
    type: 'communication',
    agentId: agentIds[i % agentIds.length],
    data: {
      messageType: 'status_update',
      content: `Status update ${i}`,
      metrics: { cpu: Math.random() * 100, memory: Math.random() * 1000000 }
    },
    metadata: {
      source: 'agent-communication',
      severity: 'low',
      tags: ['batch', 'communication'],
      correlationId: generateId('corr')
    },
    performance: { duration: Math.floor(Math.random() * 50) + 10 }
  }));
  
  const batchStart = Date.now();
  await storage.storeBatch(traces);
  const batchEnd = Date.now();
  
  console.log(`   ✓ Stored ${batchSize} traces in ${batchEnd - batchStart}ms`);
  console.log(`   ✓ Throughput: ${Math.round(batchSize / ((batchEnd - batchStart) / 1000))} traces/second`);
}

async function demonstrateQuerying(storage: TraceStorage, sessionId: string) {
  const queryStart = Date.now();
  
  // Query by session
  const sessionTraces = await storage.getTracesBySession(sessionId, {
    limit: 10,
    eventTypes: ['agent_spawn', 'task_start', 'task_complete']
  });
  
  // Query by time range
  const timeRange = {
    start: Date.now() - 10000,
    end: Date.now()
  };
  
  const recentTraces = await storage.getTracesByTimeRange(timeRange, {
    sessionIds: [sessionId],
    limit: 20
  });
  
  // Query agent messages
  if (recentTraces.length > 0 && recentTraces[0].agentId) {
    const messages = await storage.getAgentMessages(
      recentTraces[0].agentId,
      timeRange,
      10
    );
    console.log(`   ✓ Retrieved ${messages.length} agent messages`);
  }
  
  const queryEnd = Date.now();
  
  console.log(`   ✓ Session query: ${sessionTraces.length} traces`);
  console.log(`   ✓ Time range query: ${recentTraces.length} traces`);
  console.log(`   ✓ Query performance: ${queryEnd - queryStart}ms`);
}

async function demonstrateGraphAnalysis(storage: TraceStorage, sessionId: string) {
  const graph = await storage.getTraceGraph(sessionId);
  
  console.log(`   ✓ Graph nodes: ${graph.nodes.length}`);
  console.log(`   ✓ Graph edges: ${graph.edges.length}`);
  console.log(`   ✓ Graph depth: ${graph.metadata.depth}`);
  console.log(`   ✓ Graph complexity: ${graph.metadata.complexity}`);
  
  if (graph.metadata.criticalPath.length > 0) {
    console.log(`   ✓ Critical path: ${graph.metadata.criticalPath.length} nodes`);
  }
  
  // Analyze performance bottlenecks
  const slowNodes = graph.nodes.filter(node => node.duration > 1000);
  if (slowNodes.length > 0) {
    console.log(`   ⚠️  Found ${slowNodes.length} slow operations (>1s)`);
  }
}

async function demonstrateErrorTracking(storage: TraceStorage, sessionId: string) {
  // Create an error trace
  const errorTrace: TraceEvent = {
    id: generateId('error-trace'),
    timestamp: Date.now(),
    sessionId,
    type: 'task_fail',
    agentId: generateId('agent'),
    data: {
      error: 'Network timeout',
      context: { endpoint: '/api/process', timeout: 30000 }
    },
    metadata: {
      source: 'network-client',
      severity: 'high',
      tags: ['error', 'network', 'timeout'],
      correlationId: generateId('corr')
    },
    performance: { duration: 30000 }
  };
  
  await storage.storeTrace(errorTrace);
  
  // Store detailed error information
  await storage.storeErrorEvent(
    errorTrace.id,
    'NetworkTimeoutError',
    'Request timed out after 30 seconds',
    'NetworkTimeoutError: Request timed out\\n  at NetworkClient.request\\n  at Agent.processTask',
    'Implementing retry with exponential backoff'
  );
  
  // Query unresolved errors
  const errors = await storage.getErrorEvents({ resolved: false, limit: 10 });
  console.log(`   ✓ Found ${errors.length} unresolved errors`);
  
  if (errors.length > 0) {
    // Simulate error resolution
    await storage.resolveError(errors[0].id, 'Fixed with network retry logic v1.2');
    console.log(`   ✓ Resolved error: ${errors[0].errorType}`);
  }
}

async function demonstratePerformanceMonitoring(storage: TraceStorage, sessionId: string) {
  // Store performance snapshots
  const metrics = [
    { timestamp: Date.now() - 2000, cpu: 45.2, memory: 512 * 1024 * 1024, activeAgents: 3 },
    { timestamp: Date.now() - 1000, cpu: 67.8, memory: 648 * 1024 * 1024, activeAgents: 5 },
    { timestamp: Date.now(), cpu: 52.1, memory: 587 * 1024 * 1024, activeAgents: 4 }
  ];
  
  for (const metric of metrics) {
    await storage.storePerformanceSnapshot(sessionId, metric);
  }
  
  // Store resource usage for agents
  const agentId = generateId('monitor-agent');
  await storage.storeResourceUsage(
    agentId,
    75.5, // CPU %
    2 * 1024 * 1024 * 1024, // 2GB memory
    500 * 1024 * 1024, // 500MB disk
    1024 * 1024, // 1MB network in
    512 * 1024, // 512KB network out
    25 // open files
  );
  
  // Query performance data
  const timeRange = { start: Date.now() - 5000, end: Date.now() };
  const snapshots = await storage.getPerformanceSnapshots(sessionId, timeRange);
  const resourceUsage = await storage.getResourceUsage(agentId, timeRange);
  
  console.log(`   ✓ Performance snapshots: ${snapshots.length}`);
  console.log(`   ✓ Resource usage records: ${resourceUsage.length}`);
  
  if (snapshots.length > 0) {
    const avgCpu = snapshots.reduce((sum, s) => sum + s.metrics.cpu, 0) / snapshots.length;
    console.log(`   ✓ Average CPU usage: ${avgCpu.toFixed(1)}%`);
  }
}

async function demonstrateStorageManagement(storage: TraceStorage) {
  // Get storage statistics
  const stats = storage.getStorageStats();
  console.log(`   ✓ Storage stats:`);
  console.log(`     - Traces: ${stats.traceCount}`);
  console.log(`     - Sessions: ${stats.sessionCount}`);
  console.log(`     - File size: ${Math.round(stats.fileSize / 1024)}KB`);
  
  // Get comprehensive stats
  const comprehensive = storage.getComprehensiveStats();
  console.log(`   ✓ Performance stats:`);
  console.log(`     - Queue length: ${comprehensive.performance.queueLength}`);
  console.log(`     - Connection pool usage: ${(comprehensive.performance.connectionPoolUsage * 100).toFixed(1)}%`);
  console.log(`     - Uptime: ${Math.round(comprehensive.health.uptime / 1000)}s`);
  
  // Optimize database
  await storage.optimize();
  console.log(`   ✓ Database optimization completed`);
  
  // Test archiving (with dry run)
  console.log(`   ✓ Archive simulation: would clean traces older than 24 hours`);
}

// Run the demonstration
if (require.main === module) {
  demonstrateTraceStorage().catch(console.error);
}

export { demonstrateTraceStorage };