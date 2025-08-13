/**
 * ExportImportPanel - Panel for exporting trace data and importing sessions
 */

import React, { useState, useRef } from 'react';

interface ExportImportPanelProps {
  onExport: (format: 'json' | 'csv' | 'png') => Promise<void>;
  onImport: (file: File) => Promise<void>;
  onClose: () => void;
  eventCount: number;
  isExporting: boolean;
}

export const ExportImportPanel: React.FC<ExportImportPanelProps> = React.memo(({
  onExport,
  onImport,
  onClose,
  eventCount,
  isExporting
}) => {
  const [selectedFormat, setSelectedFormat] = useState<'json' | 'csv' | 'png'>('json');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    try {
      await onExport(selectedFormat);
    } catch (error) {
      console.error('Export failed:', error);
    }
  };

  const handleFileSelect = async (file: File) => {
    if (file.type === 'application/json' || file.name.endsWith('.json')) {
      try {
        await onImport(file);
        onClose();
      } catch (error) {
        console.error('Import failed:', error);
      }
    } else {
      alert('Please select a JSON file');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  return (
    <div className="export-import-panel floating-panel">
      <div className="panel-overlay" onClick={onClose} />
      
      <div className="panel-content">
        <div className="panel-header">
          <h3>Export & Import</h3>
          <button 
            className="close-button"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="panel-sections">
          {/* Export Section */}
          <section className="export-section">
            <h4>Export Trace Data</h4>
            <p className="section-description">
              Export {eventCount} events and associated data
            </p>

            <div className="format-selector">
              <label className="format-option">
                <input
                  type="radio"
                  name="format"
                  value="json"
                  checked={selectedFormat === 'json'}
                  onChange={(e) => setSelectedFormat(e.target.value as 'json')}
                />
                <div className="format-details">
                  <strong>JSON</strong>
                  <span>Complete trace data with full event details</span>
                </div>
              </label>

              <label className="format-option">
                <input
                  type="radio"
                  name="format"
                  value="csv"
                  checked={selectedFormat === 'csv'}
                  onChange={(e) => setSelectedFormat(e.target.value as 'csv')}
                />
                <div className="format-details">
                  <strong>CSV</strong>
                  <span>Spreadsheet-compatible event data</span>
                </div>
              </label>

              <label className="format-option">
                <input
                  type="radio"
                  name="format"
                  value="png"
                  checked={selectedFormat === 'png'}
                  onChange={(e) => setSelectedFormat(e.target.value as 'png')}
                />
                <div className="format-details">
                  <strong>PNG</strong>
                  <span>Visual snapshot of current graph</span>
                </div>
              </label>
            </div>

            <button
              className="export-button primary-button"
              onClick={handleExport}
              disabled={isExporting || eventCount === 0}
            >
              {isExporting ? (
                <>
                  <span className="spinner small"></span>
                  Exporting...
                </>
              ) : (
                <>
                  📥 Export {selectedFormat.toUpperCase()}
                </>
              )}
            </button>
          </section>

          <div className="section-divider" />

          {/* Import Section */}
          <section className="import-section">
            <h4>Import Trace Session</h4>
            <p className="section-description">
              Import previously exported trace data
            </p>

            <div
              className={`drop-zone ${isDragging ? 'dragging' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="drop-zone-content">
                <div className="drop-zone-icon">📁</div>
                <div className="drop-zone-text">
                  <strong>Drop JSON file here</strong>
                  <span>or click to browse</span>
                </div>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  handleFileSelect(file);
                }
              }}
            />

            <div className="import-info">
              <div className="info-item">
                <span className="info-icon">ℹ️</span>
                <span>Only JSON files exported from Claude Flow are supported</span>
              </div>
              <div className="info-item">
                <span className="info-icon">⚠️</span>
                <span>Importing will replace current session data</span>
              </div>
            </div>
          </section>
        </div>

        <div className="panel-footer">
          <button 
            className="secondary-button"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
});

ExportImportPanel.displayName = 'ExportImportPanel';