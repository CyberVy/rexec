# Developer Guide: Frontend Debug Bridge

To facilitate bidirectional communication between the **Frontend Browser Context (Webview)** and the **AI Agent (Host Sandbox)** during development, this project implements a lightweight, zero-dependency, and non-intrusive **Debug Bridge**.

---

## 1. How the Mechanism Works

The communication runs purely on standard web protocols (Server-Sent Events & HTTP POST) and is integrated directly into the Vite development server via Connect middleware. During development, Vite serves `/debug_bridge.js` directly and exposes the `/__debug/*` endpoints on the **same origin** as Vite itself. It keeps the core React frontend codebase (`src/core`, `src/infra`, `src/app/App.tsx`, etc.) 100% clean and untouched.

```
                  ┌─────────────────────────────────────┐
                  │          AI Agent Sandbox           │
                  └──────────────────┬──────────────────┘
                                     │
                    POST /__debug/   │   node cli/debug/eval.js "..."
                    eval             ▼
                  ┌─────────────────────────────────────┐
                  │   Vite Dev Server (/__debug/*)      │
                  └──────────┬──────────────────▲───────┘
                             │                  │
                1. Push SSE  │                  │  2. HTTP POST /__debug/respond
                (id, code)   │                  │  (id, result)
                             ▼                  │
                  ┌─────────────────────────────┴───────┐
                  │         Browser Webview             │
                  └─────────────────────────────────────┘
```

### Components List

- **`cli/debug/plugin.ts`** (Vite Plugin & Middleware): Handles `/__debug/events`, `/__debug/respond`, `/__debug/log`, `/__debug/eval`, and serves `/debug_bridge.js`. Automatically writes the active Vite port to `.debug/frontend/config.json`.
- **`cli/debug/debug_bridge.js`** (Browser Script): The client script that runs inside the browser, intercepting logs and evaluating incoming commands via same-origin `/__debug/*` calls.
- **`debug_bridge_plugin` in `vite.config.ts`** (Injector): Injects `<script src="/debug_bridge.js">` non-intrusively via `transformIndexHtml` (head-prepend) during development (`apply: "serve"`), leaving production HTML completely untouched.
- **`cli/debug/eval.js`** (CLI Helper): A lightweight evaluation utility that allows developers or agents to synchronously execute code in the browser by reading `.debug/frontend/config.json`.
- **`src/app/index.html`** (Production HTML Entry): 100% clean of debug tooling. Zero intrusion into source code or production artifacts.
- **`.debug/frontend/`** (Ignored Data Directory): Contains the runtime configuration and persistent session log files:
    - `config.json`: The port configuration parameter for the debug bridge.
    - `logs.jsonl`: The browser console outputs and uncaught exceptions.
    - `history.jsonl`: The history of JS evaluations executed by the agent/developer.

---

## 2. Developer/Agent Usage Guide

### Step 1: Start the Development Server

Simply start the Vite development server as normal:

```bash
npm run dev
```

Vite will automatically mount the Debug Bridge middleware and save its active listening port to `.debug/frontend/config.json`.

### Step 2: Sending Commands / Querying Frontend State

The AI agent or developer can run expressions synchronously in the browser using the helper script:

```bash
node cli/debug/eval.js "document.title"
```

The script will block, wait for the browser to execute the code, and print the response directly to stdout:

```json
{
    "success": true,
    "result": "XCMS - Home"
}
```

If the execution fails (e.g. invalid syntax or runtime error in the browser), `success` will be `false` and the error details will be returned in `result`:

```json
{
    "success": false,
    "result": "ReferenceError: nonExistentVar is not defined"
}
```

### Step 3: Inspecting Logs & History

- Read the JSON Lines file at **`/.debug/frontend/logs.jsonl`** to view console outputs, warnings, and uncaught exceptions captured from the browser console.
- Read the JSON Lines file at **`/.debug/frontend/history.jsonl`** to audit the chronological sequence of evaluation commands sent by the agent and their corresponding outcomes.

---

## 3. Git Hygiene

The runtime configuration and logs are ignored by git using the following `.gitignore` rule:

```gitignore
/.debug
```

Runtime data therefore does not pollute the commit history.
