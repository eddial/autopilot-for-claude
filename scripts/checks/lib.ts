import { setTimeout as sleep } from 'node:timers/promises'
import { connect } from '../../apps/server/src/client.ts'
import { readOwnerToken } from '../../apps/server/src/owner.ts'
import { resolvePaths } from '../../apps/server/src/paths.ts'

/** The check server mac-check.sh started, from the same AUTOPILOT_DATA and AUTOPILOT_SOCKET. */
export const checkServer = () => {
  const paths = resolvePaths()
  const token = readOwnerToken(paths)
  if (!token) throw new Error(`No owner token in ${paths.data}; is the check server running?`)
  return { paths, api: connect(paths.socket, token) }
}

export type Step = { name: string; ok: boolean; seconds: number; detail: string }

/** Runs the steps in order, recording each; a failed step stops the ones after it. */
export const run = async (title: string, steps: [string, () => Promise<string>][]): Promise<void> => {
  const results: Step[] = []
  for (const [name, fn] of steps) {
    const started = Date.now()
    try {
      const detail = await fn()
      results.push({ name, ok: true, seconds: (Date.now() - started) / 1000, detail })
    } catch (error) {
      results.push({ name, ok: false, seconds: (Date.now() - started) / 1000, detail: error instanceof Error ? error.message : String(error) })
      break
    }
  }
  console.log(`### ${title}\n`)
  for (const r of results) console.log(`- ${r.ok ? 'PASS' : 'FAIL'} ${r.name} (${r.seconds.toFixed(1)} s): ${r.detail}`)
  const skipped = steps.length - results.length
  if (skipped > 0) console.log(`- SKIPPED ${skipped} later step(s)`)
  console.log('')
  process.exitCode = results.every((r) => r.ok) && skipped === 0 ? 0 : 1
}

/** Polls until `check` returns something, or fails after `seconds`. */
export const waitFor = async <T>(what: string, seconds: number, check: () => Promise<T | null | undefined>): Promise<T> => {
  const deadline = Date.now() + seconds * 1000
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`Timed out after ${seconds} s waiting for ${what}`)
    await sleep(2000)
  }
}

export const key = () => crypto.randomUUID()
