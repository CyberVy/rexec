## Project Structure

- `src/`: Core source code.
  - `protocol.ts`: Shared protocol types and message envelopes between Hub, Agent, and CLI.
  - `server/`: Cloudflare Workers & Durable Objects implementation (`RexecHub`).
  - `agent/`: Remote worker node agent running on target servers (Node.js).
  - `cli/`: Local command-line interface client (Node.js).
- `dist/`: Build outputs for standalone agent bundle.
- `bin/`: CLI launcher and binary entries.

## Naming Conventions

- Types, interfaces, classes, enums, and type aliases: `PascalCase` (e.g. `RexecHub`, `AgentToHubMessage`).
- Functions and methods: `snake_case` (e.g. `format_ws_url`, `handle_exec_request`).
- Variables, parameters, and local state values: `snake_case` (e.g. `task_id`, `auth_token`).
- Constants: `SCREAMING_SNAKE_CASE` for module-level immutable values.
- Type imports: use `import type` when importing only types.
- Path aliases: prefer `@/` for imports under `src/`.

## Base Rules

- Format files using `oxfmt` (`npm run format`) and lint using `oxlint` (`npm run lint`).
- Typecheck using `npm run typecheck` (`tsc --noEmit`).
- Keep edits minimal, clean, and direct. Avoid bloated dependencies and defensive over-engineering.
- Agent and CLI runtimes must remain zero-dependency on target machines.
