import { useEffect, useState } from 'react'
import type { Decision, Detected, SetupStatus, SignalExample, Workstream } from '@autopilot/contracts'
import { api, key } from '../api.ts'
import { titleCase } from '../format.ts'
import { Banner, Button, Dot, Meta, Pilot, Row } from '../ui.tsx'

type Props = { onDone: () => void }

const STEPS = ['Get ready', 'Sources', 'Preview', 'Workstreams', 'Switch on']

/** Labels for the placeholders the examples use. */
const FIELD_LABEL: Record<string, string> = {
  YOUR_SLACK_USER_ID: 'Your Slack member ID (profile → ⋯ → Copy member ID)',
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Onboarding: five steps to a working queue (docs/PRODUCT.md, Onboarding). */
export const Setup = ({ onDone }: Props) => {
  const [step, setStep] = useState(0)
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [detected, setDetected] = useState<Detected | null>(null)
  const [examples, setExamples] = useState<SignalExample[]>([])
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [values, setValues] = useState<Record<string, string>>({})
  const [previews, setPreviews] = useState<Record<string, Decision[] | string>>({})
  const [workstreams, setWorkstreams] = useState<(Workstream & { use: boolean })[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api.setup.status().then(setStatus, (e: unknown) => setError(message(e)))
    void api.signals.examples().then(setExamples, () => {})
    void api.connectors.detect().then(setDetected, (e: unknown) => setError(`Could not read your Claude connectors: ${message(e)}`))
  }, [])

  const available = (example: SignalExample): boolean => {
    if (example.name === 'github') return detected?.github.user != null
    return detected?.connectors.some((c) => c.signal === example.name && c.tools.length > 0) ?? false
  }

  const step2 = async () => {
    setBusy(true)
    setError(null)
    try {
      for (const name of chosen) await api.signals.add({ idempotencyKey: key(), name, values })
      setStep(2)
      const results = await Promise.all(
        [...chosen].map(async (name) => {
          try {
            return [name, await api.signals.run({ idempotencyKey: key(), name, dryMinutes: 24 * 60 })] as const
          } catch (e) {
            return [name, message(e)] as const
          }
        }),
      )
      setPreviews(Object.fromEntries(results))
      const suggested = new Set(
        results.flatMap(([, r]) => (Array.isArray(r) ? r.flatMap((d) => (d.workstream ? [d.workstream] : [])) : [])),
      )
      const options = await api.workstreams.examples()
      setWorkstreams(options.map((w) => ({ ...w, use: suggested.size === 0 || suggested.has(w.name) })))
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  const step4 = async () => {
    setBusy(true)
    setError(null)
    try {
      for (const w of workstreams.filter((x) => x.use)) {
        await api.workstreams.save({
          idempotencyKey: key(),
          name: w.name,
          routing: w.routing,
          urgent: w.urgent,
          ...(w.repo ? { repo: w.repo } : {}),
        })
      }
      setStep(4)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  const switchOn = async () => {
    setBusy(true)
    try {
      for (const name of chosen) await api.signals.pause({ idempotencyKey: key(), name, paused: false })
      onDone()
    } catch (e) {
      setError(message(e))
      setBusy(false)
    }
  }

  const decisions = Object.values(previews).flatMap((p) => (Array.isArray(p) ? p : []))
  const filed = decisions.filter((d) => d.action === 'created')
  const byWorkstream = Object.entries(Object.groupBy(filed, (d) => d.workstream ?? 'inbox'))

  return (
    <section className="pane task" aria-label="Set up">
      <div className="task-head drag" />
      <div className="page narrow">
        <ol className="steps" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s} aria-current={i === step ? 'step' : undefined} className={i < step ? 'done' : ''}>
              {i < step ? '✓' : i + 1} {s}
            </li>
          ))}
        </ol>
        {error && <Banner>{error}</Banner>}

        {step === 0 && (
          <>
            <Row gap={6} top={9}>
              <Pilot pixel={3} />
              <h1 className="serif">Hi, I'm your pilot.</h1>
            </Row>
            <p className="lead">
              I watch where work arrives, collect what needs you, and prepare it in Claude Code. First, a quick check that everything I need
              is here.
            </p>
            <Check
              ok={status?.claude.installed ?? null}
              title="Claude Code is installed"
              detail={
                status
                  ? (status.claude.version ?? 'Not found. Install Claude Code, sign in, then open this again.')
                  : 'I start every session with it.'
              }
            />
            <Check
              ok={detected ? detected.connectors.length > 0 : error ? false : null}
              title="Your Claude connectors are there"
              detail={detected ? `${detected.connectors.length} found` : error ? 'Could not ask Claude Code' : 'Asking Claude Code…'}
            />
            <Check
              ok={status?.service ?? null}
              title="Keep working in the background"
              detail="Starts when you log in and keeps going when this window is closed."
            >
              {status && !status.service && (
                <Button
                  kind="tool"
                  onClick={() =>
                    void api.setup.installService({ idempotencyKey: key() }).then(setStatus, (e: unknown) => setError(message(e)))
                  }
                >
                  Turn on
                </Button>
              )}
            </Check>
            <div className="step-bar">
              <Meta as="span">About a minute. Nothing is filed until step 5.</Meta>
              <Button kind="primary" disabled={!status?.claude.installed} onClick={() => setStep(1)}>
                Continue
              </Button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h1 className="serif step-title">Where should I listen?</h1>
            <p className="lead">
              These are the sources I can read with your Claude connectors. Pick one or two to start; I only ever read from them.
            </p>
            {examples.map((example) => {
              const on = chosen.has(example.name)
              const can = available(example) || example.added
              return (
                <div key={example.name} className="card">
                  <label className={can ? 'card-head pickable' : 'card-head'}>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!can}
                      onChange={() =>
                        setChosen((c) => {
                          const next = new Set(c)
                          if (on) next.delete(example.name)
                          else next.add(example.name)
                          return next
                        })
                      }
                    />
                    <span className="name">{titleCase(example.name)}</span>
                    <span className="meta">
                      {can
                        ? example.summary.slice(0, 120)
                        : example.name === 'github'
                          ? 'Sign in with gh auth login first'
                          : 'Not connected in Claude yet'}
                    </span>
                  </label>
                  {on &&
                    example.fields.map((field) => (
                      <input
                        key={field}
                        className="inline-reply"
                        aria-label={FIELD_LABEL[field] ?? field}
                        placeholder={FIELD_LABEL[field] ?? field}
                        value={values[field] ?? ''}
                        onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))}
                      />
                    ))}
                </div>
              )
            })}
            <div className="step-bar">
              <Button kind="tool" onClick={() => setStep(0)}>
                Back
              </Button>
              <Button kind="primary" disabled={busy || chosen.size === 0} onClick={() => void step2()}>
                {busy ? 'Adding…' : 'Next: what I would have picked up yesterday'}
              </Button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1 className="serif step-title">Yesterday, I would have picked up these</h1>
            {busy || Object.keys(previews).length < chosen.size ? (
              <p className="lead">Reading yesterday from {[...chosen].map(titleCase).join(' and ')}. This takes a minute or two…</p>
            ) : (
              <>
                <p className="lead">
                  {filed.length} new tasks, {decisions.filter((d) => d.action === 'updated').length} follow-ups,{' '}
                  {decisions.filter((d) => d.action === 'dropped').length} left alone.
                </p>
                {Object.entries(previews)
                  .filter(([, p]) => typeof p === 'string')
                  .map(([name, p]) => (
                    <Banner key={name}>
                      {titleCase(name)}: {String(p)}
                    </Banner>
                  ))}
                {byWorkstream.map(([ws, list]) => (
                  <div key={ws}>
                    <h2>{titleCase(ws)}</h2>
                    {list?.map((d, i) => (
                      <div key={`${d.signal}-${i}`} className="card">
                        <div className="card-head">
                          <span className="name">{d.title ?? d.reason}</span>
                          <span className="meta">{titleCase(d.signal)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </>
            )}
            <div className="step-bar">
              <Button kind="tool" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button kind="primary" disabled={busy} onClick={() => setStep(3)}>
                Looks right
              </Button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h1 className="serif step-title">Where should work go?</h1>
            <p className="lead">Adjust the words if they're off; they're how I decide where things land. Everything else can wait.</p>
            {workstreams.map((w, i) => {
              const set = (patch: Partial<Workstream & { use: boolean }>) =>
                setWorkstreams((all) => all.map((x, j) => (j === i ? { ...x, ...patch } : x)))
              return (
                <div key={w.name} className="card">
                  <label className="card-head">
                    <input type="checkbox" checked={w.use} onChange={() => set({ use: !w.use })} />
                    <span className="name">{titleCase(w.name)}</span>
                  </label>
                  {w.use && (
                    <>
                      <textarea
                        className="inline-reply"
                        rows={3}
                        aria-label={`What lands in ${w.name}`}
                        value={w.routing}
                        onChange={(e) => set({ routing: e.target.value })}
                      />
                      <input
                        className="inline-reply"
                        aria-label={`When ${w.name} is urgent`}
                        placeholder="Urgent when…"
                        value={w.urgent}
                        onChange={(e) => set({ urgent: e.target.value })}
                      />
                      {w.repo !== null && (
                        <input
                          className="inline-reply"
                          aria-label={`Repository for ${w.name}`}
                          placeholder="~/code/your-repo"
                          value={w.repo}
                          onChange={(e) => set({ repo: e.target.value })}
                        />
                      )}
                    </>
                  )}
                </div>
              )
            })}
            <div className="step-bar">
              <Button kind="tool" onClick={() => setStep(2)}>
                Back
              </Button>
              <Meta as="span">Every workstream starts by preparing work, never sending it.</Meta>
              <Button kind="primary" disabled={busy || !workstreams.some((w) => w.use)} onClick={() => void step4()}>
                Continue
              </Button>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <Row gap={6} top={9}>
              <Pilot pixel={3} />
              <h1 className="serif">Ready for take-off</h1>
            </Row>
            <Check
              ok
              title={`Listening to ${[...chosen].map(titleCase).join(' and ')}, from now on`}
              detail="Nothing from before today is filed."
            />
            <Check
              ok
              title={`Sorting into ${workstreams
                .filter((w) => w.use)
                .map((w) => titleCase(w.name))
                .join(', ')}`}
              detail="Correct me by moving a task; I learn from it overnight."
            />
            <Check ok title="Sessions prepare drafts and branches" detail="You send and merge." />
            <div className="step-bar">
              <Button kind="tool" onClick={() => setStep(3)}>
                Back
              </Button>
              <Button kind="primary" disabled={busy} onClick={() => void switchOn()}>
                Go to my queue
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

const Check = ({ ok, title, detail, children }: { ok: boolean | null; title: string; detail: string; children?: React.ReactNode }) => (
  <div className="card">
    <div className="card-head">
      <Dot tone={ok === null ? 'quiet' : ok ? 'good' : 'attention'} label={ok === null ? 'checking' : ok ? 'ok' : 'needs attention'} />
      <span className="name">{title}</span>
      <span className="meta">{detail}</span>
      {children && <div className="actions">{children}</div>}
    </div>
  </div>
)
