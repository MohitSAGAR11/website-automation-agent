const tools = require("../tools/browserTools");
const {
  chat,
  parseActionFromResponse,
  OPENROUTER_MODEL,
} = require("./OpenRouterClient");
const logger = require("../utils/logger");
// dotenv is loaded once in server.js — no need to load it again here

const MAX_STEPS = parseInt(process.env.MAX_STEPS || "30");
const TARGET_URL =
  process.env.TARGET_URL || "https://ui.shadcn.com/docs/forms/react-hook-form";

const SYSTEM_PROMPT = `You are an expert browser automation agent that controls a real web browser.

Tools:
- navigate_to_url(url)
- click_element(selector)
- send_keys(text, selector)  — append \\n to submit (triggers real Enter keypress)
- scroll(deltaY, selector)
- scroll_to_center(selector)
- wait_for_element(selector)
- get_page_content()          — only call AFTER navigation/wait, NOT every step
- take_screenshot(label, selector)
- click_on_screen(x, y)
- double_click(x, y, selector)
- done(summary)              — call immediately when task is complete

RULES:
1. Page state is already in the message. Do NOT call get_page_content() unless you just navigated or waited.
2. Append \\n to send_keys text to submit forms — this fires a real Enter keypress.
3. Selector priority: id > name > aria-label > role > data-testid > text content. Never repeat a failed selector.
4. Call done() the moment the task is complete — do not take extra steps.
5. Be decisive. Pick the most direct path. Avoid unnecessary screenshots or scrolls.
6. For links (tag=a), ALWAYS use navigate_to_url(href) rather than click_element — href is in the Inputs list.
7. Do NOT take repeated screenshots — act on the page state provided. Screenshot only as a last resort.
8. If you see a STUCK WARNING, the URL has not changed — try a completely different tool or approach.

Respond ONLY with valid JSON — no markdown fences:
{"tool": "tool_name", "args": {...}, "reasoning": "brief reason"}`;


async function dispatchTool(toolName, args = {}) {
  switch (toolName) {
    case "navigate_to_url":
      return tools.navigate_to_url(args.url);

    case "take_screenshot":
      return tools.take_screenshot(args.label || "step", args.selector ?? null);

    case "scroll":
      return tools.scroll(args.deltaY ?? 400, args.selector ?? null);

    case "scroll_to_center":
      return tools.scroll_to_center(args.selector);

    case "click_element":
      return tools.click_element(args.selector);

    case "click_on_screen":
      return tools.click_on_screen(args.x, args.y);

    case "send_keys":
      return tools.send_keys(args.text, args.selector ?? null);

    case "double_click":
      return tools.double_click(
        args.x ?? null,
        args.y ?? null,
        args.selector ?? null,
      );

    case "get_page_content":
      return tools.get_page_content();

    case "wait_for_element":
      return tools.wait_for_element(args.selector, args.timeout ?? 10000);

    case "done":
      return { done: true, summary: args.summary || "Task complete" };

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

async function runAgent({ task, targetUrl = TARGET_URL, signal = null }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey === "your_openrouter_api_key_here") {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Please configure a valid API key in your .env file.",
    );
  }

  logger.info("═══════════════════════════════════════════════════════");
  logger.info("       WEBSITE AUTOMATION AGENT — STARTING             ");
  logger.info("═══════════════════════════════════════════════════════");
  logger.info("Task:");
  task.split("\n").forEach((line) => logger.info(`  ${line}`));
  logger.info(`Target  : ${targetUrl}`);
  logger.info(`Model   : ${OPENROUTER_MODEL}`);
  logger.info(`Mode    : AI-Driven`);
  logger.info("─────────────────────────────────────────────────────");

  // ── Step 1: Open browser ──────────────────────────────────────────────────
  await tools.open_browser();
  await tools.navigate_to_url(targetUrl);

  const conversationHistory = [];
  let stepCount = 0;
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 4;

  // Track which tool types need a fresh page state vs. which don't change the page
  const PAGE_CHANGING_TOOLS = new Set([
    'navigate_to_url', 'click_element', 'click_on_screen',
    'double_click', 'send_keys', 'wait_for_element', 'get_page_content'
  ]);

  let cachedPageState = null;     // last fetched page state
  let pageStateStale = true;      // must re-fetch before next step?
  let lastUrl = targetUrl;        // for stagnation detection
  let urlUnchangedSteps = 0;      // consecutive steps without a URL change
  const STAGNATION_THRESHOLD = 3; // warn AI after this many stuck steps
  const STAGNATION_SKIP_TOOLS = new Set(['scroll', 'take_screenshot', 'scroll_to_center']);

  // ── Step 2: Agent loop ────────────────────────────────────────────────────
  while (stepCount < MAX_STEPS) {
    // Check for cancellation signal before each step
    if (signal?.aborted) {
      logger.warn('Agent run cancelled by server request.');
      break;
    }
    stepCount++;
    logger.info(
      `\n─── Step ${stepCount}/${MAX_STEPS} ─────────────────────────────`,
    );

    // ── Gather current page state (skip if cache is still valid) ──────────
    if (pageStateStale || !cachedPageState) {
      try {
        cachedPageState = await tools.get_page_content();
        pageStateStale = false;
      } catch (_) {
        cachedPageState = { title: 'unknown', inputs: [], labels: [] };
        pageStateStale = false;
      }
    }

    const pageState = cachedPageState;

    // Select interactive elements in viewport, fallback to all visible if none in viewport
    const inViewportElements = pageState.inputs?.filter((i) => i.visible && i.inViewport) || [];
    const elementsToUse = inViewportElements.length > 0
      ? inViewportElements.slice(0, 15)
      : (pageState.inputs?.filter((i) => i.visible) || []).slice(0, 10);

    // Keep the serialized object compact by removing null/undefined properties
    const compactElements = elementsToUse.map(e => ({
      tag: e.tag,
      id: e.id || undefined,
      name: e.name || undefined,
      placeholder: e.placeholder || undefined,
      text: e.textContent || undefined,
      aria: e.ariaLabel || undefined,
      role: e.role || undefined,
      testId: e.testId || undefined,
      // Include href for links so the AI can navigate_to_url() directly
      href: e.href || undefined
    }));

    // Stagnation detection: warn the AI if URL hasn't changed for several steps
    const currentUrl = pageState.url || targetUrl;
    let stagnationWarning = '';
    if (currentUrl === lastUrl) {
      urlUnchangedSteps++;
      if (urlUnchangedSteps >= STAGNATION_THRESHOLD) {
        stagnationWarning = ` | ⚠️ STUCK WARNING: URL unchanged for ${urlUnchangedSteps} steps — try a completely different approach`;
      }
    } else {
      lastUrl = currentUrl;
      urlUnchangedSteps = 0;
    }

    // Include body text only for first 5 steps to reduce token usage
    const includeBodyText = stepCount <= 5;

    // Compress context: include task only on first step
    let userMessage;
    if (stepCount === 1) {
      userMessage = `Task: ${task}\nStep: 1 | URL: ${currentUrl} | Title: ${pageState.title || 'N/A'}\nInputs: ${JSON.stringify(compactElements)}\nExcerpt: ${pageState.bodyText?.substring(0, 500) || ''}`;
    } else {
      userMessage = `Step:${stepCount} | URL:${currentUrl} | Title:${pageState.title || 'N/A'} | Inputs:${JSON.stringify(compactElements)}${
        includeBodyText ? ` | Excerpt:${pageState.bodyText?.substring(0, 300) || ''}` : ''
      }${stagnationWarning}`;
    }

    conversationHistory.push({ role: 'user', content: userMessage });


    // Keep history trimmed: first 2 messages + last 8 recents (covers goal + recent context)
    let trimmedHistory;
    if (conversationHistory.length <= 10) {
      trimmedHistory = [...conversationHistory];
    } else {
      trimmedHistory = [
        conversationHistory[0],
        conversationHistory[1],
        ...conversationHistory.slice(-8)
      ];
    }

    let action;
    try {
      const aiResponse = await chat(trimmedHistory, SYSTEM_PROMPT);
      conversationHistory.push({ role: 'assistant', content: aiResponse });

      logger.agentThink(aiResponse.substring(0, 200));
      action = parseActionFromResponse(aiResponse);

      if (!action) {
        logger.warn('Could not parse action from AI response, retrying...');
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          logger.warn(`${MAX_CONSECUTIVE_FAILURES} consecutive parse failures — aborting.`);
          break;
        }
        continue;
      }
      consecutiveFailures = 0; // reset on success
    } catch (err) {
      logger.agentError(`AI call failed: ${err.message}`);
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        logger.warn(`${MAX_CONSECUTIVE_FAILURES} consecutive AI failures — aborting.`);
        break;
      }
      continue;
    }

    // ── Execute the chosen tool ───────────────────────────────────────────
    logger.agentThink(action.reasoning || '(no reasoning)');
    logger.info(`Tool: ${action.tool} | Args: ${JSON.stringify(action.args)}`);

    // Mark page state stale if this tool changes the page
    if (PAGE_CHANGING_TOOLS.has(action.tool)) {
      pageStateStale = true;
    }

    let result;
    try {
      result = await dispatchTool(action.tool, action.args || {});
      consecutiveFailures = 0;
    } catch (err) {
      logger.agentError(`Tool "${action.tool}" threw an error`, err);
      // Take a screenshot to aid debugging, then continue
      try {
        await tools.take_screenshot(`error_step${stepCount}`);
      } catch (_) {}
      conversationHistory.push({
        role: 'user',
        content: `Tool "${action.tool}" failed: ${err.message}. Try an alternative approach.`,
      });
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        logger.warn(`${MAX_CONSECUTIVE_FAILURES} consecutive tool failures — aborting.`);
        break;
      }
      // Page state is stale after an error too
      pageStateStale = true;
      continue;
    }

    // ── Check for completion signal ───────────────────────────────────────
    if (action.tool === 'done' || result?.done) {
      logger.info('\n═══════════════════════════════════════════════════════');
      logger.agentSuccess(`TASK COMPLETE after ${stepCount} steps`);
      logger.agentSuccess(
        `Summary: ${result?.summary || action.args?.summary || 'Done'}`,
      );
      logger.info('═══════════════════════════════════════════════════════');
      break;
    }
  }

  if (stepCount >= MAX_STEPS) {
    logger.warn(
      `Max steps (${MAX_STEPS}) reached without explicit completion.`,
    );
  }

  // ── Final screenshot ──────────────────────────────────────────────────────
  try {
    await tools.take_screenshot("final_state");
  } catch (_) {
    logger.warn(
      "Could not take final screenshot (page may already be closed).",
    );
  }
  try {
    await tools.close_browser();
  } catch (_) {
    logger.warn("Could not close browser cleanly.");
  }

  logger.info("\nAgent finished. Check ./screenshots for visual history.");
  logger.info("Logs saved to ./logs/agent.log");
}

module.exports = { runAgent };
