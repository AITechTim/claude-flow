/**
 * Tracing UI - Main entry point for tracing visualization components
 */

import React from 'react';
import { TracingDashboard } from './components/TracingDashboard';
import { TracingProvider } from './providers/TracingProvider';

// Re-export all components for external use
export { TracingDashboard } from './components/TracingDashboard';
export { TraceGraph } from './components/TraceGraph';
export { TimelineView } from './components/TimelineView';
export { AgentPanel } from './components/AgentPanel';
export { DebugPanel } from './components/DebugPanel';

// Re-export hooks
export { useTraceWebSocket } from './hooks/useTraceWebSocket';
export { useTimeTravel } from './hooks/useTimeTravel';

// Re-export utilities
export { GraphBuilder } from './utils/graph-builder';
export { TraceUtils } from './utils/trace-utils';

// Re-export provider
export { TracingProvider } from './providers/TracingProvider';

// Main tracing application component
export interface TracingAppProps {
  wsUrl?: string;
  theme?: 'light' | 'dark';
  initialFilters?: any[];
  onEventSelect?: (event: any) => void;
}

export const TracingApp: React.FC<TracingAppProps> = ({
  wsUrl = 'ws://localhost:8080',
  theme = 'light',
  initialFilters = [],
  onEventSelect
}) => {
  return (
    <TracingProvider 
      wsUrl={wsUrl} 
      initialFilters={initialFilters}
    >
      <div className={`tracing-app theme-${theme}`}>
        <TracingDashboard 
          onEventSelect={onEventSelect}
        />
      </div>
    </TracingProvider>
  );
};

// CSS-in-JS styles (can be extracted to separate file)
export const tracingStyles = {
  app: {
    width: '100%',
    height: '100%',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-primary)'
  },
  
  // Light theme variables
  light: {
    '--bg-primary': '#ffffff',
    '--bg-secondary': '#f5f5f5',
    '--bg-tertiary': '#eeeeee',
    '--text-primary': '#333333',
    '--text-secondary': '#666666',
    '--border-color': '#dddddd',
    '--accent-color': '#0066cc',
    '--success-color': '#28a745',
    '--warning-color': '#ffc107',
    '--error-color': '#dc3545'
  },
  
  // Dark theme variables
  dark: {
    '--bg-primary': '#1a1a1a',
    '--bg-secondary': '#2d2d2d',
    '--bg-tertiary': '#404040',
    '--text-primary': '#ffffff',
    '--text-secondary': '#cccccc',
    '--border-color': '#555555',
    '--accent-color': '#4dabf7',
    '--success-color': '#51cf66',
    '--warning-color': '#ffd43b',
    '--error-color': '#ff6b6b'
  }
};

// Default export for convenience
export default TracingApp;