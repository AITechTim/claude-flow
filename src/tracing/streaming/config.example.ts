/**
 * Example configuration for WebSocket trace streaming server
 * Copy this file and modify according to your needs
 */

import type { StreamingConfig } from './trace-streamer.js';
import type { TracingConfig } from '../types.js';

// Production configuration example
export const productionStreamingConfig: StreamingConfig = {
  enabled: true,
  port: 8080,
  maxConnections: 1000,
  heartbeatInterval: 30000,
  compressionEnabled: true,
  batchSize: 100,
  batchTimeout: 2000,
  maxMessageSize: 5 * 1024 * 1024, // 5MB

  // Authentication configuration
  auth: {
    enabled: true,
    jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
    apiKeyHeader: 'X-API-Key',
    validApiKeys: new Set([
      process.env.API_KEY_1,
      process.env.API_KEY_2,
      process.env.API_KEY_3
    ].filter(Boolean))
  },

  // Rate limiting for production
  rateLimit: {
    windowMs: 60000, // 1 minute
    maxMessages: 1000,
    maxBytesPerWindow: 50 * 1024 * 1024 // 50MB per minute
  },

  // Backpressure handling
  backpressure: {
    highWaterMark: 128 * 1024, // 128KB
    lowWaterMark: 32 * 1024,   // 32KB
    maxQueueSize: 10000,
    dropOldest: true
  },

  // Advanced options
  binaryProtocol: false,
  reconnectSupport: true,
  historicalDataLimit: 10000,
  compressionLevel: 6
};

// Development configuration example
export const developmentStreamingConfig: StreamingConfig = {
  enabled: true,
  port: 8081,
  maxConnections: 50,
  heartbeatInterval: 10000,
  compressionEnabled: false, // Disabled for easier debugging
  batchSize: 10,
  batchTimeout: 500,
  maxMessageSize: 1024 * 1024, // 1MB

  // No authentication in development
  auth: {
    enabled: false
  },

  // Relaxed rate limiting for development
  rateLimit: {
    windowMs: 60000,
    maxMessages: 10000,
    maxBytesPerWindow: 100 * 1024 * 1024 // 100MB
  },

  // Conservative backpressure settings
  backpressure: {
    highWaterMark: 64 * 1024,
    lowWaterMark: 16 * 1024,
    maxQueueSize: 1000,
    dropOldest: false
  },

  binaryProtocol: false,
  reconnectSupport: true,
  historicalDataLimit: 1000,
  compressionLevel: 1
};

// Testing configuration example
export const testStreamingConfig: StreamingConfig = {
  enabled: true,
  port: 0, // Use random available port
  maxConnections: 10,
  heartbeatInterval: 1000,
  compressionEnabled: false,
  batchSize: 5,
  batchTimeout: 100,
  maxMessageSize: 64 * 1024, // 64KB

  auth: {
    enabled: false
  },

  rateLimit: {
    windowMs: 1000,
    maxMessages: 100,
    maxBytesPerWindow: 1024 * 1024
  },

  backpressure: {
    highWaterMark: 8 * 1024,
    lowWaterMark: 2 * 1024,
    maxQueueSize: 100,
    dropOldest: true
  },

  binaryProtocol: false,
  reconnectSupport: false,
  historicalDataLimit: 100,
  compressionLevel: 1
};

// High-performance configuration for large deployments
export const highPerformanceStreamingConfig: StreamingConfig = {
  enabled: true,
  port: 8080,
  maxConnections: 10000,
  heartbeatInterval: 60000,
  compressionEnabled: true,
  batchSize: 500,
  batchTimeout: 5000,
  maxMessageSize: 10 * 1024 * 1024, // 10MB

  auth: {
    enabled: true,
    jwtSecret: process.env.JWT_SECRET!,
    validApiKeys: new Set(process.env.API_KEYS?.split(',') || [])
  },

  rateLimit: {
    windowMs: 60000,
    maxMessages: 5000,
    maxBytesPerWindow: 500 * 1024 * 1024 // 500MB
  },

  backpressure: {
    highWaterMark: 1024 * 1024, // 1MB
    lowWaterMark: 256 * 1024,   // 256KB
    maxQueueSize: 50000,
    dropOldest: true
  },

  binaryProtocol: true, // Use binary protocol for better performance
  reconnectSupport: true,
  historicalDataLimit: 50000,
  compressionLevel: 9 // Maximum compression
};

// Corresponding tracing configurations
export const productionTracingConfig: TracingConfig = {
  enabled: true,
  samplingRate: 0.1, // Sample 10% of events in production
  bufferSize: 10000,
  flushInterval: 30000,
  storageRetention: 7 * 24 * 60 * 60 * 1000, // 7 days
  compressionEnabled: true,
  realtimeStreaming: true,
  performanceMonitoring: true
};

export const developmentTracingConfig: TracingConfig = {
  enabled: true,
  samplingRate: 1.0, // Capture all events in development
  bufferSize: 1000,
  flushInterval: 5000,
  storageRetention: 24 * 60 * 60 * 1000, // 1 day
  compressionEnabled: false,
  realtimeStreaming: true,
  performanceMonitoring: true
};

// Factory function to get configuration based on environment
export function getStreamingConfig(env: string = process.env.NODE_ENV || 'development'): StreamingConfig {
  switch (env) {
    case 'production':
      return productionStreamingConfig;
    case 'test':
      return testStreamingConfig;
    case 'high-performance':
      return highPerformanceStreamingConfig;
    default:
      return developmentStreamingConfig;
  }
}

export function getTracingConfig(env: string = process.env.NODE_ENV || 'development'): TracingConfig {
  switch (env) {
    case 'production':
    case 'high-performance':
      return productionTracingConfig;
    default:
      return developmentTracingConfig;
  }
}

// Validation function
export function validateStreamingConfig(config: StreamingConfig): void {
  if (config.port < 0 || config.port > 65535) {
    throw new Error('Invalid port number');
  }

  if (config.maxConnections <= 0) {
    throw new Error('maxConnections must be positive');
  }

  if (config.batchSize <= 0) {
    throw new Error('batchSize must be positive');
  }

  if (config.batchTimeout <= 0) {
    throw new Error('batchTimeout must be positive');
  }

  if (config.auth?.enabled && !config.auth.jwtSecret && (!config.auth.validApiKeys || config.auth.validApiKeys.size === 0)) {
    throw new Error('Authentication enabled but no credentials provided');
  }

  if (config.rateLimit && (config.rateLimit.maxMessages <= 0 || config.rateLimit.windowMs <= 0)) {
    throw new Error('Invalid rate limit configuration');
  }
}

// Example usage:
// const config = getStreamingConfig();
// validateStreamingConfig(config);
// const streamer = new TraceStreamer(config, eventBus, storage, tracingConfig);