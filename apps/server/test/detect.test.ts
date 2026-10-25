import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeInit, connectorsOf, keepFor } from '../src/detect.ts'

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

  it('asks Claude Code once in five minutes, and again after a failure', async () => {
    let clock = 0
    let asked = 0
    let fail = true
    const detect = keepFor(
      5 * 60_000,
      () => {
        asked++
        return fail ? Promise.reject(new Error('no')) : Promise.resolve(asked)
      },
      () => clock,
    )
    await expect(detect()).rejects.toThrow('no')
    fail = false
    expect(await Promise.all([detect(), detect()])).toEqual([2, 2])
    clock += 4 * 60_000
    expect(await detect()).toBe(2)
    clock += 2 * 60_000
    expect(await detect()).toBe(3)
  })
})
