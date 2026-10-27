import type { QueueItem, Update } from '@autopilot/contracts'
import { describe, expect, it } from 'vitest'
import { parseMarkdown } from '../src/markdown.ts'
import {
  isArtifact,
  linkKind,
  linkSource,
  sectionsOf,
  signalChannel,
  signalMark,
  signalSender,
  updateLabel,
  updateTone,
} from '../src/present.ts'

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

  it('marks a link and a signal with where they live, and a file or an unknown place with none', () => {
    expect(
      [
        'https://acme.slack.com/archives/C1/p1',
        'https://docs.google.com/spreadsheets/d/1',
        'https://acme.atlassian.net/wiki/spaces/X',
        'https://acme.atlassian.net/browse/X-1',
        'file:///Users/b/plan.md',
        'https://www.example.com/a',
      ].map((url) => linkKind({ url, title: 'x' }).mark ?? null),
    ).toEqual(['slack', 'googleSheets', 'confluence', 'jira', null, null])
    expect([
      signalMark('slack'),
      signalMark('calendar'),
      signalMark('inbox', 'https://linear.app/a/issue/A-1'),
      signalMark('inbox'),
    ]).toEqual(['slack', 'googleCalendar', 'linear', null])
  })

  it("leaves out a signal's channel and sender where they only repeat its name", () => {
    const linear = { signal: 'linear', channel: 'linear', sender: 'Linear' }
    const slack = { signal: 'slack', channel: '#general', sender: 'Noah van Rijn' }
    expect([signalChannel(linear), signalSender(linear), signalChannel(slack), signalSender(slack)]).toEqual([
      null,
      null,
      '#general',
      'Noah van Rijn',
    ])
  })

  it('lists what a session made to share as artifacts, apart from the rest', () => {
    expect(
      [
        'file:///Users/b/plan.md',
        'https://claude.ai/artifact/abc',
        'https://docs.google.com/document/d/1',
        'https://github.com/a/b/pull/1',
        'https://linear.app/a/issue/A-1',
      ].map((url) => isArtifact({ url, title: 'x' })),
    ).toEqual([true, true, true, false, false])
  })
})

/** A cell or line of plain text, as the parser gives it. */
const t = (text: string) => [{ kind: 'text', text }]

// Only what grouping reads: id, workstream, priority.
const row = (id: string, workstream: string, priority: number) => ({ task: { id, workstream, priority } }) as QueueItem

describe('sections of a list', () => {
  const list = [row('AP-1', 'inbox', 1), row('AP-2', 'sales', 3), row('AP-3', 'dev', 1), row('AP-4', 'sales', 1)]
  const read = (by: 'workstream' | 'priority') => sectionsOf(list, by).map((s) => [s.title, ...s.items.map((i) => i.task.id)])

  it('by workstream: in the order of their most pressing task, the inbox last', () => {
    expect(read('workstream')).toEqual([
      ['sales', 'AP-2', 'AP-4'],
      ['dev', 'AP-3'],
      ['inbox', 'AP-1'],
    ])
  })
  it('by priority: Urgent to Low, each workstream together inside, the inbox last', () => {
    expect(read('priority')).toEqual([
      ['Urgent', 'AP-3', 'AP-4', 'AP-1'],
      ['Normal', 'AP-2'],
    ])
  })
  it('puts what came in to triage under your turn in Needs me', () => {
    const needs = [
      { ...row('AP-1', 'sales', 3), band: 'your_turn' },
      { ...row('AP-2', 'dev', 2), band: 'triage' },
      { ...row('AP-3', 'sales', 2), band: 'triage' },
    ] as QueueItem[]
    expect(sectionsOf(needs, 'workstream').map((s) => [s.part?.title ?? null, s.title, ...s.items.map((i) => i.task.id)])).toEqual([
      ['Your turn', 'sales', 'AP-1'],
      ['Triage', 'dev', 'AP-2'],
      [null, 'sales', 'AP-3'],
    ])
  })
})

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
