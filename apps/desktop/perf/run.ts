// pnpm perf: the numbers behind "it should feel like the text is hardcoded". Seeds a realistic
// queue, times the server's hot paths, then times the window's interactions inside Chromium from
// input to the next painted frame, and checks everything against perf/budgets.json.
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { CreateTask, PostUpdate } from '@autopilot/contracts'
import { connect } from '@autopilot/server/client'
import { startServer } from '@autopilot/server/main'
import { readOwnerToken } from '@autopilot/server/owner'
import { resolvePaths } from '@autopilot/server/paths'
import { chromium, type Page } from 'playwright-core'
import { serveWeb } from '../scripts/web-server.ts'

const ROOT = join(import.meta.dirname, '..')
const budgets = JSON.parse(readFileSync(join(import.meta.dirname, 'budgets.json'), 'utf8')) as Record<string, number>
const results: Record<string, number> = {}
let n = 0
const key = () => `perf-${++n}-key`

/** The median of `runs` timed calls, after one warm-up. */
const median = (fn: () => unknown, runs = 25): number => {
  fn()
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const started = performance.now()
    fn()
    times.push(performance.now() - started)
  }
  return times.toSorted((a, b) => a - b)[Math.floor(times.length / 2)] ?? 0
}

// ── the server, with a heavy but realistic queue: 1000 open tasks, five updates each ──

const dir = mkdtempSync(join(tmpdir(), 'ap-perf-'))
const paths = resolvePaths({ AUTOPILOT_DATA: join(dir, 'data'), AUTOPILOT_HOME: join(dir, 'home') })
const handle = await startServer({
  paths,
  self: { node: process.execPath, script: 'autopilot.js' },
  claude: join(dir, 'no-claude'),
  runClaude: () => Promise.resolve({ items: [] }),
  spawn: () => ({ pid: 1, write: () => {}, kill: () => {}, onData: () => {}, onExit: () => {} }),
  devicePort: 0,
  log: () => {},
})
const { service } = handle
const workstreams = ['engineering', 'customers', 'company']
for (let i = 0; i < 1000; i++) {
  const task = service.createTask(
    CreateTask.parse({ idempotencyKey: key(), title: `Task ${i}: answer the question about the renewal`, workstream: workstreams[i % 3], priority: (i % 4) + 1, start: false }),
  )
  for (let j = 0; j < 5; j++) {
    const ask = i % 10 === 0 && j === 4
    service.postUpdate(
      PostUpdate.parse({
        idempotencyKey: key(),
        taskId: task.id,
        kind: ask ? 'decision' : 'info',
        body: 'Progress on the work, a few sentences long, as sessions write them. '.repeat(3),
        ...(ask ? { options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] } : {}),
      }),
      'session',
    )
  }
}
results['server.snapshot.1000'] = median(() => service.queue())
results['server.taskDetail'] = median(() => service.getTask('AP-500'), 200)
results['server.changesSince'] = median(() => service.changesSince(service.latestSeq() - 50, 500), 200)
results['server.write'] = median(() => service.postUpdate(PostUpdate.parse({ idempotencyKey: key(), taskId: 'AP-7', kind: 'info', body: 'More.' }), 'session'), 200)

// ── the window, in Chromium against that server ──

// The production build, as the Mac app loads it.
const web = await serveWeb(connect(paths.socket, readOwnerToken(paths) ?? ''), 0, { built: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

/**
 * Clicks the element `target` (a JS expression) inside the page and checks `done` at each frame;
 * the time is from input to the frame that paints the result, without Playwright's round trips.
 * One frame (about 16 ms) is as fast as anything can be on screen.
 */
const interaction = (p: Page, target: string, done: string): Promise<number> =>
  p.evaluate(
    async (spec) => {
      const element = (new Function(`return (${spec.target})`) as () => HTMLElement | null)()
      if (!element) throw new Error(`nothing matches ${spec.target}`)
      const holds = new Function(`return (${spec.done})`) as () => boolean
      const started = performance.now()
      element.click()
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${spec.done}`)), 5000)
        const check = () => {
          if (holds()) {
            clearTimeout(timer)
            resolve()
          } else requestAnimationFrame(check)
        }
        check()
      })
      // The change is in the DOM at the start of this frame, so this frame paints it.
      return performance.now() - started
    },
    { target, done },
  )

await page.addInitScript(() => {
  const w = window as unknown as { longTaskCount: number }
  w.longTaskCount = 0
  new PerformanceObserver((list) => {
    w.longTaskCount += list.getEntries().length
  }).observe({ type: 'longtask', buffered: false })
})
await page.goto(web.url)
results['window.firstRows'] = await page.evaluate(async () => {
  while (!document.querySelector('[role="option"]')) await new Promise((r) => requestAnimationFrame(r))
  return performance.now()
})
if (process.env.PERF_DEBUG) {
  console.log(
    'first load:',
    // Runs in the page, so everything is spelled out inside it.
    await page.evaluate(() => ({
      domContentLoaded: (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.domContentLoadedEventEnd.toFixed(0),
      subscribe: performance.getEntriesByName('autopilot:subscribe')[0]?.startTime.toFixed(0),
      snapshot: performance.getEntriesByName('autopilot:snapshot')[0]?.startTime.toFixed(0),
    })),
  )
}
// Only interactions count towards long tasks; loading has its own budget.
await page.evaluate(() => {
  ;(window as unknown as { longTaskCount: number }).longTaskCount = 0
})

// Rows on screen, as a person would click them; a moment of hover first, as a pointer gives.
const row = (i: number) => `document.querySelectorAll('[role="option"]')[${i}]`
const opened = (i: number) =>
  `document.querySelector('.task h2')?.textContent === document.querySelectorAll('[role="option"]')[${i}]?.querySelector('.title')?.textContent && document.querySelectorAll('.timeline .msg').length >= 5`
const hover = (i: number) => page.hover(`[role="option"] >> nth=${i}`).then(() => page.waitForTimeout(150))

const openTimes: number[] = []
for (const i of [2, 4, 6, 8, 10]) {
  await hover(i)
  openTimes.push(await interaction(page, row(i), opened(i)))
}
results['window.openTask'] = openTimes.toSorted((a, b) => a - b)[2] ?? 0

// Rows waiting on a decision; answering one takes it off the list.
const answerTimes: number[] = []
for (let k = 0; k < 3; k++) {
  const i = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')].findIndex((r) => r.textContent?.includes('Needs your decision')))
  if (i < 0) throw new Error('no decision on screen')
  await hover(i)
  await interaction(page, row(i), `${opened(i)} && !!document.querySelector('.timeline .options .btn')`)
  answerTimes.push(await interaction(page, `document.querySelector('.timeline .options .btn')`, `!document.querySelector('.timeline .options .btn')`))
}
results['window.answer'] = answerTimes.toSorted((a, b) => a - b)[1] ?? 0

const switchTimes: number[] = []
for (const [view, title] of [['Waiting on others', 'Waiting on others'], ['Needs me', 'Needs me'], ['Running', 'Running'], ['Needs me', 'Needs me']] as const) {
  const index = await page.evaluate((v) => [...document.querySelectorAll('nav .nav-item')].findIndex((b) => b.textContent?.startsWith(v)), view)
  switchTimes.push(await interaction(page, `document.querySelectorAll('nav .nav-item')[${index}]`, `document.querySelector('.list h1')?.textContent === '${title}'`))
}
results['window.switchView'] = switchTimes.toSorted((a, b) => a - b)[2] ?? 0
results['window.longTasks.count'] = await page.evaluate(() => (window as unknown as { longTaskCount: number }).longTaskCount)

// The everyday start: the window opened again, drawing from its saved queue.
await page.waitForTimeout(1500)
await page.reload()
results['window.firstRows.cached'] = await page.evaluate(async () => {
  while (!document.querySelector('[role="option"]')) await new Promise((r) => requestAnimationFrame(r))
  return performance.now()
})

await browser.close()
await web.close()
await handle.close()

// ── what the window costs to load: the built renderer, gzipped ──

const assets = join(ROOT, 'dist', 'renderer', 'assets')
try {
  results['window.js.gzipKB'] = readdirSync(assets)
    .filter((f) => f.endsWith('.js'))
    .reduce((total, f) => total + gzipSync(readFileSync(join(assets, f))).length / 1024, 0)
} catch {
  console.log('(no dist/renderer: run pnpm --filter @autopilot/desktop build first for the bundle size)')
}

// ── the verdict ──

const rows = Object.entries(budgets)
  .filter(([name]) => !name.startsWith('$'))
  .map(([name, budget]) => {
    const value = results[name]
    const ok = value === undefined || value <= budget
    return { name, value, budget, ok }
  })
const table = [
  '| Measure | Result | Budget | |',
  '| --- | ---: | ---: | --- |',
  ...rows.map((r) => `| ${r.name} | ${r.value === undefined ? 'not measured' : r.value.toFixed(r.value < 10 ? 2 : 0)} | ${r.budget} | ${r.ok ? 'ok' : 'OVER'} |`),
].join('\n')
console.log(table)
writeFileSync(join(import.meta.dirname, 'results.json'), JSON.stringify(results, null, 2))
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Performance\n\n${table}\n`)
process.exitCode = rows.every((r) => r.ok) ? 0 : 1
