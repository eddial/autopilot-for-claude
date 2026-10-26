import { colours, fonts, lightColours, radius, space, toneColours } from './tokens.ts'

const kebab = (name: string): string => name.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase()

/** A palette as CSS variables. */
const palette = (set: Record<string, string>, indent: string) =>
  Object.entries(set).map(([name, value]) => `${indent}--${kebab(name)}: ${value};`)

/**
 * The tokens as the CSS the Mac window loads: variables on :root, dark by default and light when
 * the window's colour scheme is (the main process sets it from the Claude app's theme), and a
 * class per tone, made of those variables so it follows too.
 */
export const css = (): string => {
  const vars = [
    ...palette(colours, '  '),
    ...Object.entries(fonts)
      .filter(([name]) => name !== 'serifNative')
      .map(([name, value]) => `  --${kebab(name)}: ${value};`),
    ...Object.entries(radius).map(([name, value]) => `  --radius-${name}: ${value}px;`),
    ...Object.entries(space).map(([name, value]) => `  --space-${name}: ${value}px;`),
  ]
  const toneClasses = Object.entries(toneColours).map(
    ([name, t]) =>
      `.tone-${name} {\n  --tone-fg: var(--${kebab(t.fg)});\n  --tone-bg: var(--${kebab(t.bg)});\n  --tone-dot: var(--${kebab(t.dot)});\n}`,
  )
  return [
    '/* Generated from packages/design/src/tokens.ts by `pnpm tokens`. Do not edit. */',
    '',
    `:root {\n${vars.join('\n')}\n  color-scheme: dark;\n}`,
    '',
    `@media (prefers-color-scheme: light) {\n  :root {\n${palette(lightColours, '    ').join('\n')}\n    color-scheme: light;\n  }\n}`,
    '',
    toneClasses.join('\n\n'),
    '',
  ].join('\n')
}
