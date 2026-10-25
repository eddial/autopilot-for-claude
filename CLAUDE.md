# Autopilot for Claude

A work queue that sits beside Claude Code. Read `README.md` for what it is and `docs/` for the
product, architecture, API and plan; `docs/decisions/` records why things are the way they are.

## Layout

- `packages/contracts`: Zod schemas, the oRPC contract, MCP tool definitions and the shared queue
  rules. Everything else is built against it. `schema/` is generated (`pnpm schema`); never edit it.
- `apps/server`: the server and the `autopilot` CLI. `service.ts` holds every rule about tasks and
  updates; `api.ts` checks tokens against the contract; `launcher.ts` runs Claude Code sessions in a
  pty and delivers answers when they are idle; `signals.ts` runs `claude -p` for each signal.
- `prompts/`: the shared and filing instructions signal runs get. `plugin/`: the Claude Code plugin
  sessions load, with the `work` skill.
- `apps/desktop`: the Mac app. `electron/` is the main process (it holds the owner token and serves
  the contract to the window over a MessagePort through `proxy.ts`); `src/` is the React window,
  which keeps the queue with `applyEvent` from the contracts. `pnpm desktop` runs it;
  `pnpm --filter @autopilot/desktop web` serves the window in a browser against the running server.
  `test/ui.test.ts` drives the real window in Chromium against a real server.
- `apps/mobile` (the iPhone) arrives in phase 3.
- How to run it on a Mac: `docs/RUNNING.md`.

## Commands

Node 24 (`.nvmrc`), pnpm.

```sh
pnpm install
pnpm check        # lint, typecheck, test
pnpm schema       # regenerate packages/contracts/schema after changing the contract
pnpm autopilot    # the CLI (serve, new, ls, show, answer, signal, status, mcp)
```

CI runs the same and fails when the generated schema is stale.

## Conventions

- TypeScript strict, ES modules, relative imports with the `.ts` extension (Node runs the sources
  directly), only erasable syntax (no enums or namespaces).
- `type` over `interface`. No `any`, no non-null assertions.
- Every write in the contract takes an `idempotencyKey`, declares its scopes in `.meta()`, and sets
  `ownTask` when a session token may call it. The contract tests enforce this.
- Change the contract only together with `API_VERSION` when an older client could break.
- British English in docs and product copy.
- Tests: one per rule that matters, no permutation matrices, no real sleeps. `test/e2e.test.ts`
  runs a real pty and the real MCP bridge with `test/fixtures/fake-claude.ts` standing in for Claude.
- `node-pty` is native: prebuilt on macOS; elsewhere it builds with node-gyp.
