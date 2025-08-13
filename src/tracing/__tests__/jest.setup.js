/**
 * Jest Test Setup for Tracing System
 */

// Global test timeout for performance tests
jest.setTimeout(60000);

// Mock timers setup
beforeEach(() => {
  jest.useFakeTimers({ advanceTimers: true });
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

// Mock console for cleaner test output
global.console = {
  ...console,
  // Uncomment to silence logs during tests
  // log: jest.fn(),
  // debug: jest.fn(),
  // info: jest.fn(),
  // warn: jest.fn(),
  // error: jest.fn(),
};

// Performance monitoring setup
global.performance = require('perf_hooks').performance;

// Memory management for tests
if (global.gc) {
  beforeEach(() => {
    global.gc();
  });
}

// WebSocket mock for streaming tests
const mockWebSocket = {
  on: jest.fn(),
  send: jest.fn(),
  close: jest.fn(),
  terminate: jest.fn(),
  readyState: 1,
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3
};

global.WebSocket = jest.fn(() => mockWebSocket);

// Database mock helpers
global.createMockDatabase = () => ({
  prepare: jest.fn().mockReturnValue({
    run: jest.fn(),
    get: jest.fn(),
    all: jest.fn().mockReturnValue([])
  }),
  exec: jest.fn(),
  transaction: jest.fn().mockImplementation((fn) => fn),
  close: jest.fn()
});

// Test utilities
global.createTestEvent = (overrides = {}) => ({
  id: `test-${Date.now()}-${Math.random()}`,
  timestamp: Date.now(),
  type: 'TASK_START',
  agentId: 'test-agent',
  swarmId: 'test-swarm',
  sessionId: 'test-session',
  data: {},
  metadata: {
    source: 'test',
    severity: 'low',
    tags: ['test'],
    correlationId: `test-${Date.now()}`
  },
  ...overrides
});

global.createTestConfig = (overrides = {}) => ({
  enabled: true,
  samplingRate: 1.0,
  bufferSize: 100,
  flushInterval: 1000,
  storageRetention: 3600,
  compressionEnabled: false,
  realtimeStreaming: false,
  performanceMonitoring: true,
  ...overrides
});

// Async test helpers
global.waitFor = (ms) => new Promise(resolve => setTimeout(resolve, ms));

global.waitForCondition = async (condition, timeout = 5000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) {
      return true;
    }
    await waitFor(10);
  }
  throw new Error(`Condition not met within ${timeout}ms`);
};

// Error handling
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Promise Rejection:', err);
});