import { useState, useEffect, useRef } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

function App() {
  const [task, setTask] = useState(
    `Navigate to the shadcn/ui React Hook Form documentation page.\nFind the interactive form example.\nFill Username: Mohit Sagar, Bug Title: UI Component Bug Report, Description: Dropdown loses focus when scrolling inside modal.\nClick the Submit button and confirm success.`
  );
  const [targetUrl, setTargetUrl] = useState('https://ui.shadcn.com/docs/forms/react-hook-form');
  const [runId, setRunId] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [logs, setLogs] = useState('');
  const [screenshots, setScreenshots] = useState([]);
  const [activeScreenshotIndex, setActiveScreenshotIndex] = useState(-1);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  const terminalRef = useRef(null);

  // Poll for logs, status, screenshots when there is an active run
  useEffect(() => {
    let intervalId = null;

    const isActive = runId && (status === 'pending' || status === 'running');

    if (isActive) {
      const fetchLogs = async () => {
        try {
          const res = await fetch(`${API_BASE}/run/${runId}/logs`);
          if (res.ok) {
            const data = await res.json();
            setLogs(data.logs || '');
          }
        } catch (_) {}
      };

      const fetchScreenshots = async () => {
        try {
          const res = await fetch(`${API_BASE}/run/${runId}/screenshots`);
          if (res.ok) {
            const data = await res.json();
            const next = data.screenshots || [];
            setScreenshots((prev) => {
              if (next.length > prev.length) {
                setActiveScreenshotIndex(next.length - 1);
              }
              return next;
            });
          }
        } catch (_) {}
      };

      const poll = async () => {
        try {
          const res = await fetch(`${API_BASE}/run/${runId}/status`);
          if (res.ok) {
            const data = await res.json();
            setStatus(data.status);
            setError(data.error);

            if (data.status === 'success' || data.status === 'failed' || data.status === 'cancelled') {
              fetchLogs();
              fetchScreenshots();
              return;
            }
          }
          fetchLogs();
          fetchScreenshots();
        } catch (err) {
          console.error('Polling error:', err);
        }
      };

      poll();
      intervalId = setInterval(poll, 1500);
    }

    return () => { if (intervalId) clearInterval(intervalId); };
  }, [runId, status]);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  const handleRun = async (e) => {
    e.preventDefault();
    if (!task.trim() || !targetUrl.trim()) return;

    setError(null);
    setLogs('');
    setScreenshots([]);
    setActiveScreenshotIndex(-1);
    setStatus('pending');

    try {
      const res = await fetch(`${API_BASE}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, target_url: targetUrl }),
      });
      if (!res.ok) throw new Error('Failed to start the run');
      const data = await res.json();
      setRunId(data.run_id);
    } catch (err) {
      setError(err.message);
      setStatus('failed');
    }
  };

  const handleCancel = async () => {
    if (!runId) return;
    try {
      await fetch(`${API_BASE}/run/${runId}/cancel`, { method: 'POST' });
      setStatus('cancelled');
    } catch (err) {
      console.error('Failed to cancel run:', err);
    }
  };

  const isActive = status === 'pending' || status === 'running';

  // Color-coded log renderer
  const renderLogLines = () => {
    if (!logs) return <div className="log-line default">Waiting for logs...</div>;
    return logs.split('\n').map((line, idx) => {
      if (!line) return null;
      let type = 'default';
      if (line.includes('[ERROR]') || line.includes('❌') || line.toLowerCase().includes('failed')) type = 'error';
      else if (line.includes('[WARN]') || line.includes('⚠️')) type = 'warn';
      else if (line.includes('✅') || line.includes('TASK COMPLETE')) type = 'success';
      else if (line.includes('💭 Agent:')) type = 'think';
      else if (line.includes('Tool:') || line.includes('▶ Tool:')) type = 'tool';
      else if (line.includes('[INFO]')) type = 'info';
      return <div key={idx} className={`log-line ${type}`}>{line}</div>;
    });
  };

  const activeScreenshot = activeScreenshotIndex >= 0 ? screenshots[activeScreenshotIndex] : null;

  const getScreenshotLabel = (pathStr) => {
    if (!pathStr) return '';
    const filename = pathStr.split('/').pop();
    return filename.substring(4).replace('.png', '').replace(/_/g, ' ');
  };

  return (
    <div className="app-container">
      <header className="header">
        <div className="logo-section">
          <div className="logo-icon">A</div>
          <h1>AutoAgent Workspace</h1>
        </div>
        <div className={`status-badge ${status}`}>
          <div className="dot"></div>
          {status}
        </div>
      </header>

      <div className="dashboard-grid">
        {/* Left Panel — Controls */}
        <div className="left-panel">
          <form className="card" onSubmit={handleRun}>
            <h2 className="card-title">Run Configuration</h2>

            <div className="form-group">
              <label htmlFor="target-url" className="form-label">Target Website URL</label>
              <input
                id="target-url"
                type="url"
                required
                className="form-input"
                placeholder="https://example.com"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                disabled={isActive}
              />
            </div>

            <div className="form-group">
              <label htmlFor="task-description" className="form-label">Automation Task Description</label>
              <textarea
                id="task-description"
                required
                className="form-textarea"
                placeholder="Describe what the agent should do..."
                value={task}
                onChange={(e) => setTask(e.target.value)}
                disabled={isActive}
              />
            </div>

            <button type="submit" className="run-button" disabled={isActive}>
              {isActive && <div className="spinner"></div>}
              {status === 'running' ? 'Agent Running...' : 'Run Agent'}
            </button>

            {isActive && (
              <button
                type="button"
                className="run-button"
                style={{ marginTop: '8px', background: 'linear-gradient(135deg, #dc2626, #b91c1c)' }}
                onClick={handleCancel}
              >
                ✕ Cancel Run
              </button>
            )}

            {error && (
              <div className="log-line error" style={{ marginTop: '12px', borderRadius: '8px', padding: '10px' }}>
                ❌ {error}
              </div>
            )}
          </form>
        </div>

        {/* Right Panel — Terminal & Screenshots */}
        <div className="right-panel">
          <div className="card console-card">
            <div className="terminal-header">
              <div className="terminal-dots">
                <div className="terminal-dot red"></div>
                <div className="terminal-dot yellow"></div>
                <div className="terminal-dot green"></div>
              </div>
              <span className="terminal-title">agent-terminal — {runId || 'offline'}</span>
            </div>
            <div className="terminal" ref={terminalRef}>
              {renderLogLines()}
            </div>
          </div>

          <div className="card vision-card">
            <h2 className="card-title">Agent Vision Timeline</h2>

            {activeScreenshot ? (
              <div className="viewer-container" onClick={() => setIsLightboxOpen(true)}>
                <img
                  className="active-screenshot"
                  src={activeScreenshot}
                  alt={`Screenshot: ${getScreenshotLabel(activeScreenshot)}`}
                />
                <div className="screenshot-label">
                  Step {activeScreenshotIndex + 1}: {getScreenshotLabel(activeScreenshot)}
                </div>
                <div className="screenshot-count">
                  {activeScreenshotIndex + 1} / {screenshots.length}
                </div>
              </div>
            ) : (
              <div className="viewer-container">
                <div className="screenshot-placeholder">
                  <div className="placeholder-icon">👁️</div>
                  <span>Waiting for screenshots...</span>
                </div>
              </div>
            )}

            {screenshots.length > 0 && (
              <div className="thumbnails-container">
                {screenshots.map((ss, index) => (
                  <div
                    key={index}
                    className={`thumbnail-wrapper ${index === activeScreenshotIndex ? 'active' : ''}`}
                    onClick={() => setActiveScreenshotIndex(index)}
                  >
                    <img className="thumbnail-img" src={ss} alt={`Thumbnail ${index + 1}`} />
                    <span className="thumbnail-num">{index + 1}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {isLightboxOpen && activeScreenshot && (
        <div className="lightbox" onClick={() => setIsLightboxOpen(false)}>
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <button className="lightbox-close" onClick={() => setIsLightboxOpen(false)}>&times;</button>
            <img className="lightbox-img" src={activeScreenshot} alt="Agent Vision Full" />
            <div className="lightbox-caption">
              Step {activeScreenshotIndex + 1}: {getScreenshotLabel(activeScreenshot)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
