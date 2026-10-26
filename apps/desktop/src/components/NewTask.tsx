import { useEffect, useRef, useState } from 'react'
import type { Workstream } from '@autopilot/contracts'
import { api, key } from '../api.ts'
import { useDraft } from '../drafts.ts'
import { Banner, Bars, Button, Icon, NavIcon, Pilot, Row, Spacer, WorkstreamMark } from '../ui.tsx'
import { Menu } from './Menu.tsx'

type Props = { workstreams: Workstream[]; onCreated: (id: string) => void }

/** The priorities as the task's own Priority property names them. */
const PRIORITIES: Record<number, string> = { 1: 'Urgent', 2: 'High', 3: 'Normal', 4: 'Low' }

/** Automatic, drawn where a workstream's mark would be. */
const AutoMark = () => (
  <span className="ws-mark quiet" aria-hidden="true">
    <NavIcon name="auto" size={13} />
  </span>
)

export const NewTask = ({ workstreams, onCreated }: Props) => {
  const [title, setTitle] = useDraft('new:title')
  const [brief, setBrief] = useDraft('new:brief')
  // Automatic (null) leaves it to routing, as a task from a source: the first look or, when it
  // starts straight away, a quick pass before its session opens.
  const [workstream, setWorkstream] = useState<string | null>(null)
  const [priority, setPriority] = useState(3)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => titleRef.current?.focus(), [])

  const create = async (start: boolean) => {
    if (!title.trim()) return
    setBusy(true)
    setError(null)
    try {
      const task = await api.tasks.create({
        idempotencyKey: key(),
        title: title.trim().slice(0, 120),
        brief: brief.trim(),
        ...(workstream ? { workstream } : {}),
        priority,
        start,
      })
      setTitle('')
      setBrief('')
      onCreated(task.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <section className="pane task" aria-label="New task">
      <div className="task-head drag" />
      <div className="start">
        <Row gap={6}>
          <Pilot pixel={3} />
          <h1 className="serif">What’s next?</h1>
        </Row>
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault()
            void create(true)
          }}
        >
          <input
            ref={titleRef}
            className="title-input"
            aria-label="Title"
            placeholder="Title"
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            aria-label="Brief"
            rows={4}
            placeholder="Details for the session"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void create(true)
            }}
          />
          <div className="composer-bar">
            <Button kind="send" type="submit" aria-label="Create and start" title="Create and start (⌘↩)" disabled={busy || !title.trim()}>
              <Icon name="enter" size={14} />
            </Button>
          </div>
        </form>
        {/* Under the box, as Claude puts the folder and the model: where it goes, and how much it matters. */}
        <div className="below">
          <Menu
            trigger="prop"
            label={
              workstream ? (
                <>
                  <WorkstreamMark name={workstream} />
                  {workstream}
                </>
              ) : (
                <>
                  <AutoMark />
                  Automatic
                </>
              )
            }
            items={[
              { label: 'Automatic', icon: <AutoMark />, checked: workstream === null, run: () => setWorkstream(null) },
              ...workstreams
                .map((w) => w.name)
                .filter((n) => n !== 'autopilot')
                .map((name) => ({
                  label: name,
                  icon: <WorkstreamMark name={name} />,
                  checked: name === workstream,
                  run: () => setWorkstream(name),
                })),
            ]}
          />
          <Spacer />
          <Menu
            trigger="prop"
            align="right"
            label={
              <>
                <Bars priority={priority} />
                {PRIORITIES[priority]}
              </>
            }
            items={[1, 2, 3, 4].map((p) => ({
              label: PRIORITIES[p] ?? '',
              icon: <Bars priority={p} />,
              checked: p === priority,
              run: () => setPriority(p),
            }))}
          />
          <Button kind="prop" disabled={busy || !title.trim()} onClick={() => void create(false)}>
            Save without starting
          </Button>
        </div>
        {error && <Banner>{error}</Banner>}
      </div>
    </section>
  )
}
