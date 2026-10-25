import { useEffect, useState } from 'react'
import type { Decision, Detected, SetupStatus, SignalExample, Workstream } from '@autopilot/contracts'
import { api, key } from '../api.ts'
import { titleCase } from '../format.ts'
import { Banner, Button, Dot, Meta, Pilot, Row } from '../ui.tsx'

type Props = { onDone: () => void }

const STEPS = ['Get ready', 'Sources', 'Workstreams', 'Preview', 'Switch on']

/** How far back the sweep reads. */
const SWEEP_DAYS = 14

/** Labels for the placeholders the examples still ask for. */
const FIELD_LABEL: Record<string, string> = {}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** A source by the name its makers give it. */
const nameOf = (name: string) => ({ github: 'GitHub' })[name] ?? titleCase(name)

/** The first sentence of a description, or its first words when that is long. */
const gist = (text: string) => {
  const sentence = /^.*?[.!?:](?=\s|$)/.exec(text)?.[0] ?? text
  return sentence.length <= 130 ? sentence : `${sentence.slice(0, 130).replace(/\s+\S*$/, '')}…`
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const list = (names: string[]) => (names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`)

/** A workstream as you shape it in set-up: from the sweep, an example, or your own. */
type Draft = { id: string; name: string; routing: string; urgent: string; repo: string; evidence: string[]; count: number | null }

const draftOf = (
  w: Pick<Workstream, 'name' | 'routing' | 'urgent'> & { repo?: string | null; evidence?: string[]; count?: number },
): Draft => ({
  id: key(),
  name: w.name,
  routing: w.routing,
  urgent: w.urgent,
  repo: w.repo ?? '',
  evidence: w.evidence ?? [],
  count: w.count ?? null,
})

/** Names are file names: lowercase words joined by hyphens. */
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 40)

/** What one source's preview is doing. */
type Run = { started: number; finished?: number; decisions?: Decision[]; error?: string }

/** Seconds since `from`, ticking while `on`. */
const useSeconds = (on: boolean) => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [on])
  return (from: number, to?: number) => Math.max(0, Math.round(((to ?? now) - from) / 1000))
}

/** Onboarding: five steps to a working queue (docs/PRODUCT.md, Onboarding). */
export const Setup = ({ onDone }: Props) => {
  const [step, setStep] = useState(0)
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [detected, setDetected] = useState<Detected | null>(null)
  const [examples, setExamples] = useState<SignalExample[]>([])
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [values, setValues] = useState<Record<string, string>>({})
  const [drafts, setDrafts] = useState<Draft[] | null>(null)
  const [sweep, setSweep] = useState<{ started: number } | null>(null)
  const [runs, setRuns] = useState<Record<string, Run>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api.setup.status().then(setStatus, (e: unknown) => setError(message(e)))
    void api.signals.examples().then(setExamples, () => {})
    void api.connectors.detect().then(setDetected, (e: unknown) => setError(`Could not read your Claude connectors: ${message(e)}`))
  }, [])

  const previewing = Object.values(runs).some((r) => r.finished === undefined)
  const seconds = useSeconds(sweep !== null || previewing)

  /** A source is something a connector or the GitHub CLI reads; a digest is set up later, in Signals. */
  const connector = (example: SignalExample) => detected?.connectors.find((c) => c.signal === example.name)
  const isSource = (example: SignalExample) => example.name === 'github' || connector(example) !== undefined
  const available = (example: SignalExample): boolean =>
    example.name === 'github' ? detected?.github.user != null : (connector(example)?.tools.length ?? 0) > 0
  const sources = examples.filter(isSource)
  const listening = sources.filter(available).map((e) => nameOf(e.name))
  const chosenNames = [...chosen].map(nameOf)

  const addSources = async () => {
    setBusy(true)
    setError(null)
    try {
      for (const name of chosen) await api.signals.add({ idempotencyKey: key(), name, values })
      setStep(2)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  const startSweep = async () => {
    setError(null)
    setSweep({ started: Date.now() })
    try {
      const found = await api.workstreams.sweep({ idempotencyKey: key(), signals: [...chosen], days: SWEEP_DAYS })
      setDrafts((d) => d ?? found.map(draftOf))
      if (found.length === 0) setError('I found nothing to group yet. Start from the examples, or add your own.')
    } catch (e) {
      setError(`The sweep did not finish: ${message(e)}. Set them up yourself instead.`)
    } finally {
      setSweep(null)
    }
  }

  const manual = async () => {
    setSweep(null)
    try {
      const options = await api.workstreams.examples()
      // An example's repository is a placeholder, not a folder on this Mac.
      setDrafts(options.map((w) => draftOf({ ...w, repo: null })))
    } catch (e) {
      setError(message(e))
      setDrafts([])
    }
  }

  const saveWorkstreams = async () => {
    setBusy(true)
    setError(null)
    try {
      for (const d of drafts ?? []) {
        await api.workstreams.save({
          idempotencyKey: key(),
          name: d.name.replace(/-+$/, ''),
          routing: d.routing,
          urgent: d.urgent,
          ...(d.repo.trim() ? { repo: d.repo.trim() } : {}),
        })
      }
      setStep(3)
      startPreview()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  /** Each source previews on its own and shows as soon as it is done. */
  const startPreview = () => {
    const started = Date.now()
    setRuns(Object.fromEntries([...chosen].map((name) => [name, { started }])))
    for (const name of chosen) {
      api.signals.run({ idempotencyKey: key(), name, dryMinutes: 24 * 60 }).then(
        (decisions) => setRuns((r) => ({ ...r, [name]: { started, finished: Date.now(), decisions } })),
        (e: unknown) => setRuns((r) => ({ ...r, [name]: { started, finished: Date.now(), error: message(e) } })),
      )
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

  const decisions = Object.values(runs).flatMap((r) => r.decisions ?? [])
  const filed = decisions.filter((d) => d.action === 'created')
  const leftAlone = decisions.filter((d) => d.action === 'dropped')
  const byWorkstream = Object.entries(Object.groupBy(filed, (d) => d.workstream ?? 'inbox'))
  const edit = (id: string, patch: Partial<Draft>) => setDrafts((all) => (all ?? []).map((d) => (d.id === id ? { ...d, ...patch } : d)))
  const named = (drafts ?? []).every((d) => d.name.replace(/-+$/, '') !== '' && d.routing.trim() !== '')

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
            <Row gap={6} top={9} className="hero">
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
              ok={detected ? listening.length > 0 : error ? false : null}
              title="Your Claude connectors are there"
              detail={
                detected
                  ? `${plural(detected.connectors.length, 'connector', 'connectors')}; I can listen to ${listening.length > 0 ? list(listening) : 'none of them yet'}`
                  : error
                    ? 'Could not ask Claude Code'
                    : 'Asking Claude Code…'
              }
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
              <Meta as="span">A few minutes. Nothing is filed until step 5.</Meta>
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
              These are the sources your Claude connectors let me read. Pick the ones where work reaches you; I only ever read.
            </p>
            {sources.map((example) => {
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
                    <span className="name">{nameOf(example.name)}</span>
                    <span className="meta">
                      {can
                        ? gist(example.summary)
                        : example.name === 'github'
                          ? 'Sign in with gh auth login first'
                          : 'Connected, but Claude Code sees none of its tools. Reconnect it in Claude.'}
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
              <Button kind="primary" disabled={busy || chosen.size === 0} onClick={() => void addSources()}>
                {busy ? 'Connecting…' : 'Next: where work should go'}
              </Button>
            </div>
          </>
        )}

        {step === 2 && drafts === null && (
          <>
            <h1 className="serif step-title">Where should work go?</h1>
            {sweep === null ? (
              <>
                <p className="lead">
                  I can look through the last two weeks of {list(chosenNames)} (what was sent to you directly, what mentions you, what is
                  assigned to you) and suggest workstreams from what I find. I only read: nothing is sent, changed or filed.
                </p>
                <div className="step-bar">
                  <Button kind="tool" onClick={() => setStep(1)}>
                    Back
                  </Button>
                  <Button kind="tool" onClick={() => void manual()}>
                    Set them up myself
                  </Button>
                  <Button kind="primary" onClick={() => void startSweep()}>
                    Look through two weeks
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Row gap={4} top={4}>
                  <Pilot pixel={2} />
                  <p className="lead working">
                    Reading two weeks of {list(chosenNames)}… {seconds(sweep.started)} s. This usually takes a minute or two.
                  </p>
                </Row>
                <div className="step-bar">
                  <Button kind="tool" onClick={() => void manual()}>
                    Set them up myself instead
                  </Button>
                </div>
              </>
            )}
          </>
        )}

        {step === 2 && drafts !== null && (
          <>
            <h1 className="serif step-title">Where should work go?</h1>
            <p className="lead">
              {drafts.some((d) => d.count !== null)
                ? 'This is how your last two weeks group. Rename, reword or remove any of them; the words are how I decide where things land.'
                : 'Start from these, or add your own. The words are how I decide where things land.'}
            </p>
            {drafts.map((d) => (
              <div key={d.id} className="card workstream-draft">
                <div className="card-head">
                  <input
                    className="draft-name"
                    aria-label="Workstream name"
                    placeholder="name"
                    value={d.name}
                    onChange={(e) => edit(d.id, { name: slug(e.target.value) })}
                  />
                  {d.count !== null && <span className="meta">{plural(d.count, 'item', 'items')} in two weeks</span>}
                  <div className="actions">
                    <Button
                      kind="quiet"
                      aria-label={`Remove ${d.name}`}
                      onClick={() => setDrafts((all) => (all ?? []).filter((x) => x.id !== d.id))}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
                {d.evidence.length > 0 && <Meta className="meta-line">Like: {d.evidence.join(' · ')}</Meta>}
                <textarea
                  className="inline-reply"
                  rows={Math.min(8, Math.max(3, Math.ceil(d.routing.length / 80)))}
                  aria-label={`What lands in ${d.name}`}
                  placeholder="What lands here: senders, customers, channels, repositories…"
                  value={d.routing}
                  onChange={(e) => edit(d.id, { routing: e.target.value })}
                />
                <input
                  className="inline-reply"
                  aria-label={`When ${d.name} is urgent`}
                  placeholder="Urgent when…"
                  value={d.urgent}
                  onChange={(e) => edit(d.id, { urgent: e.target.value })}
                />
                <input
                  className="inline-reply"
                  aria-label={`Repository for ${d.name}`}
                  placeholder="For code work: the checkout, like ~/code/product (optional)"
                  value={d.repo}
                  onChange={(e) => edit(d.id, { repo: e.target.value })}
                />
              </div>
            ))}
            <Button kind="tool" onClick={() => setDrafts((all) => [...(all ?? []), draftOf({ name: '', routing: '', urgent: '' })])}>
              Add a workstream
            </Button>
            <div className="step-bar">
              <Button kind="tool" onClick={() => setDrafts(null)}>
                Back
              </Button>
              <Meta as="span">Every workstream starts by preparing work, never sending it.</Meta>
              <Button kind="primary" disabled={busy || drafts.length === 0 || !named} onClick={() => void saveWorkstreams()}>
                {busy ? 'Saving…' : 'Next: what I would have picked up yesterday'}
              </Button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h1 className="serif step-title">Yesterday, I would have picked up these</h1>
            <p className="lead">
              {previewing
                ? `Reading yesterday from ${list(chosenNames)}. Each source shows as soon as it is done.`
                : `${plural(filed.length, 'new task', 'new tasks')}, ${plural(decisions.filter((d) => d.action === 'updated').length, 'follow-up', 'follow-ups')}, ${leftAlone.length} left alone.`}
            </p>
            {Object.entries(runs).map(([name, run]) => (
              <div key={name} className="card">
                <div className="card-head">
                  <Dot
                    tone={run.finished === undefined ? 'quiet' : run.error ? 'alert' : 'pilot'}
                    label={run.finished === undefined ? 'reading' : run.error ? 'failed' : 'done'}
                  />
                  <span className="name">{nameOf(name)}</span>
                  <span className="meta">
                    {run.finished === undefined
                      ? `Reading… ${seconds(run.started)} s`
                      : run.error
                        ? run.error.slice(0, 160)
                        : `${plural(run.decisions?.filter((d) => d.action === 'created').length ?? 0, 'new task', 'new tasks')}, ${run.decisions?.filter((d) => d.action === 'dropped').length ?? 0} left alone, in ${seconds(run.started, run.finished)} s`}
                  </span>
                </div>
              </div>
            ))}
            {byWorkstream.map(([ws, items]) => (
              <div key={ws}>
                <h2>{titleCase(ws)}</h2>
                {items?.map((d) => (
                  <div key={d.id} className="card">
                    <div className="card-head">
                      <span className="name">{d.title ?? d.reason}</span>
                      <span className="meta">{nameOf(d.signal)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ))}
            {leftAlone.length > 0 && (
              <details className="left-alone">
                <summary>Left alone ({leftAlone.length})</summary>
                {leftAlone.map((d) => (
                  <Meta key={d.id}>
                    {nameOf(d.signal)}: {d.reason}
                  </Meta>
                ))}
              </details>
            )}
            <div className="step-bar">
              <Button kind="tool" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button kind="primary" onClick={() => setStep(4)}>
                {previewing ? 'Go on without waiting' : 'Looks right'}
              </Button>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <Row gap={6} top={9} className="hero">
              <Pilot pixel={3} />
              <h1 className="serif">Ready for take-off</h1>
            </Row>
            <Check ok title={`Listening to ${list(chosenNames)}, from now on`} detail="Nothing from before today is filed." />
            <Check
              ok
              title={`Sorting into ${list((drafts ?? []).map((d) => titleCase(d.name)))}`}
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
    <div className="check">
      <Dot tone={ok === null ? 'quiet' : ok ? 'pilot' : 'alert'} label={ok === null ? 'checking' : ok ? 'ok' : 'needs attention'} />
      <span className="name">{title}</span>
      <span className="meta">{detail}</span>
      {children && <div className="actions">{children}</div>}
    </div>
  </div>
)
