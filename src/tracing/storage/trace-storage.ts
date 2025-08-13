/**
 * High-performance trace storage with SQLite backend
 * Supports time-travel queries, indexing, and compression
 */

import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { 
  TraceEvent, 
  TraceSession, 
  TraceGraph, 
  TimeRange,
  SystemState,
  TracingConfig,
  TraceEventType,
  AgentState,
  PerformanceMetrics
} from '../types.js';
import { Logger } from '../../core/logger.js';
import { generateId } from '../../utils/helpers.js';

export interface StorageConfig {
  databasePath: string;
  maxFileSize: number;
  maxFiles: number;
  compressionLevel: number;
  indexingEnabled: boolean;
  vacuumInterval: number;
}

export class TraceStorage {
  private db: Database.Database;
  private config: StorageConfig;
  private logger: Logger;
  private statements: Map<string, Database.Statement> = new Map();
  private writeQueue: TraceEvent[] = [];
  private batchSize = 1000;
  private flushTimer?: NodeJS.Timeout;

  constructor(config: StorageConfig, tracingConfig: TracingConfig) {
    this.config = config;
    this.logger = new Logger('TraceStorage');
    
    this.db = new Database(config.databasePath, {
      verbose: tracingConfig.level === 'debug' ? this.logger.debug.bind(this.logger) : undefined
    });
    
    this.initializeDatabase();
    this.prepareStatements();
    this.startBatchProcessor();
  }

  /**
   * Store a single trace event
   */
  async storeTrace(trace: TraceEvent): Promise<void> {
    this.writeQueue.push(trace);
    
    if (this.writeQueue.length >= this.batchSize) {
      await this.flushBatch();
    }
  }

  /**
   * Store multiple trace events in a batch
   */
  async storeBatch(traces: TraceEvent[]): Promise<void> {
    const transaction = this.db.transaction((events: TraceEvent[]) => {
      const insertStmt = this.getStatement('insertTrace');
      const insertRelStmt = this.getStatement('insertRelationship');
      
      for (const trace of events) {
        try {
          // Compress data if needed
          const compressedData = this.maybeCompress(JSON.stringify(trace.data));
          const compressedMetadata = this.maybeCompress(JSON.stringify(trace.metadata));
          const compressedPerformance = this.maybeCompress(JSON.stringify(trace.performance));
          
          insertStmt.run(
            trace.id,
            trace.sessionId,
            trace.agentId || null,
            trace.type,
            trace.phase,
            trace.timestamp,
            trace.metadata.parentId || null,
            trace.metadata.correlationId,
            compressedData,
            compressedMetadata,
            compressedPerformance,
            Date.now()
          );
          
          // Insert relationship if parent exists
          if (trace.metadata.parentId) {
            try {
              insertRelStmt.run(
                trace.metadata.parentId,
                trace.id,
                this.inferRelationshipType(trace),
                Date.now()
              );
            } catch (error) {
              // Ignore relationship errors (might be duplicate)
              this.logger.debug('Relationship insert error:', error);
            }
          }
        } catch (error) {
          this.logger.error(`Failed to store trace ${trace.id}:`, error);
          throw error;
        }
      }
    });
    
    transaction(traces);
  }

  /**
   * Get traces by session with optional filtering
   */
  async getTracesBySession(
    sessionId: string, 
    options: {
      timeRange?: TimeRange;
      agentIds?: string[];
      eventTypes?: string[];
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<TraceEvent[]> {
    let query = 'SELECT * FROM traces WHERE session_id = ?';
    const params: any[] = [sessionId];
    
    // Add time range filter
    if (options.timeRange) {
      query += ' AND timestamp BETWEEN ? AND ?';
      params.push(options.timeRange.start, options.timeRange.end);
    }
    
    // Add agent filter
    if (options.agentIds && options.agentIds.length > 0) {
      query += ` AND agent_id IN (${options.agentIds.map(() => '?').join(',')})`;
      params.push(...options.agentIds);
    }
    
    // Add event type filter
    if (options.eventTypes && options.eventTypes.length > 0) {
      query += ` AND type IN (${options.eventTypes.map(() => '?').join(',')})`;
      params.push(...options.eventTypes);
    }
    
    query += ' ORDER BY timestamp ASC';
    
    // Add limit and offset
    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
      
      if (options.offset) {
        query += ' OFFSET ?';
        params.push(options.offset);
      }
    }
    
    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params);
    
    return rows.map(row => this.deserializeTrace(row));
  }

  /**
   * Get trace by ID
   */
  async getTrace(id: string): Promise<TraceEvent | null> {
    const stmt = this.getStatement('selectTraceById');
    const row = stmt.get(id);
    
    if (!row) return null;
    
    return this.deserializeTrace(row);
  }

  /**
   * Get child traces for a parent trace
   */
  async getChildTraces(parentId: string): Promise<TraceEvent[]> {
    const stmt = this.getStatement('selectChildTraces');
    const rows = stmt.all(parentId);
    
    return rows.map(row => this.deserializeTrace(row));
  }

  /**
   * Get trace relationships
   */
  async getRelationships(sessionId: string): Promise<Array<{
    parentId: string;
    childId: string;
    type: string;
  }>> {
    const stmt = this.getStatement('selectRelationshipsBySession');
    return stmt.all(sessionId);
  }

  /**
   * Build a trace graph for visualization
   */
  async getTraceGraph(sessionId: string, options: any = {}): Promise<TraceGraph> {
    const traces = await this.getTracesBySession(sessionId, options);
    const relationships = await this.getRelationships(sessionId);
    
    return this.buildTraceGraph(traces, relationships);
  }

  /**
   * Get traces by agent with performance optimization
   */
  async getTracesByAgent(
    agentId: string,
    options: {
      timeRange?: TimeRange;
      eventTypes?: string[];
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<TraceEvent[]> {
    let query = 'SELECT * FROM traces WHERE agent_id = ?';
    const params: any[] = [agentId];
    
    // Add time range filter
    if (options.timeRange) {
      query += ' AND timestamp BETWEEN ? AND ?';
      params.push(options.timeRange.start, options.timeRange.end);
    }
    
    // Add event type filter
    if (options.eventTypes && options.eventTypes.length > 0) {
      query += ` AND type IN (${options.eventTypes.map(() => '?').join(',')})`;
      params.push(...options.eventTypes);
    }
    
    query += ' ORDER BY timestamp ASC';
    
    // Add limit and offset
    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
      
      if (options.offset) {
        query += ' OFFSET ?';
        params.push(options.offset);
      }
    }
    
    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params);
    
    return rows.map(row => this.deserializeTrace(row));
  }

  /**
   * Get traces within a specific time range with optimized indexing
   */
  async getTracesByTimeRange(
    timeRange: TimeRange,
    options: {
      sessionIds?: string[];
      agentIds?: string[];
      eventTypes?: string[];
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<TraceEvent[]> {
    let query = 'SELECT * FROM traces WHERE timestamp BETWEEN ? AND ?';
    const params: any[] = [timeRange.start, timeRange.end];
    
    // Add session filter
    if (options.sessionIds && options.sessionIds.length > 0) {
      query += ` AND session_id IN (${options.sessionIds.map(() => '?').join(',')})`;
      params.push(...options.sessionIds);
    }
    
    // Add agent filter
    if (options.agentIds && options.agentIds.length > 0) {
      query += ` AND agent_id IN (${options.agentIds.map(() => '?').join(',')})`;
      params.push(...options.agentIds);
    }
    
    // Add event type filter
    if (options.eventTypes && options.eventTypes.length > 0) {
      query += ` AND type IN (${options.eventTypes.map(() => '?').join(',')})`;
      params.push(...options.eventTypes);
    }
    
    query += ' ORDER BY timestamp ASC';
    
    // Add limit and offset
    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
      
      if (options.offset) {
        query += ' OFFSET ?';
        params.push(options.offset);
      }
    }
    
    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params);
    
    return rows.map(row => this.deserializeTrace(row));
  }

  /**
   * Store error event for troubleshooting
   */
  async storeErrorEvent(
    traceId: string,
    errorType: string,
    errorMessage: string,
    stackTrace?: string,
    recoveryAction?: string
  ): Promise<void> {
    const stmt = this.getStatement('insertErrorEvent');
    
    stmt.run(
      traceId,
      errorType,
      errorMessage,
      stackTrace || null,
      recoveryAction || null,
      false, // resolved
      Date.now()
    );
  }

  /**
   * Get error events for analysis
   */
  async getErrorEvents(
    options: {
      traceId?: string;
      resolved?: boolean;
      timeRange?: TimeRange;
      limit?: number;
    } = {}
  ): Promise<Array<{
    id: number;
    eventId: string;
    errorType: string;
    errorMessage: string;
    stackTrace?: string;
    recoveryAction?: string;
    resolved: boolean;
    createdAt: number;
  }>> {
    let query = 'SELECT * FROM error_events WHERE 1=1';
    const params: any[] = [];
    
    if (options.traceId) {
      query += ' AND event_id = ?';
      params.push(options.traceId);
    }
    
    if (options.resolved !== undefined) {
      query += ' AND resolved = ?';
      params.push(options.resolved ? 1 : 0);
    }
    
    if (options.timeRange) {
      query += ' AND created_at BETWEEN ? AND ?';
      params.push(options.timeRange.start, options.timeRange.end);
    }
    
    query += ' ORDER BY created_at DESC';
    
    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }
    
    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params);
    
    return rows.map(row => ({
      id: row.id,
      eventId: row.event_id,
      errorType: row.error_type,
      errorMessage: row.error_message,
      stackTrace: row.stack_trace,
      recoveryAction: row.recovery_action,
      resolved: Boolean(row.resolved),
      createdAt: row.created_at
    }));
  }

  /**
   * Mark error as resolved
   */
  async resolveError(errorId: number, recoveryAction?: string): Promise<void> {
    const updates = ['resolved = 1'];
    const params: any[] = [];
    
    if (recoveryAction) {
      updates.push('recovery_action = ?');
      params.push(recoveryAction);
    }
    
    params.push(errorId);
    
    const query = `UPDATE error_events SET ${updates.join(', ')} WHERE id = ?`;
    const stmt = this.db.prepare(query);
    stmt.run(...params);
  }

  /**
   * Create a new session
   */
  async createSession(
    name: string, 
    metadata: Record<string, any> = {}
  ): Promise<string> {
    const sessionId = generateId('session');
    const stmt = this.getStatement('insertSession');
    
    stmt.run(
      sessionId,
      name,
      Date.now(),
      null, // end_time
      'active',
      JSON.stringify(metadata),
      Date.now()
    );
    
    return sessionId;
  }

  /**
   * Update session status
   */
  async updateSession(
    sessionId: string, 
    updates: { 
      status?: string; 
      endTime?: number; 
      metadata?: Record<string, any> 
    }
  ): Promise<void> {
    const updates_sql = [];
    const params = [];
    
    if (updates.status) {
      updates_sql.push('status = ?');
      params.push(updates.status);
    }
    
    if (updates.endTime) {
      updates_sql.push('end_time = ?');
      params.push(updates.endTime);
    }
    
    if (updates.metadata) {
      updates_sql.push('metadata = ?');
      params.push(JSON.stringify(updates.metadata));
    }
    
    if (updates_sql.length === 0) return;
    
    params.push(sessionId);
    
    const query = `UPDATE sessions SET ${updates_sql.join(', ')} WHERE id = ?`;
    const stmt = this.db.prepare(query);
    stmt.run(...params);
  }

  /**
   * Get session information
   */
  async getSession(sessionId: string): Promise<TraceSession | null> {
    const stmt = this.getStatement('selectSession');
    const row = stmt.get(sessionId);
    
    if (!row) return null;
    
    return {
      id: row.id,
      name: row.name,
      startTime: row.start_time,
      endTime: row.end_time,
      status: row.status,
      metadata: JSON.parse(row.metadata || '{}'),
      agentCount: 0, // Will be calculated
      traceCount: 0  // Will be calculated
    };
  }

  /**
   * Get all sessions
   */
  async getSessions(limit = 100): Promise<TraceSession[]> {
    const stmt = this.getStatement('selectSessions');
    const rows = stmt.all(limit);
    
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      startTime: row.start_time,
      endTime: row.end_time,
      status: row.status,
      metadata: JSON.parse(row.metadata || '{}'),
      agentCount: 0, // TODO: Calculate from traces
      traceCount: 0  // TODO: Calculate from traces
    }));
  }

  /**
   * Store performance snapshot
   */
  async storePerformanceSnapshot(
    sessionId: string, 
    metrics: Record<string, any>
  ): Promise<void> {
    const stmt = this.getStatement('insertPerformanceSnapshot');
    stmt.run(
      sessionId,
      Date.now(),
      JSON.stringify(metrics),
      Date.now()
    );
  }

  /**
   * Get performance snapshots for a time range
   */
  async getPerformanceSnapshots(
    sessionId: string, 
    timeRange: TimeRange
  ): Promise<Array<{ timestamp: number; metrics: any }>> {
    const stmt = this.getStatement('selectPerformanceSnapshots');
    const rows = stmt.all(sessionId, timeRange.start, timeRange.end);
    
    return rows.map(row => ({
      timestamp: row.timestamp,
      metrics: JSON.parse(row.metrics)
    }));
  }

  /**
   * Archive old traces (move to separate storage)
   */
  async archiveOldTraces(olderThanHours: number): Promise<number> {
    const cutoffTime = Date.now() - (olderThanHours * 60 * 60 * 1000);
    
    const stmt = this.db.prepare('DELETE FROM traces WHERE timestamp < ?');
    const result = stmt.run(cutoffTime);
    
    this.logger.info(`Archived ${result.changes} traces older than ${olderThanHours} hours`);
    return result.changes;
  }

  /**
   * Get storage statistics
   */
  getStorageStats(): {
    traceCount: number;
    sessionCount: number;
    relationshipCount: number;
    fileSize: number;
    indexSize: number;
  } {
    const traceCount = this.db.prepare('SELECT COUNT(*) as count FROM traces').get().count;
    const sessionCount = this.db.prepare('SELECT COUNT(*) as count FROM sessions').get().count;
    const relationshipCount = this.db.prepare('SELECT COUNT(*) as count FROM trace_relationships').get().count;
    
    // Get file size info
    const pragma = this.db.prepare('PRAGMA page_count').get();
    const pageSize = this.db.prepare('PRAGMA page_size').get();
    const fileSize = pragma.page_count * pageSize.page_size;
    
    return {
      traceCount,
      sessionCount,
      relationshipCount,
      fileSize,
      indexSize: 0 // TODO: Calculate index size
    };
  }

  /**
   * Optimize database (VACUUM, ANALYZE)
   */
  async optimize(): Promise<void> {
    this.logger.info('Optimizing database...');
    
    // Flush any pending writes
    await this.flushBatch();
    
    // Vacuum database
    this.db.exec('VACUUM');
    
    // Update statistics
    this.db.exec('ANALYZE');
    
    this.logger.info('Database optimization complete');
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    await this.flushBatch();
    
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    
    this.db.close();
  }

  // Private methods

  private initializeDatabase(): void {
    // Enable WAL mode for better concurrency
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.db.exec('PRAGMA cache_size = 10000');
    this.db.exec('PRAGMA temp_store = MEMORY');
    this.db.exec('PRAGMA foreign_keys = ON');
    
    // Create core tables
    this.createCoreTables();
    this.createSchemaExtensions();
    this.createIndexes();
    
    // Insert initial schema version
    this.db.exec(`
      INSERT OR IGNORE INTO schema_version (version, description) 
      VALUES (1, 'Initial schema with comprehensive tracing support')
    `);
    
    this.logger.info('Database initialized successfully');
  }
  
  /**
   * Create core tracing tables
   */
  private createCoreTables(): void {
    // Main traces table (our format)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS traces (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        agent_id TEXT,
        type TEXT NOT NULL,
        phase TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        parent_id TEXT,
        correlation_id TEXT NOT NULL,
        data BLOB,
        metadata BLOB,
        performance BLOB,
        created_at INTEGER DEFAULT (unixepoch()),
        FOREIGN KEY (parent_id) REFERENCES traces(id)
      )
    `);
    
    // Trace relationships
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trace_relationships (
        id INTEGER PRIMARY KEY,
        parent_id TEXT NOT NULL,
        child_id TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch()),
        UNIQUE(parent_id, child_id),
        FOREIGN KEY (parent_id) REFERENCES traces(id),
        FOREIGN KEY (child_id) REFERENCES traces(id)
      )
    `);
    
    // Sessions
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        status TEXT NOT NULL DEFAULT 'active',
        metadata TEXT,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `);
    
    // Performance snapshots
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS performance_snapshots (
        id INTEGER PRIMARY KEY,
        session_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        metrics TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch()),
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      )
    `);
  }
  
  /**
   * Create schema extensions for full tracing support
   */
  private createSchemaExtensions(): void {
    // Trace events (schema.sql format)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trace_events (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        type TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        swarm_id TEXT NOT NULL,
        data TEXT NOT NULL,
        duration INTEGER,
        parent_id TEXT,
        children TEXT,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (parent_id) REFERENCES trace_events(id)
      )
    `);
    
    // System snapshots
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        swarm_state TEXT NOT NULL,
        agent_states TEXT NOT NULL,
        event_count INTEGER NOT NULL,
        version TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Agent metadata
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        agent_id TEXT PRIMARY KEY,
        agent_type TEXT NOT NULL,
        swarm_id TEXT NOT NULL,
        capabilities TEXT,
        config TEXT,
        spawn_time INTEGER NOT NULL,
        destroy_time INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Performance metrics
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS performance_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        window_size INTEGER NOT NULL,
        agent_id TEXT,
        metric_type TEXT NOT NULL,
        metric_value REAL NOT NULL,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Error tracking
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS error_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL,
        error_type TEXT NOT NULL,
        error_message TEXT NOT NULL,
        stack_trace TEXT,
        recovery_action TEXT,
        resolved BOOLEAN DEFAULT FALSE,
        created_at INTEGER DEFAULT (unixepoch()),
        FOREIGN KEY (event_id) REFERENCES traces(id)
      )
    `);
    
    // Agent messages
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT UNIQUE NOT NULL,
        sender_agent_id TEXT NOT NULL,
        receiver_agent_id TEXT NOT NULL,
        message_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        delivery_status TEXT DEFAULT 'sent',
        response_to TEXT,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `);
    
    // Task execution
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_execution (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT UNIQUE NOT NULL,
        agent_id TEXT NOT NULL,
        swarm_id TEXT NOT NULL,
        task_type TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        payload TEXT NOT NULL,
        start_time INTEGER,
        end_time INTEGER,
        result TEXT,
        error_message TEXT,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `);
    
    // Resource usage
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS resource_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        agent_id TEXT,
        cpu_percent REAL,
        memory_bytes INTEGER,
        disk_bytes INTEGER,
        network_bytes_in INTEGER,
        network_bytes_out INTEGER,
        open_files INTEGER,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `);
    
    // Schema version
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        description TEXT,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  private createIndexes(): void {
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_traces_session_timestamp ON traces(session_id, timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_traces_agent_timestamp ON traces(agent_id, timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_traces_correlation ON traces(correlation_id)',
      'CREATE INDEX IF NOT EXISTS idx_traces_parent_child ON traces(parent_id, id)',
      'CREATE INDEX IF NOT EXISTS idx_traces_type ON traces(type)',
      'CREATE INDEX IF NOT EXISTS idx_relationships_parent ON trace_relationships(parent_id)',
      'CREATE INDEX IF NOT EXISTS idx_relationships_child ON trace_relationships(child_id)',
      'CREATE INDEX IF NOT EXISTS idx_performance_session_time ON performance_snapshots(session_id, timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)'
    ];
    
    indexes.forEach(sql => this.db.exec(sql));
  }

  private prepareStatements(): void {
    // Trace operations
    this.statements.set('insertTrace', this.db.prepare(`
      INSERT INTO traces (
        id, session_id, agent_id, type, phase, timestamp,
        parent_id, correlation_id, data, metadata, performance, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `));
    
    this.statements.set('selectTraceById', this.db.prepare(`
      SELECT * FROM traces WHERE id = ?
    `));
    
    this.statements.set('selectChildTraces', this.db.prepare(`
      SELECT t.* FROM traces t 
      INNER JOIN trace_relationships r ON t.id = r.child_id 
      WHERE r.parent_id = ?
      ORDER BY t.timestamp ASC
    `));
    
    // Relationship operations
    this.statements.set('insertRelationship', this.db.prepare(`
      INSERT OR IGNORE INTO trace_relationships (parent_id, child_id, relationship_type, created_at)
      VALUES (?, ?, ?, ?)
    `));
    
    this.statements.set('selectRelationshipsBySession', this.db.prepare(`
      SELECT DISTINCT r.parent_id, r.child_id, r.relationship_type as type
      FROM trace_relationships r
      INNER JOIN traces t ON r.parent_id = t.id
      WHERE t.session_id = ?
    `));
    
    // Session operations
    this.statements.set('insertSession', this.db.prepare(`
      INSERT INTO sessions (id, name, start_time, end_time, status, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `));
    
    this.statements.set('selectSession', this.db.prepare(`
      SELECT * FROM sessions WHERE id = ?
    `));
    
    this.statements.set('selectSessions', this.db.prepare(`
      SELECT * FROM sessions ORDER BY start_time DESC LIMIT ?
    `));
    
    // Performance operations
    this.statements.set('insertPerformanceSnapshot', this.db.prepare(`
      INSERT INTO performance_snapshots (session_id, timestamp, metrics, created_at)
      VALUES (?, ?, ?, ?)
    `));
    
    this.statements.set('selectPerformanceSnapshots', this.db.prepare(`
      SELECT timestamp, metrics FROM performance_snapshots
      WHERE session_id = ? AND timestamp BETWEEN ? AND ?
      ORDER BY timestamp ASC
    `));
    
    // Error event operations
    this.statements.set('insertErrorEvent', this.db.prepare(`
      INSERT INTO error_events (event_id, error_type, error_message, stack_trace, recovery_action, resolved, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `));
    
    // Agent message operations
    this.statements.set('insertAgentMessage', this.db.prepare(`
      INSERT INTO agent_messages (message_id, sender_agent_id, receiver_agent_id, message_type, payload, timestamp, delivery_status, response_to, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `));
    
    this.statements.set('selectAgentMessages', this.db.prepare(`
      SELECT * FROM agent_messages
      WHERE (sender_agent_id = ? OR receiver_agent_id = ?) AND timestamp BETWEEN ? AND ?
      ORDER BY timestamp ASC
    `));
    
    // Task execution operations
    this.statements.set('insertTaskExecution', this.db.prepare(`
      INSERT INTO task_execution (task_id, agent_id, swarm_id, task_type, status, priority, payload, start_time, end_time, result, error_message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `));
    
    this.statements.set('updateTaskExecution', this.db.prepare(`
      UPDATE task_execution SET status = ?, end_time = ?, result = ?, error_message = ?
      WHERE task_id = ?
    `));
    
    this.statements.set('selectTasksByAgent', this.db.prepare(`
      SELECT * FROM task_execution WHERE agent_id = ? ORDER BY start_time DESC LIMIT ?
    `));
    
    // Resource usage operations
    this.statements.set('insertResourceUsage', this.db.prepare(`
      INSERT INTO resource_usage (timestamp, agent_id, cpu_percent, memory_bytes, disk_bytes, network_bytes_in, network_bytes_out, open_files, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `));
    
    this.statements.set('selectResourceUsage', this.db.prepare(`
      SELECT * FROM resource_usage
      WHERE agent_id = ? AND timestamp BETWEEN ? AND ?
      ORDER BY timestamp ASC
    `));
  }

  private getStatement(name: string): Database.Statement {
    const stmt = this.statements.get(name);
    if (!stmt) {
      throw new Error(`Prepared statement '${name}' not found`);
    }
    return stmt;
  }

  private maybeCompress(data: string): Buffer {
    if (data.length > this.config.compressionLevel) {
      return gzipSync(Buffer.from(data));
    }
    return Buffer.from(data);
  }

  private maybeDecompress(data: Buffer): string {
    try {
      // Try to decompress first
      return gunzipSync(data).toString();
    } catch {
      // If decompression fails, assume it's uncompressed
      return data.toString();
    }
  }

  private deserializeTrace(row: any): TraceEvent {
    return {
      id: row.id,
      timestamp: row.timestamp,
      sessionId: row.session_id,
      agentId: row.agent_id,
      type: row.type,
      phase: row.phase,
      data: JSON.parse(this.maybeDecompress(row.data)),
      metadata: JSON.parse(this.maybeDecompress(row.metadata)),
      performance: JSON.parse(this.maybeDecompress(row.performance))
    };
  }

  private inferRelationshipType(trace: TraceEvent): string {
    // Infer relationship type based on trace data
    if (trace.type === 'communication') return 'communication';
    if (trace.phase === 'start') return 'spawn';
    if (trace.data.parallel) return 'parallel';
    return 'sequence';
  }

  private buildTraceGraph(traces: TraceEvent[], relationships: any[]): TraceGraph {
    // Create nodes from traces
    const nodes = traces.map(trace => ({
      id: trace.id,
      label: `${trace.type} (${trace.agentId || 'system'})`,
      type: trace.type,
      agentId: trace.agentId,
      timestamp: trace.timestamp,
      duration: trace.performance?.duration || 0,
      data: {
        ...trace.data,
        metadata: trace.metadata,
        performance: trace.performance
      },
      position: { x: 0, y: 0 }, // Will be calculated by layout algorithm
      style: this.getNodeStyle(trace)
    }));
    
    // Create edges from relationships
    const edges = relationships.map(rel => ({
      id: `${rel.parentId}-${rel.childId}`,
      source: rel.parentId,
      target: rel.childId,
      type: rel.type,
      label: rel.type,
      style: this.getEdgeStyle(rel.type)
    }));
    
    // Calculate graph metadata
    const rootNodes = nodes.filter(node => 
      !relationships.some(rel => rel.childId === node.id)
    );
    
    const depth = this.calculateGraphDepth(nodes, relationships);
    const width = this.calculateGraphWidth(nodes, relationships);
    const criticalPath = this.findCriticalPath(nodes, relationships);
    
    return {
      nodes,
      edges,
      layout: { 
        type: 'hierarchical', 
        direction: 'TB', 
        spacing: { x: 150, y: 100 },
        nodeSize: { width: 120, height: 60 },
        rankSep: 100,
        nodeSep: 50
      },
      metadata: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        depth,
        width,
        complexity: this.calculateComplexity(nodes, edges),
        criticalPath,
        rootNodes: rootNodes.length,
        executionTime: this.calculateTotalExecutionTime(traces)
      }
    };
  }
  
  private getNodeStyle(trace: TraceEvent) {
    const baseStyle = {
      width: 120,
      height: 60,
      borderRadius: 8,
      fontSize: 12,
      fontWeight: 500
    };
    
    // Color based on trace type
    switch (trace.type) {
      case 'task_start':
        return { ...baseStyle, backgroundColor: '#e3f2fd', borderColor: '#1976d2' };
      case 'task_complete':
        return { ...baseStyle, backgroundColor: '#e8f5e8', borderColor: '#388e3c' };
      case 'task_fail':
        return { ...baseStyle, backgroundColor: '#ffebee', borderColor: '#d32f2f' };
      case 'communication':
        return { ...baseStyle, backgroundColor: '#fff3e0', borderColor: '#f57c00' };
      default:
        return { ...baseStyle, backgroundColor: '#f5f5f5', borderColor: '#757575' };
    }
  }
  
  private getEdgeStyle(type: string) {
    const baseStyle = {
      strokeWidth: 2,
      fontSize: 10
    };
    
    switch (type) {
      case 'spawn':
        return { ...baseStyle, stroke: '#1976d2', strokeDasharray: '0' };
      case 'communication':
        return { ...baseStyle, stroke: '#f57c00', strokeDasharray: '5,5' };
      case 'parallel':
        return { ...baseStyle, stroke: '#388e3c', strokeDasharray: '10,5' };
      default:
        return { ...baseStyle, stroke: '#757575', strokeDasharray: '0' };
    }
  }
  
  private calculateGraphDepth(nodes: any[], relationships: any[]): number {
    const visited = new Set<string>();
    let maxDepth = 0;
    
    const dfs = (nodeId: string, depth: number): number => {
      if (visited.has(nodeId)) return depth;
      visited.add(nodeId);
      
      const children = relationships
        .filter(rel => rel.parentId === nodeId)
        .map(rel => rel.childId);
      
      let currentMaxDepth = depth;
      for (const childId of children) {
        const childDepth = dfs(childId, depth + 1);
        currentMaxDepth = Math.max(currentMaxDepth, childDepth);
      }
      
      return currentMaxDepth;
    };
    
    // Find root nodes and calculate depth from each
    const rootNodes = nodes.filter(node => 
      !relationships.some(rel => rel.childId === node.id)
    );
    
    for (const root of rootNodes) {
      maxDepth = Math.max(maxDepth, dfs(root.id, 1));
    }
    
    return maxDepth;
  }
  
  private calculateGraphWidth(nodes: any[], relationships: any[]): number {
    const levelNodes: { [key: number]: string[] } = {};
    const visited = new Set<string>();
    
    const assignLevels = (nodeId: string, level: number) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      
      if (!levelNodes[level]) levelNodes[level] = [];
      levelNodes[level].push(nodeId);
      
      const children = relationships
        .filter(rel => rel.parentId === nodeId)
        .map(rel => rel.childId);
      
      for (const childId of children) {
        assignLevels(childId, level + 1);
      }
    };
    
    // Find root nodes and assign levels
    const rootNodes = nodes.filter(node => 
      !relationships.some(rel => rel.childId === node.id)
    );
    
    for (const root of rootNodes) {
      assignLevels(root.id, 0);
    }
    
    // Find maximum width (nodes at any level)
    return Math.max(...Object.values(levelNodes).map(level => level.length), 1);
  }
  
  private findCriticalPath(nodes: any[], relationships: any[]): string[] {
    // Find the longest path through the graph (critical path)
    const memo = new Map<string, { path: string[], duration: number }>();
    
    const findLongestPath = (nodeId: string): { path: string[], duration: number } => {
      if (memo.has(nodeId)) {
        return memo.get(nodeId)!;
      }
      
      const node = nodes.find(n => n.id === nodeId);
      const nodeDuration = node?.duration || 0;
      
      const children = relationships
        .filter(rel => rel.parentId === nodeId)
        .map(rel => rel.childId);
      
      if (children.length === 0) {
        const result = { path: [nodeId], duration: nodeDuration };
        memo.set(nodeId, result);
        return result;
      }
      
      let longestChild = { path: [], duration: 0 };
      for (const childId of children) {
        const childResult = findLongestPath(childId);
        if (childResult.duration > longestChild.duration) {
          longestChild = childResult;
        }
      }
      
      const result = {
        path: [nodeId, ...longestChild.path],
        duration: nodeDuration + longestChild.duration
      };
      memo.set(nodeId, result);
      return result;
    };
    
    // Find root nodes and get the longest path among them
    const rootNodes = nodes.filter(node => 
      !relationships.some(rel => rel.childId === node.id)
    );
    
    let criticalPath: string[] = [];
    let maxDuration = 0;
    
    for (const root of rootNodes) {
      const result = findLongestPath(root.id);
      if (result.duration > maxDuration) {
        maxDuration = result.duration;
        criticalPath = result.path;
      }
    }
    
    return criticalPath;
  }
  
  private calculateComplexity(nodes: any[], edges: any[]): number {
    // Calculate cyclomatic complexity based on nodes and edges
    // For directed acyclic graph: complexity = edges - nodes + 2
    // Modified for trace graphs: add weight for branching factor
    const branchingFactor = edges.length > 0 ? edges.length / Math.max(nodes.length - 1, 1) : 1;
    return Math.round((edges.length - nodes.length + 2) * branchingFactor);
  }
  
  private calculateTotalExecutionTime(traces: TraceEvent[]): number {
    if (traces.length === 0) return 0;
    
    const startTime = Math.min(...traces.map(t => t.timestamp));
    const endTime = Math.max(...traces.map(t => t.timestamp));
    
    return endTime - startTime;
  }

  private startBatchProcessor(): void {
    this.flushTimer = setInterval(() => {
      if (this.writeQueue.length > 0) {
        this.flushBatch();
      }
    }, 1000); // Flush every second
  }

  private async flushBatch(): Promise<void> {
    if (this.writeQueue.length === 0) return;
    
    const batch = this.writeQueue.splice(0, this.batchSize);
    const batchId = generateId('flush');
    
    try {
      await this.storeBatch(batch);
      this.logger.debug(`Flushed batch ${batchId} with ${batch.length} traces`);
    } catch (error) {
      this.logger.error(`Failed to flush batch ${batchId}:`, error);
      
      // Return failed traces to queue for retry
      this.writeQueue.unshift(...batch);
      
      // Implement exponential backoff for retries
      const retryCount = this.retryAttempts.get(batchId) || 0;
      if (retryCount < this.maxRetries) {
        this.retryAttempts.set(batchId, retryCount + 1);
        const delay = this.retryDelay * Math.pow(2, retryCount);
        
        setTimeout(() => {
          this.flushBatch();
        }, delay);
        
        this.logger.info(`Scheduled batch retry ${retryCount + 1}/${this.maxRetries} after ${delay}ms`);
      } else {
        this.logger.error(`Batch ${batchId} failed after ${this.maxRetries} retries, dropping ${batch.length} traces`);
        this.retryAttempts.delete(batchId);
      }
    }
  }
  
  /**
   * Initialize connection pool for better concurrency
   */
  private initializeConnectionPool(): void {
    for (let i = 0; i < this.connectionPoolSize; i++) {
      try {
        const conn = new Database(this.config.databasePath, {
          readonly: false,
          fileMustExist: true
        });
        
        // Configure connection
        conn.exec('PRAGMA journal_mode = WAL');
        conn.exec('PRAGMA synchronous = NORMAL');
        conn.exec('PRAGMA cache_size = 5000');
        
        this.connectionPool.push(conn);
      } catch (error) {
        this.logger.warn(`Failed to create connection ${i}:`, error);
      }
    }
    
    this.logger.info(`Initialized connection pool with ${this.connectionPool.length} connections`);
  }
  
  /**
   * Get available connection from pool
   */
  private async getAvailableConnection(): Promise<Database.Database> {
    // Find available connection
    for (let i = 0; i < this.connectionPool.length; i++) {
      if (!this.busyConnections.has(i)) {
        this.busyConnections.add(i);
        return this.connectionPool[i];
      }
    }
    
    // If no connections available, wait and retry
    await new Promise(resolve => setTimeout(resolve, 10));
    return this.getAvailableConnection();
  }
  
  /**
   * Release connection back to pool
   */
  private releaseConnection(connection: Database.Database): void {
    const index = this.connectionPool.indexOf(connection);
    if (index !== -1) {
      this.busyConnections.delete(index);
    }
  }
  
  /**
   * Execute operation with retry logic
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationId: string
  ): Promise<T> {
    let lastError: Error | null = null;
    const retryCount = this.retryAttempts.get(operationId) || 0;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await operation();
        this.retryAttempts.delete(operationId);
        return result;
      } catch (error) {
        lastError = error as Error;
        
        // Check if it's a database busy error
        if (lastError.message.includes('SQLITE_BUSY') && attempt < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, attempt);
          this.logger.debug(`Database busy, retrying ${operationId} in ${delay}ms (attempt ${attempt + 1}/${this.maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        // For non-busy errors, fail immediately
        if (!lastError.message.includes('SQLITE_BUSY')) {
          break;
        }
      }
    }
    
    this.retryAttempts.delete(operationId);
    throw lastError || new Error(`Operation ${operationId} failed after ${this.maxRetries} retries`);
  }
  
  /**
   * Validate trace event before storage
   */
  private validateTrace(trace: TraceEvent): void {
    if (!trace.id) {
      throw new Error('Trace event must have an ID');
    }
    
    if (!trace.timestamp || isNaN(trace.timestamp)) {
      throw new Error('Trace event must have a valid timestamp');
    }
    
    if (!trace.type) {
      throw new Error('Trace event must have a type');
    }
    
    if (!trace.sessionId) {
      throw new Error('Trace event must have a session ID');
    }
    
    // Validate data size to prevent excessive storage usage
    const dataSize = JSON.stringify(trace.data || {}).length;
    if (dataSize > 1024 * 1024) { // 1MB limit
      throw new Error(`Trace data too large: ${dataSize} bytes (max 1MB)`);
    }
  }
  
  /**
   * Start periodic maintenance tasks
   */
  private startMaintenanceTasks(): void {
    // Auto-vacuum every hour
    setInterval(async () => {
      try {
        const stats = this.getStorageStats();
        
        // Only vacuum if database is getting large
        if (stats.fileSize > 100 * 1024 * 1024) { // 100MB
          await this.optimize();
        }
        
        this.logger.debug('Storage stats:', stats);
      } catch (error) {
        this.logger.error('Maintenance task failed:', error);
      }
    }, 60 * 60 * 1000); // 1 hour
    
    // Auto-archive every 24 hours
    setInterval(async () => {
      try {
        const retentionHours = this.config.maxFiles * 24; // Assume maxFiles represents days
        await this.archiveOldTraces(retentionHours);
      } catch (error) {
        this.logger.error('Auto-archive failed:', error);
      }
    }, 24 * 60 * 60 * 1000); // 24 hours
  }

  /**
   * Store agent message
   */
  async storeAgentMessage(
    messageId: string,
    senderAgentId: string,
    receiverAgentId: string,
    messageType: string,
    payload: any,
    responseToId?: string
  ): Promise<void> {
    const stmt = this.getStatement('insertAgentMessage');
    
    stmt.run(
      messageId,
      senderAgentId,
      receiverAgentId,
      messageType,
      JSON.stringify(payload),
      Date.now(),
      'sent',
      responseToId || null,
      Date.now()
    );
  }

  /**
   * Get agent messages
   */
  async getAgentMessages(
    agentId: string,
    timeRange: TimeRange,
    limit = 1000
  ): Promise<any[]> {
    const stmt = this.getStatement('selectAgentMessages');
    const rows = stmt.all(agentId, agentId, timeRange.start, timeRange.end);
    
    return rows.slice(0, limit).map(row => ({
      id: row.id,
      messageId: row.message_id,
      senderAgentId: row.sender_agent_id,
      receiverAgentId: row.receiver_agent_id,
      messageType: row.message_type,
      payload: JSON.parse(row.payload),
      timestamp: row.timestamp,
      deliveryStatus: row.delivery_status,
      responseToId: row.response_to,
      createdAt: row.created_at
    }));
  }

  /**
   * Store task execution record
   */
  async storeTaskExecution(
    taskId: string,
    agentId: string,
    swarmId: string,
    taskType: string,
    status: string,
    priority: string,
    payload: any,
    startTime?: number
  ): Promise<void> {
    const stmt = this.getStatement('insertTaskExecution');
    
    stmt.run(
      taskId,
      agentId,
      swarmId,
      taskType,
      status,
      priority,
      JSON.stringify(payload),
      startTime || Date.now(),
      null, // end_time
      null, // result
      null, // error_message
      Date.now()
    );
  }

  /**
   * Update task execution status
   */
  async updateTaskExecution(
    taskId: string,
    status: string,
    result?: any,
    errorMessage?: string
  ): Promise<void> {
    const stmt = this.getStatement('updateTaskExecution');
    
    stmt.run(
      status,
      Date.now(), // end_time
      result ? JSON.stringify(result) : null,
      errorMessage || null,
      taskId
    );
  }

  /**
   * Get tasks by agent
   */
  async getTasksByAgent(agentId: string, limit = 100): Promise<any[]> {
    const stmt = this.getStatement('selectTasksByAgent');
    const rows = stmt.all(agentId, limit);
    
    return rows.map(row => ({
      id: row.id,
      taskId: row.task_id,
      agentId: row.agent_id,
      swarmId: row.swarm_id,
      taskType: row.task_type,
      status: row.status,
      priority: row.priority,
      payload: JSON.parse(row.payload),
      startTime: row.start_time,
      endTime: row.end_time,
      result: row.result ? JSON.parse(row.result) : null,
      errorMessage: row.error_message,
      createdAt: row.created_at
    }));
  }

  /**
   * Store resource usage snapshot
   */
  async storeResourceUsage(
    agentId: string,
    cpuPercent: number,
    memoryBytes: number,
    diskBytes?: number,
    networkBytesIn?: number,
    networkBytesOut?: number,
    openFiles?: number
  ): Promise<void> {
    const stmt = this.getStatement('insertResourceUsage');
    
    stmt.run(
      Date.now(),
      agentId,
      cpuPercent,
      memoryBytes,
      diskBytes || 0,
      networkBytesIn || 0,
      networkBytesOut || 0,
      openFiles || 0,
      Date.now()
    );
  }

  /**
   * Get resource usage for agent
   */
  async getResourceUsage(
    agentId: string,
    timeRange: TimeRange
  ): Promise<any[]> {
    const stmt = this.getStatement('selectResourceUsage');
    const rows = stmt.all(agentId, timeRange.start, timeRange.end);
    
    return rows.map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      agentId: row.agent_id,
      cpuPercent: row.cpu_percent,
      memoryBytes: row.memory_bytes,
      diskBytes: row.disk_bytes,
      networkBytesIn: row.network_bytes_in,
      networkBytesOut: row.network_bytes_out,
      openFiles: row.open_files,
      createdAt: row.created_at
    }));
  }

  /**
   * Get comprehensive statistics
   */
  getComprehensiveStats(): {
    storage: ReturnType<TraceStorage['getStorageStats']>;
    performance: {
      avgWriteTime: number;
      avgReadTime: number;
      queueLength: number;
      connectionPoolUsage: number;
    };
    health: {
      uptime: number;
      errorRate: number;
      retryRate: number;
    };
  } {
    const storage = this.getStorageStats();
    
    return {
      storage,
      performance: {
        avgWriteTime: 0, // TODO: Implement timing
        avgReadTime: 0,  // TODO: Implement timing
        queueLength: this.writeQueue.length,
        connectionPoolUsage: this.busyConnections.size / this.connectionPool.length
      },
      health: {
        uptime: Date.now() - this.startTime,
        errorRate: 0, // TODO: Track errors
        retryRate: this.retryAttempts.size
      }
    };
  }
}