# 🤖 Website Automation Agent

An intelligent browser automation agent that navigates web pages, identifies form elements, and fills them autonomously. Built with **Playwright** (JavaScript) and powered by **OpenRouter AI** for intelligent decision-making.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the Agent](#running-the-agent)
- [Project Structure](#project-structure)
- [Agent Tools](#agent-tools)
- [Modes of Operation](#modes-of-operation)
- [Screenshots & Logs](#screenshots--logs)
- [Target Task](#target-task)
- [Troubleshooting](#troubleshooting)

---

## Overview

This agent is a mini browser-use implementation that autonomously:

1. Launches a Chromium browser via Playwright
2. Navigates to `https://ui.shadcn.com/docs/forms/react-hook-form`
3. Intelligently identifies the interactive form (Username, Bug Title, Description)
4. Fills each field with realistic sample data
5. Submits the form and captures a success confirmation

The agent operates in two modes:
- **AI Mode** — Uses an OpenRouter LLM to reason about the page and decide each next action (ReAct loop)
- **Heuristic Mode** — Falls back to a predefined rule-based step sequence when no API key is set

---

## Features

- ✅ **Modular tool architecture** — each browser action is an isolated, testable function
- ✅ **AI-driven decisions** — OpenRouter LLM observes page state and chooses the next tool
- ✅ **Heuristic fallback** — works without an API key for demos/testing
- ✅ **Step-by-step screenshots** — visual audit trail of every agent action
- ✅ **Structured logging** — colorized console + JSON file logs via Winston
- ✅ **Robust error handling** — catches tool failures and lets the agent recover
- ✅ **Local mock page** — bundled HTML mock of the shadcn form for offline testing

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | ≥ 18.x | Required |
| npm | ≥ 9.x | Included with Node |
| Chromium / Chrome | any | System Chrome is auto-detected |

> **OpenRouter API Key** is optional — the agent runs in heuristic mode without one.  
> Get one free at [openrouter.ai](https://openrouter.ai/).

---

## Installation

```bash
# 1. Clone or download the project
cd website-automation-agent

# 2. Install Node.js dependencies
npm install

# 3. (Optional) Install Playwright's bundled Chromium
#    Skip if you have system Chrome/Chromium installed
npm run install:browsers

# 4. Copy and configure environment variables
cp .env.example .env
# Edit .env and add your OPENROUTER_API_KEY
```

---

## Configuration

Edit `.env` (copy from `.env.example`):

```env
# Required for AI mode — get from https://openrouter.ai/
OPENROUTER_API_KEY=sk-or-...

# OpenRouter model (default: claude-3.5-haiku — fast and cheap)
OPENROUTER_MODEL=anthropic/claude-3.5-haiku

# Set to 'false' to watch the browser window live
HEADLESS=true

# Target URL (use local mock for offline testing)
TARGET_URL=https://ui.shadcn.com/docs/forms/react-hook-form
# TARGET_URL=file:///absolute/path/to/mock-shadcn-form.html

# Maximum agent steps before giving up
MAX_STEPS=20

# Log verbosity: debug | info | warn | error
LOG_LEVEL=info
```

### Available OpenRouter Models

| Model ID | Notes |
|----------|-------|
| `anthropic/claude-3.5-haiku` | Fast, cheap — recommended |
| `anthropic/claude-3.5-sonnet` | More capable, higher cost |
| `openai/gpt-4o-mini` | Alternative fast option |
| `openai/gpt-4o` | Most capable OpenAI option |
| `google/gemini-flash-1.5` | Fast Google alternative |

---

## Running the Agent

```bash
# Run with default settings (heuristic mode if no API key)
npm start

# Equivalent direct command
node src/index.js

# Watch mode — see the browser (set in .env or inline)
HEADLESS=false node src/index.js

# Debug logging
LOG_LEVEL=debug node src/index.js
```

### Expected Output

```
[HH:MM:SS] [INFO] ═══════════════════════════════════════════════════════
[HH:MM:SS] [INFO]        WEBSITE AUTOMATION AGENT — STARTING
[HH:MM:SS] [INFO] ═══════════════════════════════════════════════════════
[HH:MM:SS] [INFO] Task    : Navigate to shadcn/ui React Hook Form page...
[HH:MM:SS] [INFO] Mode    : AI-Driven  (or Rule-Based Fallback)
...
[HH:MM:SS] [INFO] ✅ TASK COMPLETE after 19 steps
[HH:MM:SS] [INFO] ✅ Summary: Form filled and submitted successfully.
```

---

## Project Structure

```
website-automation-agent/
├── src/
│   ├── index.js                  # Entry point — defines task, starts agent
│   ├── agent/
│   │   ├── agent.js              # Core ReAct loop — AI decision + tool dispatch
│   │   └── openRouterClient.js   # OpenRouter API wrapper
│   ├── tools/
│   │   └── browserTools.js       # All Playwright browser tools
│   └── utils/
│       └── logger.js             # Winston logger with chalk colors
├── screenshots/                  # Auto-generated PNG screenshots per step
├── logs/
│   ├── agent.log                 # Full JSON log of all actions
│   └── errors.log                # Errors only
├── .env                          # Your configuration (git-ignored)
├── .env.example                  # Configuration template
├── package.json
├── README.md
└── ARCHITECTURE.md
```

---

## Agent Tools

Every tool is a standalone async function in `src/tools/browserTools.js`:

| Tool | Description |
|------|-------------|
| `open_browser()` | Launch Chromium headless/headed |
| `navigate_to_url(url)` | Go to a URL, wait for network idle |
| `take_screenshot(label)` | Save a PNG to `./screenshots/` |
| `click_on_screen(x, y)` | Mouse click at pixel coordinates |
| `click_element(selector)` | CSS selector click with auto-wait |
| `send_keys(text, selector)` | Fill input / type text |
| `scroll(deltaY, selector)` | Scroll page or scroll element into view |
| `double_click(x, y, selector)` | Double-click by coords or selector |
| `get_page_content()` | Extract title, inputs, labels, body text |
| `wait_for_element(selector)` | Wait for element to appear in DOM |
| `close_browser()` | Gracefully close the browser |

---

## Modes of Operation

### AI Mode (OpenRouter)

When `OPENROUTER_API_KEY` is set, the agent runs a **ReAct loop**:

```
Observe → Think → Act → Observe → Think → Act → ...
```

1. **Observe** — `get_page_content()` returns visible inputs, labels, page text
2. **Think** — OpenRouter LLM receives page state + task and responds with a JSON action
3. **Act** — The agent dispatches the chosen tool and feeds the result back to the LLM

The LLM is given a strict system prompt and must return:
```json
{ "tool": "send_keys", "args": { "text": "johndoe", "selector": "#username" }, "reasoning": "..." }
```

### Heuristic Mode (No API Key)

A predefined list of 19 steps executes in order, covering:
- Initial screenshot
- Page inspection
- Tab switching
- Field filling (username → bugTitle → description)
- Form submission
- Toast confirmation

---

## Screenshots & Logs

After a run, inspect the evidence:

```
screenshots/
  001_initial.png          ← Page on first load
  002_after_scroll.png     ← After scrolling down
  003_preview_tab.png      ← Preview tab active
  004_username_filled.png  ← Username entered
  005_title_filled.png     ← Bug title entered
  006_description_filled.png ← Description entered
  007_form_submitted.png   ← Form submitted
  008_toast_visible.png    ← Success toast visible
  009_final_state.png      ← Final browser state

logs/
  agent.log    ← Full JSON log of all steps + tool results
  errors.log   ← Error-level events only
```

---

## Target Task

**URL:** `https://ui.shadcn.com/docs/forms/react-hook-form`

**Fields to fill:**

| Field | Value |
|-------|-------|
| Username | `johndoe` |
| Bug Title | `UI Component Bug Report` |
| Description | `The dropdown component loses focus unexpectedly when clicking the scroll area inside a modal dialog. Steps to reproduce: 1. Open modal. 2. Click dropdown. 3. Scroll inside dropdown. Expected: focus retained. Actual: focus lost. Reproducible in Firefox 120+ and Chrome 119+.` |

> **Note:** The live shadcn.com site may block headless browsers in some network environments (Cloudflare/CDN protection). Use the bundled `mock-shadcn-form.html` for reliable local testing:
> ```env
> TARGET_URL=file:///absolute/path/to/mock-shadcn-form.html
> ```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `Host not in allowlist` | Shadcn site is blocking you; use the local mock |
| `Browser not found` | Set `CHROME_PATH` in `.env` to your Chrome binary |
| `OPENROUTER_API_KEY not set` | Agent runs in heuristic mode — this is fine |
| `Timeout waiting for element` | Increase `BROWSER_TIMEOUT` in `.env` |
| Screenshots are blank | Set `HEADLESS=false` and check for page errors |
| Form validation errors | Ensure selector targets the correct input field |

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `playwright` | Browser automation |
| `axios` | HTTP client for OpenRouter API |
| `dotenv` | Environment variable loading |
| `winston` | Structured logging |
| `chalk` | Terminal color output |
