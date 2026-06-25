# Website Automation Agent — Ultimate Viva Preparation Document

> **Audience**: You, the author of this project, preparing for a university viva.
> **Scope**: Complete codebase analysis of the Website Automation Agent (Full Stack version with React dashboard and Express API).
> **Rule**: Every implementation claim traces to actual files and lines in the repository.
> **Coverage**: Explicitly highlights implemented features (React Frontend, Express Server, Playwright ReAct loop, OpenRouter API wrappers) and details features that are **not** implemented in this codebase (e.g., RAG, Vector Databases, Embeddings).

---

# SECTION 1 — Complete Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 React 19 Frontend Dashboard                 │
│  - Form submission (Task, Target URL)                      │
│  - Real-time Winston log streaming                          │
│  - Step-by-step screenshots visualizer                      │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼ HTTP Requests (3001)
┌─────────────────────────────────────────────────────────────┐
│                Express Backend (src/server.js)              │
│  - Queue processor, runs task-rewriter LLM phase            │
│  - Exposes endpoints: /run, /runs, /run/:id/logs, etc.       │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼ spawns
┌─────────────────────────────────────────────────────────────┐
│                agent.js (ReAct Orchestrator)                │
│  - Executes 30-step loop, manages memory history            │
│  - Page state caching & url stagnation detection            │
└──────────────┬──────────────────────────────────────────────┘
               │
               ├───────────────────────────────┐
               ▼                               ▼
┌──────────────────────────────┐ ┌────────────────────────────┐
│      GroqClient.js (API)     │ │       browserTools.js      │
│  - OpenRouter chat gateway   │ │  - open_browser() (Playwt) │
│  - Wait on 429s (max 3 rtr)  │ │  - get_page_content()      │
│  - deterministic temp=0      │ │  - minimized sleep times   │
└──────────────────────────────┘ └─────────────┬──────────────┘
                                               │
                                               ▼
                                 ┌────────────────────────────┐
                                 │          logger.js         │
                                 │  - Winston (agent.log)     │
                                 │  - Chalk (Console styling) │
                                 └────────────────────────────┘
```

- **Frontend / Browser Client**: Playwright controls Chromium.
- **Backend Service**: Node.js runtime process.
- **API**: OpenRouter Chat Completions HTTP POST API (`https://openrouter.ai/api/v1/chat/completions`).
- **Prompt Template**: Merges `SYSTEM_PROMPT` + `task` + `pageState` + `conversationHistory`.
- **Embedding Model**: **Not Implemented.** This project does not use vectors or embeddings.
- **Vector Database**: **Not Implemented.** This project does not use any vector storage.
- **Retriever**: **Not Implemented.**
- **Reranker**: **Not Implemented.**
- **LLM**: Configured via `.env` as `meta-llama/llama-3.3-70b-instruct:free` or similar.
- **Response**: Parsed internally by regex and dispatched.

---

# SECTION 2 — End-to-End Flow

### Keystroke / Query Automation Flow
1. **Submit**: User triggers a task on the React 19 Frontend Dashboard.
2. **Queue**: The Express API receives the post request (`/run`), assigns a run ID, and places it in an in-memory queue.
3. **Rewrite**: When dequeued, the backend calls `rewriteTask()` to convert the raw user prompt into a structured step-by-step browser plan.
4. **Launch**: `runAgent()` invokes `open_browser()` (`src/tools/browserTools.js#L28`) to spin up Playwright Chromium and navigate to the target page.
5. **Analyze**: The orchestrator triggers `get_page_content()` (`src/tools/browserTools.js#L280`) if the page state is stale. It evaluates interactive nodes (`input, textarea, select, button, a`) and determines their viewport layout (`inViewport`). It returns selector-rich attributes including `role`, `data-testid` (`testId`), and `href` (for `<a>` tags).
6. **Reason**: The orchestrator filters out elements not in the viewport (falling back to visible elements if none are in view), maps them to compact, token-lean JSON attributes, and constructs the user message. It appends the message to the conversation history, keeping the first 2 messages (system prompt + first step prompt) permanently pinned to preserve target memory.
7. **Stagnation Detection**: The orchestrator tracks consecutive steps with the same URL. If the URL is unchanged for 3 steps, it injects a stuck warning to force the LLM to try a different tool or selector.
8. **Decide**: The orchestrator requests the next action from the LLM via `chat()` (`src/agent/GroqClient.js#L24`) with temperature 0 and max_tokens 200 for maximum performance. 
9. **Rate Limit Handling**: If the API returns a 429, the client parses the suggested wait time from the `Retry-After` header or error response text, sleeps, and retries (up to 3 times).
10. **Act**: The orchestrator parses the JSON response and dispatches the action (e.g. `click_element`, `send_keys`, `scroll`). Delays between steps are minimized to optimize speed. For form inputs, `send_keys` uses `fill()` + `press('Enter')` to ensure keyboard events fire. For links (`a` tags), the agent is instructed to navigate directly via URL rather than relying on clicking.
11. **Verify**: The agent takes screenshots only when requested or needed, logs details, and loops back to **Analyze** to check the outcome. The React dashboard streams the updated log file and screenshot list.
12. **Exit**: Once the LLM determines all fields are filled, it invokes the `done` tool, closes the browser context, and completes the run (or aborts after 4 consecutive failures).

---

# SECTION 3 — Explain Every File

## 1. `frontend/src/App.jsx`
- **Purpose**: Frontend web app.
- **Responsibilities**:
  - Exposes forms for entering task descriptions and target URLs.
  - Submits runs to the Express API backend.
  - Features real-time log polling (`/run/:id/logs`) and displays chronological screenshots.
  - Renders execution state (Pending, Rewriting, Running, Success, Failed).
- **Dependencies**: React 19, standard hooks (`useState`, `useEffect`, `useRef`), axios/fetch.

## 2. `src/server.js`
- **Purpose**: Backend API Server and Task Queue Manager.
- **Responsibilities**:
  - Serves static screenshots.
  - Manages task execution queues to prevent multiple browsers from launching concurrently.
  - Runs the task rewriting phase `rewriteTask(task)` before starting the automation run.
  - Exposes REST endpoints (`/run`, `/run/:id/status`, `/run/:id/logs`, `/run/:id/screenshots`, `/runs`).
- **Dependencies**: `express`, `cors`, `path`, `fs`, `winston`, `dotenv`, `src/agent/agent.js`, `src/agent/GroqClient.js`.

## 3. `src/index.js`
- **Purpose**: Local CLI entry point fallback.
- **Responsibilities**:
  - Bootstraps agent execution directly via console commands.
  - Loads environment configuration variables using `dotenv`.
  - Defines the fallback `TASK` string.
- **Dependencies**: `dotenv`, `src/agent/agent.js`.

## 4. `src/agent/agent.js`
- **Purpose**: Core ReAct Orchestration, Page-State Caching, Stagnation Detection, and History Trimming.
- **Responsibilities**:
  - Implements the system prompt configuration (`SYSTEM_PROMPT`).
  - Maps tool choices to Playwright operations via `dispatchTool()`.
  - Employs page-state caching (only querying the DOM after page-changing tools) to boost speed.
  - Performs elements viewport filtering (`pageState.inputs?.filter(i => i.visible && i.inViewport)`).
  - Serializes elements compactly, adding modern identifiers (`role`, `testId`, `href`).
  - Trims conversation history (keeping first 2 messages + last 8 messages) to stay within token limits.
  - Intercepts page stagnation (stuck warning after 3 steps on same URL) and consecutive failure tracking (aborts after 4 failures).
  - Drives the 30-step loop (MAX_STEPS defaulting to 30) and handles self-healing.
- **Dependencies**: `src/tools/browserTools.js`, `src/agent/GroqClient.js`, `src/utils/logger.js`, `dotenv`.

## 5. `src/agent/GroqClient.js`
- **Purpose**: OpenRouter Gateway API Integration (named GroqClient for project compatibility).
- **Responsibilities**:
  - Connects to `https://openrouter.ai/api/v1/chat/completions` using Axios.
  - Controls parameters: Temperature (0) and Max Tokens (200) for fast, deterministic action selection.
  - Implements dynamic wait/retry on 429 status codes by checking the `Retry-After` header and error message regex (`try again in (\d+\.?\d*)s`), retrying up to 3 times.
  - Fails fast on non-429 API errors.
  - Parses JSON output using regex code fence matching and raw brace scope extraction.
- **Dependencies**: `axios`, `src/utils/logger.js`, `dotenv`.

## 6. `src/tools/browserTools.js`
- **Purpose**: Browser Action Wrapper Layer.
- **Responsibilities**:
  - Implements Playwright browser setup, configuration, and teardown.
  - Manages browser state via singletons (`browserInstance`, `pageInstance`, `screenshotCounter`).
  - Exposes atomic browser tools to click, type, scroll, wait, and extract page contents.
  - Eliminates unnecessary navigation sleep; reduces click/scroll/screenshot settle times to make automation fast.
  - Fixes form submission by using `fill()` + `press('Enter')` inside `send_keys` so standard keyboard submit events are triggered.
  - Queries `input, textarea, select, button, a` tags and checks if they are currently inside the viewport coordinates (`inViewport`), returning `role`, `data-testid` (`testId`), and `href` properties.
- **Dependencies**: `playwright`, `path`, `fs`, `src/utils/logger.js`, `dotenv`.

## 7. `src/utils/logger.js`
- **Purpose**: Dual console and file logger.
- **Responsibilities**:
  - Uses Winston to write logs to local run-specific files and general `logs/agent.log`.
  - Colors console outputs with Chalk.
- **Dependencies**: `winston`, `chalk`, `path`, `fs`.

---

# SECTION 4 — Explain Every Important Function

## 1. `get_page_content()` (`src/tools/browserTools.js#L280`)
- **Purpose**: Extracts a structural snapshot of form fields, buttons, and links.
- **Logic**: Evaluates a script in the browser context via `pageInstance.evaluate()`. It queries `input, textarea, select, button, a` elements. For link elements (`a`), it ignores them if they have no text content, title, or aria-label. For all elements, it computes bounding client coordinates relative to `window.innerHeight` and `window.innerWidth` to determine if they are currently within the viewport bounds (`inViewport`). It also collects selector-rich metadata such as `role`, `data-testid`, and `href` (for `<a>` tags).
- **Why written this way**: Adding link extraction (`a` tags) allows the agent to interact with navigation pathways. Viewport filtering isolates the active context, and the rich metadata ensures the agent can target elements on dynamic SPAs.

## 2. `runAgent({ task, targetUrl })` (`src/agent/agent.js#L89`)
- **Purpose**: Drives the ReAct agent loop step-by-step up to `MAX_STEPS`.
- **Logic**: Launches browser and loads URL. Inside a loop, it fetches page state via `get_page_content()` only when the page state is stale. It filters the elements list to those `inViewport` (falling back to visible elements). It maps these elements to a stripped representation (`tag`, `id`, `name`, `placeholder`, `text`, `aria`, `role`, `testId`, `href`) with no null properties. It checks for URL stagnation. It constructs the prompt. If the step is greater than 1, it formats the prompt compactly and skips the full task description. It prunes conversation history while preserving the first two messages. It calls the LLM, parses the action, executes it, and repeats.
- **Why written this way**: Page-state caching and compact element mapping drastically reduce token overhead and execution time. Keeping the initial system and task prompts pinned guarantees the agent remains aligned on the goal.

## 3. `chat(messages, systemPrompt)` (`src/agent/GroqClient.js#L24`)
- **Purpose**: Sends requests to OpenRouter and handles API errors.
- **Logic**: Sends message logs via HTTP POST. If it catches a 429 rate limit error:
  - It checks the `Retry-After` header or searches the error message string for `"try again in [seconds]s"` using a regex.
  - If a wait time is found, it calculates the delay in milliseconds (adding a 500ms safety buffer) and sleeps.
  - If no explicit time is parsed, it falls back to an exponential backoff sequence (`[5000, 15000]ms`).
  - It retries up to 3 times before failing. Non-429 errors fail fast.
- **Why written this way**: Deterministic settings (temperature=0, max_tokens=200) prevent verbose output and token waste. Dynamic rate limiting resolves OpenRouter free tier constraints automatically without manual intervention.

---

# SECTION 5 — AI Concepts Used

- **ReAct (Reasoning + Acting)**: Loop combining thought cycles with tool execution.
- **Zero-Shot Prompting**: The agent receives task instructions directly without task-specific examples.
- **Chain of Thought**: Requiring the LLM to output a `"reasoning"` parameter to improve action accuracy.
- **Context Compression**: 
  - Restricting extracted nodes to the active **viewport** (`inViewport`).
  - Stripping out empty keys in the JSON representation of elements.
  - Using a single-line message structure for subsequent steps (`Step N | URL | Title | ...`).
  - Pinned History: Trimming history to first 2 messages + last 8 messages to stay within token limits.
- **Vector Databases / Embeddings / RAG**: **Not Implemented.** Frame this as an architectural choice—because the agent interacts with live web interfaces dynamically, index search or document embedding is unnecessary.

---

# SECTION 6 — Why Questions

### Group 1 — Browser & Frontend Elements
1. **Why query `<a>` tags in `get_page_content()`?**
   Link elements (`<a>`) contain important interactive paths like video titles and navigation links. If ignored, the agent is blind to them.
2. **Why filter elements by `inViewport`?**
   A page can have hundreds of hidden or out-of-screen links and inputs. Prioritizing elements currently in the viewport reduces token usage and prevents the agent from attempting to click elements that are blocked or off-screen.
3. **Why strip null/undefined properties from interactive elements?**
   It minimizes the serialized string length, reducing prompt tokens and staying under OpenRouter's rate limits.
4. **Why did we remove the 2-second navigation delay and reduce other timeouts?**
   Fixed timeouts artificially slowed down the run execution. By relying on Playwright's page-load triggers and reducing settle times (scroll wait to 150-200ms, click wait to 100ms), we made the agent significantly faster.
5. **Why keep the first 2 messages pinned in `trimmedHistory`?**
   If we trim the history to the last 8 messages, the system prompt and original task instruction would be deleted after step 4, causing the agent to lose its goal and schema constraints.
6. **Why use `fill()` + `press('Enter')` in `send_keys`?**
   Playwright's `fill()` does not trigger standard keyboard event listeners. Appending `\n` to a text string inside `fill()` fails to submit forms on websites like YouTube. Combining `fill()` with a separate keyboard trigger `press('Enter')` ensures all form submission mechanisms fire successfully.

### Group 2 — Backend & Queueing
7. **Why build an Express server backend?**
   It allows the automation suite to run as a background service, exposing API endpoints for task submission, real-time logging, and screenshot delivery.
8. **Why implement a queue processor (`isProcessing`)?**
   Prevents multiple automation runs from running concurrently, which would overload the host machine, spawn conflicting browsers, and exhaust API rate limits.
9. **Why run `rewriteTask` via the LLM?**
   It converts fuzzy, conversational user prompts into a structured, numbered browser instruction list, improving the agent's target alignment.
10. **Why parse the `Retry-After` header and 429 rate limit delays?**
    It ensures the script sleeps for the exact duration demanded by the upstream host (e.g. 7.03 seconds) rather than waiting blindly or failing immediately.
11. **Why implement page-state caching?**
    Calling `get_page_content()` (which runs script evaluations inside the DOM) is expensive and slow. Caching the state and only re-fetching after actions that modify the page layout dramatically speeds up execution.
12. **Why implement URL stagnation detection?**
    If the agent gets stuck in a loop trying the same selector or action, the URL doesn't change. Raising a stuck warning in the prompt informs the LLM to try an alternative element or tool.

---

# SECTION 7 — Teacher Viva Questions

1. **How does your agent communicate with the LLM?**
   It sends a JSON payload containing the system prompt, page state, and conversation history via a POST request to OpenRouter's HTTP gateway.
2. **What happens when the API key is rate-limited?**
   `src/agent/GroqClient.js` catches the 429 status code, extracts the suggested wait time from headers or the error string, pauses execution, and retries the request.
3. **How does the React frontend display real-time runs?**
   It runs a polling effect that calls `/run/:id/status` and `/run/:id/logs` to retrieve the latest run state and Winston log file lines.
4. **Where is the browser context isolated?**
   Every run creates a new context, ensuring no session state leak (clean cache/cookies).

---

# SECTION 8 — If Teacher Opens the Code

### File: `src/agent/agent.js`
- **Lines 16–42**: Defines `SYSTEM_PROMPT` dictating the JSON schema: `{ tool, args, reasoning }`.
- **Lines 149–167**: Implements viewport element selection, compact property mapping (including `role`, `testId`, and `href`).
- **Lines 198–208**: History trimming strategy (first 2 + last 8 messages).

### File: `src/agent/GroqClient.js`
- **Lines 67–85**: Catches 429 codes, parses delay time using `Retry-After` headers and regex, sleeps, and retries (up to 3 times).
- **Lines 98–114**: Parses JSON output from the LLM, extracting code fences or matching curly braces.

### File: `src/tools/browserTools.js`
- **Lines 280–343**: Implements `get_page_content()`, which evaluates DOM page content, queries inputs, buttons, and links, and calculates `inViewport`.
