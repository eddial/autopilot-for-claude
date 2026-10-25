import { describe, expect, it } from 'vitest'
import { activityOf } from '../src/activity.ts'

describe('what a running session is doing', () => {
  it('says it in a few plain words from the tool it is about to use', () => {
    expect(activityOf('Read', { file_path: '/repo/apps/server/src/launcher.ts' })).toBe('Reading launcher.ts')
    expect(activityOf('Bash', { command: 'git commit -m x', description: 'Commit the note' })).toBe('Commit the note')
    expect(activityOf('WebSearch', { query: 'WorkOS Directory Sync pricing per connection' })).toBe(
      'Searching the web for “WorkOS Directory Sync pricing per connec…”',
    )
    expect(activityOf('mcp__claude_ai_Slack__slack_read_thread', {})).toBe('Using Slack')
    expect(activityOf('mcp__autopilot__post_update', {})).toBe('Writing the handover')
  })
})
