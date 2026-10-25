import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeInit, connectorsOf } from '../src/detect.ts'

describe('connector detection', () => {
  it('reads the connectors from the init event and stops Claude Code before it calls the model', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ap-detect-'))
    const claude = join(dir, 'claude')
    const init = {
      type: 'system',
      subtype: 'init',
      mcp_servers: [
        { name: 'claude.ai Slack', status: 'connected' },
        { name: 'claude.ai Gmail', status: 'needs-auth' },
        { name: 'autopilot', status: 'connected' },
      ],
      tools: ['Read', 'mcp__claude_ai_Slack__slack_read_thread', 'mcp__claude_ai_Slack__slack_search_public'],
    }
    // It never exits by itself: detection has to stop it.
    writeFileSync(claude, `#!/bin/sh\ncat > /dev/null\necho '${JSON.stringify(init)}'\nexec sleep 30\n`)
    chmodSync(claude, 0o755)

    expect(connectorsOf(await claudeInit(claude))).toEqual([
      {
        name: 'claude.ai Slack',
        status: 'connected',
        tools: ['mcp__claude_ai_Slack__slack_read_thread', 'mcp__claude_ai_Slack__slack_search_public'],
        signal: 'slack',
      },
      { name: 'claude.ai Gmail', status: 'needs-auth', tools: [], signal: 'gmail' },
    ])
  })
})
