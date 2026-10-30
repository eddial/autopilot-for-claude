# Shipping to this Mac and the iPhone

How a change gets from main onto the owner's Mac and iPhone, and how a session runs the app in the
simulator. For sessions: read this before saying a change is live.

## Pushing is shipping

Push to main (after `pnpm check` passes; see `CLAUDE.md`). The `autopilot.ship` launchd agent
sees origin/main move and ships what changed, by itself, within seconds:

| Part | Shipped when a commit touches | How |
| --- | --- | --- |
| Server | `apps/server`, `packages/contracts`, `prompts`, `plugin` | restarts `autopilot.server`; sessions keep running (they live in `autopilot.sessions`) |
| Mac app | `apps/desktop`, `packages/{contracts,client,design}` | quits Autopilot.app, packages and installs it to `~/Applications`, opens it |
| iPhone | `apps/mobile`, `packages/{contracts,client,design}` | builds and installs it when the phone can be reached: by cable, or a network the Mac reaches it on |

`pnpm-lock.yaml` ships all three. A phone that cannot be reached stays due; the agent tries again
every five minutes, so plugging it in is enough. A macOS notification says what was updated.

Everything is built from the **main checkout** (`~/Sites/autopilot-for-claude`, the one the server
runs from), never from a worktree. The ship first moves it to origin/main and replays any commit
of its own on top. It stops, and says so in the log, when that checkout has uncommitted changes,
is not on main, or its commits do not replay cleanly.

So a session does not restart the server or reinstall an app itself: it pushes, and the agent
does it. To ship by hand (the agent is off, or to force a part):

```sh
pnpm ship                   # what changed since the last ship
pnpm ship server mac phone  # these, changed or not
```

What happened is in `~/Library/Application Support/Autopilot/logs/ship.log`; what was shipped at
which commit in `shipped.json` beside it.

## Settings

`~/Library/Application Support/Autopilot/ship.env`, personal to this Mac and never in the repo:

```sh
APPLE_TEAM=<team id>        # signs the iPhone app
IPHONE_UDID=<udid>          # xcrun devicectl list devices
```

The server's owner token is not in it: the scripts read it from `owner.token` in the same folder.

## The agent

```sh
node scripts/ship.ts install     # from the main checkout; again after moving Node or pnpm
node scripts/ship.ts uninstall
```

It runs `scripts/ship.ts --auto` when `refs/remotes/origin/main` changes (a push from any worktree
or a fetch) and every five minutes.

## The simulator

```sh
pnpm sim            # builds this checkout's app and runs it in the iPhone Duo simulator
pnpm sim pair       # pairs it with the running server, for real data; tap Open in the dialog iOS shows
pnpm sim unpair     # always, when done
```

`pnpm sim` builds the checkout it is run in, so a worktree's changes are what it shows. It makes
`apps/mobile/ios` (with `expo prebuild`) only when it is missing; after changing `app.json` or a
native module, delete that folder first. How to fold, turn and test every pose:
`.claude/skills/building-for-the-duo/SKILL.md`.

**The token.** A session Autopilot started has `AUTOPILOT_TOKEN` set to its own session token,
which may only touch its own task, so `autopilot devices pair` from that session is refused. The
scripts drop it and use the owner's token. Running the CLI by hand from such a session, do the same:
`env -u AUTOPILOT_TOKEN pnpm autopilot devices`.

## When it goes wrong

- **Nothing shipped**: `tail ~/Library/Application\ Support/Autopilot/logs/ship.log`, and
  `launchctl print gui/$(id -u)/autopilot.ship` for whether the agent runs.
- **The main checkout is stuck** (uncommitted changes, a commit that does not replay): sort it out
  there by hand, never with `--force` or `reset --hard` without the owner's yes.
- **The phone build fails on signing**: open `apps/mobile/ios/Autopilot.xcworkspace` in Xcode once
  with the phone connected, and trust the developer on the phone (Settings, General, VPN & Device
  Management).
- **The Mac app will not start the server**: its packaged Node is the one `pnpm ship` ran with.
