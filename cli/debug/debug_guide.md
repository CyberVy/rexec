# Debug Channel Guide

A stable, black-box debugging and end-to-end verification harness for `rexec`.
It orchestrates a local Cloudflare Worker Hub (`wrangler dev`) and a local Node Agent (`dist/rexec-agent.mjs`), executes scenario-based test suites, and records structured diagnostics under `.debug/`.

## Architecture & Contract

The debug channel does not import internal implementation details from `src/`. It verifies `rexec` purely through external behavioral contracts:

- **Hub WebSocket Endpoint**: `ws://<hub>/ws?token=<token>&node_id=<id>`
- **Hub HTTP Exec Endpoint**: `POST /exec` with `{ cmd, cwd, timeout_ms }` producing SSE chunks (`event: chunk`, `event: exit`, `event: error`)
- **Hub Health Endpoint**: `GET /health` producing `{ status: "ok", agent_connected: boolean }`
- **Agent Sandbox**: Native `spawn` command execution, exit code fidelity, process termination on abort

## Directory Structure

- `cli/debug/serve.ts`: Starts the local Worker Hub and local Agent, pipes logs to `.debug/*.jsonl`, and writes `.debug/config.json`.
- `cli/debug/tests/`: Automated scenario tests:
    - `basic.ts`: Hub health check, stdout echo, and stderr non-zero exit code propagation.
    - `env_cwd.ts`: Remote directory isolation and shell pipeline execution.
    - `abort.ts`: SIGINT abortion and remote child process termination.
    - `large_output.ts`: Streaming fidelity under high-volume chunked output.
    - `heartbeat.ts`: Shared transport lifecycle and the agent reconnect when pings go unanswered or a close frame leaves TCP open, and the agent exits on token takeover. Does not use the debug server.
    - `run_all.ts`: Sequential test runner with aggregated pass/fail reporting.
- `.debug/` (git ignored):
    - `config.json`: Live target info written by `serve.ts` (removed on exit).
    - `worker.jsonl`: Cloudflare Worker Hub console logs.
    - `agent.jsonl`: Local Agent process logs.
    - `history.jsonl`: Execution history, timings, and test verdicts (`PASS` / `FAIL`).

## Usage

### 1. Start the Local Debug Environment

```bash
npm run debug:serve
```

### 2. Run Test Matrix (in another terminal or via AI agent)

```bash
# Run all tests
npm run debug:test

# Or run individual test suites
npm run debug:test:basic
npm run debug:test:env
npm run debug:test:abort
npm run debug:test:large
npm run debug:test:heartbeat
```

## AI Agent Autonomous Troubleshooting Workflow

When a bug or regression occurs:

1. Run `npm run debug:test` to identify failing test cases.
2. Read `.debug/history.jsonl` to inspect the exact failure verdict and error details.
3. Check `.debug/worker.jsonl` and `.debug/agent.jsonl` around the corresponding timestamp.
4. Modify source code in `src/`.
5. Re-run `npm run debug:test` to confirm the fix with zero regressions.
