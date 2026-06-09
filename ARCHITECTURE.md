# Architecture Document
## Website Automation Agent

---

## 1. System Overview

The Website Automation Agent is a Node.js application that combines browser automation (Playwright) with AI decision-making (OpenRouter LLM) to autonomously navigate web pages and interact with form elements.

The system is designed around the **ReAct pattern** (Reasoning + Acting), where an AI agent alternates between observing the environment (page state), reasoning about the next action, and executing it — continuing until the task is complete.

```
┌─────────────────────────────────────────────────────────────────┐
│                     WEBSITE AUTOMATION AGENT                    │
│                                                                 │
│  ┌────────────┐    ┌──────────────┐    ┌─────────────────────┐ │
│  │  index.js  │───▶│   agent.js   │───▶│  openRouterClient   │ │
│  │ (Entry Pt) │    │  (ReAct Loop)│    │  (AI Decisions)     │ │
│  └────────────┘    └──────┬───────┘    └─────────────────────┘ │
│                           │                                     │
│                           ▼                                     │
│                   ┌───────────────┐                             │
│                   │ browserTools  │                             │
│                   │ (Playwright)  │                             │
│                   └───────┬───────┘                             │
│                           │                                     │
│              ┌────────────┼────────────┐                        │
│              ▼            ▼            ▼                        │
│         Screenshots     Logs       Browser                      │
│         (PNG files)   (Winston)   (Chromium)                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Component Architecture

### 2.1 Entry Point (`src/index.js`)

**Responsibility:** Bootstrap the agent with a task definition.

- Loads environment variables via `dotenv`
- Defines the natural-language task description
- Calls `runAgent()` and handles process exit codes

**Design Decision:** Separating the task definition from the agent loop makes it trivial to swap tasks without modifying core agent logic.

---

### 2.2 Agent Core (`src/agent/agent.js`)

**Responsibility:** Orchestrate the AI decision loop (ReAct pattern).

```
          ┌─────────────────────────────────────────┐
          │              AGENT LOOP                 │
          │                                         │
          │  ┌──────────┐     ┌──────────────────┐  │
          │  │ Observe  │────▶│  Build Prompt   │  │
          │  │ (page    │     │  (page state +   │  │
          │  │  state)  │     │   task + history)│  │
          │  └──────────┘     └────────┬─────────┘  │
          │                           │             │
          │                           ▼             │
          │                  ┌────────────────┐     │
          │                  │  OpenRouter AI │     │
          │                  │  (Think/Reason)│     │
          │                  └───────┬────────┘     │
          │                          │              │
          │                          ▼              │
          │                  ┌────────────────┐     │
          │                  │ Parse Action   │     │
          │                  │ JSON Response  │     │
          │                  └───────┬────────┘     │
          │                          │              │
          │                          ▼              │
          │                  ┌────────────────┐     │
          │                  │  Dispatch Tool │     │
          │                  │  (Execute Act) │     │
          │                  └───────┬────────┘     │
          │                          │              │
          │                          ▼              │
          │               Done? ──Yes─▶ Exit       │
          │                  │                      │
          │                  No                     │
          │                  └──────────────────────┤
          │                  (loop, max 20 steps)   │
          └─────────────────────────────────────────┘
```

**Key Decisions:**

- **Conversation history** is maintained across loop iterations so the AI has full context of what it has already tried
- **Error recovery** — if a tool throws, the error message is fed back to the AI as context ("Tool X failed, try an alternative approach")
- **Heuristic fallback** — when no API key is set, a static step sequence executes in order, ensuring the agent always runs

---

### 2.3 Browser Tools (`src/tools/browserTools.js`)

**Responsibility:** Provide modular, logged browser actions.

Each tool is an independently testable async function:

```
browserTools
│
├── open_browser()          → Launches Chromium, creates page
├── navigate_to_url(url)    → page.goto() with networkidle wait
├── take_screenshot(label)  → page.screenshot() → ./screenshots/
├── click_on_screen(x, y)   → page.mouse.click()
├── click_element(selector) → page.click() with waitForSelector
├── send_keys(text, sel)    → page.fill() or keyboard.type()
├── scroll(deltaY, sel)     → mouse.wheel() or scrollIntoViewIfNeeded()
├── double_click(x,y, sel)  → page.dblclick()
├── get_page_content()      → page.evaluate() → structured DOM info
├── wait_for_element(sel)   → page.waitForSelector()
└── close_browser()         → browser.close()
```

**Design Decisions:**

- **Module-level singleton** (`browserInstance`, `pageInstance`) — a single page is maintained throughout the session; the agent doesn't need multi-tab behavior for this task
- **Auto-detection of Chrome** — checks `/opt/google/chrome/chrome`, `/opt/pw-browsers/`, then falls back to Playwright's bundled browser
- **Screenshot naming** — sequential counter prefix (`001_`, `002_`) plus descriptive label ensures alphabetical order matches chronological order

---

### 2.4 OpenRouter Client (`src/agent/openRouterClient.js`)

**Responsibility:** Abstract the OpenRouter REST API.

```
Agent ──→ chat(messages, systemPrompt)
            │
            ▼
    POST /v1/chat/completions
    openrouter.ai
            │
            ▼
    Model response (JSON action)
            │
            ▼
    parseActionFromResponse(text)
            │
            ▼
    { tool, args, reasoning }
```

**Design Decisions:**

- **Low temperature (0.1)** — deterministic output; the agent needs consistent JSON, not creativity
- **JSON parsing with fallback** — first tries fenced code block (` ```json `), then bare JSON object extraction
- **HTTP-Referer header** — required by OpenRouter for usage tracking

---

### 2.5 Logger (`src/utils/logger.js`)

**Responsibility:** Provide structured, readable logging.

- **Console** — colorized with `chalk`: timestamps in gray, levels color-coded, tool actions in green, AI thoughts in blue
- **`agent.log`** — full JSON log for post-run analysis
- **`errors.log`** — error-level events only, for quick debugging

Custom helper methods on the logger object:
- `logger.agentAction(tool, params)` — logs a tool invocation
- `logger.agentThink(thought)` — logs the AI's reasoning
- `logger.agentSuccess(msg)` — green checkmark + message
- `logger.agentError(msg, err)` — red cross + message

---

## 3. Data Flow

### 3.1 AI Mode Data Flow

```
User defines task
       │
       ▼
runAgent() starts
       │
       ├─ open_browser() ──────────────────────────────────▶ Chromium
       │
       ├─ navigate_to_url(TARGET_URL) ──────────────────────▶ Page loaded
       │
       └─ LOOP (up to MAX_STEPS times):
              │
              ├─ get_page_content() ──────────────────────▶ DOM data
              │     { title, url, inputs[], labels[], bodyText }
              │
              ├─ Compose prompt:
              │     system_prompt + task + page_state + history
              │
              ├─ POST → openrouter.ai ─────────────────────▶ LLM
              │     ◀── { tool, args, reasoning }
              │
              ├─ dispatchTool(tool, args) ─────────────────▶ Playwright
              │     ◀── result
              │
              └─ if tool === 'done' → EXIT LOOP
```

### 3.2 Heuristic Mode Data Flow

```
Predefined steps array
       │
       ▼
for each step:
  dispatchTool(step.tool, step.args)
       │
       ▼
Playwright executes
       │
       ▼
Screenshot saved
       │
       ▼
Next step...
```

---

## 4. Error Handling Strategy

| Error Type | Handler |
|-----------|---------|
| Browser launch failure | `throw` — fatal, no browser = no agent |
| Navigation failure | `throw` — rethrowed so agent can decide |
| Element not found | `try/catch` — take error screenshot, feed message to AI |
| AI API failure | Fall back to next heuristic step |
| JSON parse failure | Log warning, skip iteration and retry |
| Max steps exceeded | `warn` log, take final screenshot, close browser |

---

## 5. Design Decisions & Trade-offs

### Why Playwright over Puppeteer/Selenium?

Playwright was chosen because:
- Better cross-browser support (Chromium, Firefox, WebKit)
- Built-in auto-waiting for elements (reduces flakiness)
- First-class `networkidle` wait strategy (important for SPA pages)
- Active maintenance and modern API

### Why OpenRouter over direct Claude/OpenAI API?

OpenRouter provides:
- A single API key for 200+ models
- Easy model switching via environment variable
- Automatic fallbacks and load balancing
- Free tier for development

### Why a Heuristic Fallback?

The fallback ensures the agent is demonstrable without an API key. For a viva/demo, it also provides a predictable, guaranteed-to-work execution path. In production, the AI loop handles dynamic pages that heuristics can't anticipate.

### Why Module-Level Browser Singleton?

Form automation is inherently single-session. A singleton avoids passing `browser` and `page` objects through every function call. If multi-tab support were needed, the architecture would shift to a context-per-session model.

### Why a Local Mock Page?

Production websites (like shadcn.com) deploy Cloudflare Bot Protection that returns 403 to headless browsers. The local mock (`mock-shadcn-form.html`) is a faithful recreation that works in all environments, ensuring the agent can always be demonstrated.

---

## 6. Agent Intelligence

The agent's "intelligence" comes from three layers:

1. **Page State Awareness** — `get_page_content()` extracts a rich JSON snapshot of visible interactive elements, allowing the AI to reason about the page structure rather than relying on hard-coded selectors

2. **Conversation Memory** — the full conversation history is sent to the LLM on every turn, so the AI knows what it has already tried and can adapt if a tool fails

3. **Self-Healing** — when a tool throws an error, the error is added to the conversation as a user message: *"Tool X failed with: [error]. Try an alternative approach."* The AI then proposes a different selector or action

---

## 7. Scalability Considerations

| Aspect | Current | Production Extension |
|--------|---------|---------------------|
| Concurrency | Single agent | Worker pool with shared browser context |
| Tasks | Hard-coded | Task queue (Redis/Bull) |
| Targets | One URL | Multi-URL config file |
| Storage | Local files | S3 for screenshots, ELK for logs |
| Auth | None | Cookie/session injection |
| Monitoring | Console logs | Prometheus metrics + Grafana |

---

## 8. File Dependency Graph

```
src/index.js
  └── src/agent/agent.js
        ├── src/tools/browserTools.js
        │     └── playwright (npm)
        ├── src/agent/openRouterClient.js
        │     └── axios (npm)
        └── src/utils/logger.js
              ├── winston (npm)
              └── chalk (npm)
```

---

*Architecture Document — Website Automation Agent Assignment 04*
