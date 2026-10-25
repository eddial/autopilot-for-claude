# Product

Autopilot is a work queue for one person that sits beside Claude Code. It finds what needs you,
prepares the work in Claude Code sessions, and asks you only for the decisions. You discover new
work, answer what is waiting on you, and jump into a session when you want to work actively.

## Principles

- **Whose turn it is decides the order.** The top of the queue is always something you can act on.
- **The task holds decisions and outcomes; the session holds the work.** Nothing from a session
  transcript is copied onto a task, and nothing on a task needs to be repeated in the session.
- **Answer where you are.** In the list, on the task, in the session, from a notification: every
  answer reaches the same session.
- **Claude's look, Autopilot's colour.** Warm greys, serif headings over sans body, rounded
  surfaces, no shouting. Clay means "your turn". Pilot green is Autopilot itself.
- **No Claude Code navigation needed.** Autopilot is where you find and pick work; Claude Code is
  only where you work in a session.

## Concepts

| Concept | Meaning |
| --- | --- |
| **Task** | One thing that needs you: a thread, a request, a ticket, or something you asked for yourself |
| **Update** | One typed entry on a task, posted by a session, a signal, a watcher or you |
| **Session** | A Claude Code session working on one task, started with Remote Control so it opens anywhere |
| **Signal** | A source Autopilot watches (Gmail, Slack, GitHub, Linear, Fathom, Lleverage …) |
| **Workstream** | An area of work: where tasks land, how sessions run, and how much they may do alone |
| **Watcher** | A periodic check on what a waiting task depends on |
| **Lay of the land** | What Autopilot finds about a new task before anyone starts it: what it really is, related threads, tickets and code, a likely approach, and what to decide first |
| **Routing review** | The nightly run (today's "dream") that proposes routing fixes from what you corrected |

## The queue and the attention model

Tasks are grouped into bands by whose turn it is, then ordered inside each band.

| Band | Enters when | Order inside |
| --- | --- | --- |
| **Your turn** | An open update needs you (decision, question, review, stuck); a session waits on a permission prompt; a health issue or routing proposal | Blocking a live session first, then urgent, then longest wait. Unread items have a filled dot, seen ones a hollow dot |
| **New** | A signal filed it, or you saved a task without starting it | Priority, then newest. Urgent ones go straight to Your turn and notify |
| **Running** | A session is working on it | Latest activity, with one line of what it is doing |
| **Waiting on others** | The session handed over to someone and left a watcher | Folded. When the watcher sees news, a workstream with autonomy 3 or more wakes the session; otherwise, and when it times out, the task returns to Your turn |
| **Snoozed** | You snoozed it until a time | Returns to Your turn when due |
| **Done** | You closed it, or the mirrored team ticket closed | Out of the queue, searchable |

Rules:

1. A task only moves up when something changed that needs you, never because of age alone.
2. Answering moves a task to Running at once, before the session replies.
3. The list never reorders under your cursor; changes apply when focus leaves or you move past them.
4. Notifications fire only on entering Your turn, once per task until you open it. The menu bar
   count is the Your turn count.

## A task is a list of updates

A task reads like a short Claude conversation. Autopilot's updates are plain text with a quiet
label; yours sit in bubbles on the right; files are attachment cards; a reply box sits at the
bottom. Each update has a kind, and the kind decides where the task goes.

| Kind | Label | Means | Task goes to |
| --- | --- | --- | --- |
| `decision` | Needs your decision | Options the session can act on; one tap answers | Your turn |
| `question` | Asked you | An open question, answered in words | Your turn |
| `review` | Ready to review | A draft, document or pull request to read | Your turn |
| `blocked` | Stuck | A permission prompt, a missing tool, a failure | Your turn, first |
| `waiting` | Waiting on someone | Who and what it waits on | Waiting |
| `done` | Done | An outcome: a branch, a sent reply, a file | unchanged |
| `info` | Update | Progress worth keeping; never notifies | unchanged |
| `signal` | New message | A new source message on this task | New, if it asks you something |
| `instruction` | You | Your instruction or answer | Running |

A task has at most one open ask (`decision`, `question`, `review`, `blocked`). It closes when you
answer, and the answer stays attached to it.

## Onboarding

Five steps to a working queue, then two optional ones offered only when they add something. Each
step asks only what it needs; everything else has a sensible default and lives in Settings.

| Step | Asks | Why here |
| --- | --- | --- |
| 1 · Get ready | Nothing, unless a check fails: Claude Code installed, signed in with a Claude account (so connectors work), Remote Control available. One switch: keep working in the background | Nothing else works without these; showing them as checks means no reading for most people |
| 2 · Sources | Which of your Claude connectors to listen to. Detected, not typed: Slack and Gmail suggested, Linear, GitHub (through the `gh` CLI) and Fathom offered; connectors you don't have yet link to Claude's settings | Starting with one or two keeps the first queue small and right |
| 3 · Preview | Nothing, except "Not for me" on anything wrong. A dry run over yesterday shows what would have been filed, followed up and left alone, grouped into suggested workstreams | Shows the value before anything is switched on, and the corrections become routing rules |
| 4 · Workstreams | Accept or edit the suggested workstreams: what lands there, when it's urgent, and only for code work a repository | Workstreams come from real items instead of a blank form |
| 5 · Switch on | Nothing; optionally start one of the previewed items now | Signals start from now (no backfill); trying one task shows the loop end to end |
| Later · Your iPhone | Scan a pairing code on home Wi-Fi | Offered from Servers or after the first day, not during setup |
| Later · Away from home | Install Tailscale on the phone, test with Wi-Fi off, keep the Mac awake while plugged in | Only after pairing, and only for people who want the queue on the go |

Autonomy levels, watchers, schedules, models and agent tokens are not part of onboarding.

## Screens

### Mac, full window: three columns

1. **Navigation** (hideable): New task; queue views (Needs me, Running, Waiting on others, Snoozed,
   Done); one view per workstream; saved views ("Customers, over 2 days"); Signals and Servers at the
   bottom with a health dot.
2. **List** (resizable): view title, grouping (whose turn, workstream, source, machine), filter
   with tokens (`ws:customers from:slack`), select for bulk actions. Rows show title, update label,
   workstream, source and age. Space opens a row in place to answer it without opening the task.
   "Go through them" steps through Your turn or New one at a time.
3. **Task** (closable): the conversation and the reply box with Open session, Snooze and Done.

### Mac, beside Claude Code

The same window narrowed: navigation hidden behind the sidebar button, list plus task. In the
narrowest width the task replaces the list (back button), which is also the phone layout. The
session in Claude Code shows the task's state only through the existing `/ticket` hook.

### New task

Like Claude's start screen: the pilot, "What should I take on?", and the reply box holding a title,
the brief (the session's first prompt) and pickers for workstream (suggested by routing), priority,
machine and model. Send creates the task and starts its session at once; "Save without starting"
puts it in New. Also from: a global shortcut over any app (selected text becomes the brief), the
share sheet on the Mac and iPhone, `tasks.create` over MCP, and `autopilot new` in a terminal.

### Signals and workstreams

Signals with cadence, last day's filed and added counts, and health. Workstreams with where they
run, autonomy level (files, prepares, starts itself, finishes) and open count. A "Needs you" column
for health problems and routing proposals (accept or review), and the active watchers.

### Servers

Machines (one main, any runners), devices (paired apps, removable), agents (MCP tokens with their
scope), and pairing by QR code or `autopilot join <code>`.

### Menu bar

The pilot with the Your turn count. Its menu lists those tasks and opens the quick-add box.

### iPhone Duo

The phone is an iPhone Duo. Layout follows size classes, never orientation, as Apple's guidance for
the Duo asks.

| Display | Size class | Autopilot shows |
| --- | --- | --- |
| Outer, 5.4" (about 466×678 pt) | Compact width, like any iPhone | The queue; a task replaces it; "New task…" at the bottom |
| Inner, 7.6" (about 626×890 pt), in Split View beside Claude | Compact width per app | The queue or one task, next to the Claude session |
| Inner, full screen | Regular in both directions | List and task side by side, navigation behind the sidebar button |

The app keeps interactive content inside asymmetric safe areas, uses the fold's reserved region
(`ReservedRegion`) for anything custom, and does not assume a fixed screen size.

**Bars move to the side.** On the outer display, and on the inner display in landscape, iOS puts
navigation buttons, toolbar items and the tab bar into one vertical bar along the hardware edge,
shared with the status bar. In Split View each app's bar sits on its outer edge (Autopilot left,
Claude right). Inner portrait keeps ordinary horizontal bars. Order, top to bottom:

1. Back (only on a task).
2. The prominent action: New task on the queue, Open session on a task (Clay).
3. The other actions: view and filter on the queue; Snooze and Done on a task.
4. A gap, then the tabs: Queue, Signals, Servers.

In the full-screen split layout only the task column joins the vertical bar; the list column keeps
its buttons in its own header. Only bars owned by the system containers move: the Expo app has to
use the native stack header and native tabs (UINavigationController and UITabBarController
underneath), not hand-built bars, and keep the composer and other custom chrome off that edge.

## The pilot

Claude's pixel mascot in pilot green (`#5DB08F`) with a captain's peaked cap, gold wings and
aviators. Used as the app icon, in the menu bar, in the app header and on the New task screen.

## Palette

| Token | Value | Use |
| --- | --- | --- |
| Window | `#1F1E1D` | Sidebars, window ground |
| Surface | `#262624` | Main panes |
| Raised | `#30302E` | Selected rows, composer, cards |
| Text | `#FAF9F5` / `#C2C0B6` / `#9C9A92` | Primary / secondary / tertiary |
| Clay | `#D97757` | Your turn, send |
| Pilot green | `#5DB08F` | Running, healthy, the pilot |
| Border | `rgba(222,220,209,.15)` | Hairlines |

Type: Anthropic Serif (fallback Source Serif 4, Georgia) for headings; Anthropic Sans (fallback
system UI) for everything else; mono only for code. A light theme on Ivory follows the same tokens.
