#!/usr/bin/env bash
# Everything that cannot be checked in the cloud, on your Mac, in one go. It uses its own server,
# data folder and port, so your real Autopilot (if any) is not touched. Each part is recorded in a
# report; the report has tokens and personal paths taken out, and is pushed to the `mac-report`
# branch so it can be read from there. Run from the repository root: bash scripts/mac-check.sh
#
#   --no-ios      skip the iPhone build (it takes ten minutes or more the first time)
#   --no-claude   skip the parts that run real Claude Code (they cost a few cents)
#   --no-push     keep the report local
set -uo pipefail

IOS=1 CLAUDE=1 PUSH=1
for arg in "$@"; do
  case "$arg" in
    --no-ios) IOS=0 ;;
    --no-claude) CLAUDE=0 ;;
    --no-push) PUSH=0 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
STAMP="$(date +%Y%m%d-%H%M%S)"
# The real path: on macOS /tmp is /private/tmp, and Claude Code trusts folders by their real path.
WORK="$(cd "$(mktemp -d /tmp/apcheck.XXXX)" && pwd -P)"
REPORT="$WORK/report.md"
export AUTOPILOT_DATA="$WORK/data"
export AUTOPILOT_SOCKET="$WORK/s.sock"
export AUTOPILOT_DEVICE_PORT=7399
SERVER_PID=""

log() { printf '%s\n' "$*" | tee -a "$REPORT"; }
section() { log ""; log "## $1"; log ""; echo "▸ $1" >&2; }
# Runs a command, records its last lines and whether it passed.
record() {
  local name="$1"; shift
  local out="$WORK/$(echo "$name" | tr -c 'a-zA-Z0-9' '-').log"
  local started=$SECONDS
  if "$@" >"$out" 2>&1; then
    log "- PASS $name ($((SECONDS - started)) s)"
  else
    log "- FAIL $name ($((SECONDS - started)) s), last lines:"
    log '```'
    tail -40 "$out" | tee -a "$REPORT" >/dev/null
    log '```'
  fi
}
cleanup() {
  if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null; fi
}
trap cleanup EXIT

log "# Autopilot Mac check, $STAMP"
log ""
log "Commit $(git rev-parse --short HEAD) on $(git rev-parse --abbrev-ref HEAD)."

section "This Mac"
log "- macOS $(sw_vers -productVersion 2>/dev/null) on $(uname -m)"
log "- Node $(node -v 2>/dev/null || echo missing), pnpm $(pnpm -v 2>/dev/null || echo missing)"
log "- Claude Code $(claude --version 2>/dev/null || echo 'not found on PATH')"
log "- GitHub CLI: $(gh auth status >/dev/null 2>&1 && echo 'signed in' || echo 'not signed in or not installed')"
log "- Xcode: $(xcodebuild -version 2>/dev/null | head -1 || echo 'not installed')"
log "- Tailscale: $( (tailscale ip -4 2>/dev/null || /Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4 2>/dev/null) | head -1 | sed 's/^/address /' || true)"
log "- Real Autopilot server running: $(pgrep -f 'autopilot.js serve' >/dev/null && echo yes || echo no)"

NODE_MAJOR="$(node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/')"
if [ "${NODE_MAJOR:-0}" -lt 24 ]; then
  log ""
  log "Node 24 or newer is needed (found $(node -v 2>/dev/null || echo none)). With Homebrew: brew install node@24; with nvm: nvm install 24."
  exit 1
fi
command -v pnpm >/dev/null || { corepack enable 2>/dev/null || npm install -g pnpm@10; }

section "Build and tests"
record "pnpm install" pnpm install --frozen-lockfile
# The window's tests drive it in a headless Chromium (about 100 MB, once).
record "Chromium for the window's tests" pnpm --filter @autopilot/desktop exec playwright-core install chromium-headless-shell
record "lint, typecheck and tests (pnpm check)" pnpm check

section "The check server"
node apps/server/bin/autopilot.js serve >"$WORK/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 50); do [ -S "$AUTOPILOT_SOCKET" ] && break; sleep 0.2; done
if [ -S "$AUTOPILOT_SOCKET" ]; then log "- PASS started in $AUTOPILOT_DATA"; else log "- FAIL the server did not start"; fi

section "Pairing over the real network"
node scripts/checks/devices.ts >>"$REPORT" 2>&1 || true

if [ "$CLAUDE" = 1 ]; then
  section "Real Claude Code"
  node scripts/checks/real-claude.ts >>"$REPORT" 2>&1 || true
  node scripts/checks/signals.ts >>"$REPORT" 2>&1 || true
fi

section "The Mac app"
record "build" pnpm --filter @autopilot/desktop build
record "launch: the window goes live on the server" bash -c "cd apps/desktop && AUTOPILOT_SMOKE=1 npx electron ."

if [ "$IOS" = 1 ]; then
  section "The iPhone app"
  if xcodebuild -version >/dev/null 2>&1; then
    record "generate the native project" bash -c "cd apps/mobile && CI=1 npx expo prebuild --platform ios --clean"
    record "build for the simulator" bash -c "cd apps/mobile/ios && xcodebuild -workspace Autopilot.xcworkspace -scheme Autopilot -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build"
  else
    log "- SKIPPED Xcode is not installed (App Store → Xcode, then run this again)"
  fi
fi

section "Server log (last 80 lines)"
cleanup; SERVER_PID=""
log '```'
tail -80 "$WORK/server.log" >>"$REPORT"
log '```'

# Tokens, codes and your home folder's name stay out of the report.
sed -i '' -E -e 's/ap_[a-z]+_[A-Za-z0-9_-]{10,}/ap_…/g' -e "s#$HOME#~#g" "$REPORT"

echo ""
echo "Report: $REPORT"
grep -E '^- (PASS|FAIL|SKIPPED)' "$REPORT" | sed 's/^/  /'

if [ "$PUSH" = 1 ]; then
  PUSHDIR="$(mktemp -d /tmp/apreport.XXXX)"
  cp "$REPORT" "$PUSHDIR/report-$STAMP.md"
  (
    cd "$PUSHDIR" && git init -q && git checkout -q -b mac-report && git add . &&
      git -c user.name="$(git -C "$ROOT" config user.name || echo mac-check)" -c user.email="$(git -C "$ROOT" config user.email || echo mac-check@localhost)" \
        commit -q -m "Mac check $STAMP" &&
      git push -q --force "$(git -C "$ROOT" remote get-url origin)" mac-report
  ) && echo "Pushed to the mac-report branch." || echo "Could not push the report; send $REPORT instead."
fi
