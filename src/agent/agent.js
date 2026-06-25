const tools = require("../tools/browserTools");
const {
  chat,
  parseActionFromResponse,
  GROQ_MODEL,
} = require("./GroqClient");
const logger = require("../utils/logger");
require("dotenv").config({
  path: require("path").resolve(__dirname, "..", "..", ".env"),
});

const MAX_STEPS = parseInt(process.env.MAX_STEPS || "20");
const TARGET_URL =
  process.env.TARGET_URL || "https://ui.shadcn.com/docs/forms/react-hook-form";

const SYSTEM_PROMPT = `You are an expert browser automation agent that controls a real web browser to complete tasks.

Available tools:
- navigate_to_url(url)             : Navigate to a URL
- click_element(selector)          : Click a CSS selector
- send_keys(text, selector)        : Type text into an input. Append \\n to submit/press Enter (e.g. "search term\\n").
- scroll(deltaY, selector)         : Scroll the page or an element into view
- scroll_to_center(selector)       : Scroll an element to the exact center of the viewport
- wait_for_element(selector)       : Wait for an element to appear
- get_page_content()               : Refresh page state (only call this AFTER navigating or waiting — NOT at the start of a step)
- take_screenshot(label, selector) : Capture screenshot, optionally centered on a selector
- click_on_screen(x, y)            : Click at pixel coordinates
- double_click(x, y, selector)     : Double-click
- done(summary)                    : Signal task is complete

CRITICAL RULES:
1. The current page state (URL, title, inputs, page text) is ALREADY PROVIDED in each message. Do NOT call get_page_content() as your first action — it wastes steps. Use the provided state.
2. Only call get_page_content() after a navigation, wait, or major action when you need updated info.
3. To search or submit a form, append \\n to the text in send_keys instead of clicking a separate button.
4. Prefer short, reliable CSS selectors (IDs, name attributes, aria-labels) over long nested chains.
5. If a selector fails, try a simpler alternative — do not repeat the same failing selector.
6. Call done() as soon as the task is successfully completed.

Respond ONLY with a valid JSON object — no extra text:
{
  "tool": "tool_name",
  "args": { ... },
  "reasoning": "brief reason"
}`;

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

async function runAgent({ task, targetUrl = TARGET_URL }) {
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
  logger.info(`Model   : ${GROQ_MODEL}`);
  logger.info(`Mode    : AI-Driven`);
  logger.info("─────────────────────────────────────────────────────");

  // ── Step 1: Open browser ──────────────────────────────────────────────────
  await tools.open_browser();
  await tools.navigate_to_url(targetUrl);

  const conversationHistory = [];
  let stepCount = 0;

  // ── Step 2: Agent loop ────────────────────────────────────────────────────
  while (stepCount < MAX_STEPS) {
    stepCount++;
    logger.info(
      `\n─── Step ${stepCount}/${MAX_STEPS} ─────────────────────────────`,
    );

    // Gather current page state for the AI
    let pageState;
    try {
      pageState = await tools.get_page_content();
    } catch (_) {
      pageState = { title: "unknown", inputs: [], labels: [] };
    }

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
      aria: e.ariaLabel || undefined
    }));

    // Compress context: include task only on first step, use single line structure for subsequent steps
    let userMessage;
    if (stepCount === 1) {
      userMessage = `Task: ${task}
Step: 1
URL: ${pageState.url || targetUrl}
Title: ${pageState.title || "N/A"}
Inputs: ${JSON.stringify(compactElements)}
Excerpt: ${pageState.bodyText?.substring(0, 500) || ""}`;
    } else {
      userMessage = `Step: ${stepCount} | URL: ${pageState.url || targetUrl} | Title: ${pageState.title || "N/A"} | Inputs: ${JSON.stringify(compactElements)} | Excerpt: ${pageState.bodyText?.substring(0, 500) || ""}`;
    }

    conversationHistory.push({ role: "user", content: userMessage });

    // Keep history trimmed to stay within TPM/RPM limits.
    // Always preserve the very first message (which contains the full task description)
    // so the agent never forgets the goal, then append the last 9 messages.
    let trimmedHistory;
    if (conversationHistory.length <= 10) {
      trimmedHistory = [...conversationHistory];
    } else {
      trimmedHistory = [
        conversationHistory[0],
        ...conversationHistory.slice(-9)
      ];
    }

    let action;
    try {
      const aiResponse = await chat(trimmedHistory, SYSTEM_PROMPT);
      conversationHistory.push({ role: "assistant", content: aiResponse });

      logger.agentThink(aiResponse.substring(0, 200));
      action = parseActionFromResponse(aiResponse);

      if (!action) {
        logger.warn("Could not parse action from AI response, retrying...");
        continue;
      }
    } catch (err) {
      logger.agentError(`AI call failed: ${err.message}`);
      continue;
    }

    // ── Execute the chosen tool ───────────────────────────────────────────
    logger.agentThink(action.reasoning || "(no reasoning)");
    logger.info(`Tool: ${action.tool} | Args: ${JSON.stringify(action.args)}`);

    let result;
    try {
      result = await dispatchTool(action.tool, action.args || {});
    } catch (err) {
      logger.agentError(`Tool "${action.tool}" threw an error`, err);
      // Take a screenshot to aid debugging, then continue
      try {
        await tools.take_screenshot(`error_step${stepCount}`);
      } catch (_) {}
      conversationHistory.push({
        role: "user",
        content: `Tool "${action.tool}" failed: ${err.message}. Try an alternative approach.`,
      });
      continue;
    }

    // ── Check for completion signal ───────────────────────────────────────
    if (action.tool === "done" || result?.done) {
      logger.info("\n═══════════════════════════════════════════════════════");
      logger.agentSuccess(`TASK COMPLETE after ${stepCount} steps`);
      logger.agentSuccess(
        `Summary: ${result?.summary || action.args?.summary || "Done"}`,
      );
      logger.info("═══════════════════════════════════════════════════════");
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
