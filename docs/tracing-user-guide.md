# Claude-Flow Tracing System User Guide

## Table of Contents
1. [Getting Started](#getting-started)
2. [Dashboard Navigation](#dashboard-navigation)
3. [Time-Travel Debugging](#time-travel-debugging)
4. [Setting Up Breakpoints](#setting-up-breakpoints)
5. [Analyzing Performance](#analyzing-performance)
6. [Exporting and Importing Data](#exporting-and-importing-data)
7. [Troubleshooting Common Issues](#troubleshooting-common-issues)
8. [Best Practices](#best-practices)
9. [Keyboard Shortcuts](#keyboard-shortcuts)
10. [FAQ](#faq)

---

## Getting Started

### Prerequisites
- Claude-Flow v2.0.0 or higher
- Node.js 18+ 
- Chrome, Firefox, or Safari (latest versions)

### Initial Setup

1. **Enable Tracing in Configuration**
   ```bash
   # Enable tracing in your Claude-Flow configuration
   npx claude-flow config set tracing.enabled true
   npx claude-flow config set tracing.level info
   npx claude-flow config set tracing.retention 48h
   ```

2. **Start Tracing Dashboard**
   ```bash
   # Start the Claude-Flow daemon with tracing
   npx claude-flow start --trace
   
   # Or start tracing on existing session
   npx claude-flow trace start
   ```

3. **Open Dashboard**
   - Navigate to `http://localhost:8080/trace` in your browser
   - Or use the CLI: `npx claude-flow trace dashboard`

### First Session Tutorial

**Step 1: Create a Simple Swarm**
```bash
# Initialize a basic swarm for tracing
npx claude-flow swarm init hierarchical --agents 3
```

**Step 2: Execute a Traced Task**
```bash
# Run a task with full tracing enabled
npx claude-flow task create "Analyze this code file" --trace-level verbose
```

**Step 3: View Live Traces**
- Open the tracing dashboard
- You should see real-time agent activity
- Click on nodes to inspect trace details

![Dashboard Screenshot Placeholder]
*Screenshot: First trace visualization showing agent hierarchy*

---

## Dashboard Navigation

### Main Interface Overview

The tracing dashboard consists of four main panels:

1. **Graph Visualization** (Center) - Interactive agent flow diagram
2. **Timeline View** (Bottom) - Chronological trace events
3. **Agent Panel** (Left) - Active agents and their status
4. **Debug Panel** (Right) - Trace details and debugging controls

### Graph Visualization

#### Layout Options
- **Hierarchical**: Shows agent relationships in a tree structure
- **Force-Directed**: Displays natural clustering of connected agents
- **Timeline**: Arranges traces chronologically from left to right

```typescript
// Switch layouts programmatically
dashboard.setLayout('hierarchical');
dashboard.setLayout('force');
dashboard.setLayout('timeline');
```

#### Node Types and Colors
- 🟢 **Green**: Agent method execution
- 🔵 **Blue**: Inter-agent communication
- 🟠 **Orange**: Task execution
- 🟣 **Purple**: Memory operations
- 🔴 **Red**: Errors or exceptions

#### Interactive Controls
- **Click**: Select trace for detailed inspection
- **Double-click**: Zoom to trace context
- **Drag**: Pan around the graph
- **Mouse wheel**: Zoom in/out
- **Right-click**: Context menu with options

![Graph Controls Screenshot Placeholder]
*Screenshot: Graph visualization with different node types highlighted*

### Timeline View

The timeline shows all trace events as they occur over time:

- **Agent Lanes**: Horizontal lanes for each agent
- **Event Dots**: Colored dots representing trace events
- **Time Scrubber**: Red line showing current time position
- **Zoom Controls**: Timeline zoom and pan controls

#### Using the Timeline
1. Click on any event dot to jump to that time
2. Drag the time scrubber to navigate through history
3. Use mouse wheel to zoom in/out on time periods
4. Right-click for time range selection

### Agent Panel

Displays all active agents with real-time status:

- **Agent ID**: Unique identifier
- **Type**: Agent type (coordinator, coder, etc.)
- **Status**: Current state (idle, busy, error)
- **Task Count**: Number of tasks completed
- **Performance**: CPU and memory usage

#### Agent Filtering
```bash
# Filter traces by specific agents
dashboard.filterAgents(['agent-1', 'agent-2']);

# Show only error traces
dashboard.filterByStatus('error');

# Filter by time range
dashboard.filterByTime('2024-01-15T10:00:00Z', '2024-01-15T11:00:00Z');
```

### Debug Panel

Shows detailed information about the selected trace:

- **Trace Details**: Complete trace event data
- **Variable Inspector**: Current variable states
- **Call Stack**: Execution hierarchy
- **Performance Metrics**: Timing and resource usage

---

## Time-Travel Debugging

Time-travel debugging allows you to navigate through the execution history and inspect system state at any point in time.

### Basic Time Navigation

1. **Pause Live Mode**
   ```bash
   dashboard.pause();  # or click the pause button
   ```

2. **Navigate to Specific Time**
   ```bash
   dashboard.goToTime('2024-01-15T10:30:00Z');
   ```

3. **Step Through Execution**
   - **Step Into**: Enter child trace execution
   - **Step Over**: Move to next sibling trace
   - **Step Out**: Exit to parent trace
   - **Continue**: Resume to next breakpoint

### State Reconstruction

The system automatically reconstructs the complete system state at any point:

```typescript
interface SystemState {
  agents: { [id: string]: AgentState };
  tasks: { [id: string]: TaskState };
  memory: { [key: string]: MemoryEntry };
  communications: { [agentId: string]: Message[] };
}
```

#### Viewing Historical State
1. Navigate to desired time using timeline or controls
2. Select "State Inspector" from debug panel
3. Browse through agents, tasks, and memory state
4. Compare states between different time points

![Time Travel Screenshot Placeholder]
*Screenshot: Time-travel interface showing state comparison*

### Advanced Time-Travel Features

#### Creating Time Bookmarks
```bash
# Save current time position
dashboard.bookmarkTime('before-error-occurred');

# Jump to bookmark
dashboard.goToBookmark('before-error-occurred');

# List all bookmarks
dashboard.listBookmarks();
```

#### Time Range Analysis
```bash
# Analyze performance over time range
dashboard.analyzeRange(startTime, endTime);

# Compare two time periods
dashboard.compare(period1, period2);
```

---

## Setting Up Breakpoints

Breakpoints allow you to automatically pause trace execution when specific conditions are met.

### Types of Breakpoints

1. **Event Breakpoints**: Pause on specific trace events
2. **Agent Breakpoints**: Pause when specific agents execute
3. **Conditional Breakpoints**: Pause based on custom conditions
4. **Performance Breakpoints**: Pause when performance thresholds are exceeded

### Creating Breakpoints

#### Event Breakpoints
```bash
# Break on all error events
dashboard.addBreakpoint({
  type: 'event',
  eventType: 'error'
});

# Break on specific agent communication
dashboard.addBreakpoint({
  type: 'event',
  eventType: 'communication',
  agentId: 'coordinator-1'
});
```

#### Conditional Breakpoints
```bash
# Break when memory usage exceeds threshold
dashboard.addBreakpoint({
  type: 'conditional',
  condition: 'memoryUsage > 100000000', // 100MB
  description: 'High memory usage detected'
});

# Break when specific task fails
dashboard.addBreakpoint({
  type: 'conditional',
  condition: 'task.status === "failed" && task.type === "code-analysis"',
  description: 'Code analysis task failed'
});
```

#### Performance Breakpoints
```bash
# Break on slow operations
dashboard.addBreakpoint({
  type: 'performance',
  metric: 'duration',
  threshold: 5000, // 5 seconds
  description: 'Slow operation detected'
});
```

### Managing Breakpoints

#### Breakpoint Management UI
- **Enable/Disable**: Toggle breakpoints without deleting
- **Edit Conditions**: Modify breakpoint conditions
- **View Hit Count**: See how many times breakpoint was triggered
- **Export/Import**: Share breakpoint configurations

![Breakpoints Screenshot Placeholder]
*Screenshot: Breakpoint management interface*

#### Command Line Management
```bash
# List all breakpoints
npx claude-flow trace breakpoints list

# Enable/disable breakpoints
npx claude-flow trace breakpoints enable bp-123
npx claude-flow trace breakpoints disable bp-456

# Delete breakpoint
npx claude-flow trace breakpoints delete bp-789
```

---

## Analyzing Performance

The tracing system provides comprehensive performance analysis tools to identify bottlenecks and optimize agent execution.

### Real-Time Performance Monitoring

#### Performance Metrics Dashboard
- **CPU Usage**: Per-agent and system-wide CPU consumption
- **Memory Usage**: Heap usage, GC pressure, memory leaks
- **Latency**: Inter-agent communication delays
- **Throughput**: Tasks completed per second
- **Error Rates**: Failure percentages by agent and task type

![Performance Dashboard Screenshot Placeholder]
*Screenshot: Performance metrics dashboard with live charts*

#### Setting Up Alerts
```bash
# Alert on high CPU usage
dashboard.addAlert({
  metric: 'cpu.usage',
  threshold: 80,
  duration: '5m',
  action: 'notify'
});

# Alert on memory leaks
dashboard.addAlert({
  metric: 'memory.growth',
  threshold: '50MB/hour',
  duration: '1h',
  action: 'breakpoint'
});
```

### Performance Analysis Tools

#### Flame Graph Analysis
```bash
# Generate flame graph for time period
dashboard.generateFlameGraph({
  startTime: '2024-01-15T10:00:00Z',
  endTime: '2024-01-15T11:00:00Z',
  metric: 'cpu'
});
```

#### Bottleneck Detection
The system automatically identifies performance bottlenecks:

- **Slow Agents**: Agents with consistently high execution times
- **Communication Delays**: Long inter-agent message latencies
- **Memory Hotspots**: Components with high memory allocation
- **Task Queuing**: Bottlenecks in task distribution

```typescript
interface BottleneckReport {
  type: 'slow_agent' | 'communication_delay' | 'memory_hotspot' | 'task_queuing';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  affectedComponents: string[];
  recommendations: string[];
  timeRange: TimeRange;
}
```

#### Performance Comparison
```bash
# Compare performance between sessions
dashboard.comparePerformance(sessionId1, sessionId2);

# Compare before/after optimization
dashboard.compareTimeRanges(beforeOptimization, afterOptimization);
```

### Optimization Recommendations

The system provides automated optimization suggestions:

#### Agent Distribution Analysis
- **Load Balancing**: Identify uneven task distribution
- **Agent Utilization**: Find underutilized or overloaded agents
- **Scaling Recommendations**: Suggest optimal agent counts

#### Communication Pattern Analysis
- **Message Frequency**: High-frequency communication patterns
- **Payload Size**: Large message payloads causing delays
- **Routing Efficiency**: Suboptimal message routing paths

---

## Exporting and Importing Data

### Export Formats

The tracing system supports multiple export formats for analysis and sharing:

#### 1. JSON Export
```bash
# Export entire session
npx claude-flow trace export session-123 --format json --output traces.json

# Export specific time range
npx claude-flow trace export session-123 \
  --start "2024-01-15T10:00:00Z" \
  --end "2024-01-15T11:00:00Z" \
  --format json
```

#### 2. CSV Export (for spreadsheet analysis)
```bash
# Export performance metrics
npx claude-flow trace export session-123 --format csv --metrics-only

# Export communication patterns
npx claude-flow trace export session-123 --format csv --communications-only
```

#### 3. Chrome DevTools Timeline
```bash
# Export for Chrome DevTools analysis
npx claude-flow trace export session-123 --format chrome-devtools
```

#### 4. OpenTelemetry Format
```bash
# Export in OpenTelemetry format for external tools
npx claude-flow trace export session-123 --format otel --output traces.otel
```

### Import Functions

#### Importing Historical Data
```bash
# Import previously exported traces
npx claude-flow trace import traces.json --session-id imported-session

# Import and merge with existing session
npx claude-flow trace import traces.json --merge-with session-456
```

#### Importing from External Sources
```bash
# Import from OpenTelemetry collector
npx claude-flow trace import --source otel --endpoint http://localhost:4317

# Import from custom format
npx claude-flow trace import custom-traces.log --parser custom-parser.js
```

### Data Sharing and Collaboration

#### Creating Shareable Reports
```bash
# Generate shareable HTML report
npx claude-flow trace report session-123 --format html --output report.html

# Create interactive dashboard snapshot
npx claude-flow trace snapshot session-123 --interactive
```

#### Team Collaboration Features
- **Trace Annotations**: Add comments and notes to specific traces
- **Shared Bookmarks**: Share important time positions with team
- **Collaborative Analysis**: Real-time collaborative trace analysis

![Export Interface Screenshot Placeholder]
*Screenshot: Export options and format selection*

---

## Troubleshooting Common Issues

### Performance Issues

#### Dashboard Slow/Unresponsive

**Symptoms:**
- Dashboard takes long time to load
- Graph visualization laggy
- Browser becomes unresponsive

**Solutions:**
```bash
# Reduce trace detail level
npx claude-flow config set tracing.level error

# Limit trace retention
npx claude-flow config set tracing.retention 2h

# Enable trace sampling
npx claude-flow config set tracing.sampling 0.1  # 10% sampling rate

# Clear old trace data
npx claude-flow trace cleanup --older-than 24h
```

#### High Memory Usage

**Symptoms:**
- System memory consumption keeps growing
- Out of memory errors
- System becomes sluggish

**Solutions:**
```bash
# Enable memory limits
npx claude-flow config set tracing.memory.limit 500MB

# Enable automatic cleanup
npx claude-flow config set tracing.cleanup.auto true
npx claude-flow config set tracing.cleanup.interval 1h

# Enable compression
npx claude-flow config set tracing.compression true
```

### Connection Issues

#### WebSocket Connection Failures

**Symptoms:**
- "Connection lost" messages
- Dashboard not updating in real-time
- Trace events missing

**Diagnostics:**
```bash
# Check WebSocket status
npx claude-flow trace status --websocket

# Test WebSocket connection
npx claude-flow trace test-connection

# View connection logs
npx claude-flow logs --component websocket --tail
```

**Solutions:**
```bash
# Restart WebSocket server
npx claude-flow trace restart --websocket-only

# Change WebSocket port
npx claude-flow config set tracing.websocket.port 8081

# Enable WebSocket fallback
npx claude-flow config set tracing.websocket.fallback polling
```

#### Database Lock Errors

**Symptoms:**
- "Database is locked" errors
- Trace data not being saved
- SQLite errors in logs

**Solutions:**
```bash
# Check database status
npx claude-flow trace db-status

# Repair database
npx claude-flow trace db-repair

# Reset database (WARNING: loses all trace data)
npx claude-flow trace db-reset --confirm
```

### Data Issues

#### Missing Traces

**Symptoms:**
- Some agent activities not showing in dashboard
- Gaps in timeline
- Incomplete trace graphs

**Diagnostics:**
```bash
# Check trace collection status
npx claude-flow trace collection-status

# Verify agent instrumentation
npx claude-flow trace verify-agents

# Check trace filters
npx claude-flow trace show-filters
```

**Solutions:**
```bash
# Reset trace collection
npx claude-flow trace reset-collection

# Increase trace level
npx claude-flow config set tracing.level debug

# Disable trace filtering
npx claude-flow trace clear-filters
```

#### Corrupted Trace Data

**Symptoms:**
- Dashboard shows error messages
- Trace visualization broken
- Export functions fail

**Solutions:**
```bash
# Validate trace data
npx claude-flow trace validate --session session-123

# Repair corrupted traces
npx claude-flow trace repair --session session-123

# Restore from backup
npx claude-flow trace restore --backup backup-20240115.db
```

### Browser Issues

#### Visualization Not Loading

**Browser Requirements:**
- Chrome 90+, Firefox 88+, Safari 14+
- WebGL support enabled
- JavaScript enabled

**Solutions:**
```bash
# Check browser compatibility
curl http://localhost:8080/trace/compatibility

# Use alternative renderer
npx claude-flow trace dashboard --renderer canvas

# Generate static visualization
npx claude-flow trace export session-123 --format static-html
```

---

## Best Practices

### Trace Configuration

#### Production Environments

```bash
# Recommended production settings
npx claude-flow config set tracing.level info
npx claude-flow config set tracing.sampling 0.05  # 5% sampling
npx claude-flow config set tracing.retention 24h
npx claude-flow config set tracing.compression true
npx claude-flow config set tracing.memory.limit 256MB
```

#### Development Environments

```bash
# Recommended development settings
npx claude-flow config set tracing.level debug
npx claude-flow config set tracing.sampling 1.0   # 100% sampling
npx claude-flow config set tracing.retention 72h
npx claude-flow config set tracing.memory.limit 1GB
```

### Performance Optimization

#### Selective Tracing

Focus tracing on specific areas of interest:

```bash
# Trace only specific agents
npx claude-flow trace config --agents coordinator-1,coder-2

# Trace only error conditions
npx claude-flow trace config --events error,failure

# Trace only slow operations
npx claude-flow trace config --threshold 1000ms
```

#### Batch Operations

Use batch operations for better performance:

```typescript
// Good: Batch multiple trace operations
dashboard.batch(() => {
  dashboard.addBreakpoint(bp1);
  dashboard.addBreakpoint(bp2);
  dashboard.setFilters(filters);
});

// Avoid: Multiple separate operations
dashboard.addBreakpoint(bp1);
dashboard.addBreakpoint(bp2);
dashboard.setFilters(filters);
```

### Debugging Workflow

#### Systematic Problem Investigation

1. **Start Broad**: Begin with timeline overview
2. **Identify Patterns**: Look for recurring issues
3. **Narrow Focus**: Use filters to isolate problems
4. **Deep Dive**: Use time-travel for detailed analysis
5. **Document Findings**: Add annotations and bookmarks

#### Effective Breakpoint Strategy

```bash
# Start with high-level breakpoints
dashboard.addBreakpoint({ type: 'event', eventType: 'error' });

# Add specific breakpoints as needed
dashboard.addBreakpoint({
  type: 'conditional',
  condition: 'agent.id === "problematic-agent" && task.duration > 5000'
});

# Use temporary breakpoints for investigation
dashboard.addBreakpoint({
  type: 'event',
  eventType: 'task_start',
  temporary: true,
  hitCount: 1
});
```

### Data Management

#### Regular Maintenance

```bash
# Weekly cleanup script
#!/bin/bash
npx claude-flow trace cleanup --older-than 7d
npx claude-flow trace vacuum-db
npx claude-flow trace backup --path weekly-backup.db
```

#### Archive Important Sessions

```bash
# Archive critical debugging sessions
npx claude-flow trace archive session-important-bug \
  --description "Critical performance issue investigation" \
  --tags production,performance,bug-123
```

### Team Collaboration

#### Sharing Debug Sessions

```bash
# Export session for team member
npx claude-flow trace export session-123 \
  --format collaborative \
  --include-annotations \
  --include-bookmarks

# Create team-accessible report
npx claude-flow trace report session-123 \
  --format html \
  --public-url \
  --password team-password
```

#### Standardize Tracing Practices

1. **Consistent Naming**: Use standardized agent and task names
2. **Meaningful Tags**: Tag traces with context information
3. **Regular Reviews**: Schedule team trace analysis sessions
4. **Document Patterns**: Maintain library of common debugging patterns

---

## Keyboard Shortcuts

### Global Navigation
- `Ctrl+P` (Cmd+P on Mac): Open command palette
- `Ctrl+F` (Cmd+F on Mac): Search traces
- `Ctrl+G` (Cmd+G on Mac): Go to time
- `Ctrl+R` (Cmd+R on Mac): Refresh dashboard
- `Esc`: Clear selection/close dialogs

### Timeline Navigation
- `Space`: Play/pause live mode
- `←/→`: Navigate through time
- `Shift+←/→`: Jump to next/previous trace event
- `Home/End`: Go to start/end of timeline
- `Ctrl+Home/End`: Go to session start/end

### Graph Interaction
- `+/-`: Zoom in/out
- `0`: Reset zoom to fit all
- `Ctrl+Click`: Multi-select nodes
- `Shift+Click`: Select range
- `Delete`: Hide selected nodes
- `Ctrl+A`: Select all visible nodes

### Time-Travel Debugging
- `F10`: Step over
- `F11`: Step into
- `Shift+F11`: Step out
- `F8`: Continue/resume
- `F9`: Toggle breakpoint
- `Ctrl+F9`: Conditional breakpoint
- `Shift+F9`: Disable all breakpoints

### Panel Management
- `Ctrl+1`: Focus graph panel
- `Ctrl+2`: Focus timeline panel
- `Ctrl+3`: Focus agent panel
- `Ctrl+4`: Focus debug panel
- `Ctrl+\`: Toggle panel visibility
- `F11`: Toggle fullscreen

### Export/Import
- `Ctrl+S`: Quick export current view
- `Ctrl+O`: Import trace file
- `Ctrl+Shift+S`: Export with options
- `Ctrl+E`: Export performance report

---

## FAQ

### General Questions

**Q: How much overhead does tracing add to my system?**
A: Tracing typically adds less than 5% CPU overhead and uses about 10MB RAM per 1000 traces. You can adjust sampling rates to reduce overhead further.

**Q: Can I trace existing running systems?**
A: Yes, you can enable tracing on running Claude-Flow instances using `npx claude-flow trace enable --session <session-id>`.

**Q: How long are traces stored?**
A: Default retention is 48 hours, but you can configure this with `npx claude-flow config set tracing.retention <duration>`.

**Q: Can I trace multiple sessions simultaneously?**
A: Yes, the dashboard can display traces from multiple sessions. Use the session selector in the top bar.

### Technical Questions

**Q: What databases are supported for trace storage?**
A: Currently SQLite is the primary storage backend. PostgreSQL and MongoDB support is planned for future releases.

**Q: Can I integrate with external monitoring tools?**
A: Yes, traces can be exported in OpenTelemetry format for integration with tools like Jaeger, Zipkin, and Grafana.

**Q: Is there an API for programmatic access?**
A: Yes, the tracing system provides REST and GraphQL APIs. See the [API documentation](/docs/api/tracing-api.md) for details.

**Q: Can I create custom trace visualizations?**
A: Yes, you can create custom visualizations using the tracing API and the provided React components as building blocks.

### Troubleshooting Questions

**Q: Why am I not seeing all trace events?**
A: Check your trace level settings and sampling configuration. Also verify that agent instrumentation is properly enabled.

**Q: The dashboard is slow with large datasets. How can I optimize?**
A: Enable compression, increase sampling rates, reduce retention time, or use time range filters to limit displayed data.

**Q: Can I recover deleted trace data?**
A: If you have automated backups enabled, you can restore from backup. Otherwise, deleted trace data cannot be recovered.

**Q: Why are some agents not showing in the trace graph?**
A: Agents only appear in traces when they're actively executing tasks. Idle agents won't generate trace events.

### Advanced Questions

**Q: How does time-travel debugging reconstruct system state?**
A: The system uses event sourcing to replay all trace events from the last snapshot to the target time, rebuilding the complete system state.

**Q: Can I set up automated alerts based on trace patterns?**
A: Yes, you can configure alerts for performance thresholds, error patterns, and custom conditions using the alerting system.

**Q: How can I contribute custom trace collectors?**
A: See the [Extending Tracing](/docs/development/extending-tracing.md) guide for information on creating custom trace collectors.

**Q: Is there support for distributed tracing across multiple machines?**
A: Yes, the system supports distributed tracing with correlation IDs to track operations across multiple Claude-Flow instances.

---

## Additional Resources

### Documentation Links
- [Tracing System Architecture](/docs/architecture/tracing-visualization-system.md)
- [API Reference](/docs/api/tracing-api.md)
- [Configuration Guide](/docs/configuration/tracing-config.md)
- [Development Guide](/docs/development/tracing-development.md)

### Video Tutorials
- Getting Started with Tracing (10 minutes)
- Time-Travel Debugging Deep Dive (15 minutes)
- Performance Analysis Masterclass (20 minutes)
- Advanced Debugging Techniques (25 minutes)

### Community Resources
- [GitHub Discussions](https://github.com/ruvnet/claude-flow/discussions)
- [Discord Community](https://discord.gg/claude-flow)
- [Stack Overflow Tag](https://stackoverflow.com/questions/tagged/claude-flow-tracing)

### Support Channels
- **Bug Reports**: [GitHub Issues](https://github.com/ruvnet/claude-flow/issues)
- **Feature Requests**: [GitHub Discussions](https://github.com/ruvnet/claude-flow/discussions/categories/ideas)
- **Community Support**: [Discord #tracing Channel](https://discord.gg/claude-flow)
- **Enterprise Support**: support@claude-flow.com

---

*Last updated: January 2025*
*Version: 2.0.0*