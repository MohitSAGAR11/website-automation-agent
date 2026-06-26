const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const winston = require("winston");
const logger = require("./utils/logger");
const { runAgent } = require("./agent/agent");

require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Serve screenshots folder statically
const screenshotsDir = path.resolve(__dirname, "..", "screenshots");
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}
app.use("/screenshots", express.static(screenshotsDir));

// ─── In-memory run store (session only, no persistence) ───────────────────────
const runs = {};
const queue = [];
let isProcessing = false;

// Per-run abort controllers for cancellation
const abortControllers = {};

// ─── Queue processor ──────────────────────────────────────────────────────────
async function processQueue() {
  if (isProcessing || queue.length === 0) return;
  isProcessing = true;

  const runId = queue.shift();
  const run = runs[runId];
  if (!run) {
    isProcessing = false;
    processQueue();
    return;
  }

  // Setup run-specific log file
  const runLogPath = path.resolve(__dirname, "..", "logs", `run_${runId}.log`);
  const logsDir = path.dirname(runLogPath);
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const runFormat = winston.format.printf(
    ({ level, message, timestamp, ...meta }) => {
      const metaStr = Object.keys(meta).length
        ? " " + JSON.stringify(meta)
        : "";
      return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
    },
  );

  const runTransport = new winston.transports.File({
    filename: runLogPath,
    format: winston.format.combine(
      winston.format.timestamp({ format: "HH:mm:ss" }),
      runFormat,
    ),
  });

  logger.add(runTransport);

  // AbortController so this run can be cancelled
  const controller = new AbortController();
  abortControllers[runId] = controller;

  try {
    run.status = "running";
    logger.info(`Starting execution for run ${runId}`);
    logger.info(`Launching browser automation agent against: ${run.targetUrl}`);

    // Point browserTools at a run-specific screenshot subdirectory
    process.env.SCREENSHOT_DIR = path.resolve(screenshotsDir, runId);

    await runAgent({
      task: run.task,
      targetUrl: run.targetUrl,
      signal: controller.signal,
    });

    run.status = controller.signal.aborted ? "cancelled" : "success";
    logger.info(`Run ${runId} ${run.status}.`);
  } catch (err) {
    run.status = controller.signal.aborted ? "cancelled" : "failed";
    run.error = err.message;
    logger.error(`Run ${runId} failed: ${err.message}`);
  } finally {
    delete abortControllers[runId];
    try { logger.remove(runTransport); } catch (_) {}
    run.completedAt = new Date();
    isProcessing = false;
    processQueue();
  }
}

// ─── API Endpoints ────────────────────────────────────────────────────────────

// POST /run — Start a new agent run
app.post("/run", (req, res) => {
  const { task, target_url } = req.body;
  if (!task || !target_url) {
    return res
      .status(400)
      .json({ error: "Missing task or target_url in request body" });
  }

  const runId = `run_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  runs[runId] = {
    id: runId,
    task,
    targetUrl: target_url,
    status: "pending",
    error: null,
    createdAt: new Date(),
    completedAt: null,
  };

  queue.push(runId);
  processQueue();

  return res.status(202).json({ run_id: runId });
});

// POST /run/:run_id/cancel — Cancel a running or queued run
app.post("/run/:run_id/cancel", (req, res) => {
  const { run_id } = req.params;
  const run = runs[run_id];

  if (!run) {
    return res.status(404).json({ error: "Run not found" });
  }

  if (!["pending", "running"].includes(run.status)) {
    return res
      .status(400)
      .json({ error: `Run is already in terminal state: ${run.status}` });
  }

  // Remove from queue if not yet started
  const queueIdx = queue.indexOf(run_id);
  if (queueIdx !== -1) {
    queue.splice(queueIdx, 1);
    run.status = "cancelled";
    run.completedAt = new Date();
    logger.info(`Run ${run_id} cancelled before start.`);
    return res.json({ message: "Run cancelled (was queued, not yet started)" });
  }

  // Signal the running agent to stop
  const controller = abortControllers[run_id];
  if (controller) {
    controller.abort();
    logger.info(`Abort signal sent to run ${run_id}.`);
    return res.json({ message: "Cancellation signal sent to running agent" });
  }

  return res.status(500).json({ error: "Could not cancel run" });
});

// GET /run/:run_id/status — Poll run status
app.get("/run/:run_id/status", (req, res) => {
  const run = runs[req.params.run_id];
  if (!run) return res.status(404).json({ error: "Run not found" });
  return res.json(run);
});

// GET /run/:run_id/logs — Fetch live logs
app.get("/run/:run_id/logs", (req, res) => {
  const run = runs[req.params.run_id];
  if (!run) return res.status(404).json({ error: "Run not found" });

  const runLogPath = path.resolve(__dirname, "..", "logs", `run_${req.params.run_id}.log`);
  if (!fs.existsSync(runLogPath)) return res.json({ logs: "" });

  try {
    return res.json({ logs: fs.readFileSync(runLogPath, "utf8") });
  } catch (_) {
    return res.status(500).json({ error: "Failed to read logs" });
  }
});

// GET /run/:run_id/screenshots — List screenshots for a run
app.get("/run/:run_id/screenshots", (req, res) => {
  const run = runs[req.params.run_id];
  if (!run) return res.status(404).json({ error: "Run not found" });

  const runScreenshotDir = path.resolve(screenshotsDir, req.params.run_id);
  if (!fs.existsSync(runScreenshotDir)) return res.json({ screenshots: [] });

  try {
    const files = fs.readdirSync(runScreenshotDir);
    const urls = files
      .filter((f) => f.toLowerCase().endsWith(".png"))
      .sort((a, b) => a.localeCompare(b))
      .map((f) => `/screenshots/${req.params.run_id}/${f}`);
    return res.json({ screenshots: urls });
  } catch (_) {
    return res.status(500).json({ error: "Failed to retrieve screenshots" });
  }
});

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
