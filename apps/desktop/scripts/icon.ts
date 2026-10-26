import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { colours, pilot } from '@autopilot/design'

/**
 * The app icons, drawn from the pilot in the design tokens on Claude's orange, as Claude's own icon
 * sits: the Mac's (build/icon.png) and the phone's (assets/icon.png). Run after the pilot changes.
 */
const ROOT = join(import.meta.dirname, '..')
const art = JSON.stringify({ rows: pilot.rows, colours: pilot.colours, ground: colours.clay })

const draw = (kind: 'mac' | 'phone', out: string) =>
  execFileSync('swift', [join(ROOT, 'scripts', 'mac-icon.swift'), kind, out], { input: art, stdio: ['pipe', 'inherit', 'inherit'] })

draw('mac', join(ROOT, 'build', 'icon.png'))
draw('phone', join(ROOT, '..', 'mobile', 'assets', 'icon.png'))
