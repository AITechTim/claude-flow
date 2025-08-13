/**
 * WebSocket Trace Streaming - Public API
 */

export { TraceStreamer, type StreamingConfig } from './trace-streamer.js';
export { TraceStreamingClient, type ClientConfig } from './example-client.js';
export { 
  getStreamingConfig, 
  getTracingConfig, 
  validateStreamingConfig,
  productionStreamingConfig,
  developmentStreamingConfig,
  testStreamingConfig,
  highPerformanceStreamingConfig
} from './config.example.js';

// Re-export relevant types
export type {
  StreamEvent,
  ClientMessage,
  CompressedBatch,
  TimeRange,
  TraceSession,
  RateLimitConfig,
  ClientRateLimit,
  ConnectionHealth,
  AuthConfig,
  ClientAuth,
  BinaryMessage,
  BackpressureConfig,
  ClientBackpressure
} from '../types.js';