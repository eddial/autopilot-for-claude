import { contextBridge, ipcRenderer } from 'electron'

/** What the window may ask of the shell. The API itself goes over the MessagePort, not through here. */
export type Shell = {
  platform: string
  setBadge(count: number): void
  openExternal(url: string): void
  onNavigate(listener: (to: string) => void): void
}

// The window makes a MessageChannel and posts one end here; it goes on to the main process,
// which serves the API on it.
window.addEventListener('message', (event) => {
  if (event.source === window && event.data === 'autopilot:port') ipcRenderer.postMessage('autopilot:port', null, [...event.ports])
})

const shell: Shell = {
  platform: process.platform,
  setBadge: (count) => ipcRenderer.send('autopilot:badge', count),
  openExternal: (url) => ipcRenderer.send('autopilot:open', url),
  onNavigate: (listener) => {
    ipcRenderer.on('autopilot:navigate', (_event, to: string) => listener(to))
  },
}
contextBridge.exposeInMainWorld('autopilotShell', shell)
