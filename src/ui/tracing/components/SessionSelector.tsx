/**
 * SessionSelector - Component for selecting active trace sessions
 */

import React from 'react';

interface Session {
  id: string;
  name: string;
  startTime: number;
  endTime?: number;
  eventCount: number;
  agentCount: number;
  status: 'active' | 'completed' | 'error';
}

interface SessionSelectorProps {
  sessions: Session[];
  selectedSession: string;
  onSessionChange: (sessionId: string) => void;
}

export const SessionSelector: React.FC<SessionSelectorProps> = React.memo(({
  sessions,
  selectedSession,
  onSessionChange
}) => {
  return (
    <div className="session-selector">
      <label className="session-label">Session:</label>
      <select 
        className="session-dropdown"
        value={selectedSession}
        onChange={(e) => onSessionChange(e.target.value)}
      >
        <option value="">Live Session</option>
        {sessions.map((session) => (
          <option key={session.id} value={session.id}>
            {session.name} - {session.eventCount} events
            {session.status === 'active' ? ' (Live)' : ''}
          </option>
        ))}
      </select>
      
      {selectedSession && (
        <div className="session-info">
          {sessions.find(s => s.id === selectedSession)?.status === 'active' && (
            <span className="live-indicator">🔴 LIVE</span>
          )}
        </div>
      )}
    </div>
  );
});

SessionSelector.displayName = 'SessionSelector';