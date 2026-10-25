import { useState } from 'react'
import type { QueueItem, Workstream } from '@autopilot/contracts'
import { api, key } from '../api.ts'
import { titleCase } from '../format.ts'
import { Banner, Button, Meta } from '../ui.tsx'

/** What each autonomy level lets a workstream's sessions do, in the owner's words. */
export const AUTONOMY = ['', 'Files only', 'Prepares when started', 'Starts by itself', 'Finishes within its rules']

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Names are file names: lowercase words joined by hyphens. */
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 40)

type Draft = { name: string; routing: string; urgent: string; repo: string; work: string; autonomy: number }

const draftOf = (w: Workstream | null): Draft => ({
  name: w?.name ?? '',
  routing: w?.routing ?? '',
  urgent: w?.urgent ?? '',
  repo: w?.repo ?? '',
  work: w?.work ?? '',
  autonomy: w?.autonomy ?? 2,
})

const rows = (text: string) => Math.min(10, Math.max(3, Math.ceil(text.length / 80) + text.split('\n').length - 1))

/** One workstream: read as a card, edited in place. A new one starts open, with an empty name. */
const WorkstreamCard = ({
  workstream,
  open,
  onSaved,
  onRemoved,
  onCancel,
}: {
  workstream: Workstream | null
  open: number
  onSaved: (w: Workstream) => void
  onRemoved: (all: Workstream[]) => void
  onCancel?: () => void
}) => {
  const [editing, setEditing] = useState(workstream === null)
  const [draft, setDraft] = useState(() => draftOf(workstream))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))
  const name = draft.name.replace(/-+$/, '')

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const saved = await api.workstreams.save({
        idempotencyKey: key(),
        name,
        routing: draft.routing,
        urgent: draft.urgent,
        repo: draft.repo.trim(),
        work: draft.work,
        autonomy: draft.autonomy,
      })
      onSaved(saved)
      setEditing(false)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!workstream) return
    setBusy(true)
    setError(null)
    try {
      onRemoved(await api.workstreams.remove({ idempotencyKey: key(), name: workstream.name }))
    } catch (e) {
      setError(message(e))
      setBusy(false)
    }
  }

  if (!editing && workstream)
    return (
      <div className="card">
        <div className="card-head">
          <span className="name">{titleCase(workstream.name)}</span>
          <span className="meta">
            {AUTONOMY[workstream.autonomy]} ·{' '}
            {workstream.repo ? `worktrees of ${workstream.repo}` : workstream.folder ? `in ${workstream.folder}` : 'in its own folders'} ·{' '}
            {open} open
          </span>
          <div className="actions">
            <Button kind="tool" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </div>
        </div>
        <Meta top={3} className="prose">
          {workstream.routing}
          {workstream.urgent ? `\nUrgent: ${workstream.urgent}` : ''}
        </Meta>
      </div>
    )

  return (
    <div className="card workstream-draft">
      <div className="card-head">
        {workstream ? (
          <span className="name">{titleCase(workstream.name)}</span>
        ) : (
          <input
            className="draft-name"
            aria-label="Workstream name"
            placeholder="name, like customer-support"
            value={draft.name}
            onChange={(e) => set({ name: slug(e.target.value) })}
          />
        )}
      </div>
      {error && <Banner>{error}</Banner>}
      <span className="field-label">What lands here</span>
      <textarea
        className="inline-reply"
        rows={rows(draft.routing)}
        aria-label="What lands here"
        placeholder="Senders, customers, channels, repositories…"
        value={draft.routing}
        onChange={(e) => set({ routing: e.target.value })}
      />
      <span className="field-label">Urgent when</span>
      <input
        className="inline-reply"
        aria-label="Urgent when"
        placeholder="An outage, a deadline today…"
        value={draft.urgent}
        onChange={(e) => set({ urgent: e.target.value })}
      />
      <span className="field-label">How the work is done</span>
      <textarea
        className="inline-reply"
        rows={rows(draft.work)}
        aria-label="How the work is done"
        placeholder="Drafts in the customer's language; send nothing without asking…"
        value={draft.work}
        onChange={(e) => set({ work: e.target.value })}
      />
      <span className="field-label">Code checkout, for code work (optional)</span>
      <input
        className="inline-reply"
        aria-label="Code checkout"
        placeholder="A folder git knows, like ~/code/your-repo, or default"
        value={draft.repo}
        onChange={(e) => set({ repo: e.target.value })}
      />
      <span className="field-label">How far sessions go by themselves</span>
      <select
        className="inline-reply"
        aria-label="Autonomy"
        value={draft.autonomy}
        onChange={(e) => set({ autonomy: Number(e.target.value) })}
      >
        {AUTONOMY.slice(1).map((label, i) => (
          <option key={label} value={i + 1}>
            {label}
          </option>
        ))}
      </select>
      <div className="step-bar">
        {workstream && workstream.name !== 'autopilot' && (
          <Button kind="quiet" disabled={busy} onClick={() => void remove()}>
            Remove
          </Button>
        )}
        <Button
          kind="tool"
          disabled={busy}
          onClick={() => {
            setDraft(draftOf(workstream))
            setError(null)
            if (workstream) setEditing(false)
            else onCancel?.()
          }}
        >
          Cancel
        </Button>
        <Button kind="primary" disabled={busy || !name || !draft.routing.trim()} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

/** Every workstream, each editable in place, and a way to add one. */
export const WorkstreamsEditor = ({
  workstreams,
  items,
  onChange,
}: {
  workstreams: Workstream[]
  items: QueueItem[]
  onChange: (all: Workstream[]) => void
}) => {
  const [adding, setAdding] = useState(false)
  const saved = (w: Workstream) =>
    onChange(workstreams.some((x) => x.name === w.name) ? workstreams.map((x) => (x.name === w.name ? w : x)) : [...workstreams, w])
  return (
    <>
      {workstreams.map((w) => (
        <WorkstreamCard
          key={w.name}
          workstream={w}
          open={items.filter((i) => i.task.workstream === w.name).length}
          onSaved={saved}
          onRemoved={onChange}
        />
      ))}
      {adding ? (
        <WorkstreamCard
          workstream={null}
          open={0}
          onSaved={(w) => {
            saved(w)
            setAdding(false)
          }}
          onRemoved={onChange}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <Button kind="tool" onClick={() => setAdding(true)}>
          Add a workstream
        </Button>
      )}
    </>
  )
}
