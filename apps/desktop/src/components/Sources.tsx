import { useCallback, useEffect, useState } from 'react'
import type { Decision, QueueItem, RoutingProposal, Signal } from '@autopilot/contracts'
import { signalName } from '@autopilot/client'
import { api, key } from '../api.ts'
import { age, ago } from '../format.ts'
import { Banner, Button, Dot, Meta } from '../ui.tsx'

type Props = { items: QueueItem[]; onOpen: (id: string) => void }

const schedule = (s: Signal) => ('every' in s.schedule ? `Every ${s.schedule.every}` : `Cron ${s.schedule.cron}`)

const HEALTH_TONE = { ok: 'pilot', failing: 'alert', paused: 'paused' } as const

/**
 * What set-up shows once it is done: what needs you (health issues, routing proposals) and every
 * source with its health, a preview of its last day, and pause.
 */
export const Sources = ({ items, onOpen }: Props) => {
  const [signals, setSignals] = useState<Signal[]>([])
  const [proposals, setProposals] = useState<RoutingProposal[]>([])
  const [previews, setPreviews] = useState<Record<string, Decision[] | 'running' | string>>({})
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    Promise.all([api.signals.list(), api.routing.list()])
      .then(([s, r]) => {
        setSignals(s)
        setProposals(r.filter((p) => p.state === 'open'))
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  useEffect(load, [load])

  const preview = async (name: string) => {
    setPreviews((p) => ({ ...p, [name]: 'running' }))
    try {
      const decisions = await api.signals.run({ idempotencyKey: key(), name, dryMinutes: 24 * 60 })
      setPreviews((p) => ({ ...p, [name]: decisions }))
    } catch (e) {
      setPreviews((p) => ({ ...p, [name]: e instanceof Error ? e.message : String(e) }))
    }
  }

  const health = items.filter((i) => i.task.workstream === 'autopilot' && i.band === 'your_turn')

  return (
    <>
      {error && <Banner>{error}</Banner>}

      {(health.length > 0 || proposals.length > 0) && <h2>Needs you</h2>}
      {health.map((i) => (
        <div key={i.task.id} className="card">
          <div className="card-head">
            <Dot tone="alert" />
            <span className="name">{i.task.title}</span>
            <span className="meta">{age(i.task.createdAt)}</span>
            <div className="actions">
              <Button kind="tool" onClick={() => onOpen(i.task.id)}>
                Open
              </Button>
            </div>
          </div>
        </div>
      ))}
      {proposals.map((p) => (
        <div key={p.id} className="card">
          <div className="card-head">
            <span className="name">{p.reason}</span>
            <div className="actions">
              <Button
                kind="primary"
                onClick={() =>
                  void api.routing
                    .decide({ idempotencyKey: key(), proposalId: p.id, accept: true })
                    .then(load, (e: unknown) => setError(String(e)))
                }
              >
                Accept
              </Button>
              <Button
                kind="tool"
                onClick={() => void api.routing.decide({ idempotencyKey: key(), proposalId: p.id, accept: false }).then(load)}
              >
                Reject
              </Button>
            </div>
          </div>
          {p.changes.map((c) => (
            <pre key={`${c.file}-${c.before}`} className="diff">
              {c.file}
              {'\n'}
              <span className="del">- {c.before}</span>
              {'\n'}
              <span className="add">+ {c.after}</span>
            </pre>
          ))}
        </div>
      ))}

      {signals.length === 0 && <Meta>No sources yet. Add them from your Claude connectors.</Meta>}
      {signals.map((s) => {
        const shown = previews[s.name]
        return (
          <div key={s.name} className="card">
            <div className="card-head">
              <Dot tone={HEALTH_TONE[s.health.state]} label={s.health.state} />
              <span className="name">{signalName(s.name)}</span>
              <span className="meta">
                {s.paused ? 'Paused · ' : ''}
                {schedule(s)} · last day {s.last24h.filed} filed, {s.last24h.updated} added, {s.last24h.dropped} dropped
                {s.lastRunAt ? ` · ran ${ago(s.lastRunAt)}` : ''}
              </span>
              <div className="actions">
                <Button kind="tool" disabled={shown === 'running'} onClick={() => void preview(s.name)}>
                  {shown === 'running' ? 'Previewing…' : 'Preview last day'}
                </Button>
                <Button
                  kind="tool"
                  onClick={() => void api.signals.pause({ idempotencyKey: key(), name: s.name, paused: !s.paused }).then(load)}
                >
                  {s.paused ? 'Resume' : 'Pause'}
                </Button>
              </div>
            </div>
            {s.health.message && <Meta top={3}>{s.health.message}</Meta>}
            {Array.isArray(shown) && (
              <pre className="diff">
                {shown.length === 0 ? 'Nothing in the last day.' : shown.map((d) => `${d.action.padEnd(8)} ${d.reason}`).join('\n')}
              </pre>
            )}
            {typeof shown === 'string' && shown !== 'running' && <Banner>{shown}</Banner>}
          </div>
        )
      })}
    </>
  )
}
