import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, unwatchFile, watchFile, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { Link, pair, type Connection } from '@autopilot/client'
import { nodePinnedFetch } from '@autopilot/client/node'
import { Invite } from '@autopilot/contracts'
import { colours, lightColours } from '@autopilot/design'
import { setTimeout as sleep } from 'node:timers/promises'
import { connect, type Client } from '@autopilot/server/client'
import { readOwnerToken } from '@autopilot/server/owner'
import { resolvePaths } from '@autopilot/server/paths'
import { RPCHandler } from '@orpc/server/message-port'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, safeStorage, shell, Tray } from 'electron'
import { proxyRouter } from './proxy.ts'
import { pilotBitmap } from './pilot.ts'
import type { Mode } from './preload.ts'

/** What a file link may open directly: documents, never anything that runs. */
const DOCUMENT = /\.(md|markdown|txt|csv|json|ya?ml|html?|eml|pdf|docx?|xlsx?|pptx?|key|pages|numbers|rtf|png|jpe?g|gif|svg|webp)$/i

const paths = resolvePaths()
/** The checkout this runs from: apps/desktop, so the server is next door. */
/**
 * Where the server's code and a Node 24 are, for starting the server when it is not running. Run
 * from the repository, next to this app; packaged (`pnpm --filter @autopilot/desktop package`),
 * from the checkout and Node it was packaged from, written into its package.json.
 */
const packaged = ((): { checkout?: string; node?: string } => {
  if (!app.isPackaged) return {}
  try {
    return (
      (JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as { autopilot?: { checkout?: string; node?: string } })
        .autopilot ?? {}
    )
  } catch {
    return {}
  }
})()
const SERVER_BIN = packaged.checkout
  ? join(packaged.checkout, 'apps', 'server', 'bin', 'autopilot.js')
  : join(app.getAppPath(), '..', 'server', 'bin', 'autopilot.js')

let window: BrowserWindow | null = null
let tray: Tray | null = null

/** Which server the window talks to: this Mac's own, or another Mac's this one paired with (phase 4). */
let mode: Mode = { kind: 'local' }
let handler: RPCHandler<Record<never, never>> | null = null

// The pairing with another Mac, token included, encrypted with the Keychain.
const remoteFile = () => join(app.getPath('userData'), 'remote-server.bin')

const readRemote = (): Connection | null => {
  if (!existsSync(remoteFile()) || !safeStorage.isEncryptionAvailable()) return null
  try {
    return JSON.parse(safeStorage.decryptString(readFileSync(remoteFile()))) as Connection
  } catch {
    return null
  }
}

const pinned = nodePinnedFetch()

const reachable = async (): Promise<Client | null> => {
  const token = readOwnerToken(paths)
  if (!token || !existsSync(paths.socket)) return null
  const client = connect(paths.socket, token)
  try {
    await client.meta.version()
    return client
  } catch {
    return null
  }
}

/**
 * The server normally runs as a launchd agent (`autopilot service install`). When it is not
 * running, start it for as long as it lives, with the Node on PATH (Node 24).
 */
const ensureServer = async (): Promise<Client> => {
  const running = await reachable()
  if (running) return running
  mkdirSync(paths.logs, { recursive: true })
  const log = openSync(join(paths.logs, 'server.log'), 'a')
  const { ELECTRON_RUN_AS_NODE: _electron, ...env } = process.env
  const child = spawn(process.env.AUTOPILOT_NODE ?? packaged.node ?? 'node', [SERVER_BIN, 'serve'], {
    detached: true,
    stdio: ['ignore', log, log],
    env,
  })
  child.unref()
  for (let i = 0; i < 50; i++) {
    await sleep(200)
    const client = await reachable()
    if (client) return client
  }
  throw new Error(`The Autopilot server did not start; see ${join(paths.logs, 'server.log')}`)
}

/**
 * Light or dark as the Claude app is set (Settings, Appearance: light, dark or the system's), read
 * from its own settings file and followed when it changes. Without the Claude app, the system's.
 */
const CLAUDE_CONFIG = join(homedir(), 'Library', 'Application Support', 'Claude', 'config.json')

const claudeTheme = (): 'light' | 'dark' | 'system' => {
  try {
    const set = (JSON.parse(readFileSync(CLAUDE_CONFIG, 'utf8')) as { userThemeMode?: unknown }).userThemeMode
    return set === 'light' || set === 'dark' ? set : 'system'
  } catch {
    return 'system'
  }
}

const background = () => (nativeTheme.shouldUseDarkColors ? colours.window : lightColours.window)

const followClaudeTheme = () => {
  nativeTheme.themeSource = claudeTheme()
  // The window paints in its theme; this is the colour behind it while it loads or resizes.
  nativeTheme.on('updated', () => window?.setBackgroundColor(background()))
  watchFile(CLAUDE_CONFIG, { interval: 2000 }, () => {
    const next = claudeTheme()
    if (nativeTheme.themeSource !== next) nativeTheme.themeSource = next
  })
  app.on('will-quit', () => unwatchFile(CLAUDE_CONFIG))
}

const createWindow = (): BrowserWindow => {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 380,
    minHeight: 480,
    backgroundColor: background(),
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: { preload: join(import.meta.dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|claude):/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  const dev = process.env.AUTOPILOT_DEV_URL
  if (dev) void win.loadURL(dev)
  else void win.loadFile(join(import.meta.dirname, '..', 'renderer', 'index.html'))
  win.on('closed', () => {
    window = null
  })
  return win
}

const show = (to?: string): void => {
  window ??= createWindow()
  window.show()
  window.focus()
  if (to) window.webContents.send('autopilot:navigate', to)
}

const menu = (): Menu =>
  Menu.buildFromTemplate([
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [{ label: 'New Task', accelerator: 'CmdOrCtrl+N', click: () => show('new') }, { type: 'separator' }, { role: 'close' }],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ])

/** Serves the window from another Mac when this one is paired with it, else from this Mac's server. */
const connectServer = async (): Promise<void> => {
  const remote = readRemote()
  const client: Client = remote ? new Link(remote, pinned).api : await ensureServer()
  mode = remote ? { kind: 'remote', server: remote.server } : { kind: 'local' }
  handler = new RPCHandler(proxyRouter(client))
}

/** After switching servers the window reloads, and its new port is served by the new handler. */
const switched = async (): Promise<void> => {
  await connectServer()
  window?.webContents.reload()
}

const start = async (): Promise<void> => {
  await connectServer()
  ipcMain.on('autopilot:port', (event) => {
    const [port] = event.ports
    if (!port || !handler) return
    handler.upgrade(port)
    port.start()
  })
  ipcMain.handle('autopilot:mode', () => mode)
  ipcMain.handle('autopilot:use-remote', async (_event, text: unknown) => {
    const invite = Invite.safeParse(typeof text === 'string' ? JSON.parse(text.trim()) : null)
    if (!invite.success) throw new Error('That is not an Autopilot invite. Copy it from Servers on the other Mac.')
    if (!safeStorage.isEncryptionAvailable()) throw new Error('The Keychain is not available to keep the pairing.')
    const connection = await pair(invite.data, { name: hostname().split('.')[0] ?? 'Mac', kind: 'mac' }, pinned, randomUUID())
    writeFileSync(remoteFile(), safeStorage.encryptString(JSON.stringify(connection)), { mode: 0o600 })
    await switched()
    return mode
  })
  ipcMain.handle('autopilot:use-local', async () => {
    rmSync(remoteFile(), { force: true })
    await switched()
    return mode
  })
  ipcMain.on('autopilot:badge', (_event, count: unknown) => {
    const text = typeof count === 'number' && count > 0 ? String(count) : ''
    tray?.setTitle(text)
    app.dock?.setBadge(text)
  })
  ipcMain.on('autopilot:open', (_event, url: unknown) => {
    if (typeof url !== 'string') return
    if (/^(https?|claude):/.test(url)) void shell.openExternal(url)
    else if (url.startsWith('file:')) {
      // A document opens in its app; anything else, which could run, is only shown in Finder.
      const path = fileURLToPath(url)
      if (DOCUMENT.test(path)) void shell.openPath(path)
      else shell.showItemInFolder(path)
    }
  })
  ipcMain.on('autopilot:reveal', (_event, url: unknown) => {
    if (typeof url === 'string' && url.startsWith('file:')) shell.showItemInFolder(fileURLToPath(url))
  })

  Menu.setApplicationMenu(menu())
  const icon = nativeImage.createFromBitmap(pilotBitmap(), { width: 16, height: 16, scaleFactor: 1 })
  tray = new Tray(icon)
  tray.setToolTip('Autopilot')
  tray.on('click', () => show())
  // Over any app, like Spotlight: the New task box.
  globalShortcut.register('Control+Alt+Space', () => show('new'))
  show()
  if (process.env.AUTOPILOT_SMOKE) void smoke()
}

/**
 * `AUTOPILOT_SMOKE=1`: open the window, wait until it is live on the server's feed, print the
 * result and quit. CI and scripts/mac-check.sh use it to prove the packaged pieces fit together.
 */
const smoke = async (): Promise<void> => {
  let last = ''
  for (const deadline = Date.now() + 60_000; Date.now() < deadline; await sleep(500)) {
    last = String(await window?.webContents.executeJavaScript('document.body.dataset.connection ?? ""').catch(() => ''))
    if (last === 'live') {
      console.log('AUTOPILOT SMOKE OK: the window is live on the server')
      app.exit(0)
      return
    }
  }
  console.log(`AUTOPILOT SMOKE FAILED: connection is "${last}" after 60 seconds`)
  app.exit(1)
}

if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => show())
app.on('activate', () => show())
app.on('window-all-closed', () => {
  // Stays in the menu bar.
})
app.on('will-quit', () => globalShortcut.unregisterAll())
app
  .whenReady()
  .then(() => {
    followClaudeTheme()
    return start()
  })
  .catch((error: unknown) => {
    console.error(error)
    app.quit()
  })
