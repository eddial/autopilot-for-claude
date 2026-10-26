import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { css } from '../src/css.ts'
import { shapes } from '../src/tokens.ts'
import { CSS_PATH, ROOT } from '../scripts/paths.ts'

const SOURCES = ['apps/desktop/src', 'apps/desktop/electron', 'apps/mobile/src', 'apps/mobile/app']
const COLOUR = /#[0-9a-f]{3,8}\b|rgba?\(/i

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return files(path)
    return /\.(tsx?|css)$/.test(entry.name) && path !== CSS_PATH ? [path] : []
  })

describe('design tokens', () => {
  it('the window loads the current tokens', () => {
    // After changing tokens.ts: pnpm tokens
    expect(readFileSync(CSS_PATH, 'utf8')).toBe(css())
  })

  it('the window states each style rule once', () => {
    // A rule written twice wins by position, so an edit to the first copy silently does nothing.
    const styles = readFileSync(join(ROOT, 'apps/desktop/src/styles.css'), 'utf8').replace(/@media[^{]*\{([\s\S]*?)\n\}/g, '')
    const selectors = [...styles.matchAll(/^([^\s@/}][^{]*)\{/gm)].map((m) => m[1]?.replace(/\s+/g, ' ').trim())
    expect(selectors.filter((s, i) => selectors.indexOf(s) !== i)).toEqual([])
  })

  it('both apps draw every shared block from its shape', () => {
    // A row, a button or a card shaped by hand in one app drifts from the other: use shapes.
    const styles = readFileSync(join(ROOT, 'apps/desktop/src/styles.css'), 'utf8')
    const phone = SOURCES.slice(2)
      .flatMap((dir) => files(join(ROOT, dir)))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')
    const unused = Object.keys(shapes).flatMap((block) => [
      ...(styles.includes(`var(--shape-${block}-`) ? [] : [`Mac: --shape-${block}-*`]),
      ...(phone.includes(`shaped('${block}')`) || phone.includes(`shapes.${block}.`) ? [] : [`phone: shaped('${block}')`]),
    ])
    expect(unused).toEqual([])
  })

  it('the apps take every colour from the tokens', () => {
    const found = SOURCES.flatMap((dir) => files(join(ROOT, dir))).flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .flatMap((line, i) => (COLOUR.test(line) ? [`${relative(ROOT, path)}:${i + 1}: ${line.trim()}`] : [])),
    )
    expect(found, 'Use a token from @autopilot/design (or add one there)').toEqual([])
  })
})
