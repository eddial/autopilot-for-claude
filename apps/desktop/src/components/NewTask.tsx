import { useEffect, useRef, useState } from 'react'
import type { Workstream } from '@autopilot/contracts'
import { api, key } from '../api.ts'
import { useDraft } from '../drafts.ts'
import { ArrowUp, Banner, Bars, Button, Meta, Pilot, Row, WorkstreamMark } from '../ui.tsx'
import { Menu } from './Menu.tsx'

type Props = { workstreams: Workstream[]; onCreated: (id: string) => void }

/** The priorities as the task's own Priority property names them. */
const PRIORITIES: Record<number, string> = { 1: 'Urgent', 2: 'High', 3: 'Normal', 4: 'Low' }

export const NewTask = ({ workstreams, onCreated }: Props) => {
  const [title, setTitle] = useDraft('new:title')
  const [brief, setBrief] = useDraft('new:brief')
  const [workstream, setWorkstream] = useState('inbox')
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
        ...(workstream !== 'inbox' ? { workstream } : {}),
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
          <h1 className="serif">What should I take on?</h1>
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
            placeholder="What needs doing, starting with a verb"
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            aria-label="Brief"
            rows={4}
            placeholder="The brief: what you know, what to use, what not to do. It is the session's first prompt."
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void create(true)
            }}
          />
          <div className="composer-bar">
            {/* The same menus as the task's own Workstream and Priority. */}
            <Menu
              className="with-icon"
              label={
                <>
                  <WorkstreamMark name={workstream} />
                  {workstream}
                </>
              }
              items={[...new Set([...workstreams.map((w) => w.name).filter((n) => n !== 'autopilot'), 'inbox'])].map((name) => ({
                label: name,
                icon: <WorkstreamMark name={name} />,
                checked: name === workstream,
                run: () => setWorkstream(name),
              }))}
            />
            <Menu
              className="with-icon"
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
            <Button kind="send" type="submit" aria-label="Create and start" disabled={busy || !title.trim()}>
              <ArrowUp />
            </Button>
          </div>
        </form>
        <div className="below">
          <Meta as="span">Starts a session with this brief right away. ⌘↩ from the brief.</Meta>
          <Button kind="link" disabled={busy || !title.trim()} onClick={() => void create(false)}>
            Save without starting
          </Button>
        </div>
        {error && <Banner>{error}</Banner>}
      </div>
    </section>
  )
}
