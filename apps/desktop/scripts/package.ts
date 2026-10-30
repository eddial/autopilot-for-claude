import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Packages the window as Autopilot.app: Electron's own app, renamed, with the icon, and the built
 * window inside. The server stays in the checkout (it runs as a launchd agent); the app records
 * where, and which Node, so it can start the server when it is not running.
 *
 *   node scripts/package.ts             out/Autopilot.app
 *   node scripts/package.ts --install   and copied to ~/Applications
 */
const ROOT = join(import.meta.dirname, '..')
const CHECKOUT = join(ROOT, '..', '..')
const OUT = join(ROOT, 'out', 'Autopilot.app')
const run = (file: string, ...args: string[]) => execFileSync(file, args, { stdio: 'inherit' })

run(process.execPath, join(ROOT, 'scripts', 'build.ts'))

// Electron's app, renamed.
rmSync(OUT, { recursive: true, force: true })
mkdirSync(join(ROOT, 'out'), { recursive: true })
run('ditto', join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app'), OUT)
const resources = join(OUT, 'Contents', 'Resources')
rmSync(join(resources, 'default_app.asar'), { force: true })

// The window: the built main process, preload and renderer, and where the server is.
const own = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }
mkdirSync(join(resources, 'app'), { recursive: true })
cpSync(join(ROOT, 'dist'), join(resources, 'app', 'dist'), { recursive: true })
writeFileSync(
  join(resources, 'app', 'package.json'),
  JSON.stringify(
    {
      name: 'autopilot',
      productName: 'Autopilot',
      version: own.version,
      type: 'module',
      main: 'dist/electron/main.js',
      autopilot: { checkout: CHECKOUT, node: process.execPath },
    },
    null,
    2,
  ),
)

// The icon, every size macOS asks for.
const iconset = join(ROOT, 'out', 'icon.iconset')
rmSync(iconset, { recursive: true, force: true })
mkdirSync(iconset)
for (const size of [16, 32, 128, 256, 512]) {
  run('sips', '-z', String(size), String(size), join(ROOT, 'build', 'icon.png'), '--out', join(iconset, `icon_${size}x${size}.png`))
  run(
    'sips',
    '-z',
    String(size * 2),
    String(size * 2),
    join(ROOT, 'build', 'icon.png'),
    '--out',
    join(iconset, `icon_${size}x${size}@2x.png`),
  )
}
run('iconutil', '-c', 'icns', iconset, '-o', join(resources, 'icon.icns'))
rmSync(join(resources, 'electron.icns'), { force: true })

// On macOS 26, the Icon Composer icon, which it draws at full colour (an .icns gets dulled under
// glass). Needs Xcode's actool; without it the .icns above stands alone.
let iconName: string | null = null
try {
  execFileSync(
    'xcrun',
    [
      'actool',
      join(ROOT, 'build', 'Autopilot.icon'),
      '--compile',
      resources,
      '--platform',
      'macosx',
      '--minimum-deployment-target',
      '11.0',
      '--app-icon',
      'Autopilot',
      '--output-partial-info-plist',
      join(ROOT, 'out', 'icon-partial.plist'),
    ],
    { stdio: 'ignore' },
  )
  iconName = 'Autopilot'
} catch {
  console.log('actool not available: the .icns only')
}

// Its name and identity.
const plist = join(OUT, 'Contents', 'Info.plist')
for (const [key, value] of [
  ['CFBundleName', 'Autopilot'],
  ['CFBundleDisplayName', 'Autopilot'],
  ['CFBundleIdentifier', 'ai.autopilot.mac'],
  ['CFBundleIconFile', iconName ? `${iconName}.icns` : 'icon.icns'],
  ...(iconName ? [['CFBundleIconName', iconName]] : []),
  ['CFBundleShortVersionString', own.version],
]) {
  try {
    run('/usr/libexec/PlistBuddy', '-c', `Set :${key} ${value}`, plist)
  } catch {
    run('/usr/libexec/PlistBuddy', '-c', `Add :${key} string ${value}`, plist)
  }
}

// Changed, so signed again (ad hoc: this Mac only).
run('codesign', '--force', '--deep', '--sign', '-', OUT)
console.log(`packaged ${OUT}`)

if (process.argv.includes('--install')) {
  const target = join(homedir(), 'Applications', 'Autopilot.app')
  if (existsSync(target)) rmSync(target, { recursive: true })
  run('ditto', OUT, target)
  // The Dock keeps the icon of the app it saw at this path and draws the new one black until it
  // looks again: tell Launch Services the app changed and have the Dock draw its icons afresh.
  run('touch', target)
  run('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', '-f', target)
  try {
    run('killall', 'Dock')
  } catch {
    // No Dock (a headless Mac): nothing to redraw.
  }
  console.log(`installed ${target}`)
}
