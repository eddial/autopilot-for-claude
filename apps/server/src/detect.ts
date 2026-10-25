import { execFile, spawn } from 'node:child_process'
import type { Connector, Detected } from '@autopilot/contracts'

/** Example signals in `examples/home/signals/` and the connector each reads. */
const SIGNALS: [RegExp, string][] = [
  [/slack/i, 'slack'],
  [/gmail/i, 'gmail'],
  [/linear/i, 'linear'],
  [/fathom/i, 'fathom'],
]

type Init = { mcp_servers?: { name: string; status: string }[]; tools?: string[] }

/**
 * Starts Claude Code headless and stops it at its init event, which lists the MCP servers
 * (claude.ai connectors included) and their tools, before any model call is made.
 */
export const claudeInit = (claude: string, timeoutMs = 45_000): Promise<Init> =>
  new Promise((resolve, reject) => {
    const child = spawn(claude, ['-p', '--output-format', 'stream-json', '--verbose', '--max-turns', '1'], {
      env: { ...process.env, MCP_CONNECTION_NONBLOCKING: '0', CLAUDE_CODE_MCP_STARTUP_WAIT_MS: '30000' },
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Claude Code did not start within 45 seconds'))
    }, timeoutMs)
    let buffer = ''
    child.stdout.on('data', (d: Buffer) => {
      buffer += d.toString()
      for (const line of buffer.split('\n').slice(0, -1)) {
        try {
          const event = JSON.parse(line) as Init & { type?: string; subtype?: string }
          if (event.type === 'system' && event.subtype === 'init') {
            clearTimeout(timer)
            child.kill()
            resolve(event)
            return
          }
        } catch {
          // Not JSON; keep reading.
        }
      }
      buffer = buffer.slice(buffer.lastIndexOf('\n') + 1)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', () => {
      clearTimeout(timer)
      reject(new Error('Claude Code exited before reporting its tools'))
    })
    child.stdin.end('Reply with OK.')
  })

export const connectorsOf = (init: Init): Connector[] =>
  (init.mcp_servers ?? [])
    .filter((server) => server.name !== 'autopilot')
    .map((server) => {
      const prefix = `mcp__${server.name.replace(/[^A-Za-z0-9_-]/g, '_')}__`
      return {
        name: server.name,
        status: server.status,
        tools: (init.tools ?? []).filter((t) => t.startsWith(prefix)),
        signal: SIGNALS.find(([pattern]) => pattern.test(server.name))?.[1] ?? null,
      }
    })

/** `gh auth status` names the signed-in account; no `gh`, or not signed in, is not an error. */
export const githubCli = (): Promise<Detected['github']> =>
  new Promise((resolve) => {
    execFile('gh', ['auth', 'status'], { timeout: 10_000 }, (error, stdout, stderr) => {
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') return resolve({ cli: false, user: null })
      const user = /Logged in to github\.com (?:account|as) (\S+)/.exec(`${stdout}${stderr}`)?.[1] ?? null
      resolve({ cli: true, user })
    })
  })

export const detect = async (claude: string): Promise<Detected> => {
  const [init, github] = await Promise.all([claudeInit(claude), githubCli()])
  return { connectors: connectorsOf(init), github }
}

/**
 * Keeps an answer for `ms`: asking again within that time, or while the first ask is still going,
 * gets the same answer. A failure is not kept.
 */
export const keepFor = <T>(ms: number, get: () => Promise<T>, now: () => number = Date.now): (() => Promise<T>) => {
  let kept: { at: number; value: Promise<T> } | null = null
  return () => {
    if (kept && now() - kept.at < ms) return kept.value
    const value = get()
    const entry = { at: now(), value }
    kept = entry
    value.catch(() => {
      if (kept === entry) kept = null
    })
    return value
  }
}
