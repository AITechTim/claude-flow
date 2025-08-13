/**
 * Comprehensive tests for SnapshotManager
 */

import { SnapshotManager, SnapshotConfig } from '../snapshot-manager.js';
import { TraceStorage } from '../../storage/trace-storage.js';
import { SystemState, AgentState, TaskState } from '../../types.js';

describe('SnapshotManager', () => {
  let storage: TraceStorage;
  let snapshotManager: SnapshotManager;
  
  const createMockStorage = (): TraceStorage => {
    return new TraceStorage(
      {
        databasePath: ':memory:',
        maxFileSize: 100 * 1024 * 1024,
        maxFiles: 10,
        compressionLevel: 1024,
        indexingEnabled: true,
        vacuumInterval: 3600000
      },
      {
        enabled: true,
        samplingRate: 1.0,
        bufferSize: 1000,
        flushInterval: 5000,
        storageRetention: 24 * 60 * 60 * 1000,
        compressionEnabled: true,
        realtimeStreaming: false,
        performanceMonitoring: true
      }
    );
  };

  const createSampleState = (timestamp: number = Date.now()): SystemState => ({
    timestamp,
    agents: {
      'test-agent': {
        status: 'idle',
        currentTask: undefined,
        capabilities: ['testing'],
        resources: { cpu: 0.1, memory: 128, disk: 0, network: 0 },
        memory: { test: true }
      } as AgentState
    },
    tasks: {
      'test-task': {
        id: 'test-task',
        agentId: 'test-agent',
        type: 'test',
        status: 'completed',
        progress: 100,
        startedAt: timestamp - 1000,
        completedAt: timestamp
      } as TaskState
    },
    memory: {
      'test:key': {
        value: 'test-value',
        timestamp: timestamp - 2000,
        agentId: 'test-agent',
        type: 'string'
      }
    },
    communications: {},
    resources: {}
  });

  beforeEach(() => {
    storage = createMockStorage();
    snapshotManager = new SnapshotManager(storage, {
      automaticInterval: 1000,
      maxSnapshots: 10,
      compressionEnabled: true,
      storageType: 'memory',
      incrementalEnabled: true
    });
  });

  afterEach(async () => {
    await snapshotManager.shutdown();
    await storage.close();
  });

  describe('Basic Snapshot Operations', () => {
    test('should create a manual snapshot', async () => {
      const state = createSampleState();
      const sessionId = 'test-session';

      const snapshotId = await snapshotManager.createSnapshot(sessionId, state, {
        tags: ['test'],
        description: 'Test snapshot'
      });

      expect(snapshotId).toBeTruthy();
      expect(snapshotId).toMatch(/^snapshot-/);

      const retrieved = await snapshotManager.getSnapshot(snapshotId);
      expect(retrieved).toBeTruthy();
      expect(retrieved?.id).toBe(snapshotId);
      expect(retrieved?.sessionId).toBe(sessionId);
      expect(retrieved?.tags).toContain('test');
      expect(retrieved?.description).toBe('Test snapshot');
      expect(retrieved?.agentCount).toBe(1);
      expect(retrieved?.taskCount).toBe(1);
    });

    test('should retrieve snapshot by ID', async () => {
      const state = createSampleState();
      const sessionId = 'retrieve-test';

      const snapshotId = await snapshotManager.createSnapshot(sessionId, state);
      const retrieved = await snapshotManager.getSnapshot(snapshotId);

      expect(retrieved).toBeTruthy();
      expect(retrieved?.id).toBe(snapshotId);
      expect(retrieved?.state).toEqual(state);
    });

    test('should return null for non-existent snapshot', async () => {
      const retrieved = await snapshotManager.getSnapshot('non-existent');
      expect(retrieved).toBeNull();
    });

    test('should delete snapshot', async () => {
      const state = createSampleState();
      const sessionId = 'delete-test';

      const snapshotId = await snapshotManager.createSnapshot(sessionId, state);
      expect(await snapshotManager.getSnapshot(snapshotId)).toBeTruthy();

      const deleted = await snapshotManager.deleteSnapshot(snapshotId);
      expect(deleted).toBe(true);
      expect(await snapshotManager.getSnapshot(snapshotId)).toBeNull();
    });
  });

  describe('Snapshot Search', () => {
    test('should find nearest snapshot', async () => {
      const baseTime = Date.now();
      const sessionId = 'nearest-test';

      // Create snapshots at different times
      await snapshotManager.createSnapshot(sessionId, createSampleState(baseTime - 3000));
      const middleId = await snapshotManager.createSnapshot(sessionId, createSampleState(baseTime - 1000));
      await snapshotManager.createSnapshot(sessionId, createSampleState(baseTime));

      // Find nearest to a time between middle and latest
      const nearest = await snapshotManager.findNearestSnapshot(sessionId, baseTime - 500);
      expect(nearest?.id).toBe(middleId);
    });

    test('should search snapshots by tags', async () => {
      const sessionId = 'search-test';
      
      await snapshotManager.createSnapshot(sessionId, createSampleState(), { tags: ['tag1'] });
      await snapshotManager.createSnapshot(sessionId, createSampleState(), { tags: ['tag2'] });
      await snapshotManager.createSnapshot(sessionId, createSampleState(), { tags: ['tag1', 'tag2'] });

      const results = await snapshotManager.searchSnapshots({
        sessionId,
        tags: ['tag1']
      });

      expect(results).toHaveLength(2);
      results.forEach(snapshot => {
        expect(snapshot.tags).toContain('tag1');
      });
    });

    test('should search snapshots by time range', async () => {
      const baseTime = Date.now();
      const sessionId = 'time-search-test';

      await snapshotManager.createSnapshot(sessionId, createSampleState(baseTime - 3000));
      const middleId = await snapshotManager.createSnapshot(sessionId, createSampleState(baseTime - 1000));
      await snapshotManager.createSnapshot(sessionId, createSampleState(baseTime));

      const results = await snapshotManager.searchSnapshots({
        sessionId,
        timeRange: { start: baseTime - 2000, end: baseTime - 500 }
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(middleId);
    });

    test('should sort search results', async () => {
      const baseTime = Date.now();
      const sessionId = 'sort-test';

      const id1 = await snapshotManager.createSnapshot(sessionId, createSampleState(baseTime - 2000));
      const id2 = await snapshotManager.createSnapshot(sessionId, createSampleState(baseTime - 1000));

      // Sort ascending
      const ascResults = await snapshotManager.searchSnapshots({
        sessionId,
        sortBy: 'timestamp',
        sortDirection: 'asc'
      });

      expect(ascResults[0].id).toBe(id1);
      expect(ascResults[1].id).toBe(id2);

      // Sort descending
      const descResults = await snapshotManager.searchSnapshots({
        sessionId,
        sortBy: 'timestamp',
        sortDirection: 'desc'
      });

      expect(descResults[0].id).toBe(id2);
      expect(descResults[1].id).toBe(id1);
    });
  });

  describe('Snapshot Comparison', () => {
    test('should compare two snapshots', async () => {
      const sessionId = 'compare-test';
      
      const state1 = createSampleState();
      const state2 = {
        ...state1,
        agents: {
          ...state1.agents,
          'new-agent': {
            status: 'busy',
            currentTask: 'new-task',
            capabilities: ['new'],
            resources: { cpu: 0.5, memory: 256, disk: 0, network: 0 },
            memory: {}
          } as AgentState
        }
      };

      const id1 = await snapshotManager.createSnapshot(sessionId, state1);
      const id2 = await snapshotManager.createSnapshot(sessionId, state2);

      const comparison = await snapshotManager.compareSnapshots(id1, id2);

      expect(comparison.snapshot1.id).toBe(id1);
      expect(comparison.snapshot2.id).toBe(id2);
      expect(comparison.summary.agentsChanged).toBe(1); // One agent added
      expect(comparison.summary.totalChanges).toBeGreaterThan(0);
      expect(comparison.differences.agents.added).toHaveProperty('new-agent');
    });
  });

  describe('Compression', () => {
    test('should compress large snapshots', async () => {
      const config: Partial<SnapshotConfig> = {
        compressionEnabled: true,
        compressionThreshold: 100 // Low threshold for testing
      };
      
      const compressManager = new SnapshotManager(storage, config);
      
      // Create a large state
      const largeState = createSampleState();
      // Add lots of memory entries to make it large
      for (let i = 0; i < 100; i++) {
        largeState.memory[`large-key-${i}`] = {
          value: new Array(100).fill(`data-${i}`).join(' '),
          timestamp: Date.now(),
          agentId: 'test-agent',
          type: 'string'
        };
      }

      const snapshotId = await compressManager.createSnapshot('compress-test', largeState);
      const retrieved = await compressManager.getSnapshot(snapshotId);

      expect(retrieved?.compressed).toBe(true);
      expect(retrieved?.compressedSize).toBeLessThan(retrieved?.size);
      
      await compressManager.shutdown();
    });
  });

  describe('Export/Import', () => {
    test('should export and import snapshots', async () => {
      const sessionId = 'export-test';
      const state = createSampleState();

      const originalId = await snapshotManager.createSnapshot(sessionId, state, {
        tags: ['export'],
        description: 'For export test'
      });

      // Export
      const exportData = await snapshotManager.exportSnapshots(sessionId, {
        tags: ['export']
      });

      expect(exportData.snapshots).toHaveLength(1);
      expect(exportData.metadata.sessionId).toBe(sessionId);

      // Create new manager for import
      const importManager = new SnapshotManager(storage, { storageType: 'memory' });

      // Import
      const results = await importManager.importSnapshots(exportData);

      expect(results.imported).toBe(1);
      expect(results.errors).toHaveLength(0);

      // Verify imported snapshot
      const imported = await importManager.getSnapshot(originalId);
      expect(imported).toBeTruthy();
      expect(imported?.description).toBe('For export test');

      await importManager.shutdown();
    });
  });

  describe('Automatic Snapshots', () => {
    test('should start and stop automatic snapshots', () => {
      const sessionId = 'auto-test';

      // Test event emissions
      let started = false;
      let stopped = false;

      snapshotManager.on('automatic_snapshots_started', (event) => {
        if (event.sessionId === sessionId) started = true;
      });

      snapshotManager.on('automatic_snapshots_stopped', (event) => {
        if (event.sessionId === sessionId) stopped = true;
      });

      snapshotManager.startAutomaticSnapshots(sessionId);
      expect(started).toBe(true);

      snapshotManager.stopAutomaticSnapshots(sessionId);
      expect(stopped).toBe(true);
    });
  });

  describe('Statistics', () => {
    test('should track statistics', async () => {
      const sessionId = 'stats-test';
      const state = createSampleState();

      // Create multiple snapshots
      await snapshotManager.createSnapshot(sessionId, state, { tags: ['test'] });
      await snapshotManager.createSnapshot(sessionId, state, { tags: ['milestone'] });

      const stats = snapshotManager.getStatistics();

      expect(stats.snapshots.total).toBe(2);
      expect(stats.snapshots.bySession[sessionId]).toBe(2);
      expect(stats.snapshots.byType.tagged).toBe(2);
      expect(stats.performance.snapshotsCreated).toBe(2);
      expect(stats.storage.totalSize).toBeGreaterThan(0);
    });
  });

  describe('Event Handling', () => {
    test('should emit snapshot creation events', async () => {
      const sessionId = 'events-test';
      let eventReceived = false;
      let snapshotData: any = null;

      snapshotManager.on('snapshot_created', (event) => {
        eventReceived = true;
        snapshotData = event.snapshot;
      });

      await snapshotManager.createSnapshot(sessionId, createSampleState());

      expect(eventReceived).toBe(true);
      expect(snapshotData).toBeTruthy();
      expect(snapshotData.sessionId).toBe(sessionId);
    });

    test('should emit error events', (done) => {
      snapshotManager.on('error', (event) => {
        expect(event.type).toBeTruthy();
        expect(event.error).toBeTruthy();
        done();
      });

      // Force an error by trying to create snapshot with invalid data
      snapshotManager.createSnapshot('', null as any).catch(() => {
        // Expected to fail
      });
    });
  });

  describe('State Reconstruction', () => {
    test('should reconstruct state from snapshot', async () => {
      const sessionId = 'reconstruct-test';
      const originalState = createSampleState();

      const snapshotId = await snapshotManager.createSnapshot(sessionId, originalState);
      const snapshot = await snapshotManager.getSnapshot(snapshotId);

      const reconstructedState = await snapshotManager.reconstructState(snapshot!);

      expect(reconstructedState).toEqual(originalState);
      expect(reconstructedState.agents).toEqual(originalState.agents);
      expect(reconstructedState.tasks).toEqual(originalState.tasks);
      expect(reconstructedState.memory).toEqual(originalState.memory);
    });
  });

  describe('Memory Management', () => {
    test('should enforce snapshot limits', async () => {
      const limitedManager = new SnapshotManager(storage, {
        maxSnapshots: 3,
        storageType: 'memory'
      });

      const sessionId = 'limit-test';
      const state = createSampleState();

      // Create more snapshots than the limit
      const ids = [];
      for (let i = 0; i < 5; i++) {
        const id = await limitedManager.createSnapshot(sessionId, {
          ...state,
          timestamp: Date.now() + i
        });
        ids.push(id);
      }

      const sessionSnapshots = await limitedManager.getSessionSnapshots(sessionId);
      expect(sessionSnapshots.length).toBeLessThanOrEqual(3);

      await limitedManager.shutdown();
    });
  });

  describe('Configuration', () => {
    test('should use default configuration', () => {
      const defaultManager = new SnapshotManager(storage);
      const stats = defaultManager.getStatistics();
      
      expect(stats.config.compressionEnabled).toBe(true);
      expect(stats.config.automaticInterval).toBe(30000);
      expect(stats.config.maxSnapshots).toBe(1000);
    });

    test('should merge custom configuration', () => {
      const customConfig = {
        automaticInterval: 5000,
        compressionEnabled: false,
        maxSnapshots: 50
      };

      const customManager = new SnapshotManager(storage, customConfig);
      const stats = customManager.getStatistics();

      expect(stats.config.automaticInterval).toBe(5000);
      expect(stats.config.compressionEnabled).toBe(false);
      expect(stats.config.maxSnapshots).toBe(50);
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid snapshot IDs gracefully', async () => {
      const result = await snapshotManager.getSnapshot('invalid-id');
      expect(result).toBeNull();
    });

    test('should handle empty search results', async () => {
      const results = await snapshotManager.searchSnapshots({
        sessionId: 'non-existent',
        tags: ['non-existent']
      });
      
      expect(results).toEqual([]);
    });

    test('should handle malformed import data', async () => {
      const invalidData = { invalid: 'data' };
      
      await expect(
        snapshotManager.importSnapshots(invalidData as any)
      ).rejects.toThrow();
    });
  });
});