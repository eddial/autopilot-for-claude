import { contextBridge, ipcRenderer } from 'electron'

/** What the window may ask of the shell. The API itself goes over the MessagePort, not through here. */
export type Mode = { kind: 'local' } | { kind: 'remote'; server: string }

export type Shell = {
  platform: string
  /** Which server the window talks to. */
  mode(): Promise<Mode>
  /** Pairs with another Mac from its copied invite and switches to it (phase 4). */
  connectRemote(invite: string): Promise<Mode>
  /** Back to this Mac's own server. */
  connectLocal(): Promise<Mode>
  setBadge(count: number): void
  /** Light or dark: as the Claude app is set, or fixed to one. */
  appearance(): Promise<'claude' | 'light' | 'dark'>
  setAppearance(choice: 'claude' | 'light' | 'dark'): Promise<'claude' | 'light' | 'dark'>
  openExternal(url: string): void
  /** Shows a local file in Finder. */
  reveal(url: string): void
  onNavigate(listener: (to: string) => void): void
}

// The window makes a MessageChannel and posts one end here; it goes on to the main process,
// which serves the API on it.
window.addEventListener('message', (event) => {
  if (event.source === window && event.data === 'autopilot:port') ipcRenderer.postMessage('autopilot:port', null, [...event.ports])
})

const shell: Shell = {
  platform: process.platform,
  mode: () => ipcRenderer.invoke('autopilot:mode') as Promise<Mode>,
  connectRemote: (invite) => ipcRenderer.invoke('autopilot:use-remote', invite) as Promise<Mode>,
  connectLocal: () => ipcRenderer.invoke('autopilot:use-local') as Promise<Mode>,
  setBadge: (count) => ipcRenderer.send('autopilot:badge', count),
  appearance: () => ipcRenderer.invoke('autopilot:appearance') as Promise<'claude' | 'light' | 'dark'>,
  setAppearance: (choice) => ipcRenderer.invoke('autopilot:set-appearance', choice) as Promise<'claude' | 'light' | 'dark'>,
  openExternal: (url) => ipcRenderer.send('autopilot:open', url),
  reveal: (url) => ipcRenderer.send('autopilot:reveal', url),
  onNavigate: (listener) => {
    ipcRenderer.on('autopilot:navigate', (_event, to: string) => listener(to))
  },
}
contextBridge.exposeInMainWorld('autopilotShell', shell)
