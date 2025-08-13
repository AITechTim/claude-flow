/**
 * State reconstruction engine for time-travel debugging
 * Rebuilds system state at any point in time from trace events
 */

import { 
  TraceEvent, 
  SystemState, 
  AgentState, 
  TaskState, 
  MemoryEntry,
  CommunicationEntry,
  ResourceState,
  TimeRange 
} from '../types.js';
import { TraceStorage } from '../storage/trace-storage.js';
import { Logger } from '../../core/logger.js';
import { generateId } from '../../utils/helpers.js';

export interface SnapshotConfig {
  interval: number; // milliseconds between snapshots
  maxSnapshots: number;
  compressionEnabled: boolean;
  persistenceEnabled: boolean;
}

export interface StateSnapshot {
  id: string;
  sessionId: string;
  timestamp: number;
  state: SystemState;
  checksum: string;
  compressed: boolean;
}

export class StateReconstructor {
  private storage: TraceStorage;
  private logger: Logger;
  private snapshotManager: SnapshotManager;
  private stateCache = new Map<string, SystemState>();
  private config: SnapshotConfig;

  constructor(
    storage: TraceStorage, 
    config: SnapshotConfig = {
      interval: 60000, // 1 minute
      maxSnapshots: 100,
      compressionEnabled: true,
      persistenceEnabled: true
    }
  ) {
    this.storage = storage;
    this.logger = new Logger('StateReconstructor');
    this.config = config;
    this.snapshotManager = new SnapshotManager(storage, config);
  }

  /**
   * Reconstruct system state at a specific timestamp
   */
  async reconstructState(sessionId: string, timestamp: number): Promise<SystemState> {
    const cacheKey = `${sessionId}:${timestamp}`;
    
    // Check cache first
    if (this.stateCache.has(cacheKey)) {
      return this.stateCache.get(cacheKey)!;
    }

    this.logger.debug(`Reconstructing state for session ${sessionId} at ${timestamp}`);
    
    // Find nearest snapshot before timestamp
    const snapshot = await this.snapshotManager.findNearestSnapshot(sessionId, timestamp);
    
    let baseState: SystemState;
    let fromTime: number;
    
    if (snapshot && snapshot.timestamp <= timestamp) {
      baseState = { ...snapshot.state };
      fromTime = snapshot.timestamp;
      this.logger.debug(`Using snapshot from ${new Date(fromTime).toISOString()}`);
    } else {
      baseState = this.createEmptyState(sessionId, timestamp);
      fromTime = 0;
      this.logger.debug('No suitable snapshot found, reconstructing from start');
    }
    
    // Get all events between snapshot and target time
    const events = await this.storage.getTracesBySession(sessionId, {
      timeRange: { start: fromTime, end: timestamp }
    });
    
    this.logger.debug(`Applying ${events.length} events to reconstruct state`);
    
    // Apply events to reconstruct state
    const reconstructedState = await this.applyEvents(baseState, events);
    
    // Cache the result
    this.stateCache.set(cacheKey, reconstructedState);
    
    // Create snapshot if enough time has passed
    if (!snapshot || (timestamp - fromTime) > this.config.interval) {
      await this.snapshotManager.createSnapshot(sessionId, timestamp, reconstructedState);
    }
    
    return reconstructedState;
  }

  /**
   * Get the diff between two states
   */
  async getStateDiff(
    sessionId: string, 
    fromTimestamp: number, 
    toTimestamp: number
  ): Promise<StateDiff> {
    const fromState = await this.reconstructState(sessionId, fromTimestamp);
    const toState = await this.reconstructState(sessionId, toTimestamp);
    
    return this.computeStateDiff(fromState, toState);
  }

  /**
   * Replay events with state tracking
   */
  async replayEvents(
    sessionId: string, 
    timeRange: TimeRange,
    callback: (state: SystemState, event: TraceEvent) => void
  ): Promise<void> {
    const events = await this.storage.getTracesBySession(sessionId, { timeRange });
    const initialState = await this.reconstructState(sessionId, timeRange.start);
    
    let currentState = { ...initialState };
    
    for (const event of events) {
      currentState = await this.applyEvent(currentState, event);
      callback(currentState, event);
    }
  }

  /**
   * Find when a specific condition was first met
   */
  async findConditionOrigin(
    sessionId: string,
    condition: (state: SystemState) => boolean,
    maxTimestamp: number
  ): Promise<{ timestamp: number; event: TraceEvent } | null> {
    const events = await this.storage.getTracesBySession(sessionId, {
      timeRange: { start: 0, end: maxTimestamp }
    });
    
    let currentState = this.createEmptyState(sessionId, 0);
    
    for (const event of events) {
      const previousState = { ...currentState };
      currentState = await this.applyEvent(currentState, event);
      
      // Check if condition became true with this event
      if (!condition(previousState) && condition(currentState)) {
        return { timestamp: event.timestamp, event };
      }
    }
    
    return null;
  }

  /**
   * Get critical path analysis
   */
  async getCriticalPath(sessionId: string, endTimestamp: number): Promise<CriticalPath> {
    const finalState = await this.reconstructState(sessionId, endTimestamp);
    const events = await this.storage.getTracesBySession(sessionId, {
      timeRange: { start: 0, end: endTimestamp }
    });
    
    // Build dependency graph
    const dependencies = this.buildDependencyGraph(events);
    
    // Find critical path (longest path through dependencies)
    const criticalPath = this.findLongestPath(dependencies, events);
    
    return {
      events: criticalPath,
      totalDuration: criticalPath.reduce((sum, event) => sum + event.performance.duration, 0),
      bottlenecks: this.identifyBottlenecks(criticalPath),
      parallelizationOpportunities: this.findParallelizationOpportunities(dependencies, criticalPath)
    };
  }

  // Private methods

  private async applyEvents(state: SystemState, events: TraceEvent[]): Promise<SystemState> {
    let currentState = { ...state };
    
    for (const event of events.sort((a, b) => a.timestamp - b.timestamp)) {
      currentState = await this.applyEvent(currentState, event);
    }
    
    return currentState;
  }

  private async applyEvent(state: SystemState, event: TraceEvent): Promise<SystemState> {
    const newState = { ...state };
    
    switch (event.type) {
      case 'agent_method':
        this.applyAgentMethod(newState, event);
        break;
        
      case 'communication':
        this.applyCommunication(newState, event);
        break;
        
      case 'task_execution':
        this.applyTaskExecution(newState, event);
        break;
        
      case 'memory_access':
        this.applyMemoryAccess(newState, event);
        break;
        
      case 'coordination':
        this.applyCoordination(newState, event);
        break;
        
      case 'error':
        this.applyError(newState, event);
        break;
        
      case 'performance':
        this.applyPerformance(newState, event);
        break;
        
      case 'decision_point':
        this.applyDecisionPoint(newState, event);
        break;
    }
    
    // Update timestamp
    newState.timestamp = event.timestamp;
    
    return newState;
  }

  private applyAgentMethod(state: SystemState, event: TraceEvent): void {
    const agentId = event.agentId;
    
    if (!state.agents[agentId]) {
      state.agents[agentId] = this.createEmptyAgentState(agentId, event.timestamp);
    }
    
    const agent = state.agents[agentId];
    
    switch (event.phase) {
      case 'start':
        if (event.data.method === 'spawn') {
          agent.status = 'spawning';
        } else {
          agent.status = 'busy';
        }
        break;
        
      case 'complete':
        agent.status = 'idle';
        agent.lastActivity = event.timestamp;
        if (event.data.result) {
          agent.variables.lastResult = event.data.result;
        }
        break;
        
      case 'error':
        agent.status = 'error';
        agent.variables.lastError = event.data.error;
        break;
    }
    
    // Update performance metrics
    if (event.performance) {
      agent.performance = { ...event.performance };
    }
  }

  private applyCommunication(state: SystemState, event: TraceEvent): void {
    const message = event.data.message;
    if (!message) return;
    
    const senderId = message.from;
    const receiverIds = Array.isArray(message.to) ? message.to : [message.to];
    
    // Add to sender's outbound communications
    if (!state.communications[senderId]) {
      state.communications[senderId] = [];
    }
    
    state.communications[senderId].push({
      message: message.content,
      timestamp: event.timestamp,
      direction: 'outbound',
      target: receiverIds.join(',')
    });
    
    // Add to receivers' inbound communications
    for (const receiverId of receiverIds) {
      if (!state.communications[receiverId]) {
        state.communications[receiverId] = [];
      }
      
      state.communications[receiverId].push({
        message: message.content,
        timestamp: event.timestamp,
        direction: 'inbound',
        source: senderId
      });
    }
  }

  private applyTaskExecution(state: SystemState, event: TraceEvent): void {
    const task = event.data.task;
    if (!task) return;
    
    const taskId = task.taskId;
    
    if (!state.tasks[taskId]) {
      state.tasks[taskId] = {
        id: taskId,
        agentId: event.agentId,
        type: task.type,
        status: 'pending',
        progress: 0,
        startedAt: event.timestamp
      };
    }
    
    const taskState = state.tasks[taskId];
    
    switch (event.phase) {
      case 'start':
        taskState.status = 'running';
        taskState.startedAt = event.timestamp;
        break;
        
      case 'progress':
        if (task.progress !== undefined) {
          taskState.progress = task.progress;
        }
        break;
        
      case 'complete':
        taskState.status = 'completed';
        taskState.completedAt = event.timestamp;
        taskState.progress = 100;
        if (task.result) {
          taskState.result = task.result;
        }
        break;
        
      case 'error':
        taskState.status = 'failed';
        taskState.completedAt = event.timestamp;
        if (task.error) {
          taskState.error = task.error;
        }
        break;
    }
    
    // Update agent's current task
    if (state.agents[event.agentId]) {
      if (taskState.status === 'running') {
        state.agents[event.agentId].currentTask = taskId;
      } else if (taskState.status === 'completed' || taskState.status === 'failed') {
        state.agents[event.agentId].currentTask = undefined;
      }
    }
  }

  private applyMemoryAccess(state: SystemState, event: TraceEvent): void {
    const memoryOp = event.data.memoryAccess;
    if (!memoryOp) return;
    
    const key = `${memoryOp.namespace}:${memoryOp.key}`;
    
    switch (memoryOp.type) {
      case 'write':
        state.memory[key] = {
          value: memoryOp.value,
          timestamp: event.timestamp,
          agentId: event.agentId,
          type: typeof memoryOp.value
        };
        break;
        
      case 'delete':
        delete state.memory[key];
        break;
        
      case 'read':
        // Reading doesn't change state, but we could track access patterns
        break;
    }
  }

  private applyCoordination(state: SystemState, event: TraceEvent): void {
    const coordination = event.data.coordination;
    if (!coordination) return;
    
    switch (coordination.type) {
      case 'task_assignment':
        // Update resource allocation
        const resourceId = `task_assignment_${coordination.details.taskId}`;
        state.resources[resourceId] = {
          id: resourceId,
          type: 'task_assignment',
          status: 'active',
          allocation: {
            agentId: event.agentId,
            taskId: coordination.details.taskId
          },
          usage: {},
          timestamp: event.timestamp
        };
        break;
        
      case 'resource_allocation':
        // Update resource states
        for (const [resourceId, allocation] of Object.entries(coordination.details)) {
          state.resources[resourceId] = {
            id: resourceId,
            type: 'resource',
            status: 'allocated',
            allocation: allocation as any,
            usage: {},
            timestamp: event.timestamp
          };
        }
        break;
        
      case 'synchronization':
        // Update agent synchronization states
        for (const participantId of coordination.participants) {
          if (state.agents[participantId]) {
            state.agents[participantId].context.syncPoint = event.timestamp;
          }
        }
        break;
    }
  }

  private applyError(state: SystemState, event: TraceEvent): void {
    const agentId = event.agentId;
    
    if (state.agents[agentId]) {
      state.agents[agentId].status = 'error';
      state.agents[agentId].variables.lastError = event.data.error;
      state.agents[agentId].lastActivity = event.timestamp;
    }
  }

  private applyPerformance(state: SystemState, event: TraceEvent): void {
    const agentId = event.agentId;
    
    if (state.agents[agentId] && event.performance) {
      state.agents[agentId].performance = { ...event.performance };
    }
  }

  private applyDecisionPoint(state: SystemState, event: TraceEvent): void {
    const decision = event.data.decision;
    if (!decision) return;
    
    const agentId = event.agentId;
    
    if (state.agents[agentId]) {
      state.agents[agentId].context.lastDecision = {
        context: decision.context,
        selected: decision.selected,
        reasoning: decision.reasoning,
        timestamp: event.timestamp
      };
    }
  }

  private createEmptyState(sessionId: string, timestamp: number): SystemState {
    return {
      timestamp,
      agents: {},
      tasks: {},
      memory: {},
      communications: {},
      resources: {}
    };
  }

  private createEmptyAgentState(agentId: string, timestamp: number): AgentState {
    return {
      id: agentId,
      status: 'idle',
      variables: {},
      context: {},
      performance: {
        duration: 0,
        memoryUsage: 0,
        cpuTime: 0
      },
      createdAt: timestamp,
      lastActivity: timestamp
    };
  }

  private computeStateDiff(fromState: SystemState, toState: SystemState): StateDiff {
    return {
      agentChanges: this.diffAgents(fromState.agents, toState.agents),
      taskChanges: this.diffTasks(fromState.tasks, toState.tasks),
      memoryChanges: this.diffMemory(fromState.memory, toState.memory),
      resourceChanges: this.diffResources(fromState.resources, toState.resources)
    };
  }

  private diffAgents(from: Record<string, AgentState>, to: Record<string, AgentState>): any {
    const changes: any = { added: [], removed: [], modified: [] };
    
    // Find added agents
    for (const [id, agent] of Object.entries(to)) {
      if (!from[id]) {
        changes.added.push(agent);
      }
    }
    
    // Find removed agents
    for (const [id, agent] of Object.entries(from)) {
      if (!to[id]) {
        changes.removed.push(agent);
      }
    }
    
    // Find modified agents
    for (const [id, agent] of Object.entries(to)) {
      if (from[id] && JSON.stringify(from[id]) !== JSON.stringify(agent)) {
        changes.modified.push({
          id,
          from: from[id],
          to: agent
        });
      }
    }
    
    return changes;
  }

  private diffTasks(from: Record<string, TaskState>, to: Record<string, TaskState>): any {
    // Similar to diffAgents but for tasks
    return { added: [], removed: [], modified: [] };
  }

  private diffMemory(from: Record<string, MemoryEntry>, to: Record<string, MemoryEntry>): any {
    // Similar to diffAgents but for memory entries
    return { added: [], removed: [], modified: [] };
  }

  private diffResources(from: Record<string, ResourceState>, to: Record<string, ResourceState>): any {
    // Similar to diffAgents but for resources
    return { added: [], removed: [], modified: [] };
  }

  private buildDependencyGraph(events: TraceEvent[]): Map<string, string[]> {
    const dependencies = new Map<string, string[]>();
    
    for (const event of events) {
      if (event.metadata.parentId) {
        if (!dependencies.has(event.metadata.parentId)) {
          dependencies.set(event.metadata.parentId, []);
        }
        dependencies.get(event.metadata.parentId)!.push(event.id);
      }
    }
    
    return dependencies;
  }

  private findLongestPath(dependencies: Map<string, string[]>, events: TraceEvent[]): TraceEvent[] {
    // Implementation of critical path finding algorithm
    // This is a simplified version - real implementation would use topological sort
    return events.slice(0, 10); // Placeholder
  }

  private identifyBottlenecks(path: TraceEvent[]): Bottleneck[] {
    return path
      .filter(event => event.performance.duration > 1000) // > 1 second
      .map(event => ({
        eventId: event.id,
        duration: event.performance.duration,
        type: 'duration',
        severity: event.performance.duration > 5000 ? 'high' : 'medium'
      }));
  }

  private findParallelizationOpportunities(
    dependencies: Map<string, string[]>, 
    criticalPath: TraceEvent[]
  ): ParallelizationOpportunity[] {
    // Find events that could be run in parallel
    return []; // Placeholder
  }
}

/**
 * Snapshot manager for efficient state reconstruction
 */
class SnapshotManager {
  private storage: TraceStorage;
  private config: SnapshotConfig;
  private snapshots = new Map<string, StateSnapshot[]>();

  constructor(storage: TraceStorage, config: SnapshotConfig) {
    this.storage = storage;
    this.config = config;
  }

  async createSnapshot(
    sessionId: string, 
    timestamp: number, 
    state: SystemState
  ): Promise<string> {
    const snapshotId = generateId('snapshot');
    
    const snapshot: StateSnapshot = {
      id: snapshotId,
      sessionId,
      timestamp,
      state: { ...state },
      checksum: this.calculateChecksum(state),
      compressed: this.config.compressionEnabled
    };
    
    // Add to memory cache
    if (!this.snapshots.has(sessionId)) {
      this.snapshots.set(sessionId, []);
    }
    
    const sessionSnapshots = this.snapshots.get(sessionId)!;
    sessionSnapshots.push(snapshot);
    
    // Keep only the most recent snapshots
    if (sessionSnapshots.length > this.config.maxSnapshots) {
      sessionSnapshots.shift();
    }
    
    // Persist if enabled
    if (this.config.persistenceEnabled) {
      await this.persistSnapshot(snapshot);
    }
    
    return snapshotId;
  }

  async findNearestSnapshot(
    sessionId: string, 
    timestamp: number
  ): Promise<StateSnapshot | null> {
    const sessionSnapshots = this.snapshots.get(sessionId) || [];
    
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

  private calculateChecksum(state: SystemState): string {
    const { createHash } = require('crypto');
    return createHash('sha256')
      .update(JSON.stringify(state))
      .digest('hex')
      .substring(0, 16);
  }

  private async persistSnapshot(snapshot: StateSnapshot): Promise<void> {
    // Store snapshot in database or file system
    // Implementation depends on storage backend
  }
}

// Type definitions
interface StateDiff {
  agentChanges: any;
  taskChanges: any;
  memoryChanges: any;
  resourceChanges: any;
}

interface CriticalPath {
  events: TraceEvent[];
  totalDuration: number;
  bottlenecks: Bottleneck[];
  parallelizationOpportunities: ParallelizationOpportunity[];
}

interface Bottleneck {
  eventId: string;
  duration: number;
  type: 'duration' | 'memory' | 'cpu';
  severity: 'low' | 'medium' | 'high';
}

interface ParallelizationOpportunity {
  events: string[];
  potentialSpeedup: number;
  constraints: string[];
}