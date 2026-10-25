// Connectors and a real signal preview: what Claude Code reports at start, and a dry run of each
// example signal this Mac can read without filling anything in. Run by scripts/mac-check.sh.
import { checkServer, key, run } from './lib.ts'

const { api } = checkServer()
const previews: string[] = []

await run('Connectors and signals', [
  [
    'Claude Code reports its connectors',
    async () => {
      const { connectors, github } = await api.connectors.detect()
      const list = connectors.map((c) => `${c.name} (${c.status}, ${c.tools.length} tools${c.signal ? `, signal ${c.signal}` : ''})`)
      return `${list.join('; ') || 'none'}; GitHub CLI ${github.cli ? (github.user ? 'signed in' : 'not signed in') : 'not installed'}`
    },
  ],
  [
    'Preview the last two hours of each signal that needs no settings',
    async () => {
      const { connectors, github } = await api.connectors.detect()
      const examples = await api.signals.examples()
      const usable = examples.filter(
        (e) =>
          e.fields.length === 0 &&
          (e.name === 'github' ? github.user !== null : connectors.some((c) => c.signal === e.name && c.tools.length > 0)),
      )
      if (usable.length === 0) return 'no signal to preview (connect Gmail, Linear or Fathom in Claude, or sign in to gh)'
      for (const example of usable) {
        await api.signals.add({ idempotencyKey: key(), name: example.name, values: {} })
        const started = Date.now()
        try {
          const decisions = await api.signals.run({ idempotencyKey: key(), name: example.name, dryMinutes: 120 })
          const count = (action: string) => decisions.filter((d) => d.action === action).length
          previews.push(
            `${example.name}: ${count('created')} new, ${count('updated')} follow-ups, ${count('dropped')} left alone in ${((Date.now() - started) / 1000).toFixed(0)} s`,
          )
        } catch (error) {
          previews.push(`${example.name}: FAILED ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`)
        }
      }
      if (previews.every((p) => p.includes('FAILED'))) throw new Error(previews.join('; '))
      return previews.join('; ')
    },
  ],
])
