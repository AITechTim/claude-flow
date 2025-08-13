/**
 * SearchPanel - Advanced search functionality for trace events
 */

import React, { useState, useMemo, useCallback } from 'react';

interface SearchPanelProps {
  events: any[];
  agents: any[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onEventSelect: (event: any) => void;
  onClose: () => void;
}

interface SearchResult {
  event: any;
  matchType: 'id' | 'type' | 'agent' | 'data' | 'timestamp';
  matchText: string;
  score: number;
}

export const SearchPanel: React.FC<SearchPanelProps> = React.memo(({
  events,
  agents,
  searchQuery,
  onSearchChange,
  onEventSelect,
  onClose
}) => {
  const [searchMode, setSearchMode] = useState<'simple' | 'regex' | 'json'>('simple');
  const [sortBy, setSortBy] = useState<'relevance' | 'timestamp' | 'duration'>('relevance');

  // Advanced search results with scoring
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];

    const query = searchQuery.toLowerCase();
    const results: SearchResult[] = [];

    events.forEach(event => {
      const matches: SearchResult[] = [];

      // ID match (highest priority)
      if (event.id.toLowerCase().includes(query)) {
        matches.push({
          event,
          matchType: 'id',
          matchText: event.id,
          score: 100
        });
      }

      // Type match
      if (event.type.toLowerCase().includes(query)) {
        matches.push({
          event,
          matchType: 'type',
          matchText: event.type,
          score: 90
        });
      }

      // Agent match
      if (event.agentId.toLowerCase().includes(query)) {
        matches.push({
          event,
          matchType: 'agent',
          matchText: event.agentId,
          score: 80
        });
      }

      // Data match (JSON content)
      if (event.data) {
        const dataString = JSON.stringify(event.data).toLowerCase();
        if (searchMode === 'regex') {
          try {
            const regex = new RegExp(searchQuery, 'i');
            if (regex.test(dataString)) {
              matches.push({
                event,
                matchType: 'data',
                matchText: 'Data content match',
                score: 70
              });
            }
          } catch (e) {
            // Invalid regex, fall back to simple search
            if (dataString.includes(query)) {
              matches.push({
                event,
                matchType: 'data',
                matchText: 'Data content match',
                score: 70
              });
            }
          }
        } else if (dataString.includes(query)) {
          matches.push({
            event,
            matchType: 'data',
            matchText: 'Data content match',
            score: 70
          });
        }
      }

      // Timestamp match (date/time strings)
      const timestamp = new Date(event.timestamp);
      const timeString = timestamp.toLocaleString().toLowerCase();
      if (timeString.includes(query)) {
        matches.push({
          event,
          matchType: 'timestamp',
          matchText: timeString,
          score: 60
        });
      }

      // Add the best match for this event
      if (matches.length > 0) {
        const bestMatch = matches.reduce((best, current) => 
          current.score > best.score ? current : best
        );
        results.push(bestMatch);
      }
    });

    // Sort results
    return results.sort((a, b) => {
      switch (sortBy) {
        case 'timestamp':
          return b.event.timestamp - a.event.timestamp;
        case 'duration':
          return (b.event.duration || 0) - (a.event.duration || 0);
        case 'relevance':
        default:
          return b.score - a.score;
      }
    });
  }, [events, searchQuery, searchMode, sortBy]);

  const handleResultClick = useCallback((result: SearchResult) => {
    onEventSelect(result.event);
    onClose();
  }, [onEventSelect, onClose]);

  const highlightMatch = (text: string, query: string) => {
    if (!query.trim()) return text;
    
    const index = text.toLowerCase().indexOf(query.toLowerCase());
    if (index === -1) return text;
    
    return (
      <>
        {text.slice(0, index)}
        <mark className="search-highlight">
          {text.slice(index, index + query.length)}
        </mark>
        {text.slice(index + query.length)}
      </>
    );
  };

  return (
    <div className="search-panel floating-panel">
      <div className="panel-overlay" onClick={onClose} />
      
      <div className="panel-content">
        <div className="panel-header">
          <h3>Search Events</h3>
          <button 
            className="close-button"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="search-controls">
          {/* Search Input */}
          <div className="search-input-container">
            <input
              type="text"
              placeholder="Search events, agents, types, or data..."
              className="search-input"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              autoFocus
            />
            <div className="search-icon">🔍</div>
          </div>

          {/* Search Mode Toggle */}
          <div className="search-mode-toggle">
            <button
              className={`mode-btn ${searchMode === 'simple' ? 'active' : ''}`}
              onClick={() => setSearchMode('simple')}
            >
              Simple
            </button>
            <button
              className={`mode-btn ${searchMode === 'regex' ? 'active' : ''}`}
              onClick={() => setSearchMode('regex')}
            >
              Regex
            </button>
            <button
              className={`mode-btn ${searchMode === 'json' ? 'active' : ''}`}
              onClick={() => setSearchMode('json')}
            >
              JSON
            </button>
          </div>

          {/* Sort Controls */}
          <div className="sort-controls">
            <label>Sort by:</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
            >
              <option value="relevance">Relevance</option>
              <option value="timestamp">Time</option>
              <option value="duration">Duration</option>
            </select>
          </div>
        </div>

        {/* Search Results */}
        <div className="search-results">
          {searchQuery.trim() === '' ? (
            <div className="search-placeholder">
              <div className="placeholder-icon">🔍</div>
              <h4>Search Your Trace Data</h4>
              <p>Enter keywords to find specific events, agents, or data</p>
              <div className="search-tips">
                <h5>Search Tips:</h5>
                <ul>
                  <li>Use event IDs for exact matches</li>
                  <li>Search agent names or event types</li>
                  <li>Look inside event data content</li>
                  <li>Try regex mode for advanced patterns</li>
                </ul>
              </div>
            </div>
          ) : searchResults.length === 0 ? (
            <div className="no-results">
              <div className="no-results-icon">😕</div>
              <h4>No Results Found</h4>
              <p>No events match your search query "{searchQuery}"</p>
              <div className="search-suggestions">
                <p>Try:</p>
                <ul>
                  <li>Checking your spelling</li>
                  <li>Using different keywords</li>
                  <li>Switching to regex mode</li>
                  <li>Broadening your search terms</li>
                </ul>
              </div>
            </div>
          ) : (
            <>
              <div className="results-header">
                <span className="results-count">
                  {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
                </span>
              </div>
              
              <div className="results-list">
                {searchResults.map((result, index) => (
                  <div
                    key={`${result.event.id}-${index}`}
                    className="search-result-item"
                    onClick={() => handleResultClick(result)}
                  >
                    <div className="result-header">
                      <div className="result-title">
                        <span className={`event-type-badge type-${result.event.type}`}>
                          {result.event.type}
                        </span>
                        <span className="event-id">
                          {highlightMatch(result.event.id.substring(0, 12), searchQuery)}...
                        </span>
                      </div>
                      <div className="result-score">
                        <span className={`match-type match-${result.matchType}`}>
                          {result.matchType}
                        </span>
                      </div>
                    </div>
                    
                    <div className="result-details">
                      <div className="result-info">
                        <span className="agent-name">
                          Agent: {highlightMatch(result.event.agentId, searchQuery)}
                        </span>
                        <span className="timestamp">
                          {new Date(result.event.timestamp).toLocaleString()}
                        </span>
                        {result.event.duration && (
                          <span className="duration">
                            {result.event.duration}ms
                          </span>
                        )}
                      </div>
                      
                      {result.matchType === 'data' && result.event.data && (
                        <div className="data-preview">
                          <code>
                            {JSON.stringify(result.event.data).substring(0, 100)}...
                          </code>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Search Stats */}
        {searchQuery.trim() && (
          <div className="search-stats">
            <div className="stats-row">
              <span>Searched {events.length} events</span>
              <span>Found {searchResults.length} matches</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

SearchPanel.displayName = 'SearchPanel';