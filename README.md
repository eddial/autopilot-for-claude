# Autopilot for Claude

Autopilot reads your inbox, Slack, GitHub and Linear, collects what needs you in one queue, and
when you say go, starts a Claude Code session that prepares the work: a reply drafted, a document,
a branch with a fix, a decision with the facts lined up. You decide; it never sends, merges or
deletes on its own.

It runs on your Mac as a small server and an app that sits beside Claude Code, with an iPhone app
for the queue on the go. It is the successor of `autopilot-for-linear`, which uses Linear as its
control plane; this one has its own.

**Status:** being planned. Nothing here is built yet. Private until the first usable release.

| Document | What it covers |
| --- | --- |
| [docs/PRODUCT.md](docs/PRODUCT.md) | The experience: the queue, the attention model, tasks as updates, onboarding, the screens, the pilot |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Roles, how it runs on the Mac and reaches the iPhone, the stack, repo layout, storage, write-back, security |
| [docs/API.md](docs/API.md) | The contract: entities, commands, changes, update kinds, access scopes, and the MCP tools any agent can use |
| [docs/PLAN.md](docs/PLAN.md) | Phases with exit criteria, moving off the Linear version, open questions |

Design concept: https://claude.ai/artifact/NaVZFaCJWSh8VT5aaaFoSP

## In one paragraph

One TypeScript server (SQLite, oRPC) owns tasks, runs the tick (signals, watchers, health, the
nightly routing review) and starts Claude Code sessions with `--remote-control`. Every app is only
a client of its versioned API: an Electron app on the Mac, an Expo app on the iPhone. On the Mac the
app installs the server as a background agent and talks to it over a local socket; the iPhone pairs
with that Mac and connects over the local network or Tailscale, and keeps taking input while the Mac
is unreachable. Sessions write back through Autopilot's own MCP server, with access scoped per
caller. A task is a short conversation of typed updates, and the queue ranks tasks by whose turn it
is, so the top row is always something to act on.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Control plane | Autopilot's own server, not Linear | Linear stays a signal source (team tickets), not where you steer |
| Audience | You first, then anyone; open source later | Private until the first usable release; Apache-2.0 |
| Language | TypeScript throughout | One language across server, Mac app, iPhone app and MCP; the agent tooling is TypeScript-first |
| Contracts and RPC | Zod and oRPC, not Effect | Familiar to contributors, written reliably, and the MCP SDK uses Zod directly; typed end to end without a framework to learn |
| Storage | SQLite: normal tables, append-only updates, a numbered change feed, idempotency keys | Enough for the offline phone and safe retries, without full event sourcing |
| Mac app | Electron with React, styled like Claude | The same choice Claude desktop made |
| iPhone app | Expo (React Native), distributed through TestFlight | Shares the contract and client logic with the Mac app; works well enough on iPhone Duo |
| Remote access | Tailscale, free personal plan | No router setup; the server puts the Mac's Tailscale name in the pairing code |
| Where it runs | The Mac is server and client; the iPhone is a client; later an always-on Mac as server with the MacBook as client | Server installed as a launchd agent by the app |
| Visual language | Claude's warm greys, serif headings over sans body, Clay for "your turn", pilot green for Autopilot | It lives next to Claude all day |
| Mascot | Claude's pixel mascot in pilot green, captain's cap and aviators | |

## Licence

[Apache-2.0](LICENSE)
