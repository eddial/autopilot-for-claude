import { useEffect, useRef, useState } from 'react'
import type { Workstream } from '@autopilot/contracts'
import { api, key } from '../api.ts'
import { titleCase } from '../format.ts'
import { Pilot } from './Pilot.tsx'

type Props = { workstreams: Workstream[]; onCreated: (id: string) => void }

const PRIORITIES = [
  { value: 1, label: 'Urgent' },
  { value: 2, label: 'High priority' },
  { value: 3, label: 'Normal priority' },
  { value: 4, label: 'Low priority' },
]

export const NewTask = ({ workstreams, onCreated }: Props) => {
  const [title, setTitle] = useState('')
  const [brief, setBrief] = useState('')
  const [workstream, setWorkstream] = useState('')
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Pilot pixel={3} />
          <h1 className="serif">What should I take on?</h1>
        </div>
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
            <select className="pick" aria-label="Workstream" value={workstream} onChange={(e) => setWorkstream(e.target.value)}>
              <option value="">Inbox</option>
              {workstreams.map((w) => (
                <option key={w.name} value={w.name}>
                  {titleCase(w.name)}
                </option>
              ))}
            </select>
            <select className="pick" aria-label="Priority" value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <button type="submit" className="send" aria-label="Create and start" disabled={busy || !title.trim()}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#141413" strokeWidth="1.8" aria-hidden="true">
                <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
              </svg>
            </button>
          </div>
        </form>
        <div className="below">
          <span className="meta">Starts a session with this brief right away. ⌘↩ from the brief.</span>
          <button className="link" disabled={busy || !title.trim()} onClick={() => void create(false)}>
            Save without starting
          </button>
        </div>
        {error && (
          <div className="banner" style={{ width: '100%', maxWidth: 640 }}>
            {error}
          </div>
        )}
      </div>
    </section>
  )
}
