import { colours, fonts, radius, space, tones } from './tokens.ts'

const kebab = (name: string): string => name.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase()

/** The tokens as the CSS the Mac window loads: variables on :root, and a class per tone. */
export const css = (): string => {
  const vars = [
    ...Object.entries(colours).map(([name, value]) => `  --${kebab(name)}: ${value};`),
    ...Object.entries(fonts)
      .filter(([name]) => name !== 'serifNative')
      .map(([name, value]) => `  --${kebab(name)}: ${value};`),
    ...Object.entries(radius).map(([name, value]) => `  --radius-${name}: ${value}px;`),
    ...Object.entries(space).map(([name, value]) => `  --space-${name}: ${value}px;`),
  ]
  const toneClasses = Object.entries(tones).map(
    ([name, t]) => `.tone-${name} {\n  --tone-fg: ${t.fg};\n  --tone-bg: ${t.bg};\n  --tone-dot: ${t.dot};\n}`,
  )
  return [
    '/* Generated from packages/design/src/tokens.ts by `pnpm tokens`. Do not edit. */',
    '',
    `:root {\n${vars.join('\n')}\n  color-scheme: dark;\n}`,
    '',
    toneClasses.join('\n\n'),
    '',
  ].join('\n')
}
