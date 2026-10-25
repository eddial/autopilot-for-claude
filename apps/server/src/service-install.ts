import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, platform, userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import type { Paths } from './paths.ts'

export const LABEL = 'autopilot.server'

const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/**
 * The launchd agent that keeps the server running in your user session, so it has your Keychain,
 * your Claude login with its connectors, and `gh`. Cron cannot do that, which is why the Linear
 * version needed a LaunchAgent too.
 */
export const launchAgentPlist = (o: { node: string; script: string; paths: Paths; path: string }): string => {
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
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${strings([o.node, o.script, 'serve'])}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${dict}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>${escape(join(o.paths.logs, 'server.log'))}</string>
  <key>StandardErrorPath</key><string>${escape(join(o.paths.logs, 'server.log'))}</string>
</dict>
</plist>
`
}

const plistFile = () => join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)

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

export const installService = (o: { node: string; script: string; paths: Paths }): string => {
  if (platform() !== 'darwin') {
    return 'Install as a service is for macOS for now; run `autopilot serve` under your own supervisor.'
  }
  const file = plistFile()
  mkdirSync(dirname(file), { recursive: true })
  mkdirSync(o.paths.logs, { recursive: true, mode: 0o700 })
  const domain = `gui/${userInfo().uid}`
  if (existsSync(file)) {
    try {
      execFileSync('launchctl', ['bootout', domain, file], { stdio: 'ignore' })
    } catch {
      // Not loaded yet.
    }
  }
  writeFileSync(file, launchAgentPlist({ ...o, path: agentPath(o.node) }))
  execFileSync('launchctl', ['bootstrap', domain, file])
  return `Installed ${file}. The server starts at login and keeps running; logs in ${join(o.paths.logs, 'server.log')}.`
}

export const uninstallService = (): string => {
  const file = plistFile()
  if (!existsSync(file)) return 'Not installed.'
  try {
    execFileSync('launchctl', ['bootout', `gui/${userInfo().uid}`, file], { stdio: 'ignore' })
  } catch {
    // Already stopped.
  }
  rmSync(file)
  return `Removed ${file}.`
}
