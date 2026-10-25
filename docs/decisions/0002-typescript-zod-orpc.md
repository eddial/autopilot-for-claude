# 2. TypeScript with Zod and oRPC, not Effect

**Decision.** One TypeScript codebase. Contracts are Zod schemas and an oRPC contract in
`packages/contracts`; the server implements it and the apps use typed clients. No Effect.

**Why.** Written reliably by the people (and agents) building it, familiar to contributors once it
is open source, and the MCP SDK takes Zod schemas directly, so the API, the MCP tools and the public
JSON Schema come from one definition. oRPC gives typed errors and streaming without a framework.

**Consequences.** Concurrency, retries and cancellation for the tick are handled by a small
scheduler with `AbortSignal` rather than by a library.
