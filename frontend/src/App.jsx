import { useState, useEffect, useRef } from 'react';

function App() {
  const [task, setTask] = useState(
    `Navigate to the shadcn/ui React Hook Form documentation page.
Find the interactive form example.
Fill Username: Mohit Sagar, Bug Title: UI Component Bug Report, Description: Dropdown loses focus when scrolling inside modal.
Click the Submit button and confirm success.`
  );
  const [targetUrl, setTargetUrl] = useState('https://ui.shadcn.com/docs/forms/react-hook-form');
  const [runId, setRunId] = useState(null);
  const [status, setStatus] = useState('idle');
  const [rewrittenTask, setRewrittenTask] = useState(null);
  const [error, setError] = useState(null);
  
  const [logs, setLogs] = useState('');
  const [screenshots, setScreenshots] = useState([]);
  const [activeScreenshotIndex, setActiveScreenshotIndex] = useState(-1);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [history, setHistory] = useState([]);

  const terminalRef = useRef(null);

  // Fetch run history on component mount
  const fetchHistory = async () => {
    try {
      const res = await fetch('/runs');
      if (res.ok) {
        const data = await res.json();
        setHistory(data);
      }
    } catch (err) {
      console.error('Failed to fetch history:', err);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  // Poll for logs, status, screenshots when there is an active run
  useEffect(() => {
    let intervalId = null;

    const isActive = runId && (status === 'pending' || status === 'rewriting' || status === 'running');

    if (isActive) {
      const poll = async () => {
        try {
          // 1. Fetch current run details
          const statusRes = await fetch(`/run/${runId}/status`);
          if (statusRes.ok) {
            const data = await statusRes.json();
            setStatus(data.status);
            setRewrittenTask(data.rewrittenTask);
            setError(data.error);
            
            if (data.status === 'success' || data.status === 'failed') {
              // Fetch once more for final state
              fetchLogs();
              fetchScreenshots();
              fetchHistory();
              return;
            }
          }

          // 2. Fetch logs
          fetchLogs();

          // 3. Fetch screenshots
          fetchScreenshots();
        } catch (err) {
          console.error('Error during polling:', err);
        }
      };

      const fetchLogs = async () => {
        try {
          const logsRes = await fetch(`/run/${runId}/logs`);
          if (logsRes.ok) {
            const logsData = await logsRes.json();
            setLogs(logsData.logs || '');
          }
        } catch (_) {}
      };

      const fetchScreenshots = async () => {
        try {
          const ssRes = await fetch(`/run/${runId}/screenshots`);
          if (ssRes.ok) {
            const ssData = await ssRes.json();
            const nextScreenshots = ssData.screenshots || [];
            
            setScreenshots((prev) => {
              // If we got new screenshots, set active index to the newest one
              if (nextScreenshots.length > prev.length) {
                setActiveScreenshotIndex(nextScreenshots.length - 1);
              }
              return nextScreenshots;
            });
          }
        } catch (_) {}
      };

      poll(); // Run immediately
      intervalId = setInterval(poll, 1500);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [runId, status]);

  // Auto scroll terminal logs
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  // Start a new agent run
  const handleRun = async (e) => {
    e.preventDefault();
    if (!task.trim() || !targetUrl.trim()) return;

    setError(null);
    setLogs('');
    setScreenshots([]);
    setRewrittenTask(null);
    setActiveScreenshotIndex(-1);
    setStatus('pending');

    try {
      const res = await fetch('/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          task,
          target_url: targetUrl,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to start the run');
      }

      const data = await res.json();
      setRunId(data.run_id);
    } catch (err) {
      setError(err.message);
      setStatus('failed');
    }
  };

  // Load a run from history list
  const handleSelectHistory = async (historicalRun) => {
    setRunId(historicalRun.id);
    setStatus(historicalRun.status);
    setRewrittenTask(historicalRun.rewrittenTask);
    setError(historicalRun.error);
    setTask(historicalRun.task);
    setTargetUrl(historicalRun.targetUrl);

    // Fetch historical logs
    try {
      const logsRes = await fetch(`/run/${historicalRun.id}/logs`);
      if (logsRes.ok) {
        const logsData = await logsRes.json();
        setLogs(logsData.logs || '');
      }
    } catch (_) {
      setLogs('Failed to load historical logs.');
    }

    // Fetch historical screenshots
    try {
      const ssRes = await fetch(`/run/${historicalRun.id}/screenshots`);
      if (ssRes.ok) {
        const ssData = await ssRes.json();
        const ssList = ssData.screenshots || [];
        setScreenshots(ssList);
        setActiveScreenshotIndex(ssList.length > 0 ? ssList.length - 1 : -1);
      }
    } catch (_) {
      setScreenshots([]);
      setActiveScreenshotIndex(-1);
    }
  };

  // Extract steps list from rewritten planner task
  const steps = rewrittenTask
    ? rewrittenTask
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    : [];

  // Parse logs line-by-line for color-coding
  const renderLogLines = () => {
    if (!logs) return <div className="log-line default">Waiting for logs...</div>;

    return logs.split('\n').map((line, idx) => {
      if (!line) return null;
      let type = 'default';
      
      if (line.includes('[ERROR]') || line.includes('❌') || line.toLowerCase().includes('failed')) {
        type = 'error';
      } else if (line.includes('[WARN]') || line.includes('⚠️')) {
        type = 'warn';
      } else if (line.includes('✅') || line.includes('TASK COMPLETE')) {
        type = 'success';
      } else if (line.includes('💭 Agent:')) {
        type = 'think';
      } else if (line.includes('Tool:') || line.includes('▶ Tool:')) {
        type = 'tool';
      } else if (line.includes('[INFO]')) {
        type = 'info';
      }

      return (
        <div key={idx} className={`log-line ${type}`}>
          {line}
        </div>
      );
    });
  };

  const activeScreenshot = activeScreenshotIndex >= 0 ? screenshots[activeScreenshotIndex] : null;

  // Extract step counts/label from active screenshot filename
  const getScreenshotLabel = (pathStr) => {
    if (!pathStr) return '';
    const parts = pathStr.split('/');
    const filename = parts[parts.length - 1];
    // Remove the counter prefix (e.g., 001_) and file extension (.png)
    return filename.substring(4).replace('.png', '').replace(/_/g, ' ');
  };

  return (
    <div className="app-container">
      {/* Header / Brand control */}
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

      {/* Main Grid Workspace */}
      <div className="dashboard-grid">
        
        {/* Left Side — Controls & Steps Checklist */}
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
                disabled={status === 'pending' || status === 'rewriting' || status === 'running'}
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
                disabled={status === 'pending' || status === 'rewriting' || status === 'running'}
              />
            </div>

            <button
              type="submit"
              className="run-button"
              disabled={status === 'pending' || status === 'rewriting' || status === 'running'}
            >
              {(status === 'pending' || status === 'rewriting' || status === 'running') && (
                <div className="spinner"></div>
              )}
              {status === 'rewriting' ? 'LLM Rewriting Task...' : status === 'running' ? 'Agent Running...' : 'Run Agent'}
            </button>
          </form>

          {/* Steps list panel */}
          <div className="card">
            <h2 className="card-title">Rewritten Agent Plan</h2>
            {steps.length > 0 ? (
              <div className="steps-container">
                {steps.map((step, index) => {
                  // Basic regex check to parse step number and description
                  const match = step.match(/^(\d+)\.\s*(.*)/);
                  const stepNum = match ? match[1] : index + 1;
                  const stepText = match ? match[2] : step;

                  return (
                    <div key={index} className="step-item active">
                      <div className="step-number">{stepNum}</div>
                      <div className="step-text">{stepText}</div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="steps-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
                <span className="form-label">No plan generated yet. Submit a task to begin.</span>
              </div>
            )}
          </div>

          {/* Recent Runs list */}
          <div className="card" style={{ flex: 1 }}>
            <h2 className="card-title">Run History</h2>
            <div className="history-container">
              {history.length > 0 ? (
                history.map((h) => (
                  <div
                    key={h.id}
                    className={`history-item ${runId === h.id ? 'active' : ''}`}
                    onClick={() => handleSelectHistory(h)}
                  >
                    <div className="history-info">
                      <span className="history-task">{h.task}</span>
                      <span className="history-time">{new Date(h.createdAt).toLocaleTimeString()}</span>
                    </div>
                    <div className={`status-badge ${h.status}`} style={{ fontSize: '10px', padding: '2px 8px' }}>
                      {h.status}
                    </div>
                  </div>
                ))
              ) : (
                <span className="form-label" style={{ textAlign: 'center', display: 'block' }}>No run history found.</span>
              )}
            </div>
          </div>
        </div>

        {/* Right Side — Terminal Logs & Screenshot Timeline */}
        <div className="right-panel">
          {/* Terminal logs component */}
          <div className="card console-card">
            <div className="terminal-header">
              <div className="terminal-dots">
                <div className="terminal-dot red"></div>
                <div className="terminal-dot yellow"></div>
                <div className="terminal-dot green"></div>
              </div>
              <span className="terminal-title">agent-terminal - {runId || 'offline'}</span>
            </div>
            <div className="terminal" ref={terminalRef}>
              {renderLogLines()}
            </div>
          </div>

          {/* Live screenshot viewer */}
          <div className="card vision-card">
            <h2 className="card-title">Agent Vision Timeline</h2>
            
            {activeScreenshot ? (
              <div className="viewer-container" onClick={() => setIsLightboxOpen(true)}>
                <img
                  className="active-screenshot"
                  src={activeScreenshot}
                  alt={`Screenshot label: ${getScreenshotLabel(activeScreenshot)}`}
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

            {/* Carousel timeline of thumbnails */}
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

      {/* Lightbox zoom modal */}
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
