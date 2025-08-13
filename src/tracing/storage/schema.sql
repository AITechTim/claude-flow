-- Claude Flow Tracing System Database Schema

-- Main trace events table
CREATE TABLE IF NOT EXISTS trace_events (
    id TEXT PRIMARY KEY,
    timestamp INTEGER NOT NULL,
    type TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    swarm_id TEXT NOT NULL,
    data TEXT NOT NULL,                  -- JSON blob for event data
    duration INTEGER,                    -- Duration in milliseconds
    parent_id TEXT,                      -- Parent event ID for hierarchical traces
    children TEXT,                       -- JSON array of child event IDs
    metadata TEXT,                       -- JSON blob for additional metadata
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (parent_id) REFERENCES trace_events(id)
);

-- System snapshots for time-travel debugging
CREATE TABLE IF NOT EXISTS snapshots (
    id TEXT PRIMARY KEY,
    timestamp INTEGER NOT NULL,
    swarm_state TEXT NOT NULL,           -- JSON blob of swarm state
    agent_states TEXT NOT NULL,          -- JSON blob of all agent states
    event_count INTEGER NOT NULL,        -- Number of events at snapshot time
    version TEXT NOT NULL,               -- Schema version
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Agent metadata and configuration
CREATE TABLE IF NOT EXISTS agents (
    agent_id TEXT PRIMARY KEY,
    agent_type TEXT NOT NULL,
    swarm_id TEXT NOT NULL,
    capabilities TEXT,                   -- JSON array of capabilities
    config TEXT,                         -- JSON blob of agent configuration
    spawn_time INTEGER NOT NULL,
    destroy_time INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Performance metrics aggregated by time windows
CREATE TABLE IF NOT EXISTS performance_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,          -- Window timestamp
    window_size INTEGER NOT NULL,        -- Window size in milliseconds
    agent_id TEXT,                       -- NULL for system-wide metrics
    metric_type TEXT NOT NULL,           -- cpu, memory, throughput, etc.
    metric_value REAL NOT NULL,
    metadata TEXT,                       -- JSON blob for additional data
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Error and exception tracking
CREATE TABLE IF NOT EXISTS error_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL,              -- References trace_events.id
    error_type TEXT NOT NULL,
    error_message TEXT NOT NULL,
    stack_trace TEXT,
    recovery_action TEXT,                -- What was done to recover
    resolved BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (event_id) REFERENCES trace_events(id)
);

-- Communication and message passing between agents
CREATE TABLE IF NOT EXISTS agent_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT UNIQUE NOT NULL,
    sender_agent_id TEXT NOT NULL,
    receiver_agent_id TEXT NOT NULL,
    message_type TEXT NOT NULL,
    payload TEXT NOT NULL,               -- JSON blob of message payload
    timestamp INTEGER NOT NULL,
    delivery_status TEXT DEFAULT 'sent', -- sent, delivered, failed
    response_to TEXT,                    -- References another message_id
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Task execution and lifecycle tracking
CREATE TABLE IF NOT EXISTS task_execution (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT UNIQUE NOT NULL,
    agent_id TEXT NOT NULL,
    swarm_id TEXT NOT NULL,
    task_type TEXT NOT NULL,
    status TEXT NOT NULL,                -- pending, running, completed, failed
    priority TEXT NOT NULL,              -- low, medium, high, critical
    payload TEXT NOT NULL,               -- JSON blob of task data
    start_time INTEGER,
    end_time INTEGER,
    result TEXT,                         -- JSON blob of task result
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Schema version tracking for migrations
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    description TEXT,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Resource usage tracking
CREATE TABLE IF NOT EXISTS resource_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    agent_id TEXT,                       -- NULL for system-wide usage
    cpu_percent REAL,
    memory_bytes INTEGER,
    disk_bytes INTEGER,
    network_bytes_in INTEGER,
    network_bytes_out INTEGER,
    open_files INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Performance indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON trace_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_agent_id ON trace_events(agent_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON trace_events(type);
CREATE INDEX IF NOT EXISTS idx_events_swarm_id ON trace_events(swarm_id);
CREATE INDEX IF NOT EXISTS idx_events_parent_id ON trace_events(parent_id);
CREATE INDEX IF NOT EXISTS idx_events_composite ON trace_events(agent_id, timestamp, type);

CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON snapshots(timestamp);
CREATE INDEX IF NOT EXISTS idx_agents_swarm_id ON agents(swarm_id);
CREATE INDEX IF NOT EXISTS idx_agents_type ON agents(agent_type);

CREATE INDEX IF NOT EXISTS idx_performance_timestamp ON performance_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_performance_agent ON performance_metrics(agent_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_performance_type ON performance_metrics(metric_type, timestamp);

CREATE INDEX IF NOT EXISTS idx_errors_event_id ON error_events(event_id);
CREATE INDEX IF NOT EXISTS idx_errors_resolved ON error_events(resolved, created_at);

CREATE INDEX IF NOT EXISTS idx_messages_sender ON agent_messages(sender_agent_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON agent_messages(receiver_agent_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_status ON agent_messages(delivery_status, timestamp);

CREATE INDEX IF NOT EXISTS idx_tasks_agent ON task_execution(agent_id, start_time);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON task_execution(status, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_type ON task_execution(task_type, start_time);

CREATE INDEX IF NOT EXISTS idx_resources_timestamp ON resource_usage(timestamp);
CREATE INDEX IF NOT EXISTS idx_resources_agent ON resource_usage(agent_id, timestamp);

-- Views for common queries
CREATE VIEW IF NOT EXISTS active_agents AS
SELECT 
    a.agent_id,
    a.agent_type,
    a.swarm_id,
    a.capabilities,
    a.spawn_time,
    COUNT(t.task_id) as active_tasks,
    MAX(te.timestamp) as last_activity
FROM agents a
LEFT JOIN task_execution t ON a.agent_id = t.agent_id AND t.status IN ('pending', 'running')
LEFT JOIN trace_events te ON a.agent_id = te.agent_id
WHERE a.destroy_time IS NULL
GROUP BY a.agent_id, a.agent_type, a.swarm_id, a.capabilities, a.spawn_time;

CREATE VIEW IF NOT EXISTS system_health AS
SELECT 
    COUNT(DISTINCT a.agent_id) as total_agents,
    COUNT(DISTINCT CASE WHEN t.status = 'running' THEN t.agent_id END) as busy_agents,
    COUNT(CASE WHEN t.status = 'failed' THEN 1 END) as failed_tasks,
    COUNT(CASE WHEN e.resolved = FALSE THEN 1 END) as unresolved_errors,
    AVG(ru.cpu_percent) as avg_cpu_usage,
    AVG(ru.memory_bytes) as avg_memory_usage
FROM agents a
LEFT JOIN task_execution t ON a.agent_id = t.agent_id
LEFT JOIN error_events e ON e.created_at > datetime('now', '-1 hour')
LEFT JOIN resource_usage ru ON ru.timestamp > strftime('%s', 'now', '-1 hour') * 1000
WHERE a.destroy_time IS NULL;

-- Insert initial schema version
INSERT OR IGNORE INTO schema_version (version, description) VALUES (1, 'Initial schema');