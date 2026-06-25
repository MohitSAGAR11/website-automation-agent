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

const SYSTEM_PROMPT = `You are an expert browser automation agent. Your job is to control a web browser
to complete tasks by selecting the right tool at each step.

Available tools:
- navigate_to_url(url)              : Go to a URL
- take_screenshot(label, selector)  : Capture the screen. Pass selector to auto-center that element first.
- scroll(deltaY, selector)          : Scroll the page or scroll an element to center of viewport
- scroll_to_center(selector)        : Scroll a specific element to the exact center of the viewport
- click_element(selector)           : Click a CSS selector
- click_on_screen(x, y)             : Click by pixel coordinates
- send_keys(text, selector)         : Fill a text input
- double_click(x, y, selector)      : Double-click
- get_page_content()                : Get page structure / form elements
- wait_for_element(selector)        : Wait for an element to appear
- done(summary)                     : Signal task completion

Respond ONLY with a JSON object like:
{
  "tool": "tool_name",
  "args": { ... },
  "reasoning": "why you chose this step"
}

Rules:
- Always call get_page_content() or take_screenshot() to understand the page before clicking.
- IMPORTANT: Before taking a screenshot of any input field or form element, ALWAYS call
  scroll_to_center(selector) first so the element is perfectly centered in the viewport,
  never stuck at the very top or bottom edge of the screen.
- You may also pass a selector directly to take_screenshot(label, selector) to center in one step.
- Use CSS selectors when possible for reliability.
- The shadcn form preview button opens an interactive form dialog — look for a "Preview" tab or button.
- Common shadcn form selectors: input[name="username"], input[name="email"], textarea, button[type="submit"].
- When you have filled all form fields and submitted, call done().`;

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
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === "your_groq_api_key_here") {
    throw new Error(
      "GROQ_API_KEY is not set. Please configure a valid API key in your .env file.",
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

    const userMessage = `
Task: ${task}
Step: ${stepCount}
Current URL: ${pageState.url || targetUrl}
Page title: ${pageState.title || "N/A"}
Visible inputs: ${JSON.stringify(pageState.inputs?.filter((i) => i.visible).slice(0, 15))}
Labels: ${JSON.stringify(pageState.labels?.slice(0, 10))}
Page excerpt: ${pageState.bodyText?.substring(0, 500) || ""}

What should the agent do next? Respond with the JSON action object.`;

    conversationHistory.push({ role: "user", content: userMessage });

    let action;
    try {
      const aiResponse = await chat(conversationHistory, SYSTEM_PROMPT);
      conversationHistory.push({ role: "assistant", content: aiResponse });

      logger.agentThink(aiResponse.substring(0, 200));
      action = parseActionFromResponse(aiResponse);

      if (!action) {
        logger.warn("Could not parse action from AI response, retrying...");
        continue;
      }
    } catch (err) {
      logger.agentError("AI call failed", err);
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
