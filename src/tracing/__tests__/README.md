# Tracing System Test Suite

This directory contains comprehensive tests for the Claude Flow tracing system, designed to validate functionality, performance, and reliability across all components.

## Test Structure

### 1. Unit Tests (`trace-collector.test.ts`)

**Purpose**: Validate TraceCollector core functionality in isolation

**Test Categories**:
- **Initialization**: Component setup and configuration validation
- **Collection Control**: Start/stop lifecycle management
- **Event Collection**: Event processing, validation, and filtering
- **Trace Lifecycle**: Start/complete/error trace operations
- **Agent Traces**: Agent state tracking and management
- **Backpressure Handling**: Buffer management under load
- **Performance Metrics**: Collection overhead and throughput monitoring
- **Event Filtering**: Filter application and management
- **Flush Operations**: Manual and automatic buffer flushing
- **Adaptive Sampling**: Dynamic sampling rate adjustment
- **System Events**: Error capture and system monitoring
- **Edge Cases**: Null/invalid input handling
- **Memory Management**: Resource cleanup and limits

**Key Features Tested**:
- ✅ Event validation and preprocessing
- ✅ Sampling rate enforcement (0.0 to 1.0)
- ✅ Buffer management with configurable size
- ✅ Backpressure handling with priority-based dropping
- ✅ Agent state tracking across event lifecycle
- ✅ Performance metrics calculation
- ✅ Error handling and recovery
- ✅ Memory usage limits (1000 events per agent)
- ✅ Adaptive sampling based on collection overhead

### 2. Integration Tests (`integration.test.ts`)

**Purpose**: Validate end-to-end system functionality and component interactions

**Test Categories**:
- **End-to-End Trace Flow**: Complete collection → storage → retrieval
- **Real-time Streaming**: WebSocket streaming to multiple clients
- **EventBus Integration**: Event bus operation tracing
- **Performance Under Load**: High-throughput scenarios
- **Error Recovery**: Failure handling and system resilience
- **Data Consistency**: Cross-restart data integrity
- **Advanced Queries**: Complex filtering and graph generation

**Key Integration Points**:
- ✅ TraceCollector → TraceStorage → Database persistence
- ✅ TraceCollector → TraceStreamer → WebSocket clients
- ✅ EventBusTracer → TraceCollector integration
- ✅ Multi-component error handling
- ✅ Concurrent client streaming support
- ✅ Database transaction integrity
- ✅ Session management across restarts

### 3. Performance Tests (`performance.test.ts`)

**Purpose**: Validate system performance characteristics and benchmarks

**Performance Thresholds**:
```javascript
const THRESHOLDS = {
  MAX_COLLECTION_OVERHEAD: 0.05,    // 5% max overhead
  MAX_EVENT_PROCESSING_TIME: 1,     // 1ms per event
  MAX_FLUSH_TIME: 100,             // 100ms for 1000 events
  MAX_QUERY_TIME: 50,              // 50ms for complex queries
  MIN_THROUGHPUT: 10000,           // 10k events per second
  MAX_MEMORY_GROWTH: 50MB          // 50MB max memory growth
};
```

**Test Categories**:
- **Collection Performance**: Event processing overhead and throughput
- **Storage Performance**: Database operations and batch processing
- **Memory Performance**: Memory usage patterns and leak detection
- **Streaming Performance**: Real-time event streaming latency
- **Stress Tests**: Extreme load conditions (1M+ events)
- **Resource Efficiency**: Database optimization and indexing

**Benchmarks Validated**:
- ✅ >10,000 events/second sustained throughput
- ✅ <5% collection overhead under normal load
- ✅ <1ms average event processing time
- ✅ <100ms latency for real-time streaming
- ✅ <50MB memory growth under sustained load
- ✅ Sub-linear scaling for batch operations

## Running Tests

### Prerequisites

```bash
npm install --save-dev @jest/globals jest ts-jest @types/jest ws @types/ws better-sqlite3
```

### Individual Test Suites

```bash
# Unit tests only
npm test -- trace-collector.test.ts

# Integration tests only  
npm test -- integration.test.ts

# Performance tests only
npm test -- performance.test.ts
```

### Full Test Suite

```bash
# Run all tracing tests
npm test src/tracing/__tests__

# Run with coverage
npm test -- --coverage src/tracing/__tests__

# Run performance tests with extended timeout
npm test -- --testTimeout=120000 performance.test.ts
```

### Test Configuration

The test suite includes specialized configuration:

- **Jest Setup**: Custom matchers and global utilities
- **Mock Framework**: WebSocket, Database, and EventBus mocking
- **Performance Monitoring**: Built-in memory and timing utilities
- **Coverage Targets**: >80% coverage across branches, functions, lines, statements

## Test Data Patterns

### Event Generation

```typescript
// Standard test event
const testEvent = {
  type: TraceEventType.TASK_START,
  agentId: 'test-agent-1',
  swarmId: 'test-swarm',
  data: { taskId: 'task-1', priority: 'high' },
  metadata: {
    source: 'test',
    severity: 'low',
    tags: ['test', 'unit'],
    correlationId: 'test-correlation-1'
  }
};

// High-volume pattern
for (let i = 0; i < 10000; i++) {
  collector.collectEvent({
    type: TraceEventType.TASK_START,
    agentId: `agent-${i % 100}`,    // 100 unique agents
    swarmId: `swarm-${i % 10}`,     // 10 unique swarms  
    data: { index: i, batch: Math.floor(i / 1000) }
  });
}
```

### Performance Scenarios

```typescript
// Memory stress test
const LARGE_PAYLOAD = 'x'.repeat(1000); // 1KB per event
const STRESS_EVENT_COUNT = 1000000;     // 1M events

// Concurrency test  
const CONCURRENT_WORKERS = 10;
const EVENTS_PER_WORKER = 5000;

// Latency test
const STREAMING_CLIENTS = 5;
const LATENCY_SAMPLES = 1000;
```

## Coverage Requirements

The test suite enforces comprehensive coverage:

| Component | Lines | Functions | Branches | Statements |
|-----------|-------|-----------|----------|------------|
| TraceCollector | >80% | >80% | >80% | >80% |
| TraceStorage | >80% | >80% | >80% | >80% |
| EventBusTracer | >80% | >80% | >80% | >80% |
| Integration Points | >75% | >75% | >75% | >75% |

### Excluded from Coverage

- Type definitions (`*.d.ts`)
- Test files (`__tests__/**`)
- Generated code
- External dependencies

## Performance Benchmarking

### Baseline Measurements

Performance tests establish baseline metrics:

```
Collection Performance:
├── Throughput: >10,000 events/sec
├── Overhead: <5% of application time  
├── Latency: <1ms average processing
└── Memory: <50MB growth under load

Storage Performance:
├── Batch Write: >5,000 events/sec
├── Query Time: <50ms complex queries
├── Index Efficiency: Sub-linear scaling
└── Transaction Safety: ACID compliance

Streaming Performance:  
├── Client Latency: <100ms end-to-end
├── Concurrent Clients: 100+ supported
├── Message Rate: >1,000 messages/sec
└── Connection Stability: <1% drop rate
```

### Regression Detection

Tests automatically fail if performance degrades beyond thresholds:

```typescript
// Example threshold validation
expect(throughput).toBeGreaterThan(PERFORMANCE_THRESHOLDS.MIN_THROUGHPUT);
expect(overhead).toBeLessThan(PERFORMANCE_THRESHOLDS.MAX_COLLECTION_OVERHEAD);
expect(memoryGrowth).toBeLessThan(PERFORMANCE_THRESHOLDS.MAX_MEMORY_GROWTH);
```

## Debugging Test Failures

### Common Issues

1. **Timing Issues**: Use `jest.advanceTimersByTime()` for timer-dependent tests
2. **Memory Leaks**: Check for unclosed resources (database connections, timers)
3. **Race Conditions**: Use proper `await` patterns and `waitForCondition()` helper
4. **Mock Issues**: Verify mock implementations match expected interfaces

### Debug Utilities

```typescript
// Enable detailed logging
process.env.DEBUG_TRACING = 'true';

// Memory monitoring  
console.log('Memory:', process.memoryUsage());

// Event inspection
collector.on('event-collected', console.log);

// Performance profiling
const start = performance.now();
// ... operation
console.log(`Operation took: ${performance.now() - start}ms`);
```

## Contributing

When adding new tests:

1. **Follow Naming Convention**: `describe('Component Name')` → `test('should behavior')`
2. **Include Edge Cases**: Test null/undefined/invalid inputs
3. **Validate Error Handling**: Ensure graceful failure modes
4. **Add Performance Assertions**: Include timing and memory checks
5. **Document Complex Tests**: Add comments explaining test scenarios
6. **Update Thresholds**: Adjust performance thresholds if system capabilities change

### Test Template

```typescript
describe('New Component', () => {
  beforeEach(() => {
    // Setup
  });

  afterEach(() => {
    // Cleanup
  });

  describe('Core Functionality', () => {
    test('should handle normal operation', () => {
      // Arrange
      // Act  
      // Assert
    });

    test('should handle error conditions', () => {
      // Test error scenarios
    });
  });

  describe('Performance', () => {
    test('should meet performance thresholds', () => {
      // Performance validation
    });
  });

  describe('Edge Cases', () => {
    test('should handle boundary conditions', () => {
      // Edge case testing
    });
  });
});
```

This comprehensive test suite ensures the tracing system maintains high quality, performance, and reliability standards across all use cases and deployment scenarios.