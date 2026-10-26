import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { colours, pilot } from '@autopilot/design'

/**
 * The app icons, drawn from the pilot in the design tokens on Claude's orange, as Claude's own icon
 * sits: the Mac's (build/icon.png, and build/Autopilot.icon for macOS 26) and the phone's
 * (assets/icon.png), and the phone's splash. Run after the pilot changes.
 */
const ROOT = join(import.meta.dirname, '..')
const art = (ground: string) => JSON.stringify({ rows: pilot.rows, colours: pilot.colours, ground })

const draw = (kind: 'mac' | 'phone' | 'splash' | 'layer', out: string, ground: string = colours.clay) =>
  execFileSync('swift', [join(ROOT, 'scripts', 'mac-icon.swift'), kind, out], { input: art(ground), stdio: ['pipe', 'inherit', 'inherit'] })

draw('mac', join(ROOT, 'build', 'icon.png'))
draw('phone', join(ROOT, '..', 'mobile', 'assets', 'icon.png'))
// The phone's launch screen, on the dark window colour app.json gives it.
draw('splash', join(ROOT, '..', 'mobile', 'assets', 'splash.png'), colours.window)

// macOS 26 draws an old-style icon under glass, duller than Claude's beside it; an Icon Composer
// icon (the clay ground, the pilot as its one layer) it draws at full colour. package.ts compiles it.
const icon = join(ROOT, 'build', 'Autopilot.icon')
mkdirSync(join(icon, 'Assets'), { recursive: true })
draw('layer', join(icon, 'Assets', 'pilot.png'))
const channel = (hex: string, at: number) => (Number.parseInt(hex.slice(at, at + 2), 16) / 255).toFixed(5)
const clay = `srgb:${channel(colours.clay, 1)},${channel(colours.clay, 3)},${channel(colours.clay, 5)},1.00000`
writeFileSync(
  join(icon, 'icon.json'),
  `${JSON.stringify(
    {
      fill: { solid: clay },
      groups: [
        {
          layers: [{ 'image-name': 'pilot.png', name: 'pilot' }],
          shadow: { kind: 'none', opacity: 0 },
          translucency: { enabled: false, value: 0 },
        },
      ],
      'supported-platforms': { squares: 'shared' },
    },
    null,
    2,
  )}\n`,
)
