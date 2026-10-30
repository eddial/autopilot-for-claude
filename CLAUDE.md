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
- `packages/client`: what a paired device runs: the Mac reached over Tailscale only, TLS pinned to the Mac's
  certificate, the queue cached from the change feed, and the offline outbox. Tested against a
  real server over TLS.
- `packages/design`: the tokens (colours, fonts, radii, spacing, tones, the pilot) both apps draw
  with. `docs/DESIGN.md` says how the apps use them.
- `packages/testkit`: what tests that need a real server share (`startTestServer`, `localInvite`,
  `keys`). Use it rather than setting up a server by hand.
- `apps/mobile`: the Expo iPhone app. Native stack and native tabs (the iPhone Duo moves only
  native bars), a Swift module in `modules/pinned-fetch` for pinned TLS, `src/store.ts` wiring
  `Sync` to the Keychain, SQLite, notifications and background sync. Check bundling with
  `npx expo export --platform ios` (Hermes rejects some syntax tsc accepts).
- How to run it on a Mac: `docs/RUNNING.md`. Getting a change onto the owner's Mac and iPhone, and
  running the app in the simulator: `docs/SHIPPING.md` (`pnpm ship`, `pnpm sim`). Pushing to main
  ships it by itself; do not restart the server or reinstall an app by hand.
- Before any UI change, read `AGENTS.md`: what the owner keeps correcting (buttons never on the
  content, every Duo pose checked, no wasted room, plain motion).

## Commands

Node 24 (`.nvmrc`), pnpm.

```sh
pnpm install
pnpm check        # lint (oxlint, package boundaries, formatting), typecheck, test
pnpm format       # Prettier, the formatting CI checks
pnpm schema       # regenerate packages/contracts/schema after changing the contract
pnpm perf         # performance budgets (server and window)
pnpm tokens       # regenerate apps/desktop/src/tokens.css after changing the design tokens
pnpm screens      # screenshots of every Mac screen on a realistic queue, into screens/
pnpm autopilot    # the CLI (serve, new, ls, show, answer, signal, status, mcp)
pnpm ship         # put main on this Mac and the iPhone (the agent does it after each push)
pnpm sim          # this checkout's app in the iPhone Duo simulator; sim pair, sim unpair
```

CI runs the same and fails when the generated schema is stale or the contract breaks installed
apps without a new `API_VERSION` (`scripts/contract-compat.ts`).

## Conventions

- TypeScript strict, ES modules, relative imports with the `.ts` extension (Node runs the sources
  directly), only erasable syntax (no enums or namespaces).
- `type` over `interface`. No `any`, no non-null assertions.
- Package boundaries are lint rules (`.oxlintrc.json` overrides): the contract imports nothing of
  ours; `packages/client` and the phone use no Node built-ins (Node-only code goes in
  `packages/client/src/node.ts`); the window reaches the server only through the contract.
- Shared dependencies take their version from the catalog in `pnpm-workspace.yaml`
  (`"zod": "catalog:"`); add new shared ones there.
- Every write in the contract takes an `idempotencyKey`, declares its scopes in `.meta()`, and sets
  `ownTask` when a session token may call it. The contract tests enforce this.
- Change the contract only together with `API_VERSION` when an older client could break.
- British English in docs and product copy.
- Tests: one per rule that matters, no permutation matrices, no real sleeps. `test/e2e.test.ts`
  runs a real pty and the real MCP bridge with `test/fixtures/fake-claude.ts` standing in for Claude.
- `node-pty` is native: prebuilt on macOS; elsewhere it builds with node-gyp.
- UI goes through the building blocks (`docs/DESIGN.md`): `src/ui.tsx` in each app, colours only
  from `@autopilot/design`. Lint refuses a raw `<button>` or `style` in the window's screens; a
  test refuses a colour literal anywhere in the apps. Add a kind or a token rather than a one-off.
- Code the phone runs (the contract, the client, the tokens, the app) avoids what Hermes lacks:
  lint refuses `toSorted`, `toReversed`, `toSpliced`, `AbortSignal.timeout` and `crypto.randomUUID`.
- Performance is a feature (`docs/PERFORMANCE.md`): every interaction paints on the next frame.
  Apps draw from their store, never `await` the server in an event handler (use `send`), lists
  are virtualised, nothing before the first frame touches the network. `pnpm perf` checks the
  budgets in `apps/desktop/perf/budgets.json`, which only go down.
