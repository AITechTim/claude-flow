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
import { SnapshotManager, SnapshotConfig, StateSnapshot } from './snapshot-manager.js';

export class StateReconstructor {
  private storage: TraceStorage;
  private logger: Logger;
  private snapshotManager: SnapshotManager;
  private stateCache = new Map<string, SystemState>();

  constructor(
    storage: TraceStorage, 
    snapshotConfig: Partial<SnapshotConfig> = {}
  ) {
    this.storage = storage;
    this.logger = new Logger('StateReconstructor');
    this.snapshotManager = new SnapshotManager(storage, snapshotConfig);
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
      baseState = await this.snapshotManager.reconstructState(snapshot);
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
    const snapshotInterval = 60000; // 1 minute default
    if (!snapshot || (timestamp - fromTime) > snapshotInterval) {
      await this.snapshotManager.createSnapshot(sessionId, reconstructedState, {
        type: 'full',
        tags: ['auto-generated']
      });
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
    if (!agentId) return;
    
    if (!state.agents[agentId]) {
      state.agents[agentId] = this.createEmptyAgentState(agentId, event.timestamp);
    }
    
    const agent = state.agents[agentId];
    
    switch (event.phase) {
      case 'start':
        if (event.data.method === 'spawn') {
          agent.status = 'busy'; // spawning -> busy
        } else {
          agent.status = 'busy';
        }
        break;
        
      case 'complete':
        agent.status = 'idle';
        if (event.data.result) {
          agent.memory.lastResult = event.data.result;
        }
        break;
        
      case 'error':
        agent.status = 'error';
        agent.memory.lastError = event.data.error;
        break;
    }
    
    // Update resource usage if available
    if (event.performance) {
      if (event.performance.memoryUsage !== undefined) {
        agent.resources.memory = event.performance.memoryUsage;
      }
      if (event.performance.cpuTime !== undefined) {
        agent.resources.cpu = event.performance.cpuTime;
      }
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
    if (event.agentId && state.agents[event.agentId]) {
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
          agentId: event.agentId || 'system',
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
            state.agents[participantId].memory.syncPoint = event.timestamp;
          }
        }
        break;
    }
  }

  private applyError(state: SystemState, event: TraceEvent): void {
    const agentId = event.agentId;
    
    if (agentId && state.agents[agentId]) {
      state.agents[agentId].status = 'error';
      state.agents[agentId].memory.lastError = event.data.error;
    }
  }

  private applyPerformance(state: SystemState, event: TraceEvent): void {
    const agentId = event.agentId;
    
    if (agentId && state.agents[agentId] && event.performance) {
      // Update resource usage based on performance data
      if (event.performance.memoryUsage !== undefined) {
        state.agents[agentId].resources.memory = event.performance.memoryUsage;
      }
      if (event.performance.cpuTime !== undefined) {
        state.agents[agentId].resources.cpu = event.performance.cpuTime;
      }
    }
  }

  private applyDecisionPoint(state: SystemState, event: TraceEvent): void {
    const decision = event.data.decision;
    if (!decision) return;
    
    const agentId = event.agentId;
    
    if (agentId && state.agents[agentId]) {
      state.agents[agentId].memory.lastDecision = {
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
      status: 'idle',
      currentTask: undefined,
      capabilities: [],
      resources: {
        cpu: 0,
        memory: 0,
        disk: 0,
        network: 0
      },
      memory: {}
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
    const changes: any = { added: [], removed: [], modified: [] };
    
    // Find added tasks
    for (const [id, task] of Object.entries(to)) {
      if (!from[id]) {
        changes.added.push(task);
      }
    }
    
    // Find removed tasks
    for (const [id, task] of Object.entries(from)) {
      if (!to[id]) {
        changes.removed.push(task);
      }
    }
    
    // Find modified tasks
    for (const [id, task] of Object.entries(to)) {
      if (from[id] && JSON.stringify(from[id]) !== JSON.stringify(task)) {
        changes.modified.push({
          id,
          from: from[id],
          to: task
        });
      }
    }
    
    return changes;
  }

  private diffMemory(from: Record<string, MemoryEntry>, to: Record<string, MemoryEntry>): any {
    const changes: any = { added: [], removed: [], modified: [] };
    
    // Find added memory entries
    for (const [key, entry] of Object.entries(to)) {
      if (!from[key]) {
        changes.added.push({ key, entry });
      }
    }
    
    // Find removed memory entries
    for (const [key, entry] of Object.entries(from)) {
      if (!to[key]) {
        changes.removed.push({ key, entry });
      }
    }
    
    // Find modified memory entries
    for (const [key, entry] of Object.entries(to)) {
      if (from[key] && JSON.stringify(from[key]) !== JSON.stringify(entry)) {
        changes.modified.push({
          key,
          from: from[key],
          to: entry
        });
      }
    }
    
    return changes;
  }

  private diffResources(from: Record<string, ResourceState>, to: Record<string, ResourceState>): any {
    const changes: any = { added: [], removed: [], modified: [] };
    
    // Find added resources
    for (const [id, resource] of Object.entries(to)) {
      if (!from[id]) {
        changes.added.push(resource);
      }
    }
    
    // Find removed resources
    for (const [id, resource] of Object.entries(from)) {
      if (!to[id]) {
        changes.removed.push(resource);
      }
    }
    
    // Find modified resources
    for (const [id, resource] of Object.entries(to)) {
      if (from[id] && JSON.stringify(from[id]) !== JSON.stringify(resource)) {
        changes.modified.push({
          id,
          from: from[id],
          to: resource
        });
      }
    }
    
    return changes;
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
    const eventMap = new Map<string, TraceEvent>();
    const duration = new Map<string, number>();
    const path = new Map<string, TraceEvent[]>();
    
    // Build event map and initialize durations
    for (const event of events) {
      eventMap.set(event.id, event);
      duration.set(event.id, event.performance?.duration || 0);
      path.set(event.id, [event]);
    }
    
    // Topological sort with longest path calculation
    const visited = new Set<string>();
    const visiting = new Set<string>();
    
    const visit = (eventId: string): number => {
      if (visiting.has(eventId)) {
        // Cycle detected - skip
        return duration.get(eventId) || 0;
      }
      
      if (visited.has(eventId)) {
        return duration.get(eventId) || 0;
      }
      
      visiting.add(eventId);
      
      const deps = dependencies.get(eventId) || [];
      let maxDepDuration = 0;
      let longestDepPath: TraceEvent[] = [];
      
      for (const depId of deps) {
        const depDuration = visit(depId);
        if (depDuration > maxDepDuration) {
          maxDepDuration = depDuration;
          longestDepPath = path.get(depId) || [];
        }
      }
      
      const event = eventMap.get(eventId);
      const eventDuration = event?.performance?.duration || 0;
      const totalDuration = maxDepDuration + eventDuration;
      
      duration.set(eventId, totalDuration);
      path.set(eventId, [...longestDepPath, event!]);
      
      visiting.delete(eventId);
      visited.add(eventId);
      
      return totalDuration;
    };
    
    // Find the event with the longest path
    let longestPath: TraceEvent[] = [];
    let maxDuration = 0;
    
    for (const eventId of eventMap.keys()) {
      if (!visited.has(eventId)) {
        const totalDuration = visit(eventId);
        if (totalDuration > maxDuration) {
          maxDuration = totalDuration;
          longestPath = path.get(eventId) || [];
        }
      }
    }
    
    return longestPath;
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
    const opportunities: ParallelizationOpportunity[] = [];
    const criticalEventIds = new Set(criticalPath.map(e => e.id));
    
    // Group events by timestamp to find potential parallel execution
    const timeGroups = new Map<number, TraceEvent[]>();
    
    for (const event of criticalPath) {
      const timeSlot = Math.floor(event.timestamp / 1000) * 1000; // Group by second
      if (!timeGroups.has(timeSlot)) {
        timeGroups.set(timeSlot, []);
      }
      timeGroups.get(timeSlot)!.push(event);
    }
    
    // Find groups with multiple events that don't depend on each other
    for (const [timeSlot, events] of timeGroups) {
      if (events.length > 1) {
        const independentEvents: TraceEvent[] = [];
        const eventIds = events.map(e => e.id);
        
        // Check if events are independent
        for (let i = 0; i < events.length; i++) {
          const event = events[i];
          const deps = dependencies.get(event.id) || [];
          const hasInternalDependency = deps.some(depId => eventIds.includes(depId));
          
          if (!hasInternalDependency) {
            independentEvents.push(event);
          }
        }
        
        if (independentEvents.length > 1) {
          const totalDuration = independentEvents.reduce((sum, e) => 
            sum + (e.performance?.duration || 0), 0
          );
          const maxDuration = Math.max(...independentEvents.map(e => 
            e.performance?.duration || 0
          ));
          const potentialSpeedup = totalDuration / maxDuration;
          
          opportunities.push({
            events: independentEvents.map(e => e.id),
            potentialSpeedup,
            constraints: [
              'Requires parallel execution capability',
              'May increase resource usage',
              'Needs coordination between parallel tasks'
            ]
          });
        }
      }
    }
    
    return opportunities;
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