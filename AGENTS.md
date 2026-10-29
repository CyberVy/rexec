## Project Structure

- `src/`: Core source code.
  - `protocol.ts`: Shared protocol types and message envelopes across Server, Agent, and Caller.
  - `transport/`: Shared byte channel. WebSocket connection and binary frame envelope. Payloads stay opaque.
    - `framing.ts`: Channel domain binary packet multiplexing (Transfer 0x01, Forward 0x02).
    - `ws.ts`: WebSocket client channel (`WsClient`).
  - `file/`: File & directory filesystem archiving and streaming.
    - `types.ts`: Universal stream contracts (`FileSource`, `FileSink`, `ProgressInfo`).
    - `adapters/node.ts`: Node.js filesystem and streaming `tar` packaging adapter (`create_node_source`, `create_node_sink`).
  - `server/`: Cloudflare Workers & Durable Objects implementation (`RexecHub`).
  - `agent/`: Remote worker node daemon running on target servers (Node.js).
    - `task.ts`: Subprocess execution and lifecycle management (`TaskManager`).
    - `forward_manager.ts`: Multiplexed TCP socket forwarding manager (`ForwardManager`).
    - `transfer_manager.ts`: Multiplexed WebSocket transfer session management (`TransferManager`).
  - `caller/`: Calling client domain.
    - `core/`: Universal calling SDK using 100% Web Standard APIs (`RexecCaller`, `exec_command`, `pull_http`, `push_http`, `open_forward_tunnel`).
    - `terminal/`: Local command-line interface client for terminal users (`rexec`).
- `cli/`: Local developer tools and debug channel.
  - `debug/`: Black-box end-to-end debugging harness and automated test matrix.
- `dist/`: Standalone build distribution outputs and binary entries (`rexec`, `rexec-agent`).

## Naming Conventions

- Types, interfaces, classes, enums, and type aliases: `PascalCase` (e.g. `RexecHub`, `AgentToHubMessage`).
- Functions and methods: `snake_case` (e.g. `format_ws_url`, `create_node_source`).
- Variables, parameters, and local state values: `snake_case` (e.g. `task_id`, `auth_token`).
- Constants: `SCREAMING_SNAKE_CASE` for module-level immutable values.
- Type imports: use `import type` when importing only types.
- Path aliases: prefer `@/` for imports under `src/`.

## Base Rules

- Format files using `oxfmt` (`npm run format`) and lint using `oxlint` (`npm run lint`).
- Typecheck using `npm run typecheck` (`tsc --noEmit`).
- Keep edits minimal, clean, and direct. Avoid bloated dependencies and defensive over-engineering.
- **Single Concern Ownership**: Every concern (validation, transformation, lifecycle control, error formatting) must have exactly ONE designated owner layer. NEVER split, smear, or partially handle the same responsibility across multiple modules. If a layer owns a concern, it must handle it completely and decisively.
- **Direct Flow & Zero Re-wrapping**: When an upstream or downstream component already returns a complete, well-formed contract, pass it through directly. NEVER redundantly unpack, inspect, and reconstruct well-formed objects or streams across intermediate layers. Avoid paranoid multi-layer defensive programming.
- **Standard Primitives Over Trivial Wrappers**: Prefer language and platform standard APIs directly over thin helper functions that add no domain logic. Maintain a high signal-to-noise ratio (SNR) across the codebase: the codebase serves as in-context prompt training for future AI sessions, and redundant boilerplate actively degrades model reasoning.
- Agent and Caller runtimes must remain zero-dependency on target machines.

## AI Debugging & Autonomous Troubleshooting

When implementing features, refactoring, or fixing bugs in `rexec`:
- Start the local black-box debug server: `npm run debug:serve` (launches local Hub and Agent against `.debug/`).
- Run automated scenario tests: `npm run debug:test` (or specific suites `npm run debug:test:basic`, etc.).
- Inspect `.debug/history.jsonl` for test verdicts and duration.
- Inspect `.debug/worker.jsonl` and `.debug/agent.jsonl` for server and agent execution logs.
- Never require manual deployment to Cloudflare or external Colab runs for reproducible bugs.
