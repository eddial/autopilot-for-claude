import type { Update } from '@autopilot/contracts'
import { describe, expect, it } from 'vitest'
import { linkSource, updateLabel, updateTone } from '../src/present.ts'

const decision = (open: boolean): Update => ({
  id: 'u1',
  taskId: 'AP-1',
  kind: 'decision',
  body: 'Opus only, or every model?',
  options: [{ id: 'opus', label: 'Opus only' }],
  waitingOn: null,
  attachments: [],
  author: 'session',
  answers: null,
  open,
  createdAt: '2026-10-25T10:00:00Z',
})

describe('how updates read', () => {
  it('shows an open ask as a call to act, and an answered one as history', () => {
    expect([updateLabel(decision(true)), updateTone(decision(true))]).toEqual(['Needs your decision', 'pilot'])
    expect([updateLabel(decision(false)), updateTone(decision(false))]).toEqual(['Asked for a decision', 'quiet'])
  })
  it('names where a link goes', () => {
    expect(
      [
        'https://mail.google.com/mail/u/0/#drafts/1',
        'https://acme.slack.com/archives/C1/p1',
        'file:///Users/b/plan.md',
        'https://www.example.com/a',
      ].map(linkSource),
    ).toEqual(['Gmail', 'Slack', 'File', 'example.com'])
  })
})
