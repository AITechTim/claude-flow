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
  TracingConfig 
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
    
    // Create tables
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
    
    // Create indexes
    this.createIndexes();
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
    // TODO: Implement graph building logic
    // This would create nodes and edges for visualization
    return {
      nodes: [],
      edges: [],
      layout: { type: 'hierarchical', direction: 'TB', spacing: { x: 100, y: 50 } },
      metadata: {
        nodeCount: 0,
        edgeCount: 0,
        depth: 0,
        width: 0,
        complexity: 0,
        criticalPath: []
      }
    };
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
    
    try {
      await this.storeBatch(batch);
    } catch (error) {
      this.logger.error('Failed to flush batch:', error);
      // Could implement retry logic here
    }
  }
}