import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  ZoomIn, 
  ZoomOut, 
  ChevronLeft, 
  ChevronRight,
  Filter,
  Settings,
  BarChart3,
  Clock,
  Target
} from 'lucide-react';
import * as d3 from 'd3';
import { TraceEvent, Agent, TimelineSettings } from '../types/tracing';
import { cn } from '../../../lib/utils';

interface TimelineViewProps {
  events: TraceEvent[];
  agents: Agent[];
  selectedEvents?: string[];
  onEventSelect?: (eventIds: string[]) => void;
  onTimeRangeSelect?: (startTime: number, endTime: number) => void;
  className?: string;
}

interface TimelineState {
  zoomLevel: number;
  panOffset: number;
  currentTime: number;
  isPlaying: boolean;
  selectedTimeRange: [number, number] | null;
  showHeatmap: boolean;
  showCriticalPath: boolean;
  ganttMode: boolean;
  timeScale: 'ms' | 'sec' | 'min';
  eventFilters: string[];
  playbackSpeed: number;
}

const LANE_HEIGHT = 60;
const TIMELINE_HEIGHT = 40;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;

const TimelineView: React.FC<TimelineViewProps> = ({
  events,
  agents,
  selectedEvents = [],
  onEventSelect,
  onTimeRangeSelect,
  className
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const brushRef = useRef<d3.BrushBehavior<unknown>>();
  const playbackRef = useRef<NodeJS.Timeout>();

  const [state, setState] = useState<TimelineState>({
    zoomLevel: 1,
    panOffset: 0,
    currentTime: 0,
    isPlaying: false,
    selectedTimeRange: null,
    showHeatmap: true,
    showCriticalPath: false,
    ganttMode: false,
    timeScale: 'sec',
    eventFilters: [],
    playbackSpeed: 1
  });

  const [dimensions, setDimensions] = useState({ width: 800, height: 400 });

  // Calculate time bounds and scales
  const timeBounds = useMemo(() => {
    if (events.length === 0) return { min: 0, max: 1000 };
    const times = events.map(e => e.timestamp);
    return { min: Math.min(...times), max: Math.max(...times) };
  }, [events]);

  const timeScale = useMemo(() => {
    const { width } = dimensions;
    return d3.scaleLinear()
      .domain([timeBounds.min, timeBounds.max])
      .range([0, width - 100]);
  }, [timeBounds, dimensions]);

  // Agent color mapping
  const agentColors = useMemo(() => {
    const colorScale = d3.scaleOrdinal(d3.schemeCategory10);
    return new Map(agents.map(agent => [agent.id, colorScale(agent.id)]));
  }, [agents]);

  // Filter and group events
  const filteredEvents = useMemo(() => {
    return events.filter(event => {
      if (state.eventFilters.length > 0 && !state.eventFilters.includes(event.type)) {
        return false;
      }
      if (state.selectedTimeRange) {
        const [start, end] = state.selectedTimeRange;
        return event.timestamp >= start && event.timestamp <= end;
      }
      return true;
    });
  }, [events, state.eventFilters, state.selectedTimeRange]);

  // Group events by agent
  const eventsByAgent = useMemo(() => {
    const grouped = new Map<string, TraceEvent[]>();
    filteredEvents.forEach(event => {
      const agentId = event.agentId || 'unknown';
      if (!grouped.has(agentId)) {
        grouped.set(agentId, []);
      }
      grouped.get(agentId)!.push(event);
    });
    return grouped;
  }, [filteredEvents]);

  // Calculate event density for heatmap
  const eventDensity = useMemo(() => {
    if (!state.showHeatmap) return new Map();
    
    const buckets = 100;
    const bucketSize = (timeBounds.max - timeBounds.min) / buckets;
    const density = new Map<number, number>();
    
    for (let i = 0; i < buckets; i++) {
      const bucketStart = timeBounds.min + i * bucketSize;
      const bucketEnd = bucketStart + bucketSize;
      const count = filteredEvents.filter(e => 
        e.timestamp >= bucketStart && e.timestamp < bucketEnd
      ).length;
      density.set(i, count);
    }
    
    return density;
  }, [filteredEvents, timeBounds, state.showHeatmap]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({ width: rect.width, height: rect.height });
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Playback animation
  useEffect(() => {
    if (state.isPlaying) {
      playbackRef.current = setInterval(() => {
        setState(prev => {
          const nextTime = prev.currentTime + (50 * prev.playbackSpeed);
          if (nextTime >= timeBounds.max) {
            return { ...prev, currentTime: timeBounds.min, isPlaying: false };
          }
          return { ...prev, currentTime: nextTime };
        });
      }, 50);
    } else {
      if (playbackRef.current) {
        clearInterval(playbackRef.current);
      }
    }

    return () => {
      if (playbackRef.current) {
        clearInterval(playbackRef.current);
      }
    };
  }, [state.isPlaying, state.playbackSpeed, timeBounds]);

  // Format time based on scale
  const formatTime = useCallback((timestamp: number) => {
    const relative = timestamp - timeBounds.min;
    switch (state.timeScale) {
      case 'ms':
        return `${Math.round(relative)}ms`;
      case 'sec':
        return `${(relative / 1000).toFixed(1)}s`;
      case 'min':
        return `${(relative / 60000).toFixed(1)}m`;
      default:
        return `${Math.round(relative)}ms`;
    }
  }, [timeBounds, state.timeScale]);

  // Handle event selection
  const handleEventClick = useCallback((event: TraceEvent, ctrlKey: boolean = false) => {
    if (!onEventSelect) return;

    if (ctrlKey) {
      const newSelection = selectedEvents.includes(event.id)
        ? selectedEvents.filter(id => id !== event.id)
        : [...selectedEvents, event.id];
      onEventSelect(newSelection);
    } else {
      onEventSelect([event.id]);
    }
  }, [selectedEvents, onEventSelect]);

  // Handle zoom
  const handleZoom = useCallback((delta: number) => {
    setState(prev => ({
      ...prev,
      zoomLevel: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev.zoomLevel * (1 + delta)))
    }));
  }, []);

  // Handle pan
  const handlePan = useCallback((delta: number) => {
    setState(prev => ({
      ...prev,
      panOffset: prev.panOffset + delta
    }));
  }, []);

  // Render timeline axis
  const renderTimeAxis = useCallback(() => {
    const svg = d3.select(svgRef.current);
    const axisGroup = svg.select('.time-axis');
    
    if (axisGroup.empty()) return;

    const axis = d3.axisBottom(timeScale)
      .tickFormat(d => formatTime(d as number))
      .ticks(10);

    axisGroup.call(axis);
  }, [timeScale, formatTime]);

  // Render heatmap
  const renderHeatmap = useCallback(() => {
    if (!state.showHeatmap) return null;

    const maxDensity = Math.max(...Array.from(eventDensity.values()));
    const colorScale = d3.scaleSequential(d3.interpolateYlOrRd)
      .domain([0, maxDensity]);

    const buckets = Array.from(eventDensity.entries()).map(([bucket, count]) => {
      const bucketStart = timeBounds.min + bucket * (timeBounds.max - timeBounds.min) / 100;
      const bucketEnd = bucketStart + (timeBounds.max - timeBounds.min) / 100;
      
      return (
        <rect
          key={bucket}
          x={timeScale(bucketStart)}
          y={0}
          width={Math.max(1, timeScale(bucketEnd) - timeScale(bucketStart))}
          height={20}
          fill={colorScale(count)}
          opacity={0.6}
        />
      );
    });

    return <g className="heatmap">{buckets}</g>;
  }, [state.showHeatmap, eventDensity, timeScale, timeBounds]);

  // Render agent lanes
  const renderAgentLanes = useCallback(() => {
    return agents.map((agent, index) => {
      const yPosition = TIMELINE_HEIGHT + 30 + index * LANE_HEIGHT;
      const agentEvents = eventsByAgent.get(agent.id) || [];
      const agentColor = agentColors.get(agent.id) || '#666';

      return (
        <g key={agent.id} className="agent-lane">
          {/* Lane background */}
          <rect
            x={0}
            y={yPosition}
            width={dimensions.width - 100}
            height={LANE_HEIGHT - 10}
            fill={agentColor}
            opacity={0.1}
            rx={4}
          />
          
          {/* Lane label */}
          <text
            x={-10}
            y={yPosition + LANE_HEIGHT / 2}
            textAnchor="end"
            className="text-sm font-medium"
            fill={agentColor}
          >
            {agent.name}
          </text>
          
          {/* Events */}
          {agentEvents.map(event => {
            const x = timeScale(event.timestamp);
            const isSelected = selectedEvents.includes(event.id);
            const eventY = yPosition + 10;
            
            if (state.ganttMode && event.duration) {
              // Gantt bar for tasks with duration
              const width = Math.max(2, timeScale(event.timestamp + event.duration) - x);
              return (
                <g key={event.id}>
                  <rect
                    x={x}
                    y={eventY}
                    width={width}
                    height={LANE_HEIGHT - 30}
                    fill={agentColor}
                    opacity={isSelected ? 0.8 : 0.6}
                    rx={2}
                    className="cursor-pointer hover:opacity-80"
                    onClick={(e) => handleEventClick(event, e.ctrlKey)}
                  />
                  <text
                    x={x + width / 2}
                    y={eventY + (LANE_HEIGHT - 30) / 2}
                    textAnchor="middle"
                    className="text-xs fill-white"
                    pointerEvents="none"
                  >
                    {event.name}
                  </text>
                </g>
              );
            } else {
              // Point event
              return (
                <circle
                  key={event.id}
                  cx={x}
                  cy={eventY + (LANE_HEIGHT - 30) / 2}
                  r={isSelected ? 6 : 4}
                  fill={agentColor}
                  stroke={isSelected ? '#fff' : 'none'}
                  strokeWidth={isSelected ? 2 : 0}
                  className="cursor-pointer hover:r-5"
                  onClick={(e) => handleEventClick(event, e.ctrlKey)}
                />
              );
            }
          })}
        </g>
      );
    });
  }, [agents, eventsByAgent, agentColors, timeScale, dimensions, state.ganttMode, selectedEvents, handleEventClick]);

  // Render playback cursor
  const renderPlaybackCursor = useCallback(() => {
    if (!state.isPlaying && state.currentTime === 0) return null;

    const x = timeScale(state.currentTime);
    return (
      <line
        x1={x}
        y1={0}
        x2={x}
        y2={dimensions.height}
        stroke="#ff4444"
        strokeWidth={2}
        opacity={0.8}
        className="pointer-events-none"
      />
    );
  }, [state.isPlaying, state.currentTime, timeScale, dimensions]);

  return (
    <div ref={containerRef} className={cn("timeline-view flex flex-col h-full", className)}>
      {/* Controls */}
      <div className="flex items-center gap-4 p-4 border-b bg-gray-50">
        {/* Playback controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setState(prev => ({ ...prev, isPlaying: !prev.isPlaying }))}
            className="p-2 rounded hover:bg-gray-200"
          >
            {state.isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button
            onClick={() => setState(prev => ({ ...prev, currentTime: timeBounds.min, isPlaying: false }))}
            className="p-2 rounded hover:bg-gray-200"
          >
            <RotateCcw size={16} />
          </button>
          <select
            value={state.playbackSpeed}
            onChange={(e) => setState(prev => ({ ...prev, playbackSpeed: parseFloat(e.target.value) }))}
            className="px-2 py-1 border rounded text-sm"
          >
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={4}>4x</option>
          </select>
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleZoom(0.2)}
            className="p-2 rounded hover:bg-gray-200"
          >
            <ZoomIn size={16} />
          </button>
          <button
            onClick={() => handleZoom(-0.2)}
            className="p-2 rounded hover:bg-gray-200"
          >
            <ZoomOut size={16} />
          </button>
          <span className="text-sm text-gray-600">
            {(state.zoomLevel * 100).toFixed(0)}%
          </span>
        </div>

        {/* Pan controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => handlePan(50)}
            className="p-1 rounded hover:bg-gray-200"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={() => handlePan(-50)}
            className="p-1 rounded hover:bg-gray-200"
          >
            <ChevronRight size={14} />
          </button>
        </div>

        {/* View options */}
        <div className="flex items-center gap-2 ml-auto">
          <select
            value={state.timeScale}
            onChange={(e) => setState(prev => ({ ...prev, timeScale: e.target.value as any }))}
            className="px-2 py-1 border rounded text-sm"
          >
            <option value="ms">Milliseconds</option>
            <option value="sec">Seconds</option>
            <option value="min">Minutes</option>
          </select>
          
          <button
            onClick={() => setState(prev => ({ ...prev, showHeatmap: !prev.showHeatmap }))}
            className={cn("p-2 rounded", state.showHeatmap ? "bg-blue-100 text-blue-600" : "hover:bg-gray-200")}
          >
            <BarChart3 size={16} />
          </button>
          
          <button
            onClick={() => setState(prev => ({ ...prev, ganttMode: !prev.ganttMode }))}
            className={cn("p-2 rounded", state.ganttMode ? "bg-blue-100 text-blue-600" : "hover:bg-gray-200")}
          >
            <Clock size={16} />
          </button>
          
          <button
            onClick={() => setState(prev => ({ ...prev, showCriticalPath: !prev.showCriticalPath }))}
            className={cn("p-2 rounded", state.showCriticalPath ? "bg-red-100 text-red-600" : "hover:bg-gray-200")}
          >
            <Target size={16} />
          </button>
        </div>
      </div>

      {/* Timeline visualization */}
      <div className="flex-1 overflow-hidden relative">
        <svg
          ref={svgRef}
          width={dimensions.width}
          height={dimensions.height}
          className="absolute inset-0"
        >
          {/* Heatmap */}
          {renderHeatmap()}
          
          {/* Time axis */}
          <g
            className="time-axis"
            transform={`translate(50, ${TIMELINE_HEIGHT})`}
          />
          
          {/* Agent lanes */}
          <g transform="translate(50, 0)">
            {renderAgentLanes()}
          </g>
          
          {/* Playback cursor */}
          <g transform="translate(50, 0)">
            {renderPlaybackCursor()}
          </g>
          
          {/* Brush for time range selection */}
          <g
            className="brush"
            transform={`translate(50, ${TIMELINE_HEIGHT + 30})`}
          />
        </svg>

        {/* Event details tooltip */}
        <div className="absolute bottom-4 right-4 bg-white rounded-lg shadow-lg p-4 max-w-xs">
          <h4 className="font-medium mb-2">Timeline Stats</h4>
          <div className="space-y-1 text-sm text-gray-600">
            <div>Total Events: {filteredEvents.length}</div>
            <div>Time Range: {formatTime(timeBounds.max - timeBounds.min)}</div>
            <div>Active Agents: {agents.length}</div>
            {state.selectedTimeRange && (
              <div>
                Selected: {formatTime(state.selectedTimeRange[1] - state.selectedTimeRange[0])}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="p-4 border-t bg-gray-50">
        <div className="flex flex-wrap gap-4">
          {Array.from(agentColors.entries()).map(([agentId, color]) => {
            const agent = agents.find(a => a.id === agentId);
            return (
              <div key={agentId} className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="text-sm">{agent?.name || agentId}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default TimelineView;