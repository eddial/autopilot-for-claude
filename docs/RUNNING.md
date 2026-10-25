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

Pair it: on the Mac, Servers → Pair a device, then scan the code with the app. The phone needs
the same Wi-Fi as the Mac, or Tailscale on both (free; sign in with the same account and turn on
VPN On Demand on the phone). Answers, replies and new tasks made while the Mac is out of reach
wait on the phone and arrive when it is back.

## A MacBook using an always-on Mac

Set up Autopilot on the Mac mini as above (`autopilot service install` keeps it running). On the
Mac mini: Servers → Pair a device → Copy invite for a Mac. Send yourself the text, and on the
MacBook: Servers → This app → paste → Use that Mac. Both Macs must be on the same network or
Tailscale. "Use this Mac instead" switches back.

## Everyday commands

| Command | Does |
| --- | --- |
| `autopilot ls` | The queue, by whose turn it is |
| `autopilot show AP-3` | A task with its updates |
| `autopilot answer AP-3 opus` | Answer the open decision (option id or label) or question (text) |
| `autopilot new "…" --save` | A task in New, without starting a session |
| `autopilot token "Claude Desktop" read` | A token for another agent; add `autopilot mcp` with `AUTOPILOT_TOKEN` to its MCP config |
| `autopilot service uninstall` | Stop the background server |
