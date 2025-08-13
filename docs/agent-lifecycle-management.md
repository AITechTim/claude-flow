# Agent Lifecycle Management in Claude-Flow

## Overview

Claude-Flow's AgentManager component provides comprehensive agent lifecycle management with sophisticated process spawning, health monitoring, and auto-scaling capabilities. This system manages the complete lifecycle of agents from creation to termination, ensuring robust and scalable distributed operations.

## Agent Lifecycle States and Transitions

### Core States

The agent lifecycle is managed through eight distinct states:

```typescript
export type AgentStatus =
  | 'initializing' // Agent is starting up
  | 'idle'        // Available for tasks
  | 'busy'        // Currently executing task
  | 'paused'      // Temporarily unavailable
  | 'error'       // In error state
  | 'offline'     // Not available
  | 'terminating' // Shutting down
  | 'terminated'; // Shut down
```

### State Transition Flow

1. **Creation → Initializing**: Agent created from template but not yet started
2. **Initializing → Idle**: Process spawned successfully and ready signal received
3. **Idle → Busy**: Task assigned to agent
4. **Busy → Idle**: Task completed successfully
5. **Any State → Error**: Failure detected (heartbeat timeout, process crash, etc.)
6. **Error → Idle**: Auto-recovery successful
7. **Any State → Terminating**: Shutdown requested
8. **Terminating → Terminated**: Process gracefully stopped

### Practical State Transition Example

```typescript
// Agent creation process
const agentId = await agentManager.createAgent('researcher', {
  name: 'Research-Agent-001'
});
// State: 'initializing'

await agentManager.startAgent(agentId);
// Process spawned, waiting for ready signal
// State: 'initializing' → 'idle'

// Task assignment triggers state change
eventBus.emit('task:assigned', { agentId });
// State: 'idle' → 'busy'

// Heartbeat timeout detection
if (timeSinceHeartbeat > heartbeatInterval * 3) {
  agent.status = 'error';
  // State: 'busy' → 'error'
  
  if (autoRestart) {
    await agentManager.restartAgent(agentId, 'heartbeat_timeout');
    // State: 'error' → 'terminating' → 'terminated' → 'initializing' → 'idle'
  }
}
```

## Template-Based Agent Creation Pattern

### Agent Templates Structure

Agent templates define the blueprint for creating specialized agents:

```typescript
export interface AgentTemplate {
  name: string;
  type: AgentType;
  capabilities: AgentCapabilities;
  config: Partial<AgentConfig>;
  environment: Partial<AgentEnvironment>;
  startupScript?: string;
  dependencies?: string[];
}
```

### Built-in Templates

The system includes pre-configured templates for common agent types:

- **Researcher**: Web search, document analysis, data extraction
- **Developer**: Code generation, testing, debugging, Git operations
- **Analyzer**: Data analysis, statistics, visualization
- **Tester**: Test automation, coverage analysis, quality assurance
- **Reviewer**: Code review, security scanning, quality checks

### Template Implementation Example

```typescript
// Researcher agent template configuration
this.templates.set('researcher', {
  name: 'Research Agent',
  type: 'researcher',
  capabilities: {
    codeGeneration: false,
    research: true,
    analysis: true,
    webSearch: true,
    maxConcurrentTasks: 5,
    maxMemoryUsage: 256 * 1024 * 1024,
    reliability: 0.9,
    speed: 0.8,
    quality: 0.9,
  },
  config: {
    autonomyLevel: 0.8,
    heartbeatInterval: 10000,
    permissions: ['web-access', 'file-read'],
    expertise: { research: 0.9, analysis: 0.8 }
  },
  environment: {
    runtime: 'deno',
    workingDirectory: './agents/researcher',
    availableTools: ['web-search', 'document-reader']
  },
  startupScript: './scripts/start-researcher.ts'
});
```

## Process Spawning and Management

### Process Spawning Implementation

The `spawnAgentProcess` method creates child processes for agents:

```typescript
private async spawnAgentProcess(agent: AgentState): Promise<ChildProcess> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AGENT_ID: agent.id.id,
    AGENT_TYPE: agent.type,
    AGENT_NAME: agent.name,
    WORKING_DIR: agent.environment.workingDirectory,
    LOG_DIR: agent.environment.logDirectory,
  };

  const args = [
    'run',
    '--allow-all',
    agent.environment.availableTools[0] || './agents/generic-agent.ts',
    '--config',
    JSON.stringify(agent.config),
  ];

  const childProcess = spawn(agent.environment.runtime, args, {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: agent.environment.workingDirectory,
  });

  // Handle process events
  childProcess.on('exit', (code: number | null) => {
    this.handleProcessExit(agent.id.id, code);
  });

  childProcess.on('error', (error: Error) => {
    this.handleProcessError(agent.id.id, error);
  });

  return childProcess;
}
```

### Process Ready Detection

The system waits for agents to signal readiness before marking them as available:

```typescript
private async waitForAgentReady(agentId: string, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Agent ${agentId} startup timeout`));
    }, timeout);

    const handler = (data: unknown) => {
      const readyData = data as { agentId: string };
      if (readyData.agentId === agentId) {
        clearTimeout(timer);
        this.eventBus.off('agent:ready', handler);
        resolve();
      }
    };

    this.eventBus.on('agent:ready', handler);
  });
}
```

### Process Exit Handling

When processes exit, the system handles cleanup and potential auto-restart:

```typescript
private handleProcessExit(agentId: string, code: number | null): void {
  const agent = this.agents.get(agentId);
  if (!agent) return;

  this.logger.info('Agent process exited', { agentId, exitCode: code });

  if (code !== 0 && code !== null) {
    this.addAgentError(agentId, {
      timestamp: new Date(),
      type: 'process_exit',
      message: `Agent process exited with code ${code}`,
      context: { exitCode: code },
      severity: 'high',
      resolved: false,
    });
  }

  agent.status = 'offline';
  this.emit('agent:process-exit', { agentId, exitCode: code });
}
```

## Resource Monitoring and Limits

### Resource Configuration

Each agent template defines resource limits:

```typescript
resourceLimits: {
  memory: 512 * 1024 * 1024, // 512MB
  cpu: 1.0,                  // 1 CPU core
  disk: 1024 * 1024 * 1024,  // 1GB
}
```

### Resource Tracking

The system continuously monitors resource usage:

```typescript
private updateResourceUsage(
  agentId: string,
  usage: { cpu: number; memory: number; disk: number }
): void {
  this.resourceUsage.set(agentId, usage);
}

private calculateResourceScore(agentId: string): number {
  const usage = this.resourceUsage.get(agentId);
  if (!usage) return 1.0;

  const limits = this.config.resourceLimits;
  const memoryScore = 1 - usage.memory / limits.memory;
  const cpuScore = 1 - usage.cpu / limits.cpu;
  const diskScore = 1 - usage.disk / limits.disk;

  return Math.max(0, (memoryScore + cpuScore + diskScore) / 3);
}
```

## Health Check Implementation Details

### Multi-Component Health Assessment

The health check system evaluates four key components:

1. **Responsiveness**: Based on heartbeat timing
2. **Performance**: Task completion metrics
3. **Reliability**: Success/failure ratio
4. **Resource Usage**: Memory, CPU, disk utilization

```typescript
private async checkAgentHealth(agentId: string): Promise<void> {
  const agent = this.agents.get(agentId);
  const health = this.healthChecks.get(agentId);
  if (!agent || !health) return;

  try {
    // Check responsiveness (heartbeat-based)
    const responsiveness = await this.checkResponsiveness(agentId);
    health.components.responsiveness = responsiveness;

    // Check performance (execution time analysis)
    const performance = this.calculatePerformanceScore(agentId);
    health.components.performance = performance;

    // Check reliability (success rate)
    const reliability = this.calculateReliabilityScore(agentId);
    health.components.reliability = reliability;

    // Check resource usage
    const resourceScore = this.calculateResourceScore(agentId);
    health.components.resourceUsage = resourceScore;

    // Calculate overall health
    const overall = (responsiveness + performance + reliability + resourceScore) / 4;
    health.overall = overall;
    health.lastCheck = new Date();

    // Update agent health
    agent.health = overall;

    // Detect and categorize issues
    this.detectHealthIssues(agentId, health);

    // Auto-restart if critically unhealthy
    if (overall < 0.3 && this.config.autoRestart) {
      await this.restartAgent(agentId, 'health_critical');
    }
  } catch (error) {
    health.overall = 0;
    health.lastCheck = new Date();
  }
}
```

### Health Issue Detection

The system categorizes health issues by type and severity:

```typescript
private detectHealthIssues(agentId: string, health: AgentHealth): void {
  const issues: HealthIssue[] = [];

  if (health.components.responsiveness < 0.5) {
    issues.push({
      type: 'communication',
      severity: health.components.responsiveness < 0.2 ? 'critical' : 'high',
      message: 'Agent is not responding to heartbeats',
      timestamp: new Date(),
      resolved: false,
      recommendedAction: 'Restart agent or check network connectivity',
    });
  }

  if (health.components.performance < 0.6) {
    issues.push({
      type: 'performance',
      severity: health.components.performance < 0.3 ? 'high' : 'medium',
      message: 'Agent performance is below expected levels',
      recommendedAction: 'Check resource allocation or agent configuration',
    });
  }

  if (health.components.resourceUsage < 0.4) {
    issues.push({
      type: 'resource',
      severity: health.components.resourceUsage < 0.2 ? 'critical' : 'high',
      message: 'Agent resource usage is critically high',
      recommendedAction: 'Increase resource limits or reduce workload',
    });
  }

  health.issues = issues;
}
```

## Agent Pools and Auto-Scaling

### Pool Configuration

Agent pools provide auto-scaling capabilities:

```typescript
export interface AgentPool {
  id: string;
  name: string;
  type: AgentType;
  minSize: number;
  maxSize: number;
  currentSize: number;
  availableAgents: AgentId[];
  busyAgents: AgentId[];
  template: AgentTemplate;
  autoScale: boolean;
  scaleUpThreshold: number;   // 0.8 (80% utilization)
  scaleDownThreshold: number; // 0.3 (30% utilization)
}
```

### Auto-Scaling Implementation

```typescript
async scalePool(poolId: string, targetSize: number): Promise<void> {
  const pool = this.pools.get(poolId);
  if (!pool) throw new Error(`Pool ${poolId} not found`);

  const currentSize = pool.currentSize;
  const delta = targetSize - currentSize;

  if (delta > 0) {
    // Scale up - create new agents
    for (let i = 0; i < delta; i++) {
      const agentId = await this.createAgent(pool.template.name, {
        name: `${pool.name}-${currentSize + i + 1}`,
      });
      await this.startAgent(agentId);
      pool.availableAgents.push({
        id: agentId,
        swarmId: 'default',
        type: pool.type,
        instance: currentSize + i + 1,
      });
    }
  } else if (delta < 0) {
    // Scale down - remove agents
    const agentsToRemove = pool.availableAgents.slice(0, Math.abs(delta));
    for (const agentId of agentsToRemove) {
      await this.removeAgent(agentId.id);
      pool.availableAgents = pool.availableAgents.filter((a) => a.id !== agentId.id);
    }
  }

  pool.currentSize = targetSize;
}
```

### Scaling Policies

Automated scaling is governed by policies with configurable rules:

```typescript
interface ScalingPolicy {
  name: string;
  enabled: boolean;
  rules: ScalingRule[];
  cooldownPeriod: number;    // 5 minutes
  maxScaleOperations: number; // 10
}

interface ScalingRule {
  metric: string;           // 'pool-utilization'
  threshold: number;        // 0.8
  comparison: 'gt' | 'lt';  // 'gt'
  action: 'scale-up' | 'scale-down';
  amount: number;           // 1
}
```

## Heartbeat Monitoring System

### Heartbeat Configuration

Each agent type has configurable heartbeat intervals:

```typescript
// Template-specific heartbeat intervals
researcher: { heartbeatInterval: 10000 },  // 10 seconds
developer:  { heartbeatInterval: 15000 },  // 15 seconds
analyzer:   { heartbeatInterval: 12000 },  // 12 seconds
```

### Heartbeat Processing

The system processes heartbeats and updates agent state:

```typescript
private handleHeartbeat(data: {
  agentId: string;
  timestamp: Date;
  metrics?: AgentMetrics;
}): void {
  const agent = this.agents.get(data.agentId);
  if (!agent) return;

  agent.lastHeartbeat = data.timestamp;

  if (data.metrics) {
    this.updateAgentMetrics(data.agentId, data.metrics);
  }

  // Update health if agent was previously unresponsive
  if (agent.status === 'error') {
    agent.status = 'idle';
    this.updateAgentStatus(data.agentId, 'idle');
  }
}
```

### Heartbeat Timeout Detection

Continuous monitoring detects missed heartbeats:

```typescript
private checkHeartbeats(): void {
  const now = Date.now();
  const timeout = this.config.heartbeatInterval * 3; // 3x interval

  for (const [agentId, agent] of this.agents.entries()) {
    const timeSinceHeartbeat = now - agent.lastHeartbeat.getTime();

    if (timeSinceHeartbeat > timeout && 
        agent.status !== 'offline' && 
        agent.status !== 'terminated') {
      
      agent.status = 'error';
      this.addAgentError(agentId, {
        type: 'heartbeat_timeout',
        message: 'Agent failed to send heartbeat within timeout period',
        severity: 'high',
      });

      if (this.config.autoRestart) {
        this.restartAgent(agentId, 'heartbeat_timeout');
      }
    }
  }
}
```

## Error Handling and Recovery

### Error Classification

The system categorizes errors by type and severity:

```typescript
export interface AgentError {
  timestamp: Date;
  type: 'startup_failed' | 'process_exit' | 'heartbeat_timeout' | 'process_error';
  message: string;
  context: Record<string, unknown>;
  severity: 'low' | 'medium' | 'high' | 'critical';
  resolved: boolean;
}
```

### Auto-Recovery Mechanisms

1. **Heartbeat Timeout**: Automatic restart after 3 missed heartbeats
2. **Process Crashes**: Restart on non-zero exit codes
3. **Health Degradation**: Restart when overall health < 0.3
4. **Resource Exhaustion**: Scale up pool or restart individual agents

### Recovery Implementation

```typescript
private async handleServerError(error: Error): Promise<void> {
  this.setState(LifecycleState.ERROR, error);

  if (this.config.enableAutoRestart && 
      this.restartAttempts < this.config.maxRestartAttempts) {
    
    try {
      await this.restart();
    } catch (restartError) {
      this.logger.error('Auto-restart failed', restartError);
      if (this.restartAttempts >= this.config.maxRestartAttempts) {
        await this.forceStop();
      }
    }
  }
}
```

## Performance Monitoring

### Metrics Collection

The system tracks comprehensive performance metrics:

```typescript
export interface AgentMetrics {
  tasksCompleted: number;
  tasksFailed: number;
  averageExecutionTime: number;
  successRate: number;
  cpuUsage: number;
  memoryUsage: number;
  responseTime: number;
  codeQuality: number;
  testCoverage: number;
  totalUptime: number;
  lastActivity: Date;
}
```

### Performance History

Performance data is maintained for trend analysis:

```typescript
private updateAgentMetrics(agentId: string, metrics: AgentMetrics): void {
  const agent = this.agents.get(agentId);
  if (!agent) return;

  agent.metrics = { ...agent.metrics, ...metrics };

  // Store performance history
  const history = this.performanceHistory.get(agentId) || [];
  history.push({ timestamp: new Date(), metrics: { ...metrics } });

  // Keep only last 100 entries
  if (history.length > 100) {
    history.shift();
  }

  this.performanceHistory.set(agentId, history);
}
```

This comprehensive agent lifecycle management system ensures robust, scalable, and self-healing distributed agent operations in Claude-Flow, with sophisticated monitoring, auto-scaling, and recovery capabilities.