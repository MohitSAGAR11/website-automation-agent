const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const winston = require("winston");
const logger = require("./utils/logger");
const { runAgent } = require("./agent/agent");
const { chat } = require("./agent/GroqClient");

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

// In-memory runs database
const runs = {};
const queue = [];
let isProcessing = false;

// Task rewriter function using OpenRouter chat helper
async function rewriteTask(task) {
  const prompt = `You are an expert browser automation planner.
Your task is to take a raw user request for a website automation agent and rewrite it into a numbered, step-by-step plan.
Keep the plan precise, actionable, and focus on browser actions (navigation, finding elements, filling inputs, clicking buttons, confirming success).
Ensure all steps are numbered (e.g., "1. ... \\n2. ...").
Do NOT include any preamble, introduction, explanation, or markdown formatting other than the numbered list.

Input task: "${task}"

Numbered plan:`;

  try {
    const response = await chat(
      [{ role: "user", content: prompt }],
      "You are a precise browser automation planner.",
    );
    return response.trim();
  } catch (err) {
    logger.error(
      "Failed to rewrite task via LLM, falling back to original:",
      err,
    );
    throw new Error(`LLM Rewrite failed: ${err.message}`);
  }
}

// Queue processor
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

  // Setup run-specific logging path and transport
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

  try {
    // Phase 1: Rewriting
    run.status = "rewriting";
    logger.info(`Starting execution for run ${runId}`);
    logger.info(`Rewriting task via LLM...`);

    const rewritten = await rewriteTask(run.task);
    run.rewrittenTask = rewritten;
    logger.info(`Task successfully rewritten:\n${rewritten}`);

    // Phase 2: Running
    run.status = "running";
    logger.info(`Launching browser automation agent against: ${run.targetUrl}`);

    // Configure the screenshot dir environment variable for browserTools
    process.env.SCREENSHOT_DIR = path.resolve(screenshotsDir, runId);

    // Call the original agent logic with rewritten task
    await runAgent({
      task: rewritten,
      targetUrl: run.targetUrl,
    });

    run.status = "success";
    logger.info(`Run ${runId} completed successfully.`);
  } catch (err) {
    run.status = "failed";
    run.error = err.message;
    logger.error(`Run ${runId} failed: ${err.message}`);
  } finally {
    // Clean up Winston transport
    try {
      logger.remove(runTransport);
    } catch (_) {}

    run.completedAt = new Date();
    isProcessing = false;
    // Process next item in queue
    processQueue();
  }
}

// ─── API Endpoints ───────────────────────────────────────────────────────────

// POST /run — Triggers agent execution asynchronously
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
    rewrittenTask: null,
    error: null,
    createdAt: new Date(),
    completedAt: null,
  };

  queue.push(runId);
  processQueue(); // Start queue processing if idle

  return res.status(202).json({ run_id: runId });
});

// GET /run/:run_id/status — Get status of the run
app.get("/run/:run_id/status", (req, res) => {
  const { run_id } = req.params;
  const run = runs[run_id];
  if (!run) {
    return res.status(404).json({ error: "Run not found" });
  }
  return res.json(run);
});

// GET /run/:run_id/logs — Get logs so far
app.get("/run/:run_id/logs", (req, res) => {
  const { run_id } = req.params;
  const run = runs[run_id];
  if (!run) {
    return res.status(404).json({ error: "Run not found" });
  }

  const runLogPath = path.resolve(__dirname, "..", "logs", `run_${run_id}.log`);
  if (!fs.existsSync(runLogPath)) {
    return res.json({ logs: "" });
  }

  try {
    const logs = fs.readFileSync(runLogPath, "utf8");
    return res.json({ logs });
  } catch (err) {
    return res.status(500).json({ error: "Failed to read logs" });
  }
});

// GET /run/:run_id/screenshots — Get screenshots taken during run
app.get("/run/:run_id/screenshots", (req, res) => {
  const { run_id } = req.params;
  const run = runs[run_id];
  if (!run) {
    return res.status(404).json({ error: "Run not found" });
  }

  const runScreenshotDir = path.resolve(screenshotsDir, run_id);
  if (!fs.existsSync(runScreenshotDir)) {
    return res.json({ screenshots: [] });
  }

  try {
    const files = fs.readdirSync(runScreenshotDir);
    const pngFiles = files.filter((f) => f.toLowerCase().endsWith(".png"));
    // Sort files chronologically by prefix padded number
    const sortedFiles = pngFiles.sort((a, b) => a.localeCompare(b));
    const urls = sortedFiles.map((file) => `/screenshots/${run_id}/${file}`);
    return res.json({ screenshots: urls });
  } catch (err) {
    return res.status(500).json({ error: "Failed to retrieve screenshots" });
  }
});

// GET /runs — Get history list (helpful for dashboard/persistence)
app.get("/runs", (req, res) => {
  return res.json(
    Object.values(runs).sort((a, b) => b.createdAt - a.createdAt),
  );
});

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
