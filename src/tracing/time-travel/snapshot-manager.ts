/**
 * Comprehensive Snapshot Manager for Time-Travel Debugging
 * 
 * Features:
 * - Automatic snapshot creation at configurable intervals
 * - Manual snapshot creation with tagging
 * - Compression and storage optimization
 * - Quick snapshot search and retrieval
 * - Incremental snapshots for large states
 * - Import/export functionality
 * - Integrity validation
 */

import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { EventEmitter } from 'node:events';
import { 
  SystemState, 
  AgentState, 
  TaskState, 
  MemoryEntry, 
  TimeRange,
  TraceEvent 
} from '../types.js';
import { TraceStorage } from '../storage/trace-storage.js';
import { Logger } from '../../core/logger.js';
import { generateId } from '../../utils/helpers.js';

export interface SnapshotConfig {
  // Timing configuration
  automaticInterval: number;          // ms between automatic snapshots (default: 30s)
  maxRetentionTime: number;           // ms to keep snapshots (default: 24h)
  maxSnapshots: number;               // max snapshots per session (default: 1000)
  
  // Compression configuration
  compressionEnabled: boolean;        // enable gzip compression (default: true)
  compressionThreshold: number;       // min size to compress in bytes (default: 1KB)
  
  // Storage configuration
  storageType: 'memory' | 'disk' | 'hybrid';  // storage backend (default: hybrid)
  persistenceEnabled: boolean;        // persist to disk (default: true)
  
  // Advanced features
  incrementalEnabled: boolean;        // enable incremental snapshots (default: true)
  checksumValidation: boolean;        // validate integrity (default: true)
  taggedSnapshotsOnly: boolean;       // only keep tagged snapshots long-term (default: false)
}

export interface StateSnapshot {
  id: string;
  sessionId: string;
  timestamp: number;
  
  // Snapshot content
  state: SystemState | null;          // full state (null for incremental)
  incrementalData?: {
    baseSnapshotId: string;
    changes: StateDelta;
  };
  
  // Metadata
  type: 'full' | 'incremental' | 'tagged';
  tags: string[];
  description?: string;
  
  // Storage metadata
  size: number;                       // uncompressed size in bytes
  compressedSize?: number;            // compressed size if compression used
  checksum: string;                   // SHA-256 hash for integrity
  compressed: boolean;
  
  // Timing metadata
  createdAt: number;
  expiresAt?: number;
  
  // Performance metadata
  creationDuration: number;           // ms to create snapshot
  agentCount: number;
  taskCount: number;
  memoryEntryCount: number;
}

export interface StateDelta {
  agents: {
    added: Record<string, AgentState>;
    updated: Record<string, Partial<AgentState>>;
    removed: string[];
  };
  tasks: {
    added: Record<string, TaskState>;
    updated: Record<string, Partial<TaskState>>;
    removed: string[];
  };
  memory: {
    added: Record<string, MemoryEntry>;
    updated: Record<string, MemoryEntry>;
    removed: string[];
  };
  communications: {
    added: Record<string, any>;
    removed: string[];
  };
  resources: {
    added: Record<string, any>;
    updated: Record<string, any>;
    removed: string[];
  };
}

export interface SnapshotSearchOptions {
  sessionId?: string;
  tags?: string[];
  timeRange?: TimeRange;
  type?: 'full' | 'incremental' | 'tagged';
  sortBy?: 'timestamp' | 'size' | 'tags';
  sortDirection?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface SnapshotExportData {
  metadata: {
    version: string;
    exportTime: number;
    sessionId: string;
    snapshotCount: number;
  };
  snapshots: StateSnapshot[];
}

export class SnapshotManager extends EventEmitter {
  private config: SnapshotConfig;
  private storage: TraceStorage;
  private logger: Logger;
  
  // In-memory storage
  private memorySnapshots = new Map<string, Map<string, StateSnapshot>>();  // sessionId -> snapshots
  
  // Automatic snapshot timers
  private automaticTimers = new Map<string, NodeJS.Timeout>();
  
  // Statistics
  private stats = {
    snapshotsCreated: 0,
    snapshotsCompressed: 0,
    compressionRatio: 0,
    averageCreationTime: 0,
    totalStorageSize: 0
  };
  
  // Background cleanup timer
  private cleanupTimer?: NodeJS.Timeout;
  
  constructor(storage: TraceStorage, config: Partial<SnapshotConfig> = {}) {
    super();
    
    this.storage = storage;
    this.logger = new Logger('SnapshotManager');
    
    // Merge with default configuration
    this.config = {
      automaticInterval: 30000,        // 30 seconds
      maxRetentionTime: 24 * 60 * 60 * 1000,  // 24 hours
      maxSnapshots: 1000,
      compressionEnabled: true,
      compressionThreshold: 1024,      // 1KB
      storageType: 'hybrid',
      persistenceEnabled: true,
      incrementalEnabled: true,
      checksumValidation: true,
      taggedSnapshotsOnly: false,
      ...config
    };
    
    this.startBackgroundTasks();
    
    this.logger.info('SnapshotManager initialized', {
      config: this.config,
      storageType: this.config.storageType
    });
  }

  /**
   * Start automatic snapshot creation for a session
   */
  startAutomaticSnapshots(sessionId: string): void {
    if (this.automaticTimers.has(sessionId)) {
      this.logger.debug(`Automatic snapshots already running for session ${sessionId}`);
      return;
    }

    const timer = setInterval(async () => {
      try {
        await this.createAutomaticSnapshot(sessionId);
      } catch (error) {
        this.logger.error(`Failed to create automatic snapshot for session ${sessionId}:`, error);
        this.emit('error', { type: 'automatic_snapshot_failed', sessionId, error });
      }
    }, this.config.automaticInterval);

    this.automaticTimers.set(sessionId, timer);
    this.logger.info(`Started automatic snapshots for session ${sessionId} (interval: ${this.config.automaticInterval}ms)`);
    
    this.emit('automatic_snapshots_started', { sessionId });
  }

  /**
   * Stop automatic snapshot creation for a session
   */
  stopAutomaticSnapshots(sessionId: string): void {
    const timer = this.automaticTimers.get(sessionId);
    if (timer) {
      clearInterval(timer);
      this.automaticTimers.delete(sessionId);
      this.logger.info(`Stopped automatic snapshots for session ${sessionId}`);
      this.emit('automatic_snapshots_stopped', { sessionId });
    }
  }

  /**
   * Create a manual snapshot with optional tagging
   */
  async createSnapshot(
    sessionId: string,
    currentState: SystemState,
    options: {
      tags?: string[];
      description?: string;
      type?: 'full' | 'incremental';
      forceCompression?: boolean;
    } = {}
  ): Promise<string> {
    const startTime = Date.now();
    const snapshotId = generateId('snapshot');
    
    this.logger.debug(`Creating snapshot ${snapshotId} for session ${sessionId}`, {
      stateSize: this.calculateStateSize(currentState),
      options
    });

    try {
      // Determine snapshot type
      const snapshotType = options.type || (options.tags?.length ? 'tagged' : 'full');
      let incrementalData: StateDelta | undefined;
      let baseState: SystemState | null = currentState;

      // Create incremental snapshot if enabled and appropriate
      if (this.config.incrementalEnabled && snapshotType === 'full' && !options.tags?.length) {
        const lastSnapshot = await this.findLatestSnapshot(sessionId, 'full');
        if (lastSnapshot && lastSnapshot.state) {
          const delta = this.computeStateDelta(lastSnapshot.state, currentState);
          if (this.shouldCreateIncremental(delta, currentState)) {
            incrementalData = {
              baseSnapshotId: lastSnapshot.id,
              changes: delta
            };
            baseState = null;  // Don't store full state for incremental
          }
        }
      }

      // Calculate metadata
      const stateJson = JSON.stringify(baseState || incrementalData);
      const uncompressedSize = Buffer.byteLength(stateJson, 'utf8');
      const shouldCompress = options.forceCompression || 
        (this.config.compressionEnabled && uncompressedSize > this.config.compressionThreshold);

      // Compress if needed
      let finalData: Buffer;
      let compressedSize: number | undefined;

      if (shouldCompress) {
        finalData = gzipSync(Buffer.from(stateJson));
        compressedSize = finalData.length;
        this.stats.snapshotsCompressed++;
      } else {
        finalData = Buffer.from(stateJson);
      }

      // Calculate checksum
      const checksum = this.calculateChecksum(stateJson);

      // Create snapshot object
      const snapshot: StateSnapshot = {
        id: snapshotId,
        sessionId,
        timestamp: Date.now(),
        state: baseState,
        incrementalData: incrementalData ? {
          baseSnapshotId: incrementalData.baseSnapshotId,
          changes: incrementalData.changes
        } : undefined,
        type: snapshotType,
        tags: options.tags || [],
        description: options.description,
        size: uncompressedSize,
        compressedSize,
        checksum,
        compressed: shouldCompress,
        createdAt: Date.now(),
        expiresAt: this.config.taggedSnapshotsOnly && !options.tags?.length 
          ? Date.now() + this.config.maxRetentionTime 
          : undefined,
        creationDuration: Date.now() - startTime,
        agentCount: Object.keys(currentState.agents || {}).length,
        taskCount: Object.keys(currentState.tasks || {}).length,
        memoryEntryCount: Object.keys(currentState.memory || {}).length
      };

      // Store snapshot
      await this.storeSnapshot(snapshot, finalData);

      // Update statistics
      this.stats.snapshotsCreated++;
      this.updateAverageCreationTime(snapshot.creationDuration);
      this.stats.totalStorageSize += compressedSize || uncompressedSize;
      if (compressedSize) {
        this.stats.compressionRatio = (this.stats.compressionRatio + (compressedSize / uncompressedSize)) / 2;
      }

      // Cleanup old snapshots if needed
      await this.cleanupOldSnapshots(sessionId);

      this.logger.info(`Created snapshot ${snapshotId}`, {
        type: snapshotType,
        size: uncompressedSize,
        compressedSize,
        compressed: shouldCompress,
        duration: snapshot.creationDuration,
        tags: options.tags
      });

      this.emit('snapshot_created', {
        snapshot,
        compressionRatio: compressedSize ? compressedSize / uncompressedSize : 1
      });

      return snapshotId;

    } catch (error) {
      this.logger.error(`Failed to create snapshot ${snapshotId}:`, error);
      this.emit('error', { type: 'snapshot_creation_failed', snapshotId, sessionId, error });
      throw error;
    }
  }

  /**
   * Retrieve a snapshot by ID
   */
  async getSnapshot(snapshotId: string): Promise<StateSnapshot | null> {
    // Check memory first
    for (const sessionSnapshots of this.memorySnapshots.values()) {
      const snapshot = sessionSnapshots.get(snapshotId);
      if (snapshot) {
        return snapshot;
      }
    }

    // Check persistent storage
    return this.loadSnapshotFromStorage(snapshotId);
  }

  /**
   * Find the nearest snapshot to a timestamp
   */
  async findNearestSnapshot(sessionId: string, timestamp: number): Promise<StateSnapshot | null> {
    const sessionSnapshots = await this.getSessionSnapshots(sessionId);
    
    // Find the latest snapshot before or at the timestamp
    let nearest: StateSnapshot | null = null;
    
    for (const snapshot of sessionSnapshots) {
      if (snapshot.timestamp <= timestamp) {
        if (!nearest || snapshot.timestamp > nearest.timestamp) {
          nearest = snapshot;
        }
      }
    }
    
    return nearest;
  }

  /**
   * Search snapshots with flexible criteria
   */
  async searchSnapshots(options: SnapshotSearchOptions): Promise<StateSnapshot[]> {
    let results: StateSnapshot[] = [];

    if (options.sessionId) {
      results = await this.getSessionSnapshots(options.sessionId);
    } else {
      // Search all sessions
      for (const [sessionId] of this.memorySnapshots) {
        results.push(...await this.getSessionSnapshots(sessionId));
      }
    }

    // Apply filters
    if (options.tags && options.tags.length > 0) {
      results = results.filter(snapshot => 
        options.tags!.some(tag => snapshot.tags.includes(tag))
      );
    }

    if (options.timeRange) {
      results = results.filter(snapshot =>
        snapshot.timestamp >= options.timeRange!.start &&
        snapshot.timestamp <= options.timeRange!.end
      );
    }

    if (options.type) {
      results = results.filter(snapshot => snapshot.type === options.type);
    }

    // Sort results
    const sortBy = options.sortBy || 'timestamp';
    const sortDirection = options.sortDirection || 'desc';
    
    results.sort((a, b) => {
      let compareValue = 0;
      
      switch (sortBy) {
        case 'timestamp':
          compareValue = a.timestamp - b.timestamp;
          break;
        case 'size':
          compareValue = a.size - b.size;
          break;
        case 'tags':
          compareValue = a.tags.length - b.tags.length;
          break;
      }
      
      return sortDirection === 'asc' ? compareValue : -compareValue;
    });

    // Apply pagination
    const offset = options.offset || 0;
    const limit = options.limit || results.length;
    
    return results.slice(offset, offset + limit);
  }

  /**
   * Reconstruct full state from snapshot (handles incremental snapshots)
   */
  async reconstructState(snapshot: StateSnapshot): Promise<SystemState> {
    if (snapshot.state) {
      // Full snapshot, return state directly
      return { ...snapshot.state };
    }

    if (snapshot.incrementalData) {
      // Incremental snapshot, reconstruct from base
      const baseSnapshot = await this.getSnapshot(snapshot.incrementalData.baseSnapshotId);
      if (!baseSnapshot || !baseSnapshot.state) {
        throw new Error(`Base snapshot ${snapshot.incrementalData.baseSnapshotId} not found or invalid`);
      }

      return this.applyStateDelta(baseSnapshot.state, snapshot.incrementalData.changes);
    }

    throw new Error(`Invalid snapshot ${snapshot.id}: no state or incremental data`);
  }

  /**
   * Compare two snapshots and return differences
   */
  async compareSnapshots(
    snapshot1Id: string, 
    snapshot2Id: string
  ): Promise<{
    snapshot1: StateSnapshot;
    snapshot2: StateSnapshot;
    differences: StateDelta;
    summary: {
      agentsChanged: number;
      tasksChanged: number;
      memoryChanged: number;
      totalChanges: number;
    };
  }> {
    const [snapshot1, snapshot2] = await Promise.all([
      this.getSnapshot(snapshot1Id),
      this.getSnapshot(snapshot2Id)
    ]);

    if (!snapshot1 || !snapshot2) {
      throw new Error(`Snapshot not found: ${!snapshot1 ? snapshot1Id : snapshot2Id}`);
    }

    const [state1, state2] = await Promise.all([
      this.reconstructState(snapshot1),
      this.reconstructState(snapshot2)
    ]);

    const differences = this.computeStateDelta(state1, state2);
    
    const summary = {
      agentsChanged: Object.keys(differences.agents.added).length + 
                     Object.keys(differences.agents.updated).length + 
                     differences.agents.removed.length,
      tasksChanged: Object.keys(differences.tasks.added).length + 
                    Object.keys(differences.tasks.updated).length + 
                    differences.tasks.removed.length,
      memoryChanged: Object.keys(differences.memory.added).length + 
                     Object.keys(differences.memory.updated).length + 
                     differences.memory.removed.length,
      totalChanges: 0
    };
    
    summary.totalChanges = summary.agentsChanged + summary.tasksChanged + summary.memoryChanged;

    return {
      snapshot1,
      snapshot2,
      differences,
      summary
    };
  }

  /**
   * Export snapshots to a portable format
   */
  async exportSnapshots(
    sessionId: string, 
    options: {
      tags?: string[];
      timeRange?: TimeRange;
      includeIncrementals?: boolean;
      format?: 'json' | 'binary';
    } = {}
  ): Promise<SnapshotExportData | Buffer> {
    const searchOptions: SnapshotSearchOptions = {
      sessionId,
      tags: options.tags,
      timeRange: options.timeRange
    };
    
    if (!options.includeIncrementals) {
      searchOptions.type = 'full';
    }

    let snapshots = await this.searchSnapshots(searchOptions);
    
    // For incremental snapshots, reconstruct full states
    if (options.includeIncrementals) {
      snapshots = await Promise.all(
        snapshots.map(async snapshot => {
          if (snapshot.incrementalData) {
            const fullState = await this.reconstructState(snapshot);
            return { ...snapshot, state: fullState, incrementalData: undefined };
          }
          return snapshot;
        })
      );
    }

    const exportData: SnapshotExportData = {
      metadata: {
        version: '1.0.0',
        exportTime: Date.now(),
        sessionId,
        snapshotCount: snapshots.length
      },
      snapshots
    };

    if (options.format === 'binary') {
      const json = JSON.stringify(exportData);
      return gzipSync(Buffer.from(json));
    }

    return exportData;
  }

  /**
   * Import snapshots from exported data
   */
  async importSnapshots(
    data: SnapshotExportData | Buffer,
    options: {
      overwriteExisting?: boolean;
      validateIntegrity?: boolean;
    } = {}
  ): Promise<{
    imported: number;
    skipped: number;
    errors: Array<{ snapshotId: string; error: string }>;
  }> {
    let exportData: SnapshotExportData;

    // Parse input data
    if (Buffer.isBuffer(data)) {
      try {
        const decompressed = gunzipSync(data);
        exportData = JSON.parse(decompressed.toString());
      } catch (error) {
        throw new Error(`Failed to parse binary import data: ${error}`);
      }
    } else {
      exportData = data;
    }

    const results = {
      imported: 0,
      skipped: 0,
      errors: [] as Array<{ snapshotId: string; error: string }>
    };

    this.logger.info(`Importing ${exportData.snapshots.length} snapshots from export`);

    for (const snapshot of exportData.snapshots) {
      try {
        // Check if snapshot already exists
        const existing = await this.getSnapshot(snapshot.id);
        if (existing && !options.overwriteExisting) {
          results.skipped++;
          continue;
        }

        // Validate integrity if requested
        if (options.validateIntegrity && snapshot.state) {
          const calculatedChecksum = this.calculateChecksum(JSON.stringify(snapshot.state));
          if (calculatedChecksum !== snapshot.checksum) {
            results.errors.push({
              snapshotId: snapshot.id,
              error: `Checksum mismatch: expected ${snapshot.checksum}, got ${calculatedChecksum}`
            });
            continue;
          }
        }

        // Store the imported snapshot
        const stateData = JSON.stringify(snapshot.state || snapshot.incrementalData);
        const dataBuffer = snapshot.compressed ? gzipSync(Buffer.from(stateData)) : Buffer.from(stateData);
        
        await this.storeSnapshot(snapshot, dataBuffer);
        results.imported++;

      } catch (error) {
        results.errors.push({
          snapshotId: snapshot.id,
          error: String(error)
        });
      }
    }

    this.logger.info(`Import complete: ${results.imported} imported, ${results.skipped} skipped, ${results.errors.length} errors`);
    this.emit('snapshots_imported', results);

    return results;
  }

  /**
   * Delete a snapshot
   */
  async deleteSnapshot(snapshotId: string): Promise<boolean> {
    try {
      // Remove from memory
      for (const sessionSnapshots of this.memorySnapshots.values()) {
        if (sessionSnapshots.has(snapshotId)) {
          const snapshot = sessionSnapshots.get(snapshotId)!;
          sessionSnapshots.delete(snapshotId);
          
          // Update storage statistics
          this.stats.totalStorageSize -= snapshot.compressedSize || snapshot.size;
          
          this.logger.debug(`Deleted snapshot ${snapshotId} from memory`);
          break;
        }
      }

      // Remove from persistent storage
      await this.deleteSnapshotFromStorage(snapshotId);

      this.emit('snapshot_deleted', { snapshotId });
      return true;

    } catch (error) {
      this.logger.error(`Failed to delete snapshot ${snapshotId}:`, error);
      this.emit('error', { type: 'snapshot_deletion_failed', snapshotId, error });
      return false;
    }
  }

  /**
   * Get snapshots for a specific session
   */
  async getSessionSnapshots(sessionId: string): Promise<StateSnapshot[]> {
    const sessionSnapshots = this.memorySnapshots.get(sessionId);
    if (!sessionSnapshots) {
      return [];
    }

    return Array.from(sessionSnapshots.values()).sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get snapshot manager statistics
   */
  getStatistics(): {
    snapshots: {
      total: number;
      byType: Record<string, number>;
      bySession: Record<string, number>;
    };
    storage: {
      totalSize: number;
      compressionRatio: number;
      averageSnapshotSize: number;
    };
    performance: {
      snapshotsCreated: number;
      averageCreationTime: number;
      compressionRate: number;
    };
    config: SnapshotConfig;
  } {
    const snapshotsByType: Record<string, number> = {};
    const snapshotsBySession: Record<string, number> = {};
    let totalSnapshots = 0;

    for (const [sessionId, snapshots] of this.memorySnapshots) {
      snapshotsBySession[sessionId] = snapshots.size;
      totalSnapshots += snapshots.size;

      for (const snapshot of snapshots.values()) {
        snapshotsByType[snapshot.type] = (snapshotsByType[snapshot.type] || 0) + 1;
      }
    }

    return {
      snapshots: {
        total: totalSnapshots,
        byType: snapshotsByType,
        bySession: snapshotsBySession
      },
      storage: {
        totalSize: this.stats.totalStorageSize,
        compressionRatio: this.stats.compressionRatio,
        averageSnapshotSize: totalSnapshots > 0 ? this.stats.totalStorageSize / totalSnapshots : 0
      },
      performance: {
        snapshotsCreated: this.stats.snapshotsCreated,
        averageCreationTime: this.stats.averageCreationTime,
        compressionRate: this.stats.snapshotsCreated > 0 ? this.stats.snapshotsCompressed / this.stats.snapshotsCreated : 0
      },
      config: this.config
    };
  }

  /**
   * Cleanup resources and stop background tasks
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down SnapshotManager...');

    // Stop all automatic snapshot timers
    for (const [sessionId, timer] of this.automaticTimers) {
      clearInterval(timer);
      this.logger.debug(`Stopped automatic snapshots for session ${sessionId}`);
    }
    this.automaticTimers.clear();

    // Stop background cleanup
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    // Persist any remaining in-memory snapshots if needed
    if (this.config.persistenceEnabled && this.config.storageType !== 'memory') {
      await this.persistInMemorySnapshots();
    }

    this.emit('shutdown_complete');
    this.logger.info('SnapshotManager shutdown complete');
  }

  // Private methods

  private async createAutomaticSnapshot(sessionId: string): Promise<void> {
    // Get current system state - this would typically come from the system
    // For now, we'll create a minimal state or skip if no active state
    const currentState = await this.getCurrentSystemState(sessionId);
    if (!currentState) {
      this.logger.debug(`No active state found for session ${sessionId}, skipping automatic snapshot`);
      return;
    }

    await this.createSnapshot(sessionId, currentState, {
      type: 'full',
      tags: ['automatic']
    });
  }

  private async getCurrentSystemState(sessionId: string): Promise<SystemState | null> {
    // This would integrate with the actual system to get current state
    // For now, return a minimal state structure
    try {
      // Try to get recent traces and reconstruct state
      const recentTraces = await this.storage.getTracesBySession(sessionId, {
        limit: 100,
        timeRange: {
          start: Date.now() - 60000, // Last minute
          end: Date.now()
        }
      });

      if (recentTraces.length === 0) {
        return null;
      }

      // Create a minimal state from recent activity
      return {
        timestamp: Date.now(),
        agents: {},
        tasks: {},
        memory: {},
        communications: {},
        resources: {}
      };
    } catch (error) {
      this.logger.warn(`Failed to get current system state for session ${sessionId}:`, error);
      return null;
    }
  }

  private calculateStateSize(state: SystemState): number {
    return Buffer.byteLength(JSON.stringify(state), 'utf8');
  }

  private calculateChecksum(data: string): string {
    return createHash('sha256')
      .update(data)
      .digest('hex')
      .substring(0, 16);
  }

  private shouldCreateIncremental(delta: StateDelta, currentState: SystemState): boolean {
    const deltaSize = this.calculateDeltaSize(delta);
    const fullStateSize = this.calculateStateSize(currentState);
    
    // Create incremental if delta is less than 30% of full state
    return deltaSize < fullStateSize * 0.3;
  }

  private calculateDeltaSize(delta: StateDelta): number {
    return Buffer.byteLength(JSON.stringify(delta), 'utf8');
  }

  private computeStateDelta(oldState: SystemState, newState: SystemState): StateDelta {
    return {
      agents: this.computeAgentsDelta(oldState.agents || {}, newState.agents || {}),
      tasks: this.computeTasksDelta(oldState.tasks || {}, newState.tasks || {}),
      memory: this.computeMemoryDelta(oldState.memory || {}, newState.memory || {}),
      communications: this.computeCommunicationsDelta(oldState.communications || {}, newState.communications || {}),
      resources: this.computeResourcesDelta(oldState.resources || {}, newState.resources || {})
    };
  }

  private computeAgentsDelta(oldAgents: Record<string, AgentState>, newAgents: Record<string, AgentState>) {
    const delta = { added: {}, updated: {}, removed: [] as string[] };

    // Find added agents
    for (const [id, agent] of Object.entries(newAgents)) {
      if (!oldAgents[id]) {
        delta.added[id] = agent;
      }
    }

    // Find removed agents
    for (const id of Object.keys(oldAgents)) {
      if (!newAgents[id]) {
        delta.removed.push(id);
      }
    }

    // Find updated agents
    for (const [id, newAgent] of Object.entries(newAgents)) {
      const oldAgent = oldAgents[id];
      if (oldAgent && JSON.stringify(oldAgent) !== JSON.stringify(newAgent)) {
        // Find specific changes
        const updates: Partial<AgentState> = {};
        if (oldAgent.status !== newAgent.status) updates.status = newAgent.status;
        if (oldAgent.currentTask !== newAgent.currentTask) updates.currentTask = newAgent.currentTask;
        if (JSON.stringify(oldAgent.variables) !== JSON.stringify(newAgent.variables)) {
          updates.variables = newAgent.variables;
        }
        
        if (Object.keys(updates).length > 0) {
          delta.updated[id] = updates;
        }
      }
    }

    return delta;
  }

  private computeTasksDelta(oldTasks: Record<string, TaskState>, newTasks: Record<string, TaskState>) {
    const delta = { added: {}, updated: {}, removed: [] as string[] };

    // Find added tasks
    for (const [id, task] of Object.entries(newTasks)) {
      if (!oldTasks[id]) {
        delta.added[id] = task;
      }
    }

    // Find removed tasks
    for (const id of Object.keys(oldTasks)) {
      if (!newTasks[id]) {
        delta.removed.push(id);
      }
    }

    // Find updated tasks
    for (const [id, newTask] of Object.entries(newTasks)) {
      const oldTask = oldTasks[id];
      if (oldTask && JSON.stringify(oldTask) !== JSON.stringify(newTask)) {
        const updates: Partial<TaskState> = {};
        if (oldTask.status !== newTask.status) updates.status = newTask.status;
        if (oldTask.progress !== newTask.progress) updates.progress = newTask.progress;
        
        if (Object.keys(updates).length > 0) {
          delta.updated[id] = updates;
        }
      }
    }

    return delta;
  }

  private computeMemoryDelta(oldMemory: Record<string, MemoryEntry>, newMemory: Record<string, MemoryEntry>) {
    const delta = { added: {}, updated: {}, removed: [] as string[] };

    // Find added entries
    for (const [key, entry] of Object.entries(newMemory)) {
      if (!oldMemory[key]) {
        delta.added[key] = entry;
      }
    }

    // Find removed entries
    for (const key of Object.keys(oldMemory)) {
      if (!newMemory[key]) {
        delta.removed.push(key);
      }
    }

    // Find updated entries
    for (const [key, newEntry] of Object.entries(newMemory)) {
      const oldEntry = oldMemory[key];
      if (oldEntry && JSON.stringify(oldEntry) !== JSON.stringify(newEntry)) {
        delta.updated[key] = newEntry;
      }
    }

    return delta;
  }

  private computeCommunicationsDelta(oldComms: Record<string, any>, newComms: Record<string, any>) {
    const delta = { added: {}, removed: [] as string[] };

    // Find added communications
    for (const [key, entry] of Object.entries(newComms)) {
      if (!oldComms[key]) {
        delta.added[key] = entry;
      }
    }

    // Find removed communications (usually don't remove, just add)
    for (const key of Object.keys(oldComms)) {
      if (!newComms[key]) {
        delta.removed.push(key);
      }
    }

    return delta;
  }

  private computeResourcesDelta(oldResources: Record<string, any>, newResources: Record<string, any>) {
    const delta = { added: {}, updated: {}, removed: [] as string[] };

    // Find added resources
    for (const [id, resource] of Object.entries(newResources)) {
      if (!oldResources[id]) {
        delta.added[id] = resource;
      }
    }

    // Find removed resources
    for (const id of Object.keys(oldResources)) {
      if (!newResources[id]) {
        delta.removed.push(id);
      }
    }

    // Find updated resources
    for (const [id, newResource] of Object.entries(newResources)) {
      const oldResource = oldResources[id];
      if (oldResource && JSON.stringify(oldResource) !== JSON.stringify(newResource)) {
        delta.updated[id] = newResource;
      }
    }

    return delta;
  }

  private applyStateDelta(baseState: SystemState, delta: StateDelta): SystemState {
    const newState: SystemState = {
      ...baseState,
      agents: { ...baseState.agents },
      tasks: { ...baseState.tasks },
      memory: { ...baseState.memory },
      communications: { ...baseState.communications },
      resources: { ...baseState.resources }
    };

    // Apply agent changes
    Object.assign(newState.agents, delta.agents.added);
    for (const [id, updates] of Object.entries(delta.agents.updated)) {
      if (newState.agents[id]) {
        newState.agents[id] = { ...newState.agents[id], ...updates };
      }
    }
    for (const id of delta.agents.removed) {
      delete newState.agents[id];
    }

    // Apply task changes
    Object.assign(newState.tasks, delta.tasks.added);
    for (const [id, updates] of Object.entries(delta.tasks.updated)) {
      if (newState.tasks[id]) {
        newState.tasks[id] = { ...newState.tasks[id], ...updates };
      }
    }
    for (const id of delta.tasks.removed) {
      delete newState.tasks[id];
    }

    // Apply memory changes
    Object.assign(newState.memory, delta.memory.added);
    Object.assign(newState.memory, delta.memory.updated);
    for (const key of delta.memory.removed) {
      delete newState.memory[key];
    }

    // Apply communication changes
    Object.assign(newState.communications, delta.communications.added);
    for (const key of delta.communications.removed) {
      delete newState.communications[key];
    }

    // Apply resource changes
    Object.assign(newState.resources, delta.resources.added);
    Object.assign(newState.resources, delta.resources.updated);
    for (const id of delta.resources.removed) {
      delete newState.resources[id];
    }

    return newState;
  }

  private async storeSnapshot(snapshot: StateSnapshot, data: Buffer): Promise<void> {
    // Store in memory
    if (!this.memorySnapshots.has(snapshot.sessionId)) {
      this.memorySnapshots.set(snapshot.sessionId, new Map());
    }
    this.memorySnapshots.get(snapshot.sessionId)!.set(snapshot.id, snapshot);

    // Store persistently if enabled
    if (this.config.persistenceEnabled && this.config.storageType !== 'memory') {
      await this.persistSnapshotToStorage(snapshot, data);
    }
  }

  private async persistSnapshotToStorage(snapshot: StateSnapshot, data: Buffer): Promise<void> {
    // This would integrate with the storage system
    // For now, we'll use a simple approach through the trace storage
    try {
      // Store as a special trace event
      const snapshotEvent: TraceEvent = {
        id: snapshot.id,
        timestamp: snapshot.timestamp,
        sessionId: snapshot.sessionId,
        type: 'snapshot',
        phase: 'complete',
        data: {
          snapshotMetadata: {
            ...snapshot,
            state: undefined,
            incrementalData: undefined
          },
          snapshotData: data.toString('base64')
        },
        metadata: {
          tags: ['snapshot', ...snapshot.tags],
          source: 'SnapshotManager',
          severity: 'low' as const
        },
        performance: {
          duration: snapshot.creationDuration,
          size: snapshot.size,
          compressedSize: snapshot.compressedSize
        }
      };

      await this.storage.storeTrace(snapshotEvent);
    } catch (error) {
      this.logger.error(`Failed to persist snapshot ${snapshot.id}:`, error);
      throw error;
    }
  }

  private async loadSnapshotFromStorage(snapshotId: string): Promise<StateSnapshot | null> {
    try {
      const snapshotEvent = await this.storage.getTrace(snapshotId);
      if (!snapshotEvent || snapshotEvent.type !== 'snapshot') {
        return null;
      }

      const snapshotMetadata = snapshotEvent.data.snapshotMetadata;
      const snapshotDataBuffer = Buffer.from(snapshotEvent.data.snapshotData, 'base64');

      // Reconstruct the snapshot
      let stateData: string;
      if (snapshotMetadata.compressed) {
        stateData = gunzipSync(snapshotDataBuffer).toString();
      } else {
        stateData = snapshotDataBuffer.toString();
      }

      const parsedData = JSON.parse(stateData);

      return {
        ...snapshotMetadata,
        state: parsedData.state || parsedData,
        incrementalData: parsedData.baseSnapshotId ? {
          baseSnapshotId: parsedData.baseSnapshotId,
          changes: parsedData.changes || parsedData
        } : undefined
      };
    } catch (error) {
      this.logger.error(`Failed to load snapshot ${snapshotId} from storage:`, error);
      return null;
    }
  }

  private async deleteSnapshotFromStorage(snapshotId: string): Promise<void> {
    // This would integrate with the storage system to delete the snapshot
    // For now, we'll leave it as a placeholder
    this.logger.debug(`Would delete snapshot ${snapshotId} from persistent storage`);
  }

  private async findLatestSnapshot(sessionId: string, type?: string): Promise<StateSnapshot | null> {
    const sessionSnapshots = this.memorySnapshots.get(sessionId);
    if (!sessionSnapshots) {
      return null;
    }

    let latest: StateSnapshot | null = null;
    for (const snapshot of sessionSnapshots.values()) {
      if (type && snapshot.type !== type) continue;
      
      if (!latest || snapshot.timestamp > latest.timestamp) {
        latest = snapshot;
      }
    }

    return latest;
  }

  private async cleanupOldSnapshots(sessionId: string): Promise<void> {
    const sessionSnapshots = this.memorySnapshots.get(sessionId);
    if (!sessionSnapshots) return;

    const snapshots = Array.from(sessionSnapshots.values());
    const now = Date.now();

    // Remove expired snapshots
    for (const snapshot of snapshots) {
      if (snapshot.expiresAt && snapshot.expiresAt < now) {
        sessionSnapshots.delete(snapshot.id);
        this.stats.totalStorageSize -= snapshot.compressedSize || snapshot.size;
        this.logger.debug(`Removed expired snapshot ${snapshot.id}`);
      }
    }

    // Enforce max snapshots limit
    const remainingSnapshots = Array.from(sessionSnapshots.values())
      .sort((a, b) => b.timestamp - a.timestamp);

    if (remainingSnapshots.length > this.config.maxSnapshots) {
      const toRemove = remainingSnapshots.slice(this.config.maxSnapshots);
      for (const snapshot of toRemove) {
        // Don't remove tagged snapshots unless explicitly configured
        if (snapshot.tags.length > 0 && !this.config.taggedSnapshotsOnly) {
          continue;
        }
        
        sessionSnapshots.delete(snapshot.id);
        this.stats.totalStorageSize -= snapshot.compressedSize || snapshot.size;
        this.logger.debug(`Removed old snapshot ${snapshot.id} (limit exceeded)`);
      }
    }
  }

  private updateAverageCreationTime(newTime: number): void {
    if (this.stats.averageCreationTime === 0) {
      this.stats.averageCreationTime = newTime;
    } else {
      this.stats.averageCreationTime = (this.stats.averageCreationTime + newTime) / 2;
    }
  }

  private startBackgroundTasks(): void {
    // Cleanup old snapshots every 5 minutes
    this.cleanupTimer = setInterval(async () => {
      try {
        for (const sessionId of this.memorySnapshots.keys()) {
          await this.cleanupOldSnapshots(sessionId);
        }
      } catch (error) {
        this.logger.error('Background cleanup failed:', error);
      }
    }, 5 * 60 * 1000);

    this.logger.debug('Started background cleanup task');
  }

  private async persistInMemorySnapshots(): Promise<void> {
    let persistedCount = 0;
    
    for (const [sessionId, snapshots] of this.memorySnapshots) {
      for (const snapshot of snapshots.values()) {
        try {
          const stateData = JSON.stringify(snapshot.state || snapshot.incrementalData);
          const dataBuffer = snapshot.compressed ? 
            gzipSync(Buffer.from(stateData)) : 
            Buffer.from(stateData);
          
          await this.persistSnapshotToStorage(snapshot, dataBuffer);
          persistedCount++;
        } catch (error) {
          this.logger.error(`Failed to persist snapshot ${snapshot.id} during shutdown:`, error);
        }
      }
    }

    this.logger.info(`Persisted ${persistedCount} in-memory snapshots during shutdown`);
  }
}