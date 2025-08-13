/**
 * Example usage of the SnapshotManager for time-travel debugging
 * 
 * This file demonstrates how to use the comprehensive SnapshotManager
 * for creating, managing, and retrieving snapshots of system state.
 */

import { SnapshotManager, SnapshotConfig } from './snapshot-manager.js';
import { StateReconstructor } from './state-reconstructor.js';
import { TraceStorage } from '../storage/trace-storage.js';
import { SystemState, AgentState, TaskState } from '../types.js';

/**
 * Example 1: Basic SnapshotManager setup and usage
 */
async function basicSnapshotExample(): Promise<void> {
  console.log('=== Basic Snapshot Example ===');

  // Create storage and snapshot manager
  const storage = new TraceStorage(
    {
      databasePath: ':memory:',
      maxFileSize: 100 * 1024 * 1024, // 100MB
      maxFiles: 10,
      compressionLevel: 1024, // 1KB threshold
      indexingEnabled: true,
      vacuumInterval: 3600000 // 1 hour
    },
    {
      enabled: true,
      samplingRate: 1.0,
      bufferSize: 1000,
      flushInterval: 5000,
      storageRetention: 24 * 60 * 60 * 1000, // 24 hours
      compressionEnabled: true,
      realtimeStreaming: false,
      performanceMonitoring: true
    }
  );

  const snapshotConfig: Partial<SnapshotConfig> = {
    automaticInterval: 10000,        // 10 seconds for demo
    maxSnapshots: 50,
    compressionEnabled: true,
    storageType: 'hybrid',
    incrementalEnabled: true
  };

  const snapshotManager = new SnapshotManager(storage, snapshotConfig);

  // Create a sample system state
  const currentState: SystemState = {
    timestamp: Date.now(),
    agents: {
      'agent-1': {
        status: 'busy',
        currentTask: 'task-1',
        capabilities: ['coding', 'analysis'],
        resources: { cpu: 0.8, memory: 512, disk: 0, network: 0 },
        memory: { currentProject: 'claude-flow', lastAction: 'processing' }
      } as AgentState,
      'agent-2': {
        status: 'idle',
        currentTask: undefined,
        capabilities: ['testing', 'review'],
        resources: { cpu: 0.1, memory: 128, disk: 0, network: 0 },
        memory: { availability: 'ready' }
      } as AgentState
    },
    tasks: {
      'task-1': {
        id: 'task-1',
        agentId: 'agent-1',
        type: 'coding',
        status: 'running',
        progress: 75,
        startedAt: Date.now() - 30000
      } as TaskState
    },
    memory: {
      'session:config': {
        value: { debug: true, mode: 'development' },
        timestamp: Date.now() - 60000,
        agentId: 'system',
        type: 'object'
      }
    },
    communications: {},
    resources: {}
  };

  // Create a manual snapshot
  const snapshotId = await snapshotManager.createSnapshot(
    'session-1', 
    currentState, 
    {
      tags: ['milestone', 'before-refactor'],
      description: 'State before major refactoring',
      type: 'full'
    }
  );

  console.log(`Created snapshot: ${snapshotId}`);

  // Retrieve the snapshot
  const retrievedSnapshot = await snapshotManager.getSnapshot(snapshotId);
  if (retrievedSnapshot) {
    console.log(`Retrieved snapshot: ${retrievedSnapshot.id}`);
    console.log(`  - Type: ${retrievedSnapshot.type}`);
    console.log(`  - Size: ${retrievedSnapshot.size} bytes`);
    console.log(`  - Compressed: ${retrievedSnapshot.compressed}`);
    console.log(`  - Tags: ${retrievedSnapshot.tags.join(', ')}`);
    console.log(`  - Agent count: ${retrievedSnapshot.agentCount}`);
    console.log(`  - Task count: ${retrievedSnapshot.taskCount}`);
  }

  // Start automatic snapshots
  snapshotManager.startAutomaticSnapshots('session-1');

  console.log('Automatic snapshots started for session-1');
}

/**
 * Example 2: Snapshot search and comparison
 */
async function snapshotSearchExample(): Promise<void> {
  console.log('\n=== Snapshot Search Example ===');

  const storage = new TraceStorage(
    { databasePath: ':memory:', maxFileSize: 100 * 1024 * 1024, maxFiles: 10, compressionLevel: 1024, indexingEnabled: true, vacuumInterval: 3600000 },
    { enabled: true, samplingRate: 1.0, bufferSize: 1000, flushInterval: 5000, storageRetention: 24 * 60 * 60 * 1000, compressionEnabled: true, realtimeStreaming: false, performanceMonitoring: true }
  );

  const snapshotManager = new SnapshotManager(storage, {
    compressionEnabled: true,
    incrementalEnabled: true
  });

  // Create multiple snapshots with different tags
  const states = [
    { timestamp: Date.now() - 3000, agents: { 'agent-1': { status: 'idle' } }, tasks: {}, memory: {}, communications: {}, resources: {} },
    { timestamp: Date.now() - 2000, agents: { 'agent-1': { status: 'busy' }, 'agent-2': { status: 'idle' } }, tasks: {}, memory: {}, communications: {}, resources: {} },
    { timestamp: Date.now() - 1000, agents: { 'agent-1': { status: 'busy' }, 'agent-2': { status: 'busy' } }, tasks: {}, memory: {}, communications: {}, resources: {} }
  ];

  const snapshotIds = [];
  for (let i = 0; i < states.length; i++) {
    const id = await snapshotManager.createSnapshot('session-2', states[i] as SystemState, {
      tags: i === 0 ? ['initial'] : i === 1 ? ['milestone'] : ['final'],
      description: `State ${i + 1}`
    });
    snapshotIds.push(id);
  }

  // Search snapshots by tags
  const milestoneSnapshots = await snapshotManager.searchSnapshots({
    sessionId: 'session-2',
    tags: ['milestone'],
    sortBy: 'timestamp',
    sortDirection: 'asc'
  });

  console.log(`Found ${milestoneSnapshots.length} milestone snapshots`);

  // Compare two snapshots
  if (snapshotIds.length >= 2) {
    const comparison = await snapshotManager.compareSnapshots(snapshotIds[0], snapshotIds[1]);
    console.log(`Comparison between ${comparison.snapshot1.description} and ${comparison.snapshot2.description}:`);
    console.log(`  - Agents changed: ${comparison.summary.agentsChanged}`);
    console.log(`  - Tasks changed: ${comparison.summary.tasksChanged}`);
    console.log(`  - Total changes: ${comparison.summary.totalChanges}`);
  }
}

/**
 * Example 3: Export and import snapshots
 */
async function exportImportExample(): Promise<void> {
  console.log('\n=== Export/Import Example ===');

  const storage = new TraceStorage(
    { databasePath: ':memory:', maxFileSize: 100 * 1024 * 1024, maxFiles: 10, compressionLevel: 1024, indexingEnabled: true, vacuumInterval: 3600000 },
    { enabled: true, samplingRate: 1.0, bufferSize: 1000, flushInterval: 5000, storageRetention: 24 * 60 * 60 * 1000, compressionEnabled: true, realtimeStreaming: false, performanceMonitoring: true }
  );

  const snapshotManager1 = new SnapshotManager(storage);
  const snapshotManager2 = new SnapshotManager(storage); // Different instance

  // Create some snapshots in first manager
  const sampleState: SystemState = {
    timestamp: Date.now(),
    agents: {
      'export-agent': {
        status: 'idle',
        currentTask: undefined,
        capabilities: ['export', 'import'],
        resources: { cpu: 0, memory: 0, disk: 0, network: 0 },
        memory: { operation: 'export-test' }
      } as AgentState
    },
    tasks: {},
    memory: {},
    communications: {},
    resources: {}
  };

  await snapshotManager1.createSnapshot('export-session', sampleState, {
    tags: ['export-test', 'important'],
    description: 'Test snapshot for export'
  });

  // Export snapshots
  const exportData = await snapshotManager1.exportSnapshots('export-session', {
    tags: ['export-test'],
    format: 'json'
  });

  console.log(`Exported ${exportData.snapshots.length} snapshots`);
  console.log(`Export metadata: version=${exportData.metadata.version}, time=${new Date(exportData.metadata.exportTime).toISOString()}`);

  // Import into second manager
  const importResults = await snapshotManager2.importSnapshots(exportData, {
    validateIntegrity: true
  });

  console.log(`Import results: ${importResults.imported} imported, ${importResults.skipped} skipped, ${importResults.errors.length} errors`);
}

/**
 * Example 4: Integration with StateReconstructor
 */
async function stateReconstructorExample(): Promise<void> {
  console.log('\n=== StateReconstructor Integration Example ===');

  const storage = new TraceStorage(
    { databasePath: ':memory:', maxFileSize: 100 * 1024 * 1024, maxFiles: 10, compressionLevel: 1024, indexingEnabled: true, vacuumInterval: 3600000 },
    { enabled: true, samplingRate: 1.0, bufferSize: 1000, flushInterval: 5000, storageRetention: 24 * 60 * 60 * 1000, compressionEnabled: true, realtimeStreaming: false, performanceMonitoring: true }
  );

  // Create state reconstructor with snapshot management
  const reconstructor = new StateReconstructor(storage, {
    automaticInterval: 5000, // 5 seconds
    compressionEnabled: true,
    incrementalEnabled: true
  });

  // The reconstructor will automatically create snapshots during state reconstruction
  // and use existing snapshots to optimize reconstruction performance

  console.log('StateReconstructor initialized with SnapshotManager integration');
  console.log('Snapshots will be automatically created during state reconstruction');
}

/**
 * Example 5: Performance monitoring and statistics
 */
async function performanceExample(): Promise<void> {
  console.log('\n=== Performance Monitoring Example ===');

  const storage = new TraceStorage(
    { databasePath: ':memory:', maxFileSize: 100 * 1024 * 1024, maxFiles: 10, compressionLevel: 1024, indexingEnabled: true, vacuumInterval: 3600000 },
    { enabled: true, samplingRate: 1.0, bufferSize: 1000, flushInterval: 5000, storageRetention: 24 * 60 * 60 * 1000, compressionEnabled: true, realtimeStreaming: false, performanceMonitoring: true }
  );

  const snapshotManager = new SnapshotManager(storage, {
    compressionEnabled: true,
    compressionThreshold: 512 // 512 bytes
  });

  // Create snapshots of various sizes
  const largeState: SystemState = {
    timestamp: Date.now(),
    agents: {},
    tasks: {},
    memory: {},
    communications: {},
    resources: {}
  };

  // Add many agents to create a larger state
  for (let i = 0; i < 10; i++) {
    largeState.agents[`agent-${i}`] = {
      status: 'idle',
      currentTask: undefined,
      capabilities: [`capability-${i}`, 'general'],
      resources: { cpu: Math.random(), memory: Math.random() * 1000, disk: 0, network: 0 },
      memory: { 
        id: i, 
        data: new Array(100).fill(`data-${i}`).join(' '), // Large memory content
        timestamp: Date.now() 
      }
    } as AgentState;
  }

  await snapshotManager.createSnapshot('perf-session', largeState, {
    tags: ['performance-test'],
    description: 'Large state for performance testing'
  });

  // Get statistics
  const stats = snapshotManager.getStatistics();
  console.log('SnapshotManager Statistics:');
  console.log(`  Total snapshots: ${stats.snapshots.total}`);
  console.log(`  Total storage size: ${Math.round(stats.storage.totalSize / 1024)} KB`);
  console.log(`  Average snapshot size: ${Math.round(stats.storage.averageSnapshotSize / 1024)} KB`);
  console.log(`  Compression ratio: ${(stats.storage.compressionRatio * 100).toFixed(1)}%`);
  console.log(`  Average creation time: ${stats.performance.averageCreationTime}ms`);
  console.log(`  Compression rate: ${(stats.performance.compressionRate * 100).toFixed(1)}%`);
}

/**
 * Example 6: Event handling and lifecycle management
 */
async function eventHandlingExample(): Promise<void> {
  console.log('\n=== Event Handling Example ===');

  const storage = new TraceStorage(
    { databasePath: ':memory:', maxFileSize: 100 * 1024 * 1024, maxFiles: 10, compressionLevel: 1024, indexingEnabled: true, vacuumInterval: 3600000 },
    { enabled: true, samplingRate: 1.0, bufferSize: 1000, flushInterval: 5000, storageRetention: 24 * 60 * 60 * 1000, compressionEnabled: true, realtimeStreaming: false, performanceMonitoring: true }
  );

  const snapshotManager = new SnapshotManager(storage);

  // Set up event listeners
  snapshotManager.on('snapshot_created', (event) => {
    console.log(`✓ Snapshot created: ${event.snapshot.id} (${event.snapshot.type})`);
    if (event.compressionRatio < 1) {
      console.log(`  Compression saved ${Math.round((1 - event.compressionRatio) * 100)}% space`);
    }
  });

  snapshotManager.on('automatic_snapshots_started', (event) => {
    console.log(`🚀 Automatic snapshots started for session: ${event.sessionId}`);
  });

  snapshotManager.on('error', (event) => {
    console.error(`❌ Error in SnapshotManager: ${event.type} - ${event.error}`);
  });

  // Create a snapshot to trigger events
  const sampleState: SystemState = {
    timestamp: Date.now(),
    agents: {},
    tasks: {},
    memory: {},
    communications: {},
    resources: {}
  };

  await snapshotManager.createSnapshot('event-session', sampleState, {
    tags: ['event-test']
  });

  // Start automatic snapshots to trigger more events
  snapshotManager.startAutomaticSnapshots('event-session');

  // Stop automatic snapshots after a short delay
  setTimeout(() => {
    snapshotManager.stopAutomaticSnapshots('event-session');
    console.log('🛑 Automatic snapshots stopped');
  }, 2000);
}

/**
 * Run all examples
 */
export async function runSnapshotExamples(): Promise<void> {
  console.log('🎯 SnapshotManager Examples\n');
  
  try {
    await basicSnapshotExample();
    await snapshotSearchExample();
    await exportImportExample();
    await stateReconstructorExample();
    await performanceExample();
    await eventHandlingExample();
    
    console.log('\n✅ All examples completed successfully!');
  } catch (error) {
    console.error('\n❌ Example failed:', error);
    throw error;
  }
}

// Run examples if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runSnapshotExamples().catch(console.error);
}