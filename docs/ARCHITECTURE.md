# Architecture

## Roles

One server program plays up to two roles; every app is a client.

| Role | Does | How many |
| --- | --- | --- |
| **Main** | Holds the store, runs the tick (signals, watchers, health, routing review), serves the API and MCP, assigns sessions | Exactly one |
| **Runner** | Runs Claude Code sessions for the main | Any; the main is also a runner |
| **Client** | The Mac and iPhone apps, the CLI, any agent over MCP | Any; holds no data of its own beyond a cache |

In scope now: the Mac is main, runner and client; the iPhone is a client. Apps never read the
database. They use the same API locally and remotely, so a Mac that is only a client of another
machine stays a different connection, not a different code path.

## Topologies

### 1. The Mac: server and client

```
 Autopilot.app (Electron)                     ~/Library/Application Support/Autopilot/
 ├─ renderer: React UI  ──WebSocket RPC──┐     ├─ autopilot.sqlite   (tables + change feed)  
 └─ main process: tray, notifications,   │     ├─ config/            (workstreams, signals: Markdown)
    global shortcut, updater             │     └─ logs/
                                         ▼
 autopilot server (launchd agent, user session)  ── node-pty ──▶ claude --remote-control …  (sessions)
   unix socket, owner-only                       ── spawn ─────▶ claude -p --json-schema …  (signals, watchers)
```

- The app bundles the server and, on first run, installs it as a per-user launchd agent. It starts
  at login, keeps running when the window closes, and runs inside the user session, so it has the
  Keychain, the Claude login with its connectors, and `gh`.
- The app connects over a Unix socket that only the user can open: no network port. Every caller,
  the app included, still presents a token, so a session cannot act as the owner.
- Quitting from the menu bar stops the agent after a warning if sessions are running.
- One update replaces the UI and the bundled server together and restarts the agent. With a free
  Apple account that is `autopilot update` (pull and rebuild); with a paid one, electron-updater.

### 2. The iPhone as a client of the Mac

The server adds a network listener for paired devices: TLS, device keys, and by default only
loopback, private LAN and Tailscale addresses. Routes are tried in order (LAN, then Tailscale)
and the client switches back when a faster route returns. The
iPhone only reaches Autopilot while the Mac is awake; push notifications without the Mac need a
relay, which is out of scope for now.

### 3. Phase 4: an always-on Mac as main, the MacBook as client

The same app on a Mac mini runs the server; the MacBook pairs with it like the iPhone and uses the
same routes. This is what keeps the queue running while the laptop sleeps.

### 4. Out of scope for now: headless server

The same server runs on Linux or a Mac mini as a systemd or launchd service
(`autopilot service install`), signed in with `claude auth login` (not a `setup-token` token,
which has no connectors). The Mac app pairs with it and can also join as a runner, so sessions
for repo-bound workstreams run on the Mac next to its files. Moving the main role later is a
copy of the database, then clients follow.

## Stack

One language and one contract across the server, the Mac app, the iPhone app and MCP.

| Layer | Choice |
| --- | --- |
| Language | TypeScript, strict; Node LTS (24) |
| Schema | Zod 4 for every contract; JSON Schema exported from it; the MCP SDK takes the same schemas |
| RPC | oRPC, contract-first: the contract lives in `packages/contracts`, the server implements it, the desktop and mobile apps get typed clients. a streamed subscription for the Mac app and a long poll on the change feed for the phone; Unix socket locally, TLS for paired devices |
| Store | SQLite through Node's built-in `node:sqlite`; normal tables, an append-only updates table, a numbered change feed, one transaction per command |
| Jobs | A small scheduler for the tick (signals, watchers, health, routing review) with timeouts and cancellation through `AbortSignal` |
| Sessions | `claude --remote-control` in a pseudo-terminal owned by the server (`node-pty`); no tmux |
| Signals and watchers | `claude -p --json-schema` with the signal's read-only tools, as today |
| MCP | `@modelcontextprotocol/sdk`: streamable HTTP on the server, `autopilot mcp` as a stdio bridge |
| Desktop | Electron, React 19, Vite, Tailwind 4, TanStack Router, TanStack Query, Legend List; signed and notarised, electron-updater |
| Mobile | Expo with a dev client and EAS builds to TestFlight, React Native, React Navigation native stack and native tabs, Legend List, `@expo/ui`, `expo-secure-store`, `expo-sqlite`, `expo-notifications`, a share extension |
| Keys and crypto | `jose` and `@noble/curves` for device keys and tokens; Keychain on macOS via `@napi-rs/keyring` |
| Tooling | pnpm workspaces, Vitest, oxlint, tsc |

## Repository layout

This repository (`autopilot-for-claude`) is new; the Linear-based engine stays in `autopilot-for-linear` until the switch (see [PLAN.md](PLAN.md#moving-off-the-linear-version)).

```
apps/
  server/          the autopilot server and CLI: store, tick, launcher, watchers, health, routing review, API, MCP, device listener
  desktop/         the Mac app: Electron main process (token, tray, shortcuts) and the React window
  mobile/          Expo app for iPhone, with a Swift module for pinned TLS
packages/
  contracts/       Zod schemas and the oRPC contract: entities, commands, changes, update kinds, MCP tool definitions, the live queue reducer
  client/          a paired device's engine: routes, pinned TLS, cached queue from the change feed, offline outbox
prompts/           the signal, workstream, routing-review and session instructions (moved from autopilot-for-linear)
plugin/            the Claude Code plugin: the work skill, /ticket, and the MCP declaration
home/              a person's config (workstreams and signals as Markdown, same format as today), read by the server
```

## Offline on the iPhone

The phone takes input while the Mac is unreachable and sends it when the Mac is back.

- **Cache**: the last queue snapshot and opened tasks are kept on the phone (SQLite through
  `expo-sqlite`), so it opens instantly and stays readable offline, marked "Offline, last synced
  …".
- **Outbox**: every write (answer, reply, new task, start, snooze, done) is stored with its
  idempotency key and a per-device sequence number, applied to the screen at once, and sent in
  order when a route works again.
- **Replay is safe**: the server ignores a command whose idempotency key it has already applied, so
  a flaky connection never doubles anything.
- **Conflicts** are the only real work, and few:
  - an answer to an ask that was already answered on the Mac: the server returns `Conflict`; the
    phone shows "Answered on the Mac" and offers to send your text as a new instruction;
  - an action on a task that was closed meanwhile: offer to reopen it;
  - a new task never conflicts.
- **When it sends**: on app launch and foreground, when the network changes, and opportunistically
  through iOS background tasks; iOS decides how often, so the reliable moment is the next time the
  app opens. A pending count shows until the outbox is empty.

## Data model

Normal tables hold the current state. Three things make the asynchronous phone and safe retries
work without full event sourcing:

- **Updates are append-only.** A task's conversation is a log by nature and is never rewritten.
- **A numbered change feed.** Every write in a command's transaction adds a row with the next
  sequence number and what changed; clients catch up by asking for everything after the last
  number they saw.
- **Idempotency keys.** Each command records its key, so a replayed command is ignored.

Side effects (starting a session, calling a connector) run after commit from an outbox table.

Main entities: `Task`, `Update`, `Session`, `Signal`, `SignalRun`, `Decision` (every item a signal
looked at, replacing `decisions.jsonl`), `Watcher`, `Workstream`, `Machine`, `Device`, `Token`,
`RoutingProposal`. Details in [API.md](API.md).

Workstreams and signals stay Markdown files in `home/`, so they can still be edited by hand and by
sessions; the server watches them and indexes them.

## Sessions

- A session is started for a task on a runner: in the workstream's folder, or a git worktree on
  `claude/<id>` for a workstream with a repo (as today).
- The server owns the pseudo-terminal, scrapes the Remote Control link and records the session's
  resume link (`claude://resume?session=<id>`), so "Open session" works on the Mac and on the phone.
- The session gets an MCP token scoped to its own task. The work skill posts updates
  (`updates.post`) instead of Linear comments; answers arrive as new turns in the same session.
- The `/ticket` hook in Claude Code reads the task through the same API.

## Writing back from sessions

Today sessions write back through the Linear connector in Claude. Without Linear, Autopilot is its
own connector: an MCP server named `autopilot`, served by the server on the Mac.

| Caller | How it gets the tools | Scope | When |
| --- | --- | --- | --- |
| Sessions Autopilot starts | The launcher adds `--mcp-config` with `autopilot mcp` (stdio) and a token for that task. Remote Control sessions still run on the Mac, so the tools work while you steer from the iPhone | `session` (own task) | Phase 1, critical |
| Signal runs (`claude -p`) | `--mcp-config` with a signal token; `match_items` and `file_item` replace Linear's search and save tools | `signal` | Phase 1 |
| Any Claude Code session on the Mac | The Autopilot plugin's `.mcp.json` | `read` and `create` | Phase 1 |
| Claude Desktop on the same Mac | Its local MCP config | chosen per token | Phase 2 |
| Claude on claude.ai and the phone app | A custom connector is called from Anthropic's cloud, so it needs a public HTTPS address with OAuth; a Mac behind Tailscale is not reachable. Possible later with Tailscale Funnel plus OAuth on the server | per OAuth grant | Later |

Answers travel the other way through the session's terminal, which the server owns: an answer is
recorded on the task, then typed into the live session.

## Security

- **No open ports by default.** Locally a Unix socket only the user can open; for devices,
  loopback, LAN and Tailscale only, with TLS.
- **Pairing**: a QR code with the routes, the server certificate's fingerprint and a one-time code
  valid five minutes. The phone pins the fingerprint (TLS that trusts exactly that certificate, see
  [decision 7](decisions/0007-pinned-tls.md)) and trades the code for its own token, kept in the
  Keychain; the server keeps only its hash. Removing the device in Servers revokes it.
- **Scoped access**: `owner`, `read`, `create`, `session` (its own task only), `signal` (match and
  file only). Every RPC and MCP tool declares the scope it needs.
- **Source content is data**: mail, messages and tickets never become instructions; only `owner`
  updates do. Authorship comes from the token, not a comment prefix.
- **Secrets** in the macOS Keychain on the Mac and secure storage on the iPhone. Never in the repo
  or the database.
- **Sessions** keep running with `bypassPermissions` as today, as your macOS user. Scoped tokens
  keep the tools narrow; they are a guardrail, not isolation. Hard limits stay as deny rules in
  `.claude/settings.json`.

## Keeping the door open

Cheap seams built in now, so the out-of-scope setups need no rewrite later:

- The UI only talks to the API, never to the database.
- Roles are configuration; sessions start through a runner interface (local first).
- Devices and tokens have their own tables even with one device.
- The API carries a version; the server accepts the previous app version.
- Every write carries an idempotency key.
- Mac-only pieces of the server (Keychain, launchd) sit behind small services, so another
  platform needs only a new implementation of each.
