# Plan

Scope: the Mac runs the server and the app; the iPhone is a client of the Mac. Each phase ends with
something usable. Everything else is listed under [Later](#later-out-of-scope).

## Phase 0 · Foundations

**Status:** done. The MCP tool list is in [API.md](API.md#mcp) and generated into
`packages/contracts/schema/mcp-tools.json`.

- pnpm workspace with `apps/`, `packages/`, `prompts/` and `plugin/`; TypeScript strict, Vitest,
  oxlint; CI on macOS.
- `packages/contracts`: Zod schemas for entities, update kinds and commands; the oRPC contract with
  typed errors; the change feed format; API version; MCP tool definitions; JSON Schema export.
- Short decision records for the choices in the [README](../README.md#decisions).

**Done when** the contracts build and export, CI is green, and the MCP tool list is reviewed.

## Phase 1a · The loop on the Mac, one signal

**Status:** built and tested in the cloud, with a stand-in for Claude. Waiting on the two checks
on a real Mac in [RUNNING.md](RUNNING.md): a session writing back through Remote Control, and
Slack filing tasks.

The smallest slice that replaces Linear end to end.

- Store: SQLite (`node:sqlite`), the change feed, idempotency keys, the outbox for side effects.
- API over a Unix socket with tokens; `autopilot` CLI (`new`, `ls`, `show`, `answer`, `status`,
  `service install`); `autopilot mcp`.
- Launcher: sessions in a server-owned pseudo-terminal with `--remote-control` and `--mcp-config`;
  answers delivered into the session only when it is idle, so they never collide with your typing
  through Remote Control.
- The work skill and shared instructions post typed updates instead of `🤖 Autopilot` comments;
  `/ticket` reads the API.
- One signal (Slack) filing through `match_items` / `file_item`.
- Queue logic: bands, ordering and notification triggers from [PRODUCT.md](PRODUCT.md).
- launchd install for the server in the user session.

First checks, before building on them: `--mcp-config` tools reach a session you steer through
Remote Control; a headless `claude` run reports the claude.ai connectors (for onboarding).

**Done when** Slack items become tasks, a session posts a decision, `autopilot answer` reaches it,
and nothing touches Linear.

## Phase 1b · Everything else from the Linear version

- Built: the other signals as examples in `examples/home/signals/` (Gmail, GitHub, Linear for team
  tickets, Fathom, a weekly digest), each previewed with `autopilot signal <name> --dry`; cron
  schedules for digests; team-ticket mirrors (one task per ticket, branch named after the ticket,
  closed when the ticket closes); watchers (checked every interval while the task waits on others
  or on your review; news wakes the session or comes to Your turn; expiry asks you).
- Built: health (a signal failing for an hour and three runs becomes a task in the `autopilot`
  workstream and closes itself when the signal runs again; a gap longer than a signal reaches back
  asks you); the nightly routing review (learns from what you re-file, re-prioritise and dismiss,
  and proposes edits you accept with `autopilot routing accept`); connector detection
  (`autopilot connectors`) for onboarding. The preview over the last day is a dry run per signal.

**Done when** a full day runs on the CLI with everything the Linear version did.

## Phase 2 · Mac app

**Status:** first version built and tested in Chromium against a real server; not yet run as an
Electron app on a Mac, signed or packaged. Built: the window (navigation, queue with answering in
place, task conversation, New task, Signals and workstreams with routing proposals, onboarding
steps 1 to 5), the menu bar pilot with the Your turn count, notifications, ⌘N and ⌃⌥Space. It runs
from the checkout with `pnpm desktop` and starts the server when the launchd agent is not running.
Still to do: packaging, signing and notarising with electron-updater; the owner token in the
Keychain; Servers; saved views; bulk actions; ⌘K; the light theme.

- Electron shell: one window with navigation, list and task columns (each hideable or resizable),
  the narrow layout for beside Claude Code, menu bar with the Your turn count, notifications, global
  quick-add shortcut, first-run setup that installs the server. Signed and notarised; updates with
  electron-updater.
- Screens: queue with answering in place and bulk actions, task conversation, New task, Signals and
  workstreams, Servers (machines, devices, agents), the onboarding wizard from
  [PRODUCT.md](PRODUCT.md#onboarding).
- Screens still to design during this phase: settings (editing a workstream's routing and a
  signal's rules), the menu bar menu, ⌘K search, empty, error and server-offline states, notification
  wording.
- Claude look and the pilot from [PRODUCT.md](PRODUCT.md).

**Done when** it is the daily driver and `autopilot-for-linear` is switched off.

## Phase 3 · iPhone

**Status:** built; the server side and the sync engine are tested against a real server over TLS,
and the iOS bundle compiles, but the app has not run on an iPhone yet. Built: the device listener
(TLS, pinned by fingerprint, LAN and Tailscale only), pairing by QR code from the Mac app's Servers
screen, `packages/client` (routes, cached queue, offline outbox with conflicts), and the Expo app
(pairing, queue, task with answering and replies, New task, Signals, Servers) with native tabs and
native toolbar items for the Duo's vertical bar, the wide split on the inner display, local
notifications and the icon badge, and background sync. Still to do: run it on the Duo and fix what
that shows; the share extension; TestFlight once the developer account is there; try
`expo-router/unstable-split-view` for a native split so only the task column joins the vertical
bar.

- Server: network listener with TLS, pairing codes and QR, device keys, routes (LAN, Tailscale),
  API version handshake.
- Expo app: queue, task, reply, New task, share extension, the iPhone Duo layouts and vertical bar
  from [PRODUCT.md](PRODUCT.md#iphone-duo), local notifications when it syncs.
- Works offline: the last snapshot stays readable, and actions go into an outbox that is sent when
  the Mac is reachable again (see [ARCHITECTURE.md](ARCHITECTURE.md#offline-on-the-iphone)).
- Tailscale for reaching the Mac away from home.
- TestFlight distribution.

**Done when** you can answer, start and create tasks from the phone away from home, including while
the Mac is unreachable, and everything arrives once it is back.

## Phase 4 · MacBook as a client of an always-on Mac

- An always-on Mac (a Mac mini) runs the main server; the MacBook's app pairs with it like the
  iPhone does, and stops running its own server.
- First-run setup offers "This Mac" or "Connect to another Mac"; Servers gets a way to move the data
  from the MacBook to the Mac mini.

**Done when** the queue keeps running with the MacBook closed, and the MacBook and iPhone see the
same queue.

## Later (out of scope)

Designed for, not planned:

- Push notifications through APNs while the Mac sleeps, with answers from the lock screen.
- Android, from the same Expo app.
- A headless server (Linux) and remote runners.
- Claude on claude.ai and the phone as an MCP client (needs a public HTTPS address with OAuth).
- A web client from `apps/web`.
- Going public: a security page, contributor docs, first-run for people who never used the Linear
  version.

## Moving off the Linear version

1. `autopilot-for-linear` keeps running while phases 0–1 are built here.
2. When phase 1a works, Slack moves over first; the other signals follow in 1b, one at a time.
   Nothing is imported: the queue starts empty.
3. When phase 2 is the daily driver, `autopilot-for-linear` is switched off. The workstream and
   signal Markdown in `home/` keeps its format and is copied over.

## Open questions

- Bundle id: `com.eddial.autopilot` for now (in `apps/mobile/app.json`); change it before the first
  TestFlight build if it should be another.
- Signals: keep `claude -p`, or move to the Claude Agent SDK once it is clear claude.ai connectors
  are available through it.
