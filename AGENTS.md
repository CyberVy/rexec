## Project Structure

- `src/`: Core remote execution engine.
  - `protocol.ts`: Shared protocol types and message envelopes across Server, Agent, and Caller.
  - `transport/`: Shared byte channel. WebSocket connection and binary frame envelope. Payloads stay opaque.
    - `framing.ts`: Channel domain binary packet multiplexing (Transfer 0x01, Forward 0x02, PTY 0x03).
    - `ws.ts`: WebSocket client channel (`WsClient`).
  - `file/`: File & directory filesystem archiving and streaming.
    - `types.ts`: Universal stream contracts (`FileSource`, `FileSink`, `ProgressInfo`).
    - `adapters/node.ts`: Node.js filesystem and streaming `tar` packaging adapter (`create_node_source`, `create_node_sink`).
  - `server/`: Cloudflare Workers & Durable Objects implementation (`RexecHub`).
  - `agent/`: Remote worker node daemon running on target servers (Node.js).
    - `task.ts`: Subprocess execution and lifecycle management (`TaskManager`).
    - `forward_manager.ts`: Multiplexed TCP socket forwarding manager (`ForwardManager`).
    - `transfer_manager.ts`: Multiplexed WebSocket transfer session management (`TransferManager`).
    - `pty_manager.ts`: Remote pseudoterminal session manager (`PtyManager`).
  - `caller/`: Calling client domain.
    - `core/`: Universal calling SDK using 100% Web Standard APIs (`RexecCaller`, `exec_command`, `pull_http`, `push_http`, `open_forward_tunnel`, `open_pty_session`).
    - `terminal/`: Local command-line interface client for terminal users (`rexec`).
- `frontend/`: Application frontend GUI and Web UI (React, Vite, Tailwind).
  - `app/`: Application UI entry points and shells.
    - `index.html`: SPA HTML shell entry.
    - `main.tsx`: SPA entry mount point.
    - `App.tsx`: Main application root component.
    - `native_entry/`: Native/Tauri HTML shell entry (`index.html`), mount point (`main.tsx`), and route component (`App.tsx`).
    - `globals.css`: Global styles, font imports, and Tailwind setup.
  - `blocks/`: Business-facing React UI blocks composed from base components (e.g. `ExecBlock.tsx`, `TerminalBlock.tsx`, `StatusHeader.tsx`).
    - Put app-specific composite UI here and bind it directly to domain controllers.
  - `components/`: Base reusable UI components and UI infrastructure.
    - Put framework-level or reusable domain-agnostic primitives here.
    - Categorized into `base/` (atomic UI), `composite/` (generic composite components), and `animation/` (transitions/animations).
  - `core/`: Domain logic, algorithms, and application state coordination.
    - `controllers/`: Centralized reactive state and data controllers (`exec_controller.ts`, `pty_controller.ts`, `session_controller.ts`).
  - `infra/`: Infrastructure, platform adapters, Web IPC client, and utilities.
    - `*.client.ts`: Browser/webview-only client integrations.
    - `web_ipc.client.ts`: Frontend-side Tauri IPC adapter.
    - `storage/`: Normalized client storage and caching adapters.
  - `inject/`: Client-side scripts injected directly into external WebViews.
    - Organized into `infra/` (environment/IPC polyfills) and `core/` (product logic injections).
  - `sw/`: Service worker source (packaged to `dist/sw.js` in build, served in-memory by Vite in dev).
    - `core/`: Core service worker logic.
    - `infra/`: Service worker infrastructure/adapters.
    - `main.worker.ts`: Entry worker script.
- `src-tauri/`: Tauri (Rust) backend and native app configuration.
  - `src/main.rs`: Desktop/mobile app entry point.
  - `src/lib.rs`: Shared Tauri command/runtime wiring.
  - `src/commands/`: Backend IPC commands exposed to the web frontend.
  - `src/webview/` and `src/window/`: Controllers for Tauri WebView and native window management.
  - `src/logging.rs`: Application logger setup.
  - `Cargo.toml`: Rust package manifest.
  - `capabilities/`: Tauri capability allowlists.
  - `tauri.conf.json`, `tauri.ios.conf.json`: Platform configs.
- `cli/`: Local developer tools and debug channel.
  - `debug/`:
    - Remote engine black-box end-to-end debugging harness and automated test matrix (`serve.ts`, `tests/`).
    - Frontend debug bridge (SSE & HTTP server plugin) for host-to-browser agent communication (`plugin.ts`, `eval.js`, `debug_bridge.js`).
- `extensions/`: Editor integrations.
  - `vscode/`: Visual Studio Code extension for Agent status, port forwarding, and terminal.
- `dist/`: Standalone build distribution outputs and binary entries (`rexec`, `rexec-agent`, frontend assets).
- `public/`: Static assets, icons, and `manifest.json`.
- `draft/`: Temporary sandboxes and development draft files.

## Data Architecture (Event-Driven Producer-Consumer)

The frontend application adheres to a strict **Event-Driven Producer-Consumer Architecture** separated into three distinct tiers:

```
┌────────────────────────────────────────────────────────┐
│               Data Generator (No Events)               │
│  - Stateless asynchronous/synchronous data producers   │
│  - API clients, parsers, transformers & algorithms     │
└───────────────────────────┬────────────────────────────┘
                            │ Raw data / Domain entities
                            ▼
┌────────────────────────────────────────────────────────┐
│               Data Controller (With Events)            │
│  - Single source of truth (SSOT) & state orchestrator  │
│  - Caching, deduplication, persistence & lifecycles    │
│  - Framework-agnostic state & event dispatch           │
└───────────────────────────┬────────────────────────────┘
                            │ Reactive snapshots & events
                            ▼
┌────────────────────────────────────────────────────────┐
│             Data Consumer (UIs, Tests, Adapters)       │
│  - Reactive UI bindings (`useSyncExternalStore`)       │
│  - Test runners, debug bridges & CLI utilities         │
│  - External IPC handlers & platform adapters           │
└────────────────────────────────────────────────────────┘
```

### 1. Data Generator (No Events)
- **Definition**: Stateless data-producing modules responsible for fetching raw inputs, parsing, algorithmic transformation, and low-level data extraction. Data Generator is an architectural role rather than a directory boundary; generator modules may live under `frontend/core/` or `frontend/infra/`.
- **Constraints**:
  - **No Application Events**: Must NOT publish application or domain state-change events, maintain external subscription registries, or couple with reactive view lifecycles. Low-level event-based APIs may be used internally.
  - **No Owned Application State**: Must return results through values or Promises and must not own long-lived application state, domain caches, or persistence lifecycles. External I/O may be nondeterministic.

### 2. Data Controller (With Events)
- **Definition**: Centralized domain state coordinators and reactive event dispatchers (located under `frontend/core/controllers/`).
- **Responsibilities**:
  - Serves as the **Single Source of Truth (SSOT)** for domain state.
  - Coordinates Data Generators, performs caching, indexing, deduplication, and persistence.
  - Exposes framework-agnostic, read-only state snapshots and dispatches granular domain events via `EventTarget` when internal state mutates.
  - Must remain independent of React and other UI frameworks; consumer-side adapters are responsible for translating controller state and events into framework-specific reactive contracts.
- **Constraints**:
  - Controllers own mutation logic and state lifetimes; all state transitions must occur through explicit controller methods.

### 3. Data Consumer (UIs, Tests, External Adapters)
- **Definition**: Observers and consumers that react to controller state changes or invoke controller commands.
- **Roles**:
  - **UI Blocks & Components**: React rendering must consume Controller snapshots through `useSyncExternalStore`-based hooks. Tests, debug tools, IPC adapters, and other non-React consumers may observe Controller events directly.
  - **Tests & Debug Bridges**: Automated verification scripts and CLI evaluators querying snapshots or observing dispatched events.
  - **Platform & IPC Adapters**: External message handlers dispatching payloads directly into controller actions.
- **Constraints**:
  - **Unidirectional Flow & Anti-Bypass**: Consumers must NEVER bypass a Data Controller to interact directly with a Data Generator when a Controller exists for that domain.
  - **No Manual Domain-State Sync**: UI consumers must not mirror controller-owned domain state into component state through effects. Ephemeral UI state that is not owned by a Controller remains local to the component.
  - **Zero Cross-Block Callback Drilling**: Do NOT forward domain action callbacks through intermediate UI blocks. An immediate parent-child callback is permitted when the parent handles it directly rather than forwarding it further.
  - **Minimal Block Props**: Props for domain blocks (`frontend/blocks/`) must NEVER duplicate, proxy, or shadow state and action logic that can be directly managed or derived by a domain Controller. Reserve props only for instance-specific context (e.g., item records in list renderers, slot composition) or local configuration that the Controller does not own.

## Storage Architecture (Normalized Index-Data Separation)

The client-side persistence layer (`LocalForage` / IndexedDB) adheres to a strict **Index-Data Separation and Normalized Storage Pattern**:

```
┌────────────────────────────────────────────────────────┐
│                   Index / Order Store                  │
│  - Dedicated sequence and index registries ('orders')  │
│  - Key: <collection_key> -> Value: string[] (ID list)  │
└───────────────────────────┬────────────────────────────┘
                            │ Sequence of Entity IDs
                            ▼
┌────────────────────────────────────────────────────────┐
│                   Entity Data Stores                   │
│  - Pure, strongly-typed domain records & caches        │
│  - Key: <entity_id> -> Value: TEntity                  │
└───────────────────────────┬────────────────────────────┘
                            │ Batched hydration
                            ▼
┌────────────────────────────────────────────────────────┐
│               Data Controller & Snapshot               │
│  - Assembles hydrated view entities into memory        │
│  - Dispatches tearing-free reactive snapshots to UI    │
└────────────────────────────────────────────────────────┘
```

### 1. Pure Entity Stores (No Magic/Index Keys)
- **Primary Key Constraint**: Every entity store must use the entity's unique identifier (`id` or `<entity>_id`) as its key, and store exclusively pure entity records (`TEntity`).
- **Zero Key Pollution**: Entity stores must NEVER mix metadata, index arrays, or magic keys (e.g., `"order"`) into the entity key-space.
- **Single Type Integrity**: Store instances must be strongly typed without union types (e.g., `LocalForageMap<TRecord>`, strictly avoiding `LocalForageMap<TRecord | string[]>`).

### 2. Dedicated Index & Sequence Stores
- **Index Isolation**: Display sequences, custom orderings, and bounded ID queues must be isolated in dedicated index stores (e.g., `"orders"` store).
- **Zero Write Amplification**: Persistent reordering, front-promotion, and re-indexing operations mutate only the index store (`string[]`), while Controllers update their in-memory state as needed. These operations must not rewrite unchanged entity records.

### 3. Separation of Domain Entity vs User State
- **Entity Purity**: Base domain entities must strictly represent objective, stateless domain metadata.
- **Relational / Event Data**: User interactions, access logs, and custom associations must be decoupled into distinct relational records or dedicated domain controllers rather than injected directly into base entity models.

### 4. Normalized Hydration Flow
- **Hydration Responsibility**: Controllers read ordered ID lists from index stores, batch-hydrate entities from corresponding entity caches, and replace snapshot references when state changes. Consumers must treat returned snapshots as immutable.

## Naming Conventions

- Types, interfaces, classes, enums, and type aliases: `PascalCase` (e.g. `RexecHub`, `AgentToHubMessage`, `TerminalBlockProps`).
- React components: `PascalCase` filenames and exports (e.g. `StatusHeader`, `TerminalBlock`).
- React component props types: component name plus `Props` in `PascalCase` (e.g. `TerminalBlockProps`).
- Blocks: `PascalCase` filenames and exports under `frontend/blocks/`.
- React hooks: `camelCase` names starting with `use` (e.g. `useWindowSize`, `useViewSwitcher`).
- Functions and methods: `snake_case` (e.g. `format_ws_url`, `create_node_source`).
- Variables, parameters, refs, and local state values: `snake_case` (e.g. `task_id`, `auth_token`, `current_session_id`).
- Constants: `SCREAMING_SNAKE_CASE` for module-level immutable values / semantic constants; use `snake_case` for local values and function bindings.
- Type imports: use `import type` when importing only types.
- Path aliases: prefer `@/` for imports under `src/` and `frontend/`.
- WebView injection scripts: entry point is `src-tauri/src/inject.ts` (source) and `src-tauri/src/inject.js` (compiled output). Sub-modules under `frontend/inject/` may use `*.inject.ts` naming.
- Type Definitions: Follow the proximity principle (define types close to where they are used). Avoid creating separate type files (like `types.ts` or `*.types.ts`) unless the type declarations are highly complex or repeatedly reused across multiple files.
- Descriptive Naming: All variable, function, component, and file names must clearly reflect their purpose and responsibility. Use readable, self-explanatory names and strictly avoid generic, vague, or obscure names (e.g. prefer `is_sidebar_open` over `temp` or `flag`).
- External Naming: Preserve names required by external APIs, framework contracts, serialized payloads, and implemented or overridden interfaces.

## UI & Dialog Rules

- **Emoji Prohibition (Enforced by Oxlint)**: Do not use emojis in any UI text or icons.
- **Color Restrictions (AI Only)**: AI-authored UI changes may use only black, white, gray, and their alpha variants. Do not introduce chromatic colors or alter existing human-authored colors unless explicitly requested.
- **Animation Performance (CPU)**:
  - **High-Frequency & Looping Animations**: Continuous, high-frequency, or infinite animations (e.g., playback indicators, spectrum bounces, pulsing effects, spinners) MUST strictly use composited, hardware-accelerated properties (`transform`, `opacity`) to prevent CPU layout reflow and repaint thrashing.
  - **Low-Frequency & Discrete Transitions**: Infrequent, one-off state transitions triggered by user interaction (e.g., toggle, accordion expansion) may animate layout properties (e.g., `height`, `width`) when geometric fidelity (such as preserving true circular/capsule `border-radius` without affine scale distortion) is required, provided the transition is brief and layout impact is localized.
- **Filter & Effect Restraint (GPU)**: Do not abuse CSS filters (e.g., `blur`, `backdrop-filter`) and animations that cause excessive GPU overhead and rendering bottlenecks.
- **Icons & SVGs**: Write SVG components in the corresponding `icons.tsx` based on the UI ownership layer (e.g., `frontend/components/icons.tsx` for generic component-level icons and `frontend/blocks/icons.tsx` for block-level business icons). Inline SVGs outside these files are prohibited by Oxlint. Do not import external icon libraries.
- **Modals & Dialogs**:
  - Do not use native window dialogs (`window.alert`, `window.confirm`, `window.prompt`). This is enforced by Oxlint.
  - Use [ModalContainer.tsx](frontend/components/composite/ModalContainer.tsx) to build modals and dialog components.
  - If a modal requires animations, compose it with [AnimationContainer.tsx](frontend/components/animation/AnimationContainer.tsx).

## Layering Rules

- **UI vs Non-UI Directories**: React UI components, UI-specific React hooks, and JSX rendered by the main application may exist only in `frontend/app/`, `frontend/blocks/`, and `frontend/components/`. All other directories under `frontend/` (such as `frontend/core/`, `frontend/infra/`, `frontend/inject/`, and `frontend/sw/`) as well as `src/` are Non-UI environments.
- **Non-UI Isolation**: Non-UI environments must NEVER import modules from `frontend/app/`, `frontend/blocks/`, or `frontend/components/`.
- **Component Isolation**: `frontend/components/` must NEVER import from `frontend/app/`, `frontend/blocks/`, or `frontend/core/`. Keep business UI and domain dependencies out of reusable components.
- **Infrastructure Isolation**: `frontend/infra/` must NEVER import from `frontend/core/`.
- The import restrictions above apply to runtime imports, type-only imports, dynamic imports, and re-exports, and are enforced by Oxlint.
- **Web IPC Communications**:
  - All communication between frontend web app and backend Rust must utilize the Web IPC layer (e.g., [web_ipc.client.ts](frontend/infra/web_ipc.client.ts)).
  - Shared data types used across the IPC boundary should follow the general type rules and be defined close to their usage/IPC client implementation.

## Base Rules

- Format files using `oxfmt` (`npm run format`) and lint using `oxlint` (`npm run lint`).
- Typecheck and run comprehensive checks using `npm run check` (`oxlint` + `tsc --noEmit`).
- **Source Code & Runtime as SSOT**: Source code and live runtime data are the Single Source of Truth (SSOT), never historical knowledge or outdated assumptions. Always verify facts against current code and runtime state.
- **Minimalist & Clean Code**: Keep edits minimal, direct, and targeted. Avoid sweeping reformatting, unnecessary fallback mechanisms, and defensive over-engineering. Prioritize human readability and simplicity.
- **Single Concern Ownership**: Every concern (validation, transformation, lifecycle control, error formatting) must have exactly ONE designated owner layer. NEVER split, smear, or partially handle the same responsibility across multiple modules. If a layer owns a concern, it must handle it completely and decisively.
- **Direct Flow & Zero Re-wrapping**: When an upstream or downstream component already returns a complete, well-formed contract, pass it through directly. NEVER redundantly unpack, inspect, and reconstruct well-formed objects or streams across intermediate layers. Avoid paranoid multi-layer defensive programming.
- **Standard Primitives Over Trivial Wrappers**: Prefer language and platform standard APIs directly over thin helper functions that add no domain logic. Maintain a high signal-to-noise ratio (SNR) across the codebase: the codebase serves as in-context prompt training for future AI sessions, and redundant boilerplate actively degrades model reasoning.
- **Refactor Before Feature**: Review whether existing mechanisms can support a new design before extending them. Stop and seek developer approval before changing a foundational abstraction, public cross-module interface, persistence model, or architectural ownership boundary. Ordinary local refactoring does not require separate approval.
- **Style Consistency**: Match existing naming, formatting, and import styles in every file. Format modified files using `oxfmt` (`npx oxfmt <file>`) to ensure correct indentation, consistent layout, and unambiguous DOM hierarchy.
- **Interface Reuse & Dependencies**: When importing from outside a module, prefer its public `index.ts` exports. Within the same module, use direct relative imports when they are clearer and avoid cycles. Reuse existing types and interfaces when suitable. Do not add dependencies or design complex public interfaces without developer approval.
- **Zero-Dependency Target Runtimes**: Agent and Caller CLI runtimes must remain zero-dependency on target machines.
- **Local Verification**: After editing TypeScript or TSX files, run `npm run check`. Also run the relevant build or Cargo verification when modifying build configuration, generated entry sources, IPC boundaries, or Rust code.

## AI Debugging & Autonomous Troubleshooting

### 1. Engine & Protocol Troubleshooting (Local Black-Box Debug Harness)

When implementing features, refactoring, or fixing bugs in `rexec` engine/core:
- Start the local black-box debug server: `npm run debug:serve` (launches local Hub and Agent against `.debug/engine/`).
- Run automated scenario tests: `npm run debug:test` (or specific suites `npm run debug:test:basic`, etc.).
- Inspect `.debug/engine/history.jsonl` for test verdicts and duration.
- Inspect `.debug/engine/worker.jsonl` and `.debug/engine/agent.jsonl` for server and agent execution logs.
- Never require manual deployment to Cloudflare or external Colab runs for reproducible bugs.

### 2. Frontend & GUI Debugging (Frontend Debug Bridge)

When running the development server via `npm run dev`, a debug bridge is automatically mounted via [plugin.ts](cli/debug/plugin.ts) that allows direct, silent bidirectional communication with the browser/Tauri webview context. Before starting the dev server, check if the dev server is already running to avoid duplicate/repeated runs.
- **Frontend Logs**: Read [logs.jsonl](.debug/frontend/logs.jsonl) (in JSON Lines format) to inspect console output and errors in real-time.
- **Execute Commands**: Synchronously execute JavaScript code in the browser/Tauri webview context using [eval.js](cli/debug/eval.js):
  ```bash
  npm run debug:eval -- "document.title"
  ```
  This will print the response directly to stdout, for example:
  ```json
  {
    "success": true,
    "result": "rexec"
  }
  ```
- **Execution History**: The history of executed commands and their results is stored in [history.jsonl](.debug/frontend/history.jsonl).
- **Sub-Agent Delegation**: When implementing features or fixing bugs that affect frontend runtime behavior, prefer delegating validation and log monitoring to a sub-agent. The sub-agent should actively use the Frontend Debug Bridge to execute tests, verify UI correctness, and tail [logs.jsonl](.debug/frontend/logs.jsonl) to ensure no regressions or runtime console errors are introduced.
