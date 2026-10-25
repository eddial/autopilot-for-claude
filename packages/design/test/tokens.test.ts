import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { css } from '../src/css.ts'
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

  it('the apps take every colour from the tokens', () => {
    const found = SOURCES.flatMap((dir) => files(join(ROOT, dir))).flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .flatMap((line, i) => (COLOUR.test(line) ? [`${relative(ROOT, path)}:${i + 1}: ${line.trim()}`] : [])),
    )
    expect(found, 'Use a token from @autopilot/design (or add one there)').toEqual([])
  })
})
