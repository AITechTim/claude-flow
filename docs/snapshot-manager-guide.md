# SnapshotManager - Time-Travel Debugging Guide

The SnapshotManager is a comprehensive component for creating, managing, and retrieving snapshots of system state for time-travel debugging in the Claude Flow tracing system.

## Features

### ✨ Core Features

- **Automatic Snapshot Creation**: Configurable intervals for automatic state snapshots
- **Manual Snapshot Creation**: On-demand snapshots with tagging and descriptions
- **Compression & Storage**: Efficient storage with gzip compression and space optimization
- **Quick Search**: Fast snapshot retrieval with flexible search criteria
- **Incremental Snapshots**: Space-efficient incremental snapshots for large states
- **Import/Export**: Portable snapshot data for backup and sharing
- **Integrity Validation**: Checksum validation for data integrity
- **Memory Management**: Configurable retention policies and cleanup

### 🚀 Advanced Features

- **Hybrid Storage**: Memory + disk storage options for optimal performance
- **Event-Driven**: EventEmitter-based architecture for lifecycle hooks
- **Performance Monitoring**: Built-in statistics and performance tracking
- **State Comparison**: Detailed diff analysis between snapshots
- **Tag Management**: Organize snapshots with tags and metadata
- **Batch Operations**: Efficient bulk operations for large datasets

## Quick Start

```typescript
import { SnapshotManager } from './snapshot-manager.js';
import { TraceStorage } from '../storage/trace-storage.js';

// Initialize storage
const storage = new TraceStorage(storageConfig, tracingConfig);

// Create snapshot manager
const snapshotManager = new SnapshotManager(storage, {
  automaticInterval: 30000,        // 30 seconds
  maxSnapshots: 1000,
  compressionEnabled: true,
  storageType: 'hybrid',
  incrementalEnabled: true
});

// Create a snapshot
const snapshotId = await snapshotManager.createSnapshot(
  'session-id', 
  currentSystemState, 
  {
    tags: ['milestone', 'before-deployment'],
    description: 'State before major deployment'
  }
);

// Start automatic snapshots
snapshotManager.startAutomaticSnapshots('session-id');
```

## Configuration

### SnapshotConfig Options

```typescript
interface SnapshotConfig {
  // Timing
  automaticInterval: number;        // ms between auto snapshots (default: 30s)
  maxRetentionTime: number;         // ms to keep snapshots (default: 24h)
  maxSnapshots: number;             // max snapshots per session (default: 1000)
  
  // Compression
  compressionEnabled: boolean;      // enable gzip compression (default: true)
  compressionThreshold: number;     // min size to compress (default: 1KB)
  
  // Storage
  storageType: 'memory' | 'disk' | 'hybrid';  // storage backend (default: hybrid)
  persistenceEnabled: boolean;      // persist to disk (default: true)
  
  // Advanced
  incrementalEnabled: boolean;      // enable incremental snapshots (default: true)
  checksumValidation: boolean;      // validate integrity (default: true)
  taggedSnapshotsOnly: boolean;     // only keep tagged snapshots (default: false)
}
```

## API Reference

### Core Methods

#### `createSnapshot(sessionId, state, options)`

Create a manual snapshot with optional configuration.

```typescript
const snapshotId = await snapshotManager.createSnapshot(
  'session-123',
  systemState,
  {
    tags: ['important', 'milestone'],
    description: 'Critical checkpoint',
    type: 'full',  // 'full' | 'incremental'
    forceCompression: true
  }
);
```

#### `getSnapshot(snapshotId)`

Retrieve a snapshot by ID.

```typescript
const snapshot = await snapshotManager.getSnapshot('snapshot-456');
if (snapshot) {
  console.log(`Snapshot: ${snapshot.description}`);
  console.log(`Size: ${snapshot.size} bytes`);
  console.log(`Tags: ${snapshot.tags.join(', ')}`);
}
```

#### `findNearestSnapshot(sessionId, timestamp)`

Find the closest snapshot to a specific timestamp.

```typescript
const nearestSnapshot = await snapshotManager.findNearestSnapshot(
  'session-123',
  Date.now() - 3600000  // 1 hour ago
);
```

### Search & Query

#### `searchSnapshots(options)`

Search snapshots with flexible criteria.

```typescript
const results = await snapshotManager.searchSnapshots({
  sessionId: 'session-123',
  tags: ['milestone'],
  timeRange: { start: startTime, end: endTime },
  type: 'full',
  sortBy: 'timestamp',
  sortDirection: 'desc',
  limit: 10
});
```

#### `compareSnapshots(snapshot1Id, snapshot2Id)`

Compare two snapshots and get detailed differences.

```typescript
const comparison = await snapshotManager.compareSnapshots(
  'snapshot-1',
  'snapshot-2'
);

console.log(`Changes: ${comparison.summary.totalChanges}`);
console.log(`Agents changed: ${comparison.summary.agentsChanged}`);
console.log(`Tasks changed: ${comparison.summary.tasksChanged}`);
```

### Automatic Snapshots

#### `startAutomaticSnapshots(sessionId)`

Start automatic snapshot creation for a session.

```typescript
snapshotManager.startAutomaticSnapshots('session-123');
```

#### `stopAutomaticSnapshots(sessionId)`

Stop automatic snapshot creation.

```typescript
snapshotManager.stopAutomaticSnapshots('session-123');
```

### Import/Export

#### `exportSnapshots(sessionId, options)`

Export snapshots to portable format.

```typescript
const exportData = await snapshotManager.exportSnapshots(
  'session-123',
  {
    tags: ['important'],
    timeRange: { start: startTime, end: endTime },
    includeIncrementals: false,
    format: 'json'  // 'json' | 'binary'
  }
);

// Save to file or send to another system
```

#### `importSnapshots(data, options)`

Import snapshots from exported data.

```typescript
const results = await snapshotManager.importSnapshots(
  exportData,
  {
    overwriteExisting: false,
    validateIntegrity: true
  }
);

console.log(`Imported: ${results.imported}, Errors: ${results.errors.length}`);
```

### State Reconstruction

#### `reconstructState(snapshot)`

Reconstruct full system state from any snapshot (handles incrementals).

```typescript
const fullState = await snapshotManager.reconstructState(snapshot);
// Returns complete SystemState object
```

### Utilities

#### `getStatistics()`

Get comprehensive statistics about snapshot usage.

```typescript
const stats = snapshotManager.getStatistics();
console.log(`Total snapshots: ${stats.snapshots.total}`);
console.log(`Storage size: ${Math.round(stats.storage.totalSize / 1024)} KB`);
console.log(`Compression ratio: ${stats.storage.compressionRatio * 100}%`);
```

#### `deleteSnapshot(snapshotId)`

Delete a specific snapshot.

```typescript
const success = await snapshotManager.deleteSnapshot('snapshot-456');
```

## Event Handling

The SnapshotManager extends EventEmitter and emits various events:

```typescript
// Snapshot lifecycle events
snapshotManager.on('snapshot_created', (event) => {
  console.log(`Created: ${event.snapshot.id}`);
});

snapshotManager.on('snapshot_deleted', (event) => {
  console.log(`Deleted: ${event.snapshotId}`);
});

// Automatic snapshot events
snapshotManager.on('automatic_snapshots_started', (event) => {
  console.log(`Auto snapshots started: ${event.sessionId}`);
});

snapshotManager.on('automatic_snapshots_stopped', (event) => {
  console.log(`Auto snapshots stopped: ${event.sessionId}`);
});

// Import/export events
snapshotManager.on('snapshots_imported', (results) => {
  console.log(`Import complete: ${results.imported} snapshots`);
});

// Error events
snapshotManager.on('error', (event) => {
  console.error(`Error: ${event.type} - ${event.error}`);
});

// Shutdown event
snapshotManager.on('shutdown_complete', () => {
  console.log('SnapshotManager shutdown complete');
});
```

## Integration with StateReconstructor

The SnapshotManager integrates seamlessly with the StateReconstructor:

```typescript
import { StateReconstructor } from './state-reconstructor.js';

// StateReconstructor automatically uses SnapshotManager
const reconstructor = new StateReconstructor(storage, {
  automaticInterval: 60000,  // Create snapshots every minute
  compressionEnabled: true,
  incrementalEnabled: true
});

// Reconstructor will automatically:
// 1. Use existing snapshots for faster reconstruction
// 2. Create new snapshots during reconstruction
// 3. Optimize using incremental snapshots
```

## Storage Types

### Memory Storage (`storageType: 'memory'`)

- **Pros**: Fastest access, no disk I/O
- **Cons**: Lost on restart, memory usage
- **Use case**: Short sessions, testing

### Disk Storage (`storageType: 'disk'`)

- **Pros**: Persistent, unlimited size
- **Cons**: Slower access, disk I/O overhead
- **Use case**: Long sessions, production

### Hybrid Storage (`storageType: 'hybrid'`) - Recommended

- **Pros**: Fast recent access + persistent storage
- **Cons**: Slightly more complex
- **Use case**: Most production scenarios

## Performance Optimization

### Compression Settings

```typescript
{
  compressionEnabled: true,
  compressionThreshold: 1024,  // Only compress > 1KB
}
```

### Incremental Snapshots

```typescript
{
  incrementalEnabled: true,  // Saves ~70% space for similar states
}
```

### Retention Policies

```typescript
{
  maxSnapshots: 1000,        // Per session limit
  maxRetentionTime: 86400000, // 24 hours
  taggedSnapshotsOnly: false  // Keep all vs tagged only
}
```

## Best Practices

### 1. Tagging Strategy

```typescript
// Use semantic tags
await snapshotManager.createSnapshot(sessionId, state, {
  tags: [
    'milestone',           // Important checkpoints
    'before-refactor',     // Before major changes
    'error-state',         // When errors occur
    'performance-test'     // Performance benchmarks
  ]
});
```

### 2. Automatic vs Manual

```typescript
// Automatic for ongoing monitoring
snapshotManager.startAutomaticSnapshots(sessionId);

// Manual for important events
await snapshotManager.createSnapshot(sessionId, state, {
  tags: ['deployment-ready'],
  description: 'State ready for production deployment'
});
```

### 3. Cleanup Strategy

```typescript
// Configure retention
const config = {
  maxRetentionTime: 7 * 24 * 60 * 60 * 1000, // 7 days
  taggedSnapshotsOnly: false,  // Keep important snapshots longer
  maxSnapshots: 500  // Per-session limit
};
```

### 4. Error Handling

```typescript
snapshotManager.on('error', (event) => {
  switch (event.type) {
    case 'snapshot_creation_failed':
      // Handle creation errors
      console.error(`Failed to create snapshot: ${event.error}`);
      break;
    case 'automatic_snapshot_failed':
      // Handle automatic snapshot errors
      console.warn(`Auto snapshot failed: ${event.error}`);
      break;
  }
});
```

## Troubleshooting

### Common Issues

#### 1. High Memory Usage

```typescript
// Reduce memory footprint
const config = {
  maxSnapshots: 100,         // Reduce limit
  compressionEnabled: true,  // Enable compression
  storageType: 'disk'       // Use disk storage
};
```

#### 2. Slow Performance

```typescript
// Optimize for speed
const config = {
  compressionThreshold: 10240,  // 10KB threshold
  incrementalEnabled: true,     // Use incrementals
  storageType: 'memory'        // Fast memory storage
};
```

#### 3. Storage Space

```typescript
// Optimize storage
const config = {
  compressionEnabled: true,
  compressionThreshold: 512,   // Compress smaller files
  maxRetentionTime: 86400000, // 1 day retention
  taggedSnapshotsOnly: true   // Only keep important snapshots
};
```

## Advanced Usage

### Custom Event Handlers

```typescript
class CustomSnapshotManager extends SnapshotManager {
  constructor(storage, config) {
    super(storage, config);
    
    this.on('snapshot_created', this.onSnapshotCreated.bind(this));
  }
  
  private onSnapshotCreated(event) {
    // Custom logic for snapshot creation
    if (event.snapshot.size > 1024 * 1024) {
      console.warn(`Large snapshot created: ${event.snapshot.id}`);
    }
  }
}
```

### Integration with External Systems

```typescript
// Export to external backup system
snapshotManager.on('snapshot_created', async (event) => {
  if (event.snapshot.tags.includes('backup')) {
    const exportData = await snapshotManager.exportSnapshots(
      event.snapshot.sessionId,
      { tags: ['backup'], format: 'binary' }
    );
    
    await sendToBackupSystem(exportData);
  }
});
```

## Migration Guide

### From Basic Snapshots

If you're upgrading from a basic snapshot system:

```typescript
// Old way
const snapshot = {
  id: generateId(),
  timestamp: Date.now(),
  state: systemState
};

// New way
const snapshotId = await snapshotManager.createSnapshot(
  sessionId,
  systemState,
  {
    tags: ['migration'],
    description: 'Migrated from basic system'
  }
);
```

### Configuration Migration

```typescript
// Old config
const oldConfig = {
  interval: 60000,
  maxSnapshots: 100,
  compressionEnabled: true
};

// New config
const newConfig = {
  automaticInterval: 60000,
  maxSnapshots: 100,
  compressionEnabled: true,
  compressionThreshold: 1024,
  storageType: 'hybrid',
  incrementalEnabled: true,
  persistenceEnabled: true
};
```

## Examples

See `/src/tracing/time-travel/example-usage.ts` for comprehensive examples covering:

- Basic snapshot creation and retrieval
- Search and comparison operations
- Export/import functionality
- Performance monitoring
- Event handling
- StateReconstructor integration

## Support

For issues and questions:

1. Check the troubleshooting section above
2. Review the example usage file
3. Check the event logs for error details
4. File issues with detailed error information

The SnapshotManager is designed to be robust and handle edge cases gracefully, with comprehensive error handling and recovery mechanisms built in.