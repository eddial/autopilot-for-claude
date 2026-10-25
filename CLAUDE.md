# Autopilot for Claude

A work queue that sits beside Claude Code. Read `README.md` for what it is and `docs/` for the
product, architecture, API and plan; `docs/decisions/` records why things are the way they are.

## Layout

- `packages/contracts`: Zod schemas, the oRPC contract, MCP tool definitions and the shared queue
  rules. Everything else is built against it. `schema/` is generated (`pnpm schema`); never edit it.
- `apps/` (server, desktop, web, mobile), `prompts/` and `plugin/` arrive in later phases.

## Commands

Node 24 (`.nvmrc`), pnpm.

```sh
pnpm install
pnpm check        # lint, typecheck, test
pnpm schema       # regenerate packages/contracts/schema after changing the contract
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
- Tests: one per rule that matters, no permutation matrices, no real sleeps.
