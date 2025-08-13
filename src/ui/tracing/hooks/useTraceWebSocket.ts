/**
 * useTraceWebSocket - React hook for WebSocket trace streaming
 */

import { useState, useEffect, useRef, useCallback } from 'react';

export interface TraceEvent {
  id: string;
  timestamp: number;
  type: string;
  agentId: string;
  swarmId: string;
  data: Record<string, any>;
  duration?: number;
  parentId?: string;
  children?: string[];
  metadata?: any;
}

export interface Agent {
  id: string;
  type: string;
  status: string;
  capabilities: string[];
  performance: any;
}

export interface UseTraceWebSocketOptions {
  url: string;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  bufferSize?: number;
}

export interface UseTraceWebSocketReturn {
  isConnected: boolean;
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
  events: TraceEvent[];
  agents: Agent[];
  lastEvent: TraceEvent | null;
  error: Error | null;
  sendMessage: (message: any) => void;
  disconnect: () => void;
  reconnect: () => void;
  clearEvents: () => void;
  setFilters: (filters: any[]) => void;
  subscribe: (channels: string[]) => void;
  unsubscribe: (channels: string[]) => void;
}

export const useTraceWebSocket = (
  options: UseTraceWebSocketOptions
): UseTraceWebSocketReturn => {
  // State
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [lastEvent, setLastEvent] = useState<TraceEvent | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Configuration
  const {
    url,
    autoReconnect = true,
    reconnectInterval = 5000,
    maxReconnectAttempts = 5,
    bufferSize = 1000
  } = options;

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      return; // Already connected
    }

    setConnectionStatus('connecting');
    setError(null);

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        setIsConnected(true);
        setConnectionStatus('connected');
        reconnectAttemptsRef.current = 0;
        
        // Start heartbeat
        startHeartbeat();
        
        // Send initial subscription
        sendMessage({ type: 'subscribe', data: { channels: ['all'] } });
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          handleMessage(message);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onclose = (event) => {
        console.log('WebSocket disconnected:', event.code, event.reason);
        setIsConnected(false);
        setConnectionStatus('disconnected');
        stopHeartbeat();
        
        if (autoReconnect && reconnectAttemptsRef.current < maxReconnectAttempts) {
          scheduleReconnect();
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setError(new Error('WebSocket connection error'));
        setConnectionStatus('error');
      };
    } catch (error) {
      console.error('Error creating WebSocket:', error);
      setError(error as Error);
      setConnectionStatus('error');
    }
  }, [url, autoReconnect, maxReconnectAttempts, reconnectInterval]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    stopHeartbeat();
    setIsConnected(false);
    setConnectionStatus('disconnected');
  }, []);

  // Send message to WebSocket
  const sendMessage = useCallback((message: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  // Handle incoming messages
  const handleMessage = useCallback((message: any) => {
    switch (message.type) {
      case 'trace-event':
        const event = message.data as TraceEvent;
        setLastEvent(event);
        setEvents(prev => {
          const newEvents = [event, ...prev];
          return newEvents.slice(0, bufferSize);
        });
        updateAgentFromEvent(event);
        break;

      case 'trace-events-batch':
        const batchEvents = message.data as TraceEvent[];
        if (batchEvents.length > 0) {
          setLastEvent(batchEvents[0]);
          setEvents(prev => {
            const newEvents = [...batchEvents, ...prev];
            return newEvents.slice(0, bufferSize);
          });
          batchEvents.forEach(updateAgentFromEvent);
        }
        break;

      case 'agent-update':
        updateAgent(message.data);
        break;

      case 'heartbeat-ack':
        // Heartbeat acknowledged
        break;

      case 'connected':
        console.log('Connected with client ID:', message.data.clientId);
        break;

      case 'error':
        console.error('Server error:', message.data.message);
        setError(new Error(message.data.message));
        break;

      default:
        console.log('Unknown message type:', message.type);
    }
  }, [bufferSize]);

  // Update agent from event
  const updateAgentFromEvent = useCallback((event: TraceEvent) => {
    setAgents(prev => {
      const existingIndex = prev.findIndex(agent => agent.id === event.agentId);
      
      if (existingIndex !== -1) {
        // Update existing agent
        const updatedAgents = [...prev];
        const agent = { ...updatedAgents[existingIndex] };
        
        // Update status based on event type
        switch (event.type) {
          case 'AGENT_SPAWN':
            agent.status = 'idle';
            if (event.data.agentType) {
              agent.type = event.data.agentType;
            }
            if (event.data.capabilities) {
              agent.capabilities = event.data.capabilities;
            }
            break;
          
          case 'TASK_START':
            agent.status = 'busy';
            break;
          
          case 'TASK_COMPLETE':
          case 'TASK_FAIL':
            agent.status = 'idle';
            break;
          
          case 'AGENT_DESTROY':
            agent.status = 'terminated';
            break;
        }
        
        updatedAgents[existingIndex] = agent;
        return updatedAgents;
      } else {
        // Create new agent
        const newAgent: Agent = {
          id: event.agentId,
          type: event.data.agentType || 'unknown',
          status: event.type === 'AGENT_SPAWN' ? 'idle' : 'active',
          capabilities: event.data.capabilities || [],
          performance: {}
        };
        
        return [...prev, newAgent];
      }
    });
  }, []);

  // Update specific agent
  const updateAgent = useCallback((agentData: any) => {
    setAgents(prev => {
      const existingIndex = prev.findIndex(agent => agent.id === agentData.id);
      
      if (existingIndex !== -1) {
        const updatedAgents = [...prev];
        updatedAgents[existingIndex] = { ...updatedAgents[existingIndex], ...agentData };
        return updatedAgents;
      } else {
        return [...prev, agentData];
      }
    });
  }, []);

  // Schedule reconnect
  const scheduleReconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) return;
    
    reconnectAttemptsRef.current += 1;
    console.log(`Scheduling reconnect attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts}`);
    
    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectTimeoutRef.current = null;
      connect();
    }, reconnectInterval);
  }, [connect, maxReconnectAttempts, reconnectInterval]);

  // Start heartbeat
  const startHeartbeat = useCallback(() => {
    heartbeatIntervalRef.current = setInterval(() => {
      sendMessage({ type: 'heartbeat', timestamp: Date.now() });
    }, 30000); // 30 seconds
  }, [sendMessage]);

  // Stop heartbeat
  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, []);

  // Additional utility functions
  const clearEvents = useCallback(() => {
    setEvents([]);
    setLastEvent(null);
  }, []);

  const setFilters = useCallback((filters: any[]) => {
    sendMessage({ type: 'set-filters', data: { filters } });
  }, [sendMessage]);

  const subscribe = useCallback((channels: string[]) => {
    sendMessage({ type: 'subscribe', data: { channels } });
  }, [sendMessage]);

  const unsubscribe = useCallback((channels: string[]) => {
    sendMessage({ type: 'unsubscribe', data: { channels } });
  }, [sendMessage]);

  // Connect on mount
  useEffect(() => {
    connect();
    
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      stopHeartbeat();
    };
  }, [stopHeartbeat]);

  return {
    isConnected,
    connectionStatus,
    events,
    agents,
    lastEvent,
    error,
    sendMessage,
    disconnect,
    reconnect: connect,
    clearEvents,
    setFilters,
    subscribe,
    unsubscribe
  };
};