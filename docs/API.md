# API

The contract lives in `packages/contracts` as Zod schemas and an oRPC contract. Everything else is
derived from it: the typed clients the apps use, the MCP tools agents use, and a JSON Schema export for anyone else.
The API is versioned; a server accepts its own version and the previous one.

## Entities

| Entity | Key fields |
| --- | --- |
| `Task` | `id` (`AP-212`), `title`, `brief`, `workstream`, `priority` (1–4), `band` (derived), `state` (`new`, `running`, `waiting`, `snoozed`, `done`, `canceled`), `snoozedUntil`, `source` (signal, URL, mirrored ticket), `links[]`, `sessionId`, `createdBy`, timestamps |
| `Update` | `id`, `taskId`, `kind` (below), `body`, `options[]` (for `decision`), `waitingOn`, `attachments[]`, `author` (`owner`, `session`, `signal`, `watcher`, `system`), `answers` (update id it answers), `open` (bool), `createdAt` |
| `Session` | `id`, `taskId`, `machine`, `cwd`, `branch`, `resumeUrl`, `remoteControlUrl`, `state` (`starting`, `working`, `idle`, `waiting_permission`, `ended`), `startedAt`, `lastActivityAt` |
| `Signal` | `name`, `schedule` (`every` or `cron`), `tools[]`, `model`, `paused`, `health`, `lastRunAt` |
| `Decision` | one item a signal looked at: `signal`, `action` (`created`, `updated`, `dropped`), `taskId`, `reason`, `searches[]`, `gated` |
| `Watcher` | `taskId`, `what`, `every`, `until`, `tools[]`, `fingerprint` |
| `Workstream` | `name`, `routing`, `urgent`, `work`, `autonomy` (1–4), `repo` / `folder`, `runner` |
| `Machine` | `id`, `name`, `roles` (`main`, `runner`), `capacity`, `workstreams[]`, `routes[]`, `health` |
| `Device` | `id`, `name`, `kind`, `publicKey`, `lastSeenAt` |
| `Token` | `id`, `name`, `scope`, `taskId` (for `session`), `lastUsedAt` |
| `RoutingProposal` | `id`, `diff`, `reason`, `state` (`open`, `accepted`, `rejected`) |

## Update kinds

`decision`, `question`, `review`, `blocked`, `waiting`, `done`, `info`, `signal`, `instruction`.
Their meaning and effect on the band are in [PRODUCT.md](PRODUCT.md#a-task-is-a-list-of-updates).
At most one open ask (`decision`, `question`, `review`, `blocked`) per task.

## Commands

Every command takes an `idempotencyKey` and is authorised by scope.

| Command | Scope | Effect |
| --- | --- | --- |
| `tasks.create { title, brief, workstream?, priority?, links?, start }` | `owner`, `create`, `session` | Creates a task; `start: true` starts its session with `brief` as the first prompt. Workstream and priority default from routing |
| `tasks.edit { id, title?, workstream?, priority? }` | `owner` | Changing the workstream re-files it (and teaches routing) |
| `tasks.start { id }` | `owner` | New → Running |
| `tasks.snooze { id, until }` | `owner` | |
| `tasks.wait { id, on, watcher? }` | `owner`, `session` (own) | |
| `tasks.close { id, outcome: done \| canceled }` | `owner` | Ends the session, cleans up the worktree unless it holds unpushed work |
| `tasks.bulk { ids, action }` | `owner` | start, dismiss, move, snooze |
| `updates.post { taskId, kind, body, options?, waitingOn?, attachments? }` | `session` (own), `watcher`, `signal` (`signal` kind only) | Opening an ask closes any previous open ask |
| `updates.answer { updateId, option? , text? }` | `owner` | Records an `instruction`, delivers it into the live session (or starts one), task → Running |
| `updates.instruct { taskId, body }` | `owner` | The same without an open ask: tells the session something, or starts one with it |
| `sessions.report { taskId, state, activity? }` | `session` (own task) | From the session's Claude Code hooks: working, idle, waiting on a permission prompt, ended. Answers are delivered only when idle |
| `links.attach { taskId, url, title, subtitle? }` | `owner`, `session` (own) | |
| `watchers.add { taskId, what, every?, until?, tools? }` / `watchers.remove` | `owner`, `session` (own) | |
| `items.match { query }` | `signal` | The searches a signal run does before filing |
| `items.file { item }` | `signal` | Creates a task or adds a `signal` update; logs a `Decision`. An item with `ticket { id, closed }` mirrors a team ticket: one task per ticket, closed when the ticket closes |
| `routing.decide { proposalId, accept }` | `owner` | Accepting writes the edit into the home files (`CONFLICT` with `version_mismatch` when the file changed since) and closes the proposal's task |
| `signals.run { name, dryMinutes? }`, `signals.pause` | `owner` | |
| `devices.pair { code, publicKey, name }`, `devices.remove` | pairing / `owner` | |
| `tokens.create { name, scope }`, `tokens.revoke` | `owner` | |

## Queries and subscriptions

- `queue.list { band?, workstream?, filter? }`: a snapshot of the queue with its change number.
- `queue.subscribe { after? }`: a snapshot (unless resuming from `after`), then every change
  (`task.upserted`, `task.removed`, `update.added`, `update.changed`, `session.changed`,
  `signal.changed`, `workstream.changed`) as it happens.
- `changes.since { after, limit }`: catch up after being offline, page by page.
- `tasks.get { id }`: the task with its updates, session and watchers.
- `signals.list`, `workstreams.list`, `routing.list`, `machines.list`, `devices.list`, `tokens.list`.
- `connectors.detect`: the MCP servers Claude Code has on this Mac (claude.ai connectors included)
  with their tools and the example signal that reads each, and whether the GitHub CLI is signed in.
  Takes a few seconds; for onboarding.
- `meta.version`: the API version and the oldest client it serves; needs no token.

## MCP

The server exposes a subset of the procedures as MCP tools, with the same input minus the
idempotency key, which the bridge fills in. Local agents connect with `autopilot mcp` (stdio bridge
to the server); remote agents use streamable HTTP with a token. The tool list, with each tool's
scopes and input schema, is generated into `packages/contracts/schema/mcp-tools.json`.

| Tool | Scopes |
| --- | --- |
| `list_tasks` | `owner`, `read`, `create` |
| `get_task` | `owner`, `read`, `create`, `session` (own task) |
| `list_workstreams` | `owner`, `read`, `create`, `signal` |
| `create_task` | `owner`, `create`, `session` |
| `post_update` | `session` (own task), `watcher` |
| `attach_link`, `add_watcher`, `wait_on` | `owner`, `session` (own task) |
| `answer_update`, `start_task`, `snooze_task`, `close_task` | `owner` |
| `match_items`, `file_item` | `signal` |

Sessions get a `session` token for their own task automatically; signal runs get a `signal` token.
Other agents (Claude Desktop, a Lleverage agent) get a token from Servers → Agents.

## Errors

Typed errors in the oRPC contract:

- `NOT_FOUND`: the task, update or other entity does not exist.
- `FORBIDDEN`: the token's scope is not allowed, or a session token names another task.
- `CONFLICT`: the ask was already answered elsewhere, the task was closed meanwhile, or the client's
  API version is too old.
- `SERVICE_UNAVAILABLE`: a runner, a connector or Claude itself is down.

Invalid input is rejected with oRPC's validation error. Retries are safe because of idempotency
keys.
