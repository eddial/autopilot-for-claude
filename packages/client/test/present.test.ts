import type { Update } from '@autopilot/contracts'
import { describe, expect, it } from 'vitest'
import { parseMarkdown } from '../src/markdown.ts'
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

/** A cell or line of plain text, as the parser gives it. */
const t = (text: string) => [{ kind: 'text', text }]

describe('markdown', () => {
  it('reads headings, lists and paragraphs, with bold, code and links inside a line', () => {
    expect(parseMarkdown('# Reply\n\nHi **Sofie**, see `docs`.\n\n- [Trust page](https://trust.example.com)\n- Two')).toEqual([
      { kind: 'heading', level: 1, inlines: [{ kind: 'text', text: 'Reply' }] },
      {
        kind: 'paragraph',
        lines: [
          [
            { kind: 'text', text: 'Hi ' },
            { kind: 'strong', text: 'Sofie' },
            { kind: 'text', text: ', see ' },
            { kind: 'code', text: 'docs' },
            { kind: 'text', text: '.' },
          ],
        ],
      },
      {
        kind: 'list',
        ordered: false,
        items: [[{ kind: 'link', text: 'Trust page', url: 'https://trust.example.com' }], [{ kind: 'text', text: 'Two' }]],
      },
    ])
  })

  it('reads a table under a paragraph, an empty corner cell and alignment included', () => {
    expect(parseMarkdown('Point 3 says:\n| | Paged | Repeats |\n|---|:---:|--:|\n| P0 | **call** | 3× |\n| P2 | Slack |')).toEqual([
      { kind: 'paragraph', lines: [t('Point 3 says:')] },
      {
        kind: 'table',
        align: ['left', 'center', 'right'],
        head: [[], t('Paged'), t('Repeats')],
        rows: [
          [t('P0'), [{ kind: 'strong', text: 'call' }], t('3×')],
          [t('P2'), t('Slack'), []],
        ],
      },
    ])
  })
})
