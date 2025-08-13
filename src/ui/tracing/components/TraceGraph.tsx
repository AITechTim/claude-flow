import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import { debounce } from 'lodash';
import { TraceData, TraceNode, TraceEdge, GraphConfig, LayoutType, FilterOptions } from '../types/trace.types';

interface TraceGraphProps {
  data: TraceData;
  config?: Partial<GraphConfig>;
  onNodeSelect?: (node: TraceNode) => void;
  onEdgeSelect?: (edge: TraceEdge) => void;
  onExport?: (format: 'svg' | 'png') => void;
  filters?: FilterOptions;
  searchQuery?: string;
}

interface D3Node extends d3.SimulationNodeDatum {
  id: string;
  type: string;
  status: string;
  label: string;
  data: any;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  id: string;
  type: string;
  weight: number;
  data: any;
}

const defaultConfig: GraphConfig = {
  width: 800,
  height: 600,
  nodeRadius: 8,
  linkDistance: 80,
  charge: -300,
  alpha: 0.3,
  alphaDecay: 0.02,
  velocityDecay: 0.4,
  showLabels: true,
  showMinimap: true,
  enableZoom: true,
  enablePan: true,
  enableDrag: true,
  colorScheme: 'category10',
  animationDuration: 750,
  maxNodes: 1000,
  clusterThreshold: 100,
  virtualRendering: true,
};

const layoutConfigs = {
  force: {
    type: 'force' as LayoutType,
    strength: -300,
    distance: 80,
    iterations: 1,
  },
  tree: {
    type: 'tree' as LayoutType,
    separation: 2,
    nodeSize: [100, 80],
    orientation: 'horizontal',
  },
  timeline: {
    type: 'timeline' as LayoutType,
    timeScale: 'linear',
    spacing: 60,
    groupBy: 'timestamp',
  },
};

export const TraceGraph: React.FC<TraceGraphProps> = ({
  data,
  config: userConfig = {},
  onNodeSelect,
  onEdgeSelect,
  onExport,
  filters,
  searchQuery,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<D3Node, D3Link> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  const [currentLayout, setCurrentLayout] = useState<LayoutType>('force');
  const [selectedNode, setSelectedNode] = useState<D3Node | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<D3Link | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; content: string; visible: boolean }>({
    x: 0,
    y: 0,
    content: '',
    visible: false,
  });

  const config = useMemo(() => ({ ...defaultConfig, ...userConfig }), [userConfig]);

  // Process and filter data
  const processedData = useMemo(() => {
    let nodes = data.nodes || [];
    let edges = data.edges || [];

    // Apply filters
    if (filters) {
      if (filters.agentTypes?.length) {
        nodes = nodes.filter(node => filters.agentTypes!.includes(node.type));
      }
      if (filters.eventTypes?.length) {
        edges = edges.filter(edge => filters.eventTypes!.includes(edge.type));
      }
      if (filters.timeRange) {
        const [start, end] = filters.timeRange;
        nodes = nodes.filter(node => {
          const timestamp = new Date(node.timestamp).getTime();
          return timestamp >= start && timestamp <= end;
        });
      }
      if (filters.statusFilter?.length) {
        nodes = nodes.filter(node => filters.statusFilter!.includes(node.status));
      }
    }

    // Apply search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      nodes = nodes.filter(node => 
        node.label.toLowerCase().includes(query) ||
        node.id.toLowerCase().includes(query) ||
        node.type.toLowerCase().includes(query)
      );
    }

    // Convert to D3 format
    const d3Nodes: D3Node[] = nodes.map(node => ({
      id: node.id,
      type: node.type,
      status: node.status,
      label: node.label,
      data: node,
    }));

    const d3Links: D3Link[] = edges
      .filter(edge => {
        const sourceExists = d3Nodes.some(n => n.id === edge.source);
        const targetExists = d3Nodes.some(n => n.id === edge.target);
        return sourceExists && targetExists;
      })
      .map(edge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: edge.type,
        weight: edge.weight || 1,
        data: edge,
      }));

    return { nodes: d3Nodes, links: d3Links };
  }, [data, filters, searchQuery]);

  // Color scales
  const colorScale = useMemo(() => {
    const types = Array.from(new Set(processedData.nodes.map(n => n.type)));
    return d3.scaleOrdinal(d3.schemeCategory10).domain(types);
  }, [processedData.nodes]);

  const statusColorScale = useMemo(() => {
    return d3.scaleOrdinal<string>()
      .domain(['active', 'idle', 'busy', 'error', 'completed'])
      .range(['#28a745', '#6c757d', '#ffc107', '#dc3545', '#17a2b8']);
  }, []);

  // Initialize SVG and zoom
  const initializeSVG = useCallback(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // Create main group
    const g = svg.append('g').attr('class', 'main-group');

    // Create layers
    g.append('g').attr('class', 'links-layer');
    g.append('g').attr('class', 'nodes-layer');
    g.append('g').attr('class', 'labels-layer');

    // Setup zoom
    if (config.enableZoom) {
      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 10])
        .on('zoom', (event) => {
          g.attr('transform', event.transform);
        });

      svg.call(zoom);
      zoomRef.current = zoom;

      // Reset zoom button
      svg.append('g')
        .attr('class', 'zoom-controls')
        .attr('transform', 'translate(20, 20)')
        .append('rect')
        .attr('width', 60)
        .attr('height', 25)
        .attr('fill', '#fff')
        .attr('stroke', '#ccc')
        .style('cursor', 'pointer')
        .on('click', () => {
          svg.transition()
            .duration(config.animationDuration)
            .call(zoom.transform, d3.zoomIdentity);
        });

      svg.select('.zoom-controls')
        .append('text')
        .attr('x', 30)
        .attr('y', 17)
        .attr('text-anchor', 'middle')
        .attr('font-size', '12px')
        .text('Reset')
        .style('pointer-events', 'none');
    }

    // Setup minimap if enabled
    if (config.showMinimap) {
      const minimap = svg.append('g')
        .attr('class', 'minimap')
        .attr('transform', `translate(${config.width - 150}, ${config.height - 100})`);

      minimap.append('rect')
        .attr('width', 120)
        .attr('height', 80)
        .attr('fill', '#f8f9fa')
        .attr('stroke', '#dee2e6')
        .attr('stroke-width', 1);

      minimap.append('text')
        .attr('x', 60)
        .attr('y', -5)
        .attr('text-anchor', 'middle')
        .attr('font-size', '10px')
        .text('Minimap');
    }

    // Add defs for markers and gradients
    const defs = svg.append('defs');

    // Arrow markers
    defs.append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '-0 -5 10 10')
      .attr('refX', 13)
      .attr('refY', 0)
      .attr('orient', 'auto')
      .attr('markerWidth', 13)
      .attr('markerHeight', 13)
      .attr('xoverflow', 'visible')
      .append('path')
      .attr('d', 'M 0,-5 L 10 ,0 L 0,5')
      .attr('fill', '#999')
      .style('stroke', 'none');

    // Gradient for nodes
    const gradient = defs.append('radialGradient')
      .attr('id', 'node-gradient');

    gradient.append('stop')
      .attr('offset', '0%')
      .attr('stop-color', '#fff')
      .attr('stop-opacity', 0.8);

    gradient.append('stop')
      .attr('offset', '100%')
      .attr('stop-opacity', 1);

  }, [config]);

  // Force simulation setup
  const initializeSimulation = useCallback(() => {
    if (simulationRef.current) {
      simulationRef.current.stop();
    }

    const simulation = d3.forceSimulation<D3Node>(processedData.nodes)
      .force('link', d3.forceLink<D3Node, D3Link>(processedData.links)
        .id(d => d.id)
        .distance(config.linkDistance)
        .strength(0.5))
      .force('charge', d3.forceManyBody().strength(config.charge))
      .force('center', d3.forceCenter(config.width / 2, config.height / 2))
      .force('collision', d3.forceCollide().radius(config.nodeRadius + 2))
      .alpha(config.alpha)
      .alphaDecay(config.alphaDecay)
      .velocityDecay(config.velocityDecay);

    simulationRef.current = simulation;
    return simulation;
  }, [processedData, config]);

  // Layout algorithms
  const applyLayout = useCallback((layoutType: LayoutType) => {
    const svg = d3.select(svgRef.current);
    const g = svg.select('.main-group');

    switch (layoutType) {
      case 'tree':
        applyTreeLayout(g);
        break;
      case 'timeline':
        applyTimelineLayout(g);
        break;
      case 'force':
      default:
        applyForceLayout();
        break;
    }
  }, [processedData]);

  const applyForceLayout = useCallback(() => {
    const simulation = initializeSimulation();
    
    simulation.on('tick', () => {
      updateVisualization();
    });

    simulation.restart();
  }, [initializeSimulation]);

  const applyTreeLayout = useCallback((g: d3.Selection<SVGGElement, unknown, null, undefined>) => {
    const treeLayout = d3.tree<D3Node>()
      .size([config.height - 100, config.width - 100])
      .separation((a, b) => (a.parent === b.parent ? 1 : 2) / a.depth);

    // Convert to hierarchy
    const root = d3.hierarchy(
      { id: 'root', children: processedData.nodes.filter(n => !processedData.links.find(l => l.target === n.id)) },
      (d: any) => {
        if (d.children) return d.children;
        const children = processedData.links
          .filter(l => l.source === d.id)
          .map(l => processedData.nodes.find(n => n.id === l.target))
          .filter(Boolean);
        return children.length > 0 ? children : null;
      }
    );

    const treeData = treeLayout(root);

    // Update positions
    treeData.descendants().forEach(d => {
      if (d.data && d.data.id !== 'root') {
        const node = processedData.nodes.find(n => n.id === d.data.id);
        if (node) {
          node.x = d.y + 50;
          node.y = d.x + 50;
          node.fx = node.x;
          node.fy = node.y;
        }
      }
    });

    updateVisualization();

    // Clear fixed positions after animation
    setTimeout(() => {
      processedData.nodes.forEach(node => {
        node.fx = null;
        node.fy = null;
      });
    }, config.animationDuration);
  }, [processedData, config]);

  const applyTimelineLayout = useCallback((g: d3.Selection<SVGGElement, unknown, null, undefined>) => {
    // Sort nodes by timestamp
    const sortedNodes = [...processedData.nodes].sort((a, b) => 
      new Date(a.data.timestamp).getTime() - new Date(b.data.timestamp).getTime()
    );

    const timeScale = d3.scaleTime()
      .domain(d3.extent(sortedNodes, d => new Date(d.data.timestamp)) as [Date, Date])
      .range([50, config.width - 50]);

    // Group by agent type
    const agentTypes = Array.from(new Set(sortedNodes.map(n => n.type)));
    const yScale = d3.scaleBand()
      .domain(agentTypes)
      .range([50, config.height - 50])
      .padding(0.1);

    sortedNodes.forEach(node => {
      node.x = timeScale(new Date(node.data.timestamp));
      node.y = yScale(node.type)! + yScale.bandwidth() / 2;
      node.fx = node.x;
      node.fy = node.y;
    });

    updateVisualization();

    // Clear fixed positions after animation
    setTimeout(() => {
      processedData.nodes.forEach(node => {
        node.fx = null;
        node.fy = null;
      });
    }, config.animationDuration);
  }, [processedData, config]);

  // Update visualization
  const updateVisualization = useCallback(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const g = svg.select('.main-group');

    // Update links
    const link = g.select('.links-layer')
      .selectAll<SVGLineElement, D3Link>('.link')
      .data(processedData.links, d => d.id);

    link.exit()
      .transition()
      .duration(config.animationDuration)
      .style('opacity', 0)
      .remove();

    const linkEnter = link.enter()
      .append('line')
      .attr('class', 'link')
      .style('opacity', 0);

    link.merge(linkEnter)
      .transition()
      .duration(config.animationDuration)
      .style('opacity', 1)
      .attr('stroke', d => d.type === 'dependency' ? '#dc3545' : '#6c757d')
      .attr('stroke-width', d => Math.sqrt(d.weight))
      .attr('stroke-dasharray', d => d.type === 'async' ? '5,5' : 'none')
      .attr('marker-end', 'url(#arrowhead)')
      .attr('x1', d => (d.source as D3Node).x!)
      .attr('y1', d => (d.source as D3Node).y!)
      .attr('x2', d => (d.target as D3Node).x!)
      .attr('y2', d => (d.target as D3Node).y!);

    // Update nodes
    const node = g.select('.nodes-layer')
      .selectAll<SVGCircleElement, D3Node>('.node')
      .data(processedData.nodes, d => d.id);

    node.exit()
      .transition()
      .duration(config.animationDuration)
      .attr('r', 0)
      .style('opacity', 0)
      .remove();

    const nodeEnter = node.enter()
      .append('circle')
      .attr('class', 'node')
      .attr('r', 0)
      .style('opacity', 0);

    const nodeUpdate = node.merge(nodeEnter);

    nodeUpdate
      .transition()
      .duration(config.animationDuration)
      .style('opacity', 1)
      .attr('r', config.nodeRadius)
      .attr('fill', d => {
        const baseColor = colorScale(d.type);
        const statusColor = statusColorScale(d.status);
        return d3.interpolate(baseColor, statusColor)(0.3);
      })
      .attr('stroke', d => statusColorScale(d.status))
      .attr('stroke-width', d => selectedNode?.id === d.id ? 3 : 1.5)
      .attr('cx', d => d.x!)
      .attr('cy', d => d.y!);

    // Node interactions
    nodeUpdate
      .style('cursor', 'pointer')
      .on('click', (event, d) => {
        event.stopPropagation();
        setSelectedNode(selectedNode?.id === d.id ? null : d);
        onNodeSelect?.(d as any);
      })
      .on('mouseover', (event, d) => {
        const [x, y] = d3.pointer(event, svgRef.current);
        setTooltip({
          x,
          y,
          content: `${d.label}\nType: ${d.type}\nStatus: ${d.status}\nTimestamp: ${d.data.timestamp}`,
          visible: true,
        });
      })
      .on('mouseout', () => {
        setTooltip(prev => ({ ...prev, visible: false }));
      });

    // Drag behavior
    if (config.enableDrag) {
      const drag = d3.drag<SVGCircleElement, D3Node>()
        .on('start', (event, d) => {
          if (!event.active && simulationRef.current) {
            simulationRef.current.alphaTarget(0.3).restart();
          }
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active && simulationRef.current) {
            simulationRef.current.alphaTarget(0);
          }
          if (!event.sourceEvent.shiftKey) {
            d.fx = null;
            d.fy = null;
          }
        });

      nodeUpdate.call(drag);
    }

    // Update labels
    if (config.showLabels) {
      const label = g.select('.labels-layer')
        .selectAll<SVGTextElement, D3Node>('.label')
        .data(processedData.nodes.filter(d => d.x && d.y), d => d.id);

      label.exit()
        .transition()
        .duration(config.animationDuration)
        .style('opacity', 0)
        .remove();

      const labelEnter = label.enter()
        .append('text')
        .attr('class', 'label')
        .style('opacity', 0);

      label.merge(labelEnter)
        .transition()
        .duration(config.animationDuration)
        .style('opacity', 0.8)
        .attr('x', d => d.x! + config.nodeRadius + 2)
        .attr('y', d => d.y! + 4)
        .attr('font-size', '10px')
        .attr('font-family', 'monospace')
        .attr('fill', '#333')
        .text(d => d.label);
    }

    // Update minimap
    if (config.showMinimap) {
      updateMinimap();
    }
  }, [processedData, config, selectedNode, colorScale, statusColorScale, onNodeSelect]);

  const updateMinimap = useCallback(() => {
    const svg = d3.select(svgRef.current);
    const minimap = svg.select('.minimap');

    // Clear previous minimap content
    minimap.selectAll('.minimap-node').remove();

    // Scale for minimap
    const xScale = d3.scaleLinear()
      .domain([0, config.width])
      .range([5, 115]);

    const yScale = d3.scaleLinear()
      .domain([0, config.height])
      .range([5, 75]);

    // Add minimap nodes
    minimap.selectAll('.minimap-node')
      .data(processedData.nodes.filter(d => d.x && d.y))
      .enter()
      .append('circle')
      .attr('class', 'minimap-node')
      .attr('cx', d => xScale(d.x!))
      .attr('cy', d => yScale(d.y!))
      .attr('r', 1.5)
      .attr('fill', d => colorScale(d.type));
  }, [processedData, config, colorScale]);

  // Debounced resize handler
  const handleResize = useMemo(
    () => debounce(() => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const newConfig = { ...config, width: rect.width, height: rect.height };
        // Trigger re-render with new dimensions
      }
    }, 250),
    [config]
  );

  // Export functionality
  const handleExport = useCallback((format: 'svg' | 'png') => {
    if (!svgRef.current) return;

    const svg = svgRef.current;
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svg);

    if (format === 'svg') {
      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'trace-graph.svg';
      link.click();
      URL.revokeObjectURL(url);
    } else if (format === 'png') {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      
      img.onload = () => {
        canvas.width = config.width;
        canvas.height = config.height;
        ctx?.drawImage(img, 0, 0);
        
        canvas.toBlob((blob) => {
          if (blob) {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'trace-graph.png';
            link.click();
            URL.revokeObjectURL(url);
          }
        });
      };
      
      img.src = 'data:image/svg+xml;base64,' + btoa(svgString);
    }

    onExport?.(format);
  }, [config, onExport]);

  // Search and highlight
  const highlightNodes = useCallback((query: string) => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const nodes = svg.selectAll('.node');

    if (!query) {
      nodes.style('stroke-width', 1.5).style('stroke-opacity', 1);
      return;
    }

    nodes
      .style('stroke-width', (d: any) => {
        const matchesQuery = d.label.toLowerCase().includes(query.toLowerCase()) ||
                           d.id.toLowerCase().includes(query.toLowerCase()) ||
                           d.type.toLowerCase().includes(query.toLowerCase());
        return matchesQuery ? 3 : 1.5;
      })
      .style('stroke-opacity', (d: any) => {
        const matchesQuery = d.label.toLowerCase().includes(query.toLowerCase()) ||
                           d.id.toLowerCase().includes(query.toLowerCase()) ||
                           d.type.toLowerCase().includes(query.toLowerCase());
        return matchesQuery ? 1 : 0.3;
      });
  }, []);

  // Effects
  useEffect(() => {
    initializeSVG();
  }, [initializeSVG]);

  useEffect(() => {
    applyLayout(currentLayout);
  }, [applyLayout, currentLayout, processedData]);

  useEffect(() => {
    highlightNodes(searchQuery || '');
  }, [highlightNodes, searchQuery]);

  useEffect(() => {
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      handleResize.cancel();
    };
  }, [handleResize]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (simulationRef.current) {
        simulationRef.current.stop();
      }
    };
  }, []);

  return (
    <div ref={containerRef} className="trace-graph-container" style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Controls */}
      <div className="graph-controls" style={{
        position: 'absolute',
        top: 10,
        left: 10,
        zIndex: 10,
        background: 'rgba(255, 255, 255, 0.9)',
        padding: '10px',
        borderRadius: '4px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
      }}>
        <div style={{ marginBottom: '8px' }}>
          <label style={{ marginRight: '8px', fontSize: '12px' }}>Layout:</label>
          <select
            value={currentLayout}
            onChange={(e) => setCurrentLayout(e.target.value as LayoutType)}
            style={{ fontSize: '12px', padding: '2px 4px' }}
          >
            <option value="force">Force-Directed</option>
            <option value="tree">Hierarchical Tree</option>
            <option value="timeline">Timeline</option>
          </select>
        </div>
        
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            onClick={() => handleExport('svg')}
            style={{
              fontSize: '10px',
              padding: '4px 8px',
              border: '1px solid #ccc',
              background: '#fff',
              borderRadius: '3px',
              cursor: 'pointer',
            }}
          >
            Export SVG
          </button>
          <button
            onClick={() => handleExport('png')}
            style={{
              fontSize: '10px',
              padding: '4px 8px',
              border: '1px solid #ccc',
              background: '#fff',
              borderRadius: '3px',
              cursor: 'pointer',
            }}
          >
            Export PNG
          </button>
        </div>
      </div>

      {/* Main SVG */}
      <svg
        ref={svgRef}
        width={config.width}
        height={config.height}
        style={{ border: '1px solid #e1e5e9', background: '#fafbfc' }}
      />

      {/* Tooltip */}
      {tooltip.visible && (
        <div
          style={{
            position: 'absolute',
            left: tooltip.x + 10,
            top: tooltip.y - 10,
            background: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            padding: '8px',
            borderRadius: '4px',
            fontSize: '12px',
            pointerEvents: 'none',
            whiteSpace: 'pre-line',
            zIndex: 1000,
          }}
        >
          {tooltip.content}
        </div>
      )}

      {/* Node details panel */}
      {selectedNode && (
        <div
          style={{
            position: 'absolute',
            right: 10,
            top: 10,
            width: '250px',
            background: 'white',
            border: '1px solid #e1e5e9',
            borderRadius: '4px',
            padding: '12px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            zIndex: 10,
          }}
        >
          <h4 style={{ margin: '0 0 8px 0', fontSize: '14px' }}>{selectedNode.label}</h4>
          <div style={{ fontSize: '12px', lineHeight: '1.4' }}>
            <div><strong>ID:</strong> {selectedNode.id}</div>
            <div><strong>Type:</strong> {selectedNode.type}</div>
            <div><strong>Status:</strong> {selectedNode.status}</div>
            <div><strong>Timestamp:</strong> {selectedNode.data.timestamp}</div>
            {selectedNode.data.duration && (
              <div><strong>Duration:</strong> {selectedNode.data.duration}ms</div>
            )}
            {selectedNode.data.memory && (
              <div><strong>Memory:</strong> {selectedNode.data.memory}</div>
            )}
          </div>
          <button
            onClick={() => setSelectedNode(null)}
            style={{
              position: 'absolute',
              right: '8px',
              top: '8px',
              background: 'none',
              border: 'none',
              fontSize: '16px',
              cursor: 'pointer',
              color: '#999',
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Performance stats */}
      <div
        style={{
          position: 'absolute',
          bottom: 10,
          left: 10,
          background: 'rgba(255, 255, 255, 0.9)',
          padding: '8px',
          borderRadius: '4px',
          fontSize: '11px',
          color: '#666',
        }}
      >
        Nodes: {processedData.nodes.length} | Edges: {processedData.links.length}
      </div>
    </div>
  );
};

export default TraceGraph;