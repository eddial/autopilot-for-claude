import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { connect, type Client } from '@autopilot/server/client'
import { readOwnerToken } from '@autopilot/server/owner'
import { resolvePaths } from '@autopilot/server/paths'
import { RPCHandler } from '@orpc/server/message-port'
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import { proxyRouter } from './proxy.ts'
import { pilotBitmap } from './pilot.ts'

const paths = resolvePaths()
/** The checkout this runs from: apps/desktop, so the server is next door. */
const SERVER_BIN = join(app.getAppPath(), '..', 'server', 'bin', 'autopilot.js')

let window: BrowserWindow | null = null
let tray: Tray | null = null

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
  const child = spawn(process.env.AUTOPILOT_NODE ?? 'node', [SERVER_BIN, 'serve'], { detached: true, stdio: ['ignore', log, log], env })
  child.unref()
  for (let i = 0; i < 50; i++) {
    await sleep(200)
    const client = await reachable()
    if (client) return client
  }
  throw new Error(`The Autopilot server did not start; see ${join(paths.logs, 'server.log')}`)
}

const createWindow = (): BrowserWindow => {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 380,
    minHeight: 480,
    backgroundColor: '#1F1E1D',
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
      submenu: [
        { label: 'New Task', accelerator: 'CmdOrCtrl+N', click: () => show('new') },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ])

const start = async (): Promise<void> => {
  const client = await ensureServer()
  const handler = new RPCHandler(proxyRouter(client))
  ipcMain.on('autopilot:port', (event) => {
    const [port] = event.ports
    if (!port) return
    handler.upgrade(port)
    port.start()
  })
  ipcMain.on('autopilot:badge', (_event, count: unknown) => {
    const text = typeof count === 'number' && count > 0 ? String(count) : ''
    tray?.setTitle(text)
    app.dock?.setBadge(text)
  })
  ipcMain.on('autopilot:open', (_event, url: unknown) => {
    if (typeof url === 'string' && /^(https?|claude):/.test(url)) void shell.openExternal(url)
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
  .then(start)
  .catch((error: unknown) => {
    console.error(error)
    app.quit()
  })
