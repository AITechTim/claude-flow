-- Claude-Flow Tracing and Visualization System - Database Schema
-- Optimized for high-performance tracing with minimal storage footprint

-- Enable foreign key constraints and performance optimizations
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = 10000;
PRAGMA temp_store = MEMORY;

-- ============================================================================
-- Core Tables
-- ============================================================================

-- Traces table for high-level trace metadata
CREATE TABLE traces (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'completed', 'stopped', 'error')),
    agent_count INTEGER DEFAULT 0,
    event_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    total_duration_ms INTEGER,
    topology TEXT,
    sampling_rate REAL DEFAULT 0.1,
    compression_enabled BOOLEAN DEFAULT true,
    storage_size_bytes INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch() * 1000),
    updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- Events table for individual trace events with partitioning support
CREATE TABLE events (
    id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    parent_id TEXT, -- For event hierarchy
    agent_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    duration_ms INTEGER,
    level TEXT DEFAULT 'info' CHECK(level IN ('debug', 'info', 'warn', 'error')),
    message TEXT,
    metadata TEXT, -- Compressed JSON payload
    stack_trace TEXT,
    sequence_number INTEGER, -- For ordering within trace
    batch_id TEXT, -- For batch processing
    compressed BOOLEAN DEFAULT false,
    
    -- Foreign key constraints
    FOREIGN KEY (trace_id) REFERENCES traces(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES events(id) ON DELETE SET NULL
);

-- Agent states for visualization and time-travel
CREATE TABLE agent_states (
    id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    agent_name TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('spawning', 'idle', 'busy', 'error', 'destroyed')),
    position_x REAL,
    position_y REAL,
    current_task_id TEXT,
    metrics TEXT, -- JSON: AgentMetrics
    
    FOREIGN KEY (trace_id) REFERENCES traces(id) ON DELETE CASCADE
);

-- Agent connections for network topology visualization
CREATE TABLE agent_connections (
    id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    source_agent_id TEXT NOT NULL,
    target_agent_id TEXT NOT NULL,
    connection_type TEXT NOT NULL CHECK(connection_type IN ('communication', 'coordination', 'dependency')),
    strength REAL DEFAULT 1.0,
    latency_ms INTEGER,
    message_count INTEGER DEFAULT 0,
    last_interaction INTEGER,
    active BOOLEAN DEFAULT true,
    
    FOREIGN KEY (trace_id) REFERENCES traces(id) ON DELETE CASCADE,
    UNIQUE(trace_id, source_agent_id, target_agent_id, connection_type)
);

-- Task states for task tracking and dependencies
CREATE TABLE task_states (
    id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    task_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed')),
    progress REAL DEFAULT 0.0 CHECK(progress >= 0.0 AND progress <= 1.0),
    start_time INTEGER,
    end_time INTEGER,
    estimated_completion INTEGER,
    dependencies TEXT, -- JSON array of task IDs
    metadata TEXT, -- JSON payload
    
    FOREIGN KEY (trace_id) REFERENCES traces(id) ON DELETE CASCADE
);

-- Snapshots table for time-travel debugging
CREATE TABLE snapshots (
    id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    snapshot_type TEXT NOT NULL CHECK(snapshot_type IN ('agent_state', 'memory_state', 'task_state', 'coordination_state', 'full_system')),
    scope_id TEXT, -- agent_id, memory_key, task_id, etc.
    state_data BLOB NOT NULL, -- Compressed state data
    checksum TEXT NOT NULL, -- For integrity verification
    size_bytes INTEGER NOT NULL,
    compression_ratio REAL,
    created_at INTEGER DEFAULT (unixepoch() * 1000),
    
    FOREIGN KEY (trace_id) REFERENCES traces(id) ON DELETE CASCADE
);

-- Memory operations for distributed memory tracking
CREATE TABLE memory_operations (
    id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    agent_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK(operation IN ('store', 'retrieve', 'delete', 'update')),
    memory_key TEXT NOT NULL,
    namespace TEXT DEFAULT 'default',
    value_hash TEXT, -- Hash of the value for deduplication
    size_bytes INTEGER,
    ttl INTEGER,
    metadata TEXT, -- JSON payload
    
    FOREIGN KEY (trace_id) REFERENCES traces(id) ON DELETE CASCADE
);

-- Performance metrics for overhead monitoring
CREATE TABLE performance_metrics (
    id TEXT PRIMARY KEY,
    trace_id TEXT,
    timestamp INTEGER NOT NULL,
    metric_type TEXT NOT NULL,
    component TEXT NOT NULL, -- 'collector', 'storage', 'streaming', 'ui'
    value REAL NOT NULL,
    unit TEXT,
    metadata TEXT, -- JSON payload
    
    FOREIGN KEY (trace_id) REFERENCES traces(id) ON DELETE SET NULL
);

-- System health events
CREATE TABLE health_events (
    id TEXT PRIMARY KEY,
    timestamp INTEGER NOT NULL,
    component TEXT NOT NULL,
    severity TEXT NOT NULL CHECK(severity IN ('low', 'medium', 'high', 'critical')),
    event_type TEXT NOT NULL,
    message TEXT NOT NULL,
    resolved BOOLEAN DEFAULT false,
    resolved_at INTEGER,
    metadata TEXT -- JSON payload
);

-- Batch processing metadata for efficient queries
CREATE TABLE batch_metadata (
    id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    event_count INTEGER NOT NULL,
    time_range_start INTEGER NOT NULL,
    time_range_end INTEGER NOT NULL,
    agent_ids TEXT, -- JSON array
    event_types TEXT, -- JSON array
    compression_ratio REAL,
    size_bytes INTEGER,
    processed BOOLEAN DEFAULT false,
    
    FOREIGN KEY (trace_id) REFERENCES traces(id) ON DELETE CASCADE
);

-- ============================================================================
-- Indexes for Performance Optimization
-- ============================================================================

-- Traces indexes
CREATE INDEX idx_traces_session ON traces(session_id);
CREATE INDEX idx_traces_time ON traces(start_time, end_time);
CREATE INDEX idx_traces_status ON traces(status);
CREATE INDEX idx_traces_updated ON traces(updated_at);

-- Events indexes (most critical for query performance)
CREATE INDEX idx_events_trace_time ON events(trace_id, timestamp);
CREATE INDEX idx_events_agent_time ON events(agent_id, timestamp);
CREATE INDEX idx_events_type_time ON events(event_type, timestamp);
CREATE INDEX idx_events_level_time ON events(level, timestamp) WHERE level IN ('error', 'warn');
CREATE INDEX idx_events_parent ON events(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_events_batch ON events(batch_id, sequence_number);

-- Recent events index for real-time queries
CREATE INDEX idx_events_recent ON events(timestamp DESC) 
WHERE timestamp > (unixepoch() * 1000 - 3600000); -- Last hour

-- Agent states indexes
CREATE INDEX idx_agent_states_trace_agent ON agent_states(trace_id, agent_id, timestamp);
CREATE INDEX idx_agent_states_time ON agent_states(timestamp);
CREATE INDEX idx_agent_states_status ON agent_states(status, timestamp);

-- Agent connections indexes
CREATE INDEX idx_connections_trace_time ON agent_connections(trace_id, timestamp);
CREATE INDEX idx_connections_agents ON agent_connections(source_agent_id, target_agent_id);
CREATE INDEX idx_connections_active ON agent_connections(active, last_interaction) WHERE active = true;

-- Task states indexes
CREATE INDEX idx_task_states_trace_time ON task_states(trace_id, timestamp);
CREATE INDEX idx_task_states_agent ON task_states(agent_id, timestamp);
CREATE INDEX idx_task_states_status ON task_states(status, timestamp);
CREATE INDEX idx_task_states_task ON task_states(task_id, timestamp);

-- Snapshots indexes for time-travel queries
CREATE INDEX idx_snapshots_trace_time ON snapshots(trace_id, timestamp);
CREATE INDEX idx_snapshots_type_time ON snapshots(snapshot_type, timestamp);
CREATE INDEX idx_snapshots_scope ON snapshots(scope_id, timestamp) WHERE scope_id IS NOT NULL;

-- Memory operations indexes
CREATE INDEX idx_memory_trace_time ON memory_operations(trace_id, timestamp);
CREATE INDEX idx_memory_agent_time ON memory_operations(agent_id, timestamp);
CREATE INDEX idx_memory_key_namespace ON memory_operations(memory_key, namespace, timestamp);

-- Performance metrics indexes
CREATE INDEX idx_metrics_type_time ON performance_metrics(metric_type, timestamp);
CREATE INDEX idx_metrics_component ON performance_metrics(component, timestamp);
CREATE INDEX idx_metrics_trace ON performance_metrics(trace_id, timestamp) WHERE trace_id IS NOT NULL;

-- Health events indexes
CREATE INDEX idx_health_severity_time ON health_events(severity, timestamp);
CREATE INDEX idx_health_component ON health_events(component, timestamp);
CREATE INDEX idx_health_unresolved ON health_events(resolved, timestamp) WHERE resolved = false;

-- Batch metadata indexes
CREATE INDEX idx_batch_trace ON batch_metadata(trace_id, created_at);
CREATE INDEX idx_batch_time_range ON batch_metadata(time_range_start, time_range_end);
CREATE INDEX idx_batch_unprocessed ON batch_metadata(processed, created_at) WHERE processed = false;

-- ============================================================================
-- Optimized Views for Common Queries
-- ============================================================================

-- Active traces with live statistics
CREATE VIEW active_traces AS
SELECT 
    t.*,
    COUNT(DISTINCT a.agent_id) as live_agent_count,
    COUNT(e.id) as recent_event_count,
    MAX(e.timestamp) as last_activity,
    AVG(CASE WHEN pm.metric_type = 'cpu_usage' THEN pm.value END) as avg_cpu,
    AVG(CASE WHEN pm.metric_type = 'memory_usage' THEN pm.value END) as avg_memory
FROM traces t
LEFT JOIN agent_states a ON t.id = a.trace_id 
    AND a.timestamp > (unixepoch() * 1000 - 300000) -- Last 5 minutes
    AND a.status NOT IN ('destroyed')
LEFT JOIN events e ON t.id = e.trace_id 
    AND e.timestamp > (unixepoch() * 1000 - 300000) -- Last 5 minutes
LEFT JOIN performance_metrics pm ON t.id = pm.trace_id
    AND pm.timestamp > (unixepoch() * 1000 - 300000) -- Last 5 minutes
WHERE t.status = 'active'
GROUP BY t.id;

-- Recent events with trace context
CREATE VIEW recent_events AS
SELECT 
    e.*,
    t.session_id,
    t.topology,
    a.agent_name,
    a.agent_type,
    a.status as agent_status
FROM events e
JOIN traces t ON e.trace_id = t.id
LEFT JOIN agent_states a ON e.trace_id = a.trace_id 
    AND e.agent_id = a.agent_id
    AND a.timestamp <= e.timestamp
    AND a.timestamp = (
        SELECT MAX(timestamp) 
        FROM agent_states 
        WHERE trace_id = a.trace_id 
        AND agent_id = a.agent_id 
        AND timestamp <= e.timestamp
    )
WHERE e.timestamp > (unixepoch() * 1000 - 3600000) -- Last hour
ORDER BY e.timestamp DESC;

-- Error events with context
CREATE VIEW error_events AS
SELECT 
    e.*,
    t.session_id,
    a.agent_name,
    a.agent_type,
    COUNT(*) OVER (PARTITION BY e.trace_id, e.agent_id) as agent_error_count,
    ROW_NUMBER() OVER (PARTITION BY e.trace_id ORDER BY e.timestamp) as error_sequence
FROM events e
JOIN traces t ON e.trace_id = t.id
LEFT JOIN agent_states a ON e.trace_id = a.trace_id AND e.agent_id = a.agent_id
WHERE e.level = 'error'
ORDER BY e.timestamp DESC;

-- Agent topology for visualization
CREATE VIEW agent_topology AS
SELECT 
    ac.*,
    sa.agent_name as source_name,
    sa.agent_type as source_type,
    sa.status as source_status,
    ta.agent_name as target_name,
    ta.agent_type as target_type,
    ta.status as target_status
FROM agent_connections ac
JOIN agent_states sa ON ac.trace_id = sa.trace_id 
    AND ac.source_agent_id = sa.agent_id
JOIN agent_states ta ON ac.trace_id = ta.trace_id 
    AND ac.target_agent_id = ta.agent_id
WHERE ac.active = true
    AND sa.timestamp = (
        SELECT MAX(timestamp) 
        FROM agent_states 
        WHERE trace_id = sa.trace_id 
        AND agent_id = sa.agent_id
    )
    AND ta.timestamp = (
        SELECT MAX(timestamp) 
        FROM agent_states 
        WHERE trace_id = ta.trace_id 
        AND agent_id = ta.agent_id
    );

-- Performance dashboard data
CREATE VIEW performance_dashboard AS
SELECT 
    pm.timestamp,
    pm.trace_id,
    AVG(CASE WHEN pm.metric_type = 'collection_overhead' THEN pm.value END) as collection_overhead,
    AVG(CASE WHEN pm.metric_type = 'storage_overhead' THEN pm.value END) as storage_overhead,
    AVG(CASE WHEN pm.metric_type = 'streaming_latency' THEN pm.value END) as streaming_latency,
    AVG(CASE WHEN pm.metric_type = 'compression_ratio' THEN pm.value END) as compression_ratio,
    COUNT(CASE WHEN he.severity IN ('high', 'critical') THEN 1 END) as critical_issues
FROM performance_metrics pm
LEFT JOIN health_events he ON pm.timestamp BETWEEN he.timestamp - 60000 AND he.timestamp + 60000
WHERE pm.timestamp > (unixepoch() * 1000 - 86400000) -- Last 24 hours
GROUP BY pm.timestamp, pm.trace_id
ORDER BY pm.timestamp DESC;

-- ============================================================================
-- Triggers for Data Maintenance
-- ============================================================================

-- Auto-update trace statistics
CREATE TRIGGER update_trace_stats_on_event
AFTER INSERT ON events
BEGIN
    UPDATE traces SET 
        event_count = event_count + 1,
        error_count = error_count + CASE WHEN NEW.level = 'error' THEN 1 ELSE 0 END,
        updated_at = unixepoch() * 1000
    WHERE id = NEW.trace_id;
END;

-- Auto-update trace end time
CREATE TRIGGER update_trace_end_time
AFTER UPDATE ON traces
WHEN NEW.status != 'active' AND OLD.status = 'active'
BEGIN
    UPDATE traces SET 
        end_time = unixepoch() * 1000,
        total_duration_ms = (unixepoch() * 1000) - start_time
    WHERE id = NEW.id;
END;

-- Auto-cleanup old debug events
CREATE TRIGGER cleanup_old_debug_events
AFTER INSERT ON events
WHEN NEW.level = 'debug'
BEGIN
    DELETE FROM events 
    WHERE level = 'debug' 
    AND timestamp < (unixepoch() * 1000 - 86400000) -- Older than 1 day
    AND trace_id IN (
        SELECT id FROM traces WHERE status != 'active'
    );
END;

-- Auto-cleanup old performance metrics
CREATE TRIGGER cleanup_old_metrics
AFTER INSERT ON performance_metrics
BEGIN
    DELETE FROM performance_metrics
    WHERE timestamp < (unixepoch() * 1000 - 604800000) -- Older than 7 days
    AND metric_type NOT IN ('system_error', 'critical_alert');
END;

-- Auto-resolve old health events
CREATE TRIGGER auto_resolve_health_events
AFTER INSERT ON health_events
WHEN NEW.severity IN ('low', 'medium')
BEGIN
    UPDATE health_events SET 
        resolved = true,
        resolved_at = unixepoch() * 1000
    WHERE resolved = false 
    AND severity IN ('low', 'medium')
    AND timestamp < (unixepoch() * 1000 - 3600000); -- Older than 1 hour
END;

-- ============================================================================
-- Functions for Common Operations
-- ============================================================================

-- Get trace summary statistics
-- Note: SQLite doesn't support user-defined functions, but this would be the equivalent query
-- SELECT 
--     id,
--     session_id,
--     (end_time - start_time) as duration_ms,
--     agent_count,
--     event_count,
--     error_count,
--     ROUND((error_count * 100.0 / NULLIF(event_count, 0)), 2) as error_rate,
--     status
-- FROM traces WHERE id = ?;

-- ============================================================================
-- Materialized Views for Performance (Implemented as Tables with Triggers)
-- ============================================================================

-- Hourly aggregated metrics
CREATE TABLE metrics_hourly (
    hour_timestamp INTEGER PRIMARY KEY,
    trace_count INTEGER DEFAULT 0,
    event_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    avg_latency REAL DEFAULT 0,
    avg_cpu_usage REAL DEFAULT 0,
    avg_memory_usage REAL DEFAULT 0,
    compression_ratio REAL DEFAULT 0,
    storage_size_bytes INTEGER DEFAULT 0,
    updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX idx_metrics_hourly_time ON metrics_hourly(hour_timestamp);

-- Trigger to update hourly metrics
CREATE TRIGGER update_hourly_metrics
AFTER INSERT ON events
BEGIN
    INSERT OR REPLACE INTO metrics_hourly (hour_timestamp)
    VALUES ((NEW.timestamp / 3600000) * 3600000);
    
    -- This would need to be a more complex aggregation in a real implementation
    -- UPDATE metrics_hourly SET ... WHERE hour_timestamp = ...;
END;

-- ============================================================================
-- Initial Configuration Data
-- ============================================================================

-- Default performance thresholds
INSERT INTO health_events (id, timestamp, component, severity, event_type, message, resolved)
VALUES 
    ('init-1', unixepoch() * 1000, 'system', 'low', 'initialization', 'Tracing system initialized', true),
    ('threshold-cpu', unixepoch() * 1000, 'collector', 'medium', 'configuration', 'CPU overhead threshold: 5%', true),
    ('threshold-memory', unixepoch() * 1000, 'storage', 'medium', 'configuration', 'Memory footprint limit: 100MB', true),
    ('threshold-latency', unixepoch() * 1000, 'streaming', 'medium', 'configuration', 'Streaming latency target: <100ms', true);

-- ============================================================================
-- Cleanup and Archival Procedures
-- ============================================================================

-- Note: In a production environment, these would be scheduled procedures

-- Archive old completed traces
-- DELETE FROM traces WHERE status = 'completed' AND end_time < (unixepoch() * 1000 - 604800000); -- 7 days

-- Compress old snapshots
-- UPDATE snapshots SET state_data = compress(state_data) WHERE timestamp < (unixepoch() * 1000 - 86400000); -- 1 day

-- Vacuum database periodically for space reclamation
-- VACUUM;

-- Update statistics for query optimization
-- ANALYZE;