import { useCallback, useEffect, useState } from 'react'
import type { Device, Machine, Pairing, Token } from '@autopilot/contracts'
import QRCode from 'qrcode'
import type { Mode } from '../../electron/preload.ts'
import { api, key, shell } from '../api.ts'
import { colours } from '@autopilot/design'
import { ago } from '../format.ts'
import { Banner, Button, Dot, Meta, Row } from '../ui.tsx'

const ROUTE_LABEL = { socket: 'Socket', lan: 'Home network', tailscale: 'Tailscale' } as const

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Machines, paired devices, agent tokens, and pairing a new iPhone by QR code. */
export const Servers = () => {
  const [machines, setMachines] = useState<Machine[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [tokens, setTokens] = useState<Token[]>([])
  const [pairing, setPairing] = useState<{ pairing: Pairing; svg: string; known: Set<string> } | null>(null)
  const [paired, setPaired] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode | null>(null)
  const [invite, setInvite] = useState('')
  const [switching, setSwitching] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void shell?.mode().then(setMode)
  }, [])

  const switchToRemote = async () => {
    if (!shell) return
    setSwitching(true)
    setError(null)
    try {
      setMode(await shell.connectRemote(invite))
    } catch (e) {
      // Errors from the main process arrive wrapped; keep the sentence that matters.
      setError(message(e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      setSwitching(false)
    }
  }

  const load = useCallback(() => {
    Promise.all([api.machines.list(), api.devices.list(), api.tokens.list()])
      .then(([m, d, t]) => {
        setMachines(m)
        setDevices(d)
        // Sessions and signals get short-lived tokens of their own; this Mac's token and paired devices'
        // are managed above (revoking this Mac's would lock the app out).
        setTokens(
          t.filter((x) => x.scope !== 'session' && x.scope !== 'signal' && x.name !== 'This Mac' && !/ \((iphone|mac)\)$/.test(x.name)),
        )
      })
      .catch((e: unknown) => setError(message(e)))
  }, [])
  useEffect(load, [load])

  const startPairing = async () => {
    setError(null)
    setPaired(null)
    try {
      const next = await api.devices.startPairing({ idempotencyKey: key() })
      const svg = await QRCode.toString(JSON.stringify(next.invite), {
        type: 'svg',
        margin: 1,
        color: { dark: colours.well, light: colours.text },
      })
      setPairing({ pairing: next, svg, known: new Set(devices.map((d) => d.id)) })
      load()
    } catch (e) {
      setError(message(e))
    }
  }

  // While the code is up, watch for the phone to appear; the code expires after five minutes.
  useEffect(() => {
    if (!pairing) return
    const timer = setInterval(() => {
      if (Date.now() > Date.parse(pairing.pairing.expiresAt)) {
        setPairing(null)
        return
      }
      void api.devices.list().then((list) => {
        const fresh = list.find((d) => !pairing.known.has(d.id))
        setDevices(list)
        if (fresh) {
          setPaired(fresh.name)
          setPairing(null)
        }
      })
    }, 2000)
    return () => clearInterval(timer)
  }, [pairing])

  const mac = machines[0]
  return (
    <section className="pane task" aria-label="Servers">
      <div className="task-head drag" />
      <div className="page narrow">
        <h1 className="serif">Servers</h1>
        {error && <Banner>{error}</Banner>}

        {shell && mode && (
          <>
            <h2>This app</h2>
            <div className="card">
              <div className="card-head">
                <span className="name">{mode.kind === 'remote' ? `Uses ${mode.server}` : 'Uses this Mac'}</span>
                <span className="meta">
                  {mode.kind === 'remote'
                    ? 'The queue and the sessions run on that Mac; this one shows them.'
                    : 'The queue and the sessions run here.'}
                </span>
                {mode.kind === 'remote' && (
                  <div className="actions">
                    <Button kind="tool" onClick={() => void shell?.connectLocal().then(setMode)}>
                      Use this Mac instead
                    </Button>
                  </div>
                )}
              </div>
              {mode.kind === 'local' && (
                <>
                  <Meta top={4}>
                    To use an always-on Mac instead: on that Mac open Servers, choose Pair a device, then Copy invite for a Mac, and paste
                    it here.
                  </Meta>
                  <textarea
                    className="inline-reply"
                    rows={2}
                    aria-label="Invite from another Mac"
                    placeholder='{"v":1,"server":…}'
                    value={invite}
                    onChange={(e) => setInvite(e.target.value)}
                  />
                  <Row top={3}>
                    <Button disabled={switching || !invite.trim()} onClick={() => void switchToRemote()}>
                      {switching ? 'Connecting…' : 'Use that Mac'}
                    </Button>
                  </Row>
                </>
              )}
            </div>
          </>
        )}

        <h2>This Mac</h2>
        {mac && (
          <div className="card">
            <div className="card-head">
              <Dot tone="good" />
              <span className="name">{mac.name}</span>
              <span className="meta">
                Runs the queue and the sessions · {mac.running} of {mac.capacity} sessions running
              </span>
            </div>
            <Meta top={3} className="prose">
              {mac.routes.filter((r) => r.kind !== 'socket').length === 0
                ? 'Not reachable from other devices until you pair one.'
                : mac.routes
                    .filter((r) => r.kind !== 'socket')
                    .map((r) => (
                      <div key={r.address}>
                        {ROUTE_LABEL[r.kind]}: {r.address}
                      </div>
                    ))}
            </Meta>
          </div>
        )}

        <h2>Devices</h2>
        {paired && <Banner tone="good">Paired with {paired}.</Banner>}
        {devices.length === 0 && !pairing && <Meta>No phone yet. Pair your iPhone to answer and add tasks from anywhere.</Meta>}
        {devices.map((d) => (
          <div key={d.id} className="card">
            <div className="card-head">
              <span className="name">{d.name}</span>
              <span className="meta">
                {d.kind === 'iphone' ? 'iPhone' : 'Mac'} · paired {ago(d.createdAt)}
                {d.lastSeenAt ? ` · seen ${ago(d.lastSeenAt)}` : ''}
              </span>
              <div className="actions">
                <Button
                  kind="tool"
                  onClick={() =>
                    void api.devices.remove({ idempotencyKey: key(), id: d.id }).then(load, (e: unknown) => setError(message(e)))
                  }
                >
                  Remove
                </Button>
              </div>
            </div>
          </div>
        ))}
        {pairing ? (
          <div className="card pairing">
            <div className="qr" dangerouslySetInnerHTML={{ __html: pairing.svg }} />
            <div>
              <div className="name">Scan this in Autopilot on your iPhone</div>
              <ol className="meta steps-list">
                <li>Install Autopilot on the iPhone from TestFlight.</li>
                <li>Be on the same Wi-Fi as this Mac, or both on Tailscale.</li>
                <li>Open it and scan. The code works once and for five minutes.</li>
              </ol>
              <div className="meta">
                Or type the code: <span className="code">{pairing.pairing.invite.code}</span>
              </div>
              <Row gap={4} top={4} className="meta">
                Waiting for your phone…
                <Button
                  kind="tool"
                  onClick={() =>
                    void navigator.clipboard.writeText(JSON.stringify(pairing.pairing.invite)).then(() => {
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2000)
                    })
                  }
                >
                  {copied ? 'Copied' : 'Copy invite for a Mac'}
                </Button>
              </Row>
            </div>
          </div>
        ) : (
          <Row top={3}>
            <Button kind="primary" onClick={() => void startPairing()}>
              Pair a device
            </Button>
          </Row>
        )}

        <h2>Agents</h2>
        <Meta className="intro">
          Tokens for agents and apps that use Autopilot over MCP (<code>autopilot token</code>). Paired devices have their own.
        </Meta>
        {tokens.length === 0 && <Meta>None yet.</Meta>}
        {tokens.map((t) => (
          <div key={t.id} className="card">
            <div className="card-head">
              <span className="name">{t.name}</span>
              <span className="meta">
                {t.scope} · {t.lastUsedAt ? `used ${ago(t.lastUsedAt)}` : 'never used'}
              </span>
              <div className="actions">
                <Button kind="tool" onClick={() => void api.tokens.revoke({ idempotencyKey: key(), id: t.id }).then(load)}>
                  Revoke
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
