# Developer Guide: Frontend Debug Bridge & Debug CLI

To facilitate bidirectional communication and UI inspection/interaction between the **Host Sandbox (Node CLI / AI Agent)** and the **Browser Context (Webview)** during development, this project provides a zero-intrusion **Debug Bridge** and framework-agnostic **UI Debug CLI**.

For the `rexec` Worker Hub + Agent black-box debug harness (`npm run debug:serve`, `npm run debug:test`), see [debug_guide.md](debug_guide.md).

---

## 1. Architecture & Directory Structure

Communication runs purely on standard web protocols (Server-Sent Events & HTTP POST) via Vite development middleware, keeping `frontend/` completely clean of debug tooling.

- **`cli/debug/plugin.ts`** (Vite Plugin & Middleware): Serves `/__debug/events`, `/__debug/respond`, `/__debug/log`, `/__debug/eval`, bundles `cli/debug/browser/index.ts` in memory at `/debug_bridge.js`, injects `<script src="/debug_bridge.js">` during `vite serve`, and writes the active port to `.debug/frontend/config.json`.
- **`cli/debug/shared/`** (Environment-Agnostic Protocol): Pure TypeScript protocol types and readable target locator parser (`protocol.ts`) shared across `host/` and `browser/`.
- **`cli/debug/host/`** (Node Host Clients & CLIs):
    - `bridge_client.ts`: Single source for reading `.debug/frontend/config.json` and calling `/__debug/eval`.
    - `eval.ts`: Synchronous JS evaluation CLI (`npm run debug:eval`).
    - `ui.ts`: Framework-agnostic UI inspection and interaction CLI (`npm run debug:ui`).
- **`cli/debug/browser/`** (Browser Runtime):
    - `index.ts`: Bridge initialization (console/error capture, SSE command loop, `window.__debug_ui__.exec` wiring).
    - `layout_sampler.ts`: Per-frame layout sampling of `--watch` targets while an action runs.
    - `listener_registry.ts`: Passive DOM `addEventListener`/`removeEventListener` listener tracking.
    - `dom/`: Framework-agnostic DOM/ARIA classification, occlusion/hit testing, locator resolution (`locator.ts`), and snapshot summaries (`snapshot.ts`).
    - `actions/`: Non-pointer form and input actions (`text_input.ts`, `keyboard.ts`, `native_control.ts`).
    - `gestures/`: Pointer, touch, hover, and scroll interaction runners (`pointer_common.ts`, `pointer_tap.ts`, `long_press.ts`, `hover.ts`, `swipe_drag.ts`, `scroll.ts`).
- **`cli/debug/checks/`** (Frontend Page Checks): Automated frontend verification scripts built on `host/bridge_client.ts` (`lazy_container_dimensions.ts`).
- **`.debug/frontend/`** (Git-Ignored Frontend Runtime Data): Contains `config.json` (active Vite port), `logs.jsonl` (captured console/errors), and `history.jsonl` (eval audit trail).

---

## 2. Usage Guide

### Prerequisites

Start the Vite development server as normal:

```bash
npm run dev
```

Vite automatically mounts the Debug Bridge and writes its active listening port to `.debug/frontend/config.json`.

### UI Inspection & Interaction (`npm run debug:ui`)

```bash
npm run debug:ui -- help
npm run debug:ui -- snap
npm run debug:ui -- find "<target>"
npm run debug:ui -- inspect "<target>"
npm run debug:ui -- tap "<target>"
npm run debug:ui -- click "<target>"
npm run debug:ui -- long-press "<target>"
npm run debug:ui -- long-press "<target>" --duration 800
npm run debug:ui -- fill "<target>" "hello" --submit
npm run debug:ui -- fill "<target>" --clear
npm run debug:ui -- press Escape
npm run debug:ui -- press "<target>" Enter
npm run debug:ui -- select "select#1" "zh-CN"
npm run debug:ui -- select "checkbox#1" toggle
npm run debug:ui -- hover "<target>"
npm run debug:ui -- hover "<target>" --from "<from>" --leave
npm run debug:ui -- swipe left
npm run debug:ui -- swipe "swipeable#1" right 240 --speed fast
npm run debug:ui -- drag "clickable#1@10%,50%" --to "@80%,50%"
npm run debug:ui -- scroll down 80%
npm run debug:ui -- scroll "scrollable#1" right 240
npm run debug:ui -- scroll --to "Footer" --align center
```

#### Layout Tracing (`--watch`)

Any interaction command (everything except `snap`, `find`, and `inspect`) accepts a repeatable `--watch <target>` flag (max 8 targets). The targets are resolved once before the action starts; the browser then samples each element's `getBoundingClientRect` on every rendered frame until the action finishes.

```bash
npm run debug:ui -- swipe left --watch "swipeable#1" --watch "Player"
```

The raw time series is written to `.debug/frontend/traces/<timestamp>-<action>.json`; stdout and `--json` only report the file path and summary statistics.

- `t` is milliseconds since sampling started (before target resolution and `scroll_into_view`), so samples before the gesture begins are expected.
- `input_span_ms` marks the first and last synthetic pointer, touch, or wheel event on the same clock.
- Each sample holds one rect per watched target (sub-pixel `x`, `y`, `w`, `h`), or `null` once that element leaves the document.
- Requires a visible page: if `document.hidden` is true, `--watch` fails immediately with `UNSUPPORTED` because `requestAnimationFrame` is paused. If the page is hidden mid-action, sampling stops producing frames and the trace ends with the final sample taken at stop.

### Arbitrary JS Evaluation (`npm run debug:eval`)

```bash
npm run debug:eval -- "document.title"
```

### Automated Page Checks

#### LazyContainer Dimension Check

Open a page rendering `LazyContainer` instances (e.g., a long list with loaded content and placeholders), then run:

```bash
npm run debug:lazy-container
```

Groups visible `LazyContainer` instances by parent layout and compares rendered content vs placeholder dimensions (default tolerance `0`). Supports `--tolerance=0.5` and `--require-pair`.
