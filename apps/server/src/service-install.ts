import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, platform, userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import type { Paths } from './paths.ts'

export const LABEL = 'autopilot.server'
/** The session host: the terminals sessions run in, so restarting the server stops none of them. */
export const HOST_LABEL = 'autopilot.sessions'

const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/**
 * The launchd agent that keeps the server running in your user session, so it has your Keychain,
 * your Claude login with its connectors, and `gh`. Cron cannot do that, which is why the Linear
 * version needed a LaunchAgent too.
 */
export const launchAgentPlist = (o: {
  node: string
  script: string
  paths: Paths
  path: string
  label?: string
  command?: string
  log?: string
}): string => {
  const env: Record<string, string> = {
    PATH: o.path,
    AUTOPILOT_DATA: o.paths.data,
    AUTOPILOT_HOME: o.paths.home,
    AUTOPILOT_SOCKET: o.paths.socket,
  }
  const strings = (values: string[]) => values.map((v) => `    <string>${escape(v)}</string>`).join('\n')
  const dict = Object.entries(env)
    .map(([k, v]) => `    <key>${k}</key><string>${escape(v)}</string>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${o.label ?? LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${strings([o.node, o.script, o.command ?? 'serve'])}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${dict}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>${escape(join(o.paths.logs, o.log ?? 'server.log'))}</string>
  <key>StandardErrorPath</key><string>${escape(join(o.paths.logs, o.log ?? 'server.log'))}</string>
</dict>
</plist>
`
}

const plistFile = (label = LABEL) => join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`)

/** The PATH the agent runs with: this Node, Homebrew, and where `claude` and `gh` usually live. */
const agentPath = (node: string) =>
  [
    dirname(node),
    join(homedir(), '.local', 'bin'),
    join(homedir(), '.claude', 'local'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ]
    .filter((p, i, all) => all.indexOf(p) === i)
    .join(':')

/** Loads one agent, replacing the one already loaded under its label. */
const load = (file: string, plist: string) => {
  const domain = `gui/${userInfo().uid}`
  if (existsSync(file)) {
    try {
      execFileSync('launchctl', ['bootout', domain, file], { stdio: 'ignore' })
    } catch {
      // Not loaded yet.
    }
  }
  writeFileSync(file, plist)
  execFileSync('launchctl', ['bootstrap', domain, file])
}

/**
 * Two agents: the server, and the session host its sessions run in. Reinstalling replaces the
 * server; the host, already running, is left alone so no session stops.
 */
export const installService = (o: { node: string; script: string; paths: Paths }): string => {
  if (platform() !== 'darwin') {
    return 'Install as a service is for macOS for now; run `autopilot serve` under your own supervisor.'
  }
  const file = plistFile()
  mkdirSync(dirname(file), { recursive: true })
  mkdirSync(o.paths.logs, { recursive: true, mode: 0o700 })
  const path = agentPath(o.node)
  const hostFile = plistFile(HOST_LABEL)
  const host = launchAgentPlist({ ...o, path, label: HOST_LABEL, command: 'session-host', log: 'sessions.log' })
  if (!existsSync(hostFile) || readFileSync(hostFile, 'utf8') !== host) load(hostFile, host)
  load(file, launchAgentPlist({ ...o, path }))
  return `Installed ${file} and ${hostFile}. The server and its sessions start at login and keep running; logs in ${o.paths.logs}.`
}

/** Removes both agents; stopping the session host ends its sessions. */
export const uninstallService = (): string => {
  const removed = [LABEL, HOST_LABEL].flatMap((label) => {
    const file = plistFile(label)
    if (!existsSync(file)) return []
    try {
      execFileSync('launchctl', ['bootout', `gui/${userInfo().uid}`, file], { stdio: 'ignore' })
    } catch {
      // Already stopped.
    }
    rmSync(file)
    return [file]
  })
  return removed.length ? `Removed ${removed.join(' and ')}.` : 'Not installed.'
}
