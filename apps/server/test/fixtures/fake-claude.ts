// Stands in for `claude` in the end-to-end test. It behaves like a session that works a task:
// it reads the MCP config and hooks the launcher wrote, posts a decision through the real
// `autopilot mcp` bridge, waits for the answer the launcher pastes in, and reports done.
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const arg = (name: string) => process.argv[process.argv.indexOf(name) + 1] ?? ''
const config = JSON.parse(readFileSync(arg('--mcp-config'), 'utf8')) as {
  mcpServers: { autopilot: { command: string; args: string[]; env: Record<string, string> } }
}
const settings = JSON.parse(readFileSync(arg('--settings'), 'utf8')) as {
  hooks: Record<string, { hooks: { command: string }[] }[]>
}
const hook = (event: string) =>
  execSync(settings.hooks[event]?.[0]?.hooks[0]?.command ?? 'true', { input: '{}', env: process.env, stdio: ['pipe', 'ignore', 'inherit'] })

const server = config.mcpServers.autopilot
const mcp = new Client({ name: 'fake-claude', version: '1.0.0' })
await mcp.connect(
  new StdioClientTransport({ command: server.command, args: server.args, env: { ...(process.env as Record<string, string>), ...server.env } }),
)
const taskId = process.env.AUTOPILOT_TASK ?? ''

console.log('Remote Control: https://claude.ai/code/session_fake123')
hook('UserPromptSubmit')
await mcp.callTool({
  name: 'post_update',
  arguments: {
    taskId,
    kind: 'decision',
    body: 'Enable caching for Opus only, or every model?',
    options: [
      { id: 'opus', label: 'Opus only' },
      { id: 'all', label: 'Every model' },
    ],
  },
})
hook('Stop')

process.stdin.setRawMode(true)
let input = ''
process.stdin.on('data', (data: Buffer) => {
  input += data.toString()
  // The paste ends with the bracketed-paste marker and Enter (\r, or \n if the answer arrived before raw mode).
  const end = input.indexOf('\u001b[201~')
  if (end === -1 || !/[\r\n]/.test(input.slice(end + 6))) return
  process.stdin.pause()
  void (async () => {
    hook('UserPromptSubmit')
    const picked = input.includes('Opus only') ? 'Opus only' : 'unknown'
    await mcp.callTool({ name: 'post_update', arguments: { taskId, kind: 'done', body: `Enabled for ${picked}.` } })
    hook('Stop')
    await mcp.close()
    process.exit(0)
  })()
})
