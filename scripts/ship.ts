// Puts what is on main on this Mac: the server, the Mac app and the iPhone app.
//   node scripts/ship.ts                    what changed since the last ship (pnpm ship)
//   node scripts/ship.ts server mac phone   only these, changed or not
//   node scripts/ship.ts --auto             what launchd runs: quiet when nothing is new
//   node scripts/ship.ts install|uninstall  the launchd agent that ships whenever main moves
//   node scripts/ship.ts sim [pair|unpair]  the app in the iPhone Duo simulator, paired with this server
// It always builds from the main checkout (the one the server runs from), never from a worktree:
// it moves that checkout to origin/main first, replaying any commit of its own on top.
// docs/SHIPPING.md says when and why.
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

type Target = 'server' | 'mac' | 'phone'
const TARGETS: Target[] = ['server', 'mac', 'phone']

/** What each part is built from: a change under one of these ships it again. */
const SOURCES: Record<Target, string[]> = {
  server: ['apps/server', 'packages/contracts', 'prompts', 'plugin', 'pnpm-lock.yaml'],
  mac: ['apps/desktop', 'packages/contracts', 'packages/client', 'packages/design', 'pnpm-lock.yaml'],
  phone: ['apps/mobile', 'packages/contracts', 'packages/client', 'packages/design', 'pnpm-lock.yaml'],
}
/** What the generated native project is made from: a change here runs `expo prebuild` again. */
const NATIVE = ['apps/mobile/app.json', 'apps/mobile/package.json', 'apps/mobile/modules', 'pnpm-lock.yaml']

const DATA = join(homedir(), 'Library', 'Application Support', 'Autopilot')
const STATE = join(DATA, 'shipped.json')
const LOG = join(DATA, 'logs', 'ship.log')
const LOCK = join(DATA, 'ship.lock')
const AGENT = 'autopilot.ship'
const PLIST = join(homedir(), 'Library', 'LaunchAgents', `${AGENT}.plist`)
const SIMULATOR = 'iPhone Duo'
const XCODE = ['-workspace', 'Autopilot.xcworkspace', '-scheme', 'Autopilot', '-configuration', 'Release']

const args = process.argv.slice(2)
const auto = args.includes('--auto')

const log = (message: string) => {
  const line = `${new Date().toISOString()} ${message}`
  console.log(message)
  mkdirSync(dirname(LOG), { recursive: true })
  appendFileSync(LOG, `${line}\n`)
}

/**
 * Commands run without AUTOPILOT_TOKEN: a session Autopilot started has its own token there, which
 * may only touch its task, and `autopilot devices` or `status` need the owner's (read from its file).
 */
const env = (): NodeJS.ProcessEnv => {
  const { AUTOPILOT_TOKEN: _session, ...rest } = process.env
  return { ...rest, LANG: 'en_US.UTF-8' }
}

const run = (cwd: string, command: string, ...rest: string[]) =>
  execFileSync(command, rest, { cwd, env: env(), stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
    .toString()
    .trim()

/** Like `run`, with the output in the log rather than kept: for the long builds. */
const build = (cwd: string, command: string, ...rest: string[]) => {
  const result = spawnSync(command, rest, { cwd, env: env(), stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 })
  if (result.status !== 0) {
    appendFileSync(LOG, `${result.stdout.toString().slice(-20_000)}\n${result.stderr.toString().slice(-20_000)}\n`)
    throw new Error(`${command} ${rest[0] ?? ''} failed; the end of its output is in ${LOG}`)
  }
}

/** The Apple team and the iPhone, from ship.env beside the server's data (never in the repo). */
const settings = (): { team: string | null; iphone: string | null } => {
  const file = join(DATA, 'ship.env')
  const values = existsSync(file)
    ? Object.fromEntries(
        readFileSync(file, 'utf8')
          .split('\n')
          .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/))
          .flatMap((m) => (m?.[1] ? [[m[1], m[2] ?? '']] : [])),
      )
    : {}
  return { team: values.APPLE_TEAM || null, iphone: values.IPHONE_UDID || null }
}

/** The main checkout: the first worktree git lists, wherever this script is run from. */
const checkout = (): string => {
  const first = run(join(import.meta.dirname, '..'), 'git', 'worktree', 'list', '--porcelain').split('\n')[0] ?? ''
  return first.replace(/^worktree /, '')
}

const shipped = (): Partial<Record<Target, string>> =>
  existsSync(STATE) ? (JSON.parse(readFileSync(STATE, 'utf8')) as Partial<Record<Target, string>>) : {}

const markShipped = (target: Target, sha: string) => writeFileSync(STATE, JSON.stringify({ ...shipped(), [target]: sha }, null, 2))

const changedSince = (root: string, from: string | undefined, paths: string[]): boolean => {
  if (!from) return true
  try {
    return run(root, 'git', 'diff', '--name-only', from, 'HEAD', '--', ...paths) !== ''
  } catch {
    // A commit no longer there (history rewritten): ship it again.
    return true
  }
}

/** Moves the main checkout to origin/main, its own commits replayed on top. False when it cannot. */
const update = (root: string): boolean => {
  run(root, 'git', 'fetch', '--quiet', 'origin')
  if (run(root, 'git', 'status', '--porcelain', '--untracked-files=no') !== '') {
    log(`${root} has uncommitted changes; not shipping until they are committed or put away`)
    return false
  }
  if (run(root, 'git', 'rev-parse', '--abbrev-ref', 'HEAD') !== 'main') {
    log(`${root} is not on main; not shipping`)
    return false
  }
  try {
    run(root, 'git', 'rebase', 'origin/main')
  } catch {
    run(root, 'git', 'rebase', '--abort')
    log(`${root}: its own commits do not replay on origin/main; not shipping until that is sorted by hand`)
    return false
  }
  return true
}

const shipServer = (root: string) => {
  run(root, 'launchctl', 'kickstart', '-k', `gui/${process.getuid?.() ?? 501}/autopilot.server`)
  for (let i = 0; i < 60; i++) {
    try {
      run(root, 'node', 'apps/server/bin/autopilot.js', 'status')
      return
    } catch {
      execFileSync('sleep', ['1'])
    }
  }
  throw new Error('the server did not answer within a minute after restarting; see logs/server.log')
}

const shipMac = (root: string) => {
  spawnSync('osascript', ['-e', 'quit app "Autopilot"'])
  build(join(root, 'apps', 'desktop'), 'node', 'scripts/package.ts', '--install')
  spawnSync('open', [join(homedir(), 'Applications', 'Autopilot.app')])
}

/** The generated Xcode project, made when it is missing or (`stale`) what it is made from changed. */
const prebuild = (mobile: string, stale: boolean) => {
  if (existsSync(join(mobile, 'ios', 'Autopilot.xcworkspace')) && !stale) return
  build(mobile, 'npx', 'expo', 'prebuild', '--platform', 'ios', '--no-install')
  // A personal team cannot sign push notifications; local notifications need no entitlement.
  writeFileSync(
    join(mobile, 'ios', 'Autopilot', 'Autopilot.entitlements'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict/>\n</plist>\n',
  )
  build(join(mobile, 'ios'), 'pod', 'install')
}

/** Whether the iPhone answers now: by cable, or on a network that lets the Mac reach it. */
const phoneReachable = (iphone: string): boolean =>
  spawnSync('xcrun', ['devicectl', 'device', 'info', 'details', '--device', iphone], { env: env(), timeout: 20_000 }).status === 0

const shipPhone = (root: string, from: string | undefined, team: string, iphone: string) => {
  prebuild(join(root, 'apps', 'mobile'), changedSince(root, from, NATIVE))
  const ios = join(root, 'apps', 'mobile', 'ios')
  build(
    ios,
    'xcodebuild',
    ...XCODE,
    '-destination',
    'generic/platform=iOS',
    '-derivedDataPath',
    'build-device',
    '-allowProvisioningUpdates',
    `DEVELOPMENT_TEAM=${team}`,
    'CODE_SIGN_STYLE=Automatic',
    'build',
  )
  build(
    ios,
    'xcrun',
    'devicectl',
    'device',
    'install',
    'app',
    '--device',
    iphone,
    'build-device/Build/Products/Release-iphoneos/Autopilot.app',
  )
}

const notify = (message: string) => spawnSync('osascript', ['-e', `display notification ${JSON.stringify(message)} with title "Autopilot"`])

const ship = (only: Target[]) => {
  const root = checkout()
  if (!update(root)) {
    if (!auto) process.exitCode = 1
    return
  }
  const head = run(root, 'git', 'rev-parse', '--short', 'HEAD')
  const before = shipped()
  const { team, iphone } = settings()
  const due = (only.length > 0 ? only : TARGETS).filter((t) => only.length > 0 || changedSince(root, before[t], SOURCES[t]))
  if (due.length === 0) {
    if (!auto) log(`Everything is on ${head} already`)
    return
  }
  // The phone only when it can be reached and signed for; otherwise it stays due and the next run tries.
  const phoneReady = due.includes('phone') && team !== null && iphone !== null && phoneReachable(iphone)
  if (due.includes('phone') && !phoneReady) {
    if (!team || !iphone) log(`The phone is due, but ${join(DATA, 'ship.env')} has no APPLE_TEAM or IPHONE_UDID`)
    else if (!auto) log('The phone is due but not reachable: connect it by cable (or to a network the Mac can reach it on)')
  }
  const now = due.filter((t) => t !== 'phone' || phoneReady)
  if (now.length === 0) return
  log(`Shipping ${now.join(', ')} at ${head}`)
  build(root, 'pnpm', 'install', '--frozen-lockfile')
  const done: Target[] = []
  for (const target of now) {
    try {
      if (target === 'server') shipServer(root)
      if (target === 'mac') shipMac(root)
      if (target === 'phone' && team && iphone) shipPhone(root, before.phone, team, iphone)
      markShipped(target, head)
      done.push(target)
      log(`${target}: on ${head}`)
    } catch (error) {
      log(`${target}: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
    }
  }
  if (done.length > 0) notify(`Updated the ${done.join(', ')} to ${head}`)
}

/** Runs with one at a time: launchd may fire while a ship from the command line is building. */
const locked = (work: () => void) => {
  mkdirSync(DATA, { recursive: true })
  try {
    mkdirSync(LOCK)
  } catch {
    if (!auto) log(`Another ship is running (${LOCK}); try again when it is done`)
    return
  }
  try {
    work()
  } finally {
    rmSync(LOCK, { recursive: true, force: true })
  }
}

const sim = (step: string | undefined) => {
  const root = checkout()
  const autopilot = (...rest: string[]) => run(root, 'node', 'apps/server/bin/autopilot.js', ...rest)
  if (step === 'pair') {
    const link = autopilot('devices', 'pair', '--link')
    run(root, 'xcrun', 'simctl', 'openurl', SIMULATOR, link)
    log(`Paired ${SIMULATOR}; unpair with: pnpm sim unpair`)
    return
  }
  if (step === 'unpair') {
    const ids = autopilot('devices')
      .split('\n')
      .filter((l) => l.endsWith(SIMULATOR))
      .map((l) => l.split(/\s+/)[0] ?? '')
    for (const id of ids) autopilot('devices', 'remove', id)
    log(ids.length > 0 ? `Unpaired ${SIMULATOR}` : `${SIMULATOR} was not paired`)
    return
  }
  // From the checkout this is run in, so a worktree's own changes are what the simulator shows.
  const here = join(import.meta.dirname, '..')
  const mobile = join(here, 'apps', 'mobile')
  // Only when missing here: after changing app.json or a native module, delete apps/mobile/ios first.
  prebuild(mobile, false)
  spawnSync('xcrun', ['simctl', 'boot', SIMULATOR])
  spawnSync('open', ['-a', 'Simulator'])
  const ios = join(mobile, 'ios')
  build(
    ios,
    'xcodebuild',
    ...XCODE,
    '-sdk',
    'iphonesimulator',
    '-destination',
    `platform=iOS Simulator,name=${SIMULATOR}`,
    '-derivedDataPath',
    'build',
    'CODE_SIGN_IDENTITY=-',
    'CODE_SIGN_STYLE=Manual',
    'DEVELOPMENT_TEAM=',
    'build',
  )
  const app = join(ios, 'build', 'Build', 'Products', 'Release-iphonesimulator', 'Autopilot.app')
  run(ios, 'xcrun', 'simctl', 'install', SIMULATOR, app)
  run(ios, 'xcrun', 'simctl', 'launch', SIMULATOR, 'com.eddial.autopilot')
  log(`Running in ${SIMULATOR}; pair it with this server: pnpm sim pair`)
}

/** The launchd agent: ships when a push moves origin/main, and every five minutes for a phone plugged in late. */
const install = () => {
  const root = checkout()
  const common = run(root, 'git', 'rev-parse', '--path-format=absolute', '--git-common-dir')
  const path = [
    dirname(process.execPath),
    dirname(run(root, 'which', 'pnpm')),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ]
  mkdirSync(dirname(PLIST), { recursive: true })
  writeFileSync(
    PLIST,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${AGENT}</string>
  <key>ProgramArguments</key>
  <array><string>${process.execPath}</string><string>${join(root, 'scripts', 'ship.ts')}</string><string>--auto</string></array>
  <key>WorkingDirectory</key><string>${root}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${[...new Set(path)].join(':')}</string></dict>
  <key>WatchPaths</key><array><string>${join(common, 'refs', 'remotes', 'origin', 'main')}</string><string>${join(common, 'packed-refs')}</string></array>
  <key>StartInterval</key><integer>300</integer>
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>${join(DATA, 'logs', 'ship.err.log')}</string>
</dict>
</plist>
`,
  )
  spawnSync('launchctl', ['bootout', `gui/${process.getuid?.() ?? 501}/${AGENT}`])
  run(root, 'launchctl', 'bootstrap', `gui/${process.getuid?.() ?? 501}`, PLIST)
  log(`Installed ${AGENT}: it ships whenever origin/main moves, and tries a due phone every five minutes`)
}

const uninstall = () => {
  spawnSync('launchctl', ['bootout', `gui/${process.getuid?.() ?? 501}/${AGENT}`])
  rmSync(PLIST, { force: true })
  log(`Removed ${AGENT}`)
}

const [command, ...rest] = args.filter((a) => a !== '--auto')
if (command === 'install') install()
else if (command === 'uninstall') uninstall()
else if (command === 'sim') sim(rest[0])
else {
  const only = [command, ...rest].filter((a): a is Target => TARGETS.includes(a as Target))
  locked(() => ship(only))
}
