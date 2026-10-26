# Running it on your Mac

**First, the check.** `bash scripts/mac-check.sh` runs everything that cannot be checked in the
cloud, on a throwaway server of its own: the tests, pairing over your network, a real Claude Code
session asking and taking an answer, your connectors and a signal preview, the Mac app, and the
iPhone build. It writes a report (tokens taken out) and pushes it to the `mac-report` branch.
`--no-ios`, `--no-claude` and `--no-push` leave parts out.

Phase 1a: the server and the `autopilot` command-line tool. No app yet. It runs next to the Linear
version without touching it.

## Set up

```sh
git clone https://github.com/eddial/autopilot-for-claude ~/autopilot-for-claude
cd ~/autopilot-for-claude
nvm use            # Node 24
pnpm install
alias autopilot="node $PWD/apps/server/bin/autopilot.js"
```

Your config lives in `~/Library/Application Support/Autopilot/home/`, in the same format as the
Linear version's `home/` (`examples/home/` has a starting set). Copy over the workstreams you want
and the Slack signal:

```sh
H="$HOME/Library/Application Support/Autopilot/home"
mkdir -p "$H/workstreams" "$H/signals"
cp ~/autopilot/home/workstreams/<name>.md "$H/workstreams/"   # one or more
cp ~/autopilot/home/signals/slack.md "$H/signals/"
```

Leave the Linear version's own Slack signal running until the checks below pass, then pause it
there.

## Start the server

In the foreground first, to watch it:

```sh
autopilot serve
```

When you are happy, keep it running in the background (it starts at login):

```sh
autopilot service install
```

## Check 1 · a session writes back, also through Remote Control

This is the one thing that cannot be tested in the cloud: a real Claude Code session using the
Autopilot tools while you steer it from your phone.

```sh
autopilot new "Ask me which emoji to put in a test note, as a decision with three options"
```

1. A session starts. Open the Claude app on your iPhone: it appears under Remote Control, named
   `AP-1 …`.
2. Within a minute `autopilot ls` shows AP-1 on your turn with the decision, and `autopilot show
   AP-1` lists the options. That means the session reached `post_update` through the Autopilot
   MCP server.
3. On the phone, type something into the session ("make it a haiku too"). Claude should answer and
   post a new update. That means the tools still work while steered through Remote Control.
4. Answer from the Mac: `autopilot answer AP-1 <option id>`. The answer appears in the session once
   it is idle (watch it on the phone), and the session posts `done`.

If step 2 never happens, run `autopilot show AP-1` and look at
`~/Library/Application Support/Autopilot/logs/server.log`.

## Check 2 · Slack files tasks

```sh
autopilot signal slack --dry 60     # what the last hour would have filed; files nothing
```

If the preview looks right, the signal runs by itself every few minutes from now on (the first run
only marks where to start). `autopilot status` shows its health; `autopilot ls` the queue.

## The Mac app

```sh
pnpm install          # downloads Electron the first time
pnpm desktop          # builds and opens the app; it starts the server if it is not running
```

The app lives in the menu bar with the Your turn count. ⌘N or ⌃⌥Space opens New task from
anywhere. **Set up** in the sidebar walks through onboarding: it checks Claude Code, reads your
Claude connectors, adds the signals you pick from `examples/home/`, previews yesterday, saves your
workstreams and switches the signals on. Prefer it over copying files by hand.

## The iPhone

The app has native code (pinned TLS), so it runs as a development build, not in Expo Go. With
Xcode and the iPhone connected by cable, a free Apple account is enough for your own phone (the
build expires after seven days):

```sh
cd apps/mobile
npx expo run:ios --device     # builds with Xcode and installs on the phone
```

With the paid developer account, `eas build --profile production` and `eas submit` put it on
TestFlight instead.

Pair it: on the Mac, Settings → Devices → Pair a device, which walks through it. The phone reaches
the Mac over Tailscale only, at home and away: install Tailscale on both (free), sign in with the
same account, and turn on VPN On Demand on the phone. Then scan the code with the app. Answers,
replies and new tasks made while the Mac is out of reach wait on the phone and arrive when it is
back.

## A MacBook using an always-on Mac

Set up Autopilot on the Mac mini as above (`autopilot service install` keeps it running). On the
Mac mini: Settings → Devices → Pair a device → Copy invite for a Mac. Send yourself the text, and
on the MacBook: Settings → Devices → This app → paste → Use that Mac. Both Macs need Tailscale,
signed in to the same account. "Use this Mac instead" switches back.

## Moving from Linear

Bring the open tickets assigned to you across once, then let the Linear signal keep them current.

1. Add the Linear signal in Set up (or copy `examples/home/signals/linear.md` into
   `~/autopilot/signals/`), with the tool names `autopilot connectors` shows for your Linear
   connector.
2. Preview: `autopilot import linear --dry` lists each open ticket and the workstream it would go
   to. Nothing is filed. If the routing is off, adjust the workstream files and preview again.
3. Import: `autopilot import linear`. Each open ticket becomes a task in New, linked to the ticket
   and mirroring it, so commits and PRs keep naming the ticket. Imported tasks skip the first
   look; they bring their own context. Running it again files nothing new.
4. Resume the Linear signal (Signals → Resume). From then on new assignments and comments arrive by
   themselves, and a ticket closed in Linear closes its task.

## Where sessions work

A session works in a folder, and it is always a git repository:

1. The workstream's `repo:` (a checkout; `repo: default` is the default checkout below): each
   task gets a worktree of it, on a branch named after the task.
2. Else, when the task names a GitHub repository (a pull request, an issue, a link in its brief),
   a worktree of that repository's checkout on this Mac, found by its remote.
3. Else the task's own folder in `~/Library/Application Support/Autopilot/work/`, made a git
   repository so its drafts have history.

`home/checkouts.yaml` says where your checkouts are and which one is the default
(`examples/home/checkouts.yaml` explains both). Without it, the usual places (`~/Sites`, `~/code`,
`~/dev` and the like) are searched.

## Everyday commands

| Command | Does |
| --- | --- |
| `autopilot ls` | The queue, by whose turn it is |
| `autopilot show AP-3` | A task with its updates |
| `autopilot answer AP-3 opus` | Answer the open decision (option id or label) or question (text) |
| `autopilot new "…" --save` | A task in New, without starting a session |
| `autopilot token "Claude Desktop" read` | A token for another agent; add `autopilot mcp` with `AUTOPILOT_TOKEN` to its MCP config |
| `autopilot service uninstall` | Stop the background server |

## The iPhone Duo simulator

`simctl` cannot fold the Duo. `apps/mobile/scripts/duo.sh outer|inner [portrait|landscape-left|landscape-right]`
sends the same hinge and orientation events as Device Hub's controls. For split view, long-press
Autopilot on the inner Home Screen and choose Open in Split View; the app opens on the left.
