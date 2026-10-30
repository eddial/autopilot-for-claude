# Using Autopilot

Autopilot keeps one queue of everything that needs you, and Claude Code sessions do the work in
it. This guide is for using it. [RUNNING.md](RUNNING.md) covers installing and checking it, and
[PRODUCT.md](PRODUCT.md) explains why it works the way it does.

## The idea in a minute

- **Signals** watch your sources (Slack, Gmail, GitHub, Linear and others) and file a **task** for
  each thing that needs you. You can also file one yourself.
- When you say go, a **session** starts: Claude Code in a worktree on your Mac, with Remote
  Control, so you can open it anywhere. It prepares the work, such as a draft, a document, a branch
  with a fix, or a decision with the facts lined up.
- The session reports back on the task as **updates**. When it needs you, the task comes to
  **your turn**: answer it, and the answer reaches the session.
- Autopilot never sends, merges or deletes anything without you. Sessions prepare; you decide.

## Getting it running

You need a Mac with [Claude Code](https://claude.com/claude-code) signed in, Node 24 and pnpm.

```sh
git clone https://github.com/eddial/autopilot-for-claude ~/autopilot-for-claude
cd ~/autopilot-for-claude
pnpm install
pnpm --filter @autopilot/desktop package --install   # Autopilot.app, in ~/Applications
```

Open Autopilot. The first time, **Set up** walks you through five steps:

1. **Claude Code**: Autopilot checks that it is installed and signed in.
2. **Sources**: it reads your Claude connectors and offers a signal for each source it can watch.
3. **A look at yesterday**: it previews what each signal would have filed. Nothing is filed yet.
4. **Workstreams**: your areas of work, suggested from those real items. For each one, say what
   lands there, when it is urgent and, for code work, which repository.
5. **Switch on**: the signals start from now. Nothing from before is filed.

The app installs the server as a background service, so the queue keeps filling while the window
is closed. The menu bar shows the pilot with how many tasks are your turn.

## The queue

The list is the navigation. The tabs along the top:

| Tab | What is in it |
| --- | --- |
| **Needs me** | What waits on your answer, then, under it, what came in to triage: what signals file and what you saved for later |
| **Running** | A session is working on it |
| **Waiting on others** | Handed over to someone; a watcher checks for news and brings it back |
| **Snoozed** | Put away until a time you chose |
| **Done** | Closed, newest first, still searchable |
| **All** | Every open task, with its status shown on each row |

### What comes first

Needs me holds two things:

- First, work under way that waits on you. Each row says what it wants in green (Needs your
  decision, Asked you, Ready to review, Stuck, Finished), then the question itself.
- Under the **Triage** heading, what came in and nobody has started; each row says Triage in
  orange. Start it, snooze it, or close it as Not for me. An urgent one skips Triage and goes to
  the top.

Priority leads in both: Urgent, then High, Normal and Low. At the same priority among what waits
on you, a task with a live session waiting on your answer comes first, then the one that has waited
longest; in Triage, the newest. Running shows the latest activity first.

A task moves up only when something changed that needs you, never because it got old. The list
never reorders under your cursor.

### Grouping

The button between Search and New (on the iPhone, the gear) chooses how the list is cut up:

- **By workstream**: a section per workstream, in the order of its most pressing task, with the
  inbox last. This is best when you work one area at a time.
- **By priority**: Urgent, High, Normal and Low sections, with each workstream kept together inside
  them. This is best when the queue is long and you want the most important things first,
  whatever area they are in. Each row then shows its workstream.

Click a section header to fold it away. Your choice is remembered.

### Search

Search matches titles and task ids, and takes two kinds of token:

- `ws:customers` shows only that workstream.
- `from:slack` shows only what that signal filed; `from:you` shows only tasks you filed yourself.

Tokens combine: `ws:sales from:gmail pricing`.

## A task

A task reads like a short conversation. Autopilot's updates are plain text with a quiet label, and
yours sit in bubbles on the right. The label tells you what an update wants:

| Label | What to do |
| --- | --- |
| **Needs your decision** | Pick an option, or answer in your own words |
| **Asked you** | Answer the question |
| **Ready to review** | Look at what it made (the links are listed on the task) and say what to change, or close it |
| **Stuck** | The session cannot go on without you; it says why |
| **Finished** | The work is done: close the task, or ask for more |

Pictures an update attaches, such as screenshots, show as thumbnails: click one to see it large
(Escape closes it), or on the iPhone tap it and pinch to zoom.

Whatever you type in the reply box goes to the session. If the session has ended, your reply
starts a new one in the same worktree, which picks up where the last one left off. Paste, drop or
attach files with it; on the iPhone, the + button offers Paste Image when you have copied one.

A new task needs only what needs doing: write it, paste or drop files in, and Autopilot names it.
The first line stands in as its title for a moment. Left on **Automatic**, it goes to the
workstream it fits best, never the inbox.

At the top of a task:

- **Start** begins a session on a new task.
- **Open session** opens the Claude Code session: in Claude on this Mac, or through Remote
  Control in the browser or on your phone. Pick one once; the button remembers.
- **Snooze** puts the task away: for an hour or three, until this evening, tomorrow morning,
  Monday morning or a week from now. It comes back as your turn.
- **Done** closes it. **Not for me** (under ⋯) closes it as not yours. On a task nobody started,
  that tells the routing review the signal should not have filed it.

### Sessions

Each session runs in its own worktree, on a branch named after the task (`claude/ap-12`), in the
repository its workstream or brief points to. Sessions run in a separate background process, so
restarting or updating Autopilot does not stop them, and their Remote Control links keep working.

When a session opens a pull request on GitHub, Autopilot turns on Claude Code's **Auto-fix** for
it (`/autofix-pr`): a cloud session watches its checks and reviews and pushes fixes, and it never
merges. It needs the Claude GitHub App on the repository. The task's timeline says when Auto-fix
went on. To stop it, set **Auto-fix** to Off in the task's properties (it shows once a pull
request is linked); Autopilot then stops it on each of the task's pull requests.

Every linked pull request also gets a watcher for what Auto-fix does not tell Autopilot: once it
merges, the task closes; once it is approved and green, the task asks you to merge ("merge it"
and the session does); when it is stuck where Auto-fix does not reach (conflicts, nobody
reviewing), the session is woken to sort it out. Tell a session "merge when ready" and it merges
without asking again. A task whose ticket closes stays open until its pull request merges.
Watchers read with the tools your signals use, through your connectors; with no signals at all
they cannot read, and Autopilot says so.

A session lives until its task closes. While it is idle, waiting on you, it takes up none of your
parallel slots. If you open a session that has ended, Autopilot brings back the same conversation
with Remote Control, so it never opens as archived.

## Keys on the Mac

| Keys | Does |
| --- | --- |
| ⌘N, or ⌃⌥Space from any app | New task (text you have selected becomes the brief) |
| ⌘F | Search |
| ⌘1 to ⌘5 | The tabs, in order |
| ↑ ↓ (or j k in the list) | The previous or next task |
| ⌥1 to ⌥9 | Pick one of the first nine tasks (hold ⌥ to see the numbers) |
| Space | Open a row in place and answer it without opening the task |
| Return | Open the selected task |
| ⌘ with an arrow, from an empty reply box | The previous or next task without leaving the box |

## The iPhone

The iPhone app shows the same queue and works offline: answers, replies and new tasks made while
your Mac is out of reach wait on the phone and send when it is back.

Notifications, on the Mac and the iPhone, are for news only: a task back from waiting on someone
or from a snooze, and a new task a signal filed. A session handing over is not news, and nothing is
announced for a task you have open on the Mac or in front of you on the phone.

### Pairing

The phone reaches your Mac over [Tailscale](https://tailscale.com), at home and away, with no
router setup.

1. Install Tailscale on the Mac and the iPhone, and sign in to **the same account** on both.
2. On the iPhone, in Tailscale's settings (tap your account badge), turn on **VPN On Demand**, so
   the connection is there whenever the app needs it.
3. On the Mac: **Settings → Devices → Pair a device**. Scan the code with the Autopilot app.

The app ticks each step off as it sees it done. The connection is pinned to your Mac's own
certificate, so nothing else can stand in for it.

### Getting around

- The tabs sit at the bottom, near your thumb; the search bar folds into the bottom bar beside New.
- On a task, Open session (or Start), Done and Snooze are at the top. The arrows at the bottom
  step through the list.
- The gear holds the grouping, which Mac you are paired with, and Unpair.
- On an iPhone Duo, everything follows the system bar: folded or open, portrait or landscape, and
  either side of Split View. Open in landscape, the list and the task sit side by side.

## When something is off

| What you see | Try |
| --- | --- |
| A source stops filing | Set up shows a health dot on it; open it to see the error and preview again |
| A task went to the wrong workstream | Move it. The nightly routing review proposes a fix from your corrections |
| The phone says it cannot reach the Mac | Check that Tailscale is connected on both and signed in to the same account |
| A session does not answer | Open session and look at it; `autopilot show AP-12` in a terminal shows the task |
| Anything else | `~/Library/Application Support/Autopilot/logs/server.log` |
