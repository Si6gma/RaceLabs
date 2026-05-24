import { useState, useRef, useCallback } from 'react';
import { useTelemetryStore } from '@/stores/telemetryStore';
import { Upload, X, FileSpreadsheet, CheckCircle, AlertTriangle, Loader2, FileUp } from 'lucide-react';
import type { ImportProgress } from '@/types/telemetry';

const API_URL = import.meta.env.VITE_API_URL || '';

export default function ImportModal() {
  const importModalOpen = useTelemetryStore(s => s.importModalOpen);
  const setImportModalOpen = useTelemetryStore(s => s.setImportModalOpen);
  const addImportedSession = useTelemetryStore(s => s.addImportedSession);
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [validation, setValidation] = useState<any>(null);
  const [validating, setValidating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setFile(null);
    setValidation(null);
    setValidating(false);
    setImporting(false);
    setProgress(null);
    setError(null);
    setSessionName('');
  }, []);

  const handleClose = useCallback(() => {
    setImportModalOpen(false);
    setTimeout(reset, 300);
  }, [setImportModalOpen, reset]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const validateFile = useCallback(async (file: File) => {
    setValidating(true);
    setError(null);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const res = await fetch(`${API_URL}/api/import/validate`, {
        method: 'POST',
        body: formData,
      });
      
      if (!res.ok) throw new Error(`Validation failed: ${res.status} ${res.statusText}`);
      
      const data = await res.json();
      setValidation(data);
      
      if (!data.valid) {
        setError(`Missing required columns: ${data.missing_required?.join(', ')}`);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to validate file');
    } finally {
      setValidating(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const dropped = e.dataTransfer.files[0];
    if (dropped && dropped.name.endsWith('.csv')) {
      setFile(dropped);
      setSessionName(dropped.name.replace('.csv', '').replace(/[_-]/g, ' '));
      validateFile(dropped);
    } else {
      setError('Please drop a CSV file');
    }
  }, [validateFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      setSessionName(selected.name.replace('.csv', '').replace(/[_-]/g, ' '));
      validateFile(selected);
    }
  }, [validateFile]);

  const handleImport = useCallback(async () => {
    if (!file || !validation?.valid) return;
    
    setImporting(true);
    setProgress({ status: 'validating', progress: 0, message: 'Starting import...' });
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (sessionName) {
        formData.append('session_name', sessionName);
      }
      
      const res = await fetch(`${API_URL}/api/import/csv`, {
        method: 'POST',
        body: formData,
      });
      
      if (!res.ok) {
        const text = await res.text();
        let message = `Import failed: ${res.status} ${res.statusText}`;
        try {
          const err = JSON.parse(text);
          if (err.detail) message = err.detail;
        } catch {
          // ignore JSON parse error
        }
        throw new Error(message);
      }
      
      const data = await res.json();
      
      if (data.status === 'complete' && data.session) {
        setProgress({
          status: 'complete',
          progress: 100,
          message: data.message,
          session: data.session,
        });
        addImportedSession(data.session);
      } else if (data.status === 'error') {
        throw new Error(data.message);
      }
    } catch (err: any) {
      setError(err.message || 'Import failed');
      setProgress(null);
    } finally {
      setImporting(false);
    }
  }, [file, validation, sessionName, addImportedSession]);

  if (!importModalOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-motorsport-charcoal border border-motorsport-border rounded-sm w-full max-w-lg mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-motorsport-border">
          <div className="flex items-center gap-2">
            <FileUp className="w-4 h-4 text-motorsport-orange" />
            <span className="text-sm font-semibold">IMPORT TELEMETRY</span>
          </div>
          <button
            onClick={handleClose}
            className="p-1 hover:bg-motorsport-surface rounded-sm transition-colors"
          >
            <X className="w-4 h-4 text-motorsport-muted" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Drag & Drop Area */}
          {!file && (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-sm p-8 text-center cursor-pointer transition-colors ${
                isDragging
                  ? 'border-motorsport-orange bg-motorsport-orange/5'
                  : 'border-motorsport-border hover:border-motorsport-muted hover:bg-motorsport-surface/30'
              }`}
            >
              <Upload className="w-8 h-8 mx-auto mb-3 text-motorsport-muted" />
              <p className="text-sm text-motorsport-text mb-1">
                Drop CSV file here or click to browse
              </p>
              <p className="text-xs text-motorsport-dim">
                Supports F1 telemetry CSV format
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
          )}

          {/* File Selected */}
          {file && !progress && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-motorsport-surface/50 rounded-sm border border-motorsport-border">
                <FileSpreadsheet className="w-5 h-5 text-motorsport-cyan" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <p className="text-xs text-motorsport-muted">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                <button
                  onClick={reset}
                  className="p-1 hover:bg-motorsport-charcoal rounded-sm"
                >
                  <X className="w-3.5 h-3.5 text-motorsport-muted" />
                </button>
              </div>

              {/* Validation Results */}
              {validating && (
                <div className="flex items-center gap-2 text-sm text-motorsport-muted">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Validating schema...
                </div>
              )}

              {validation && !validating && (
                <div className="space-y-3">
                  {validation.valid ? (
                    <div className="flex items-center gap-2 text-sm text-motorsport-green">
                      <CheckCircle className="w-4 h-4" />
                      Schema valid — {validation.estimated_rows?.toLocaleString()} rows detected
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-motorsport-red">
                      <AlertTriangle className="w-4 h-4" />
                      Schema invalid
                    </div>
                  )}

                  {validation.unknown_columns?.length > 0 && (
                    <p className="text-xs text-motorsport-muted">
                      Unknown columns: {validation.unknown_columns.join(', ')}
                    </p>
                  )}

                  {/* Session Name Input */}
                  {validation.valid && (
                    <div>
                      <label className="text-xs text-motorsport-muted block mb-1">
                        Session Name
                      </label>
                      <input
                        type="text"
                        value={sessionName}
                        onChange={(e) => setSessionName(e.target.value)}
                        className="w-full bg-motorsport-black border border-motorsport-border rounded-sm px-3 py-2 text-sm text-motorsport-text focus:outline-none focus:border-motorsport-orange"
                        placeholder="Enter session name..."
                      />
                    </div>
                  )}

                  {/* Import Button */}
                  {validation.valid && (
                    <button
                      onClick={handleImport}
                      disabled={importing}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-motorsport-orange text-motorsport-black font-semibold text-sm rounded-sm hover:bg-motorsport-orange/90 transition-colors disabled:opacity-50"
                    >
                      {importing ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Importing...
                        </>
                      ) : (
                        <>
                          <Upload className="w-4 h-4" />
                          Import Telemetry
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Progress */}
          {progress && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-motorsport-muted">
                  {progress.status === 'complete' ? 'Import Complete' : 'Importing...'}
                </span>
                <span className="font-telemetry">{progress.progress}%</span>
              </div>
              
              <div className="h-1.5 bg-motorsport-surface rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    progress.status === 'complete'
                      ? 'bg-motorsport-green'
                      : 'bg-motorsport-orange'
                  }`}
                  style={{ width: `${progress.progress}%` }}
                />
              </div>
              
              <p className="text-xs text-motorsport-muted">{progress.message}</p>
              
              {progress.status === 'complete' && progress.session && (
                <div className="p-3 bg-motorsport-green/5 border border-motorsport-green/20 rounded-sm">
                  <div className="flex items-center gap-2 text-sm text-motorsport-green mb-2">
                    <CheckCircle className="w-4 h-4" />
                    <span className="font-medium">{progress.session.name}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-motorsport-muted">Laps</span>
                      <p className="font-telemetry text-motorsport-text">{progress.session.lap_count}</p>
                    </div>
                    <div>
                      <span className="text-motorsport-muted">Samples</span>
                      <p className="font-telemetry text-motorsport-text">{progress.session.sample_count?.toLocaleString()}</p>
                    </div>
                    <div>
                      <span className="text-motorsport-muted">Best</span>
                      <p className="font-telemetry text-motorsport-cyan">
                        {progress.session.best_lap_time_ms ? formatLapTime(progress.session.best_lap_time_ms) : '--:--'}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-motorsport-red/5 border border-motorsport-red/20 rounded-sm">
              <AlertTriangle className="w-4 h-4 text-motorsport-red shrink-0 mt-0.5" />
              <p className="text-sm text-motorsport-red">{error}</p>
            </div>
          )}

          {/* Done Button */}
          {progress?.status === 'complete' && (
            <button
              onClick={handleClose}
              className="w-full px-4 py-2.5 bg-motorsport-surface text-motorsport-text font-medium text-sm rounded-sm hover:bg-motorsport-surface/80 transition-colors"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function formatLapTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}
