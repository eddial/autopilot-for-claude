import { useEffect, useState } from 'react'
import { DarkTheme, router, Stack, ThemeProvider } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { StatusBar } from 'expo-status-bar'
import {
  booted,
  connectTo,
  forgetPairing,
  loadConnection,
  registerBackgroundSync,
  useItems,
  useSyncInstance,
  useSyncState,
  useWakeUps,
} from '../src/store.ts'
import { colours } from '@autopilot/design'
import { colourScheme } from '../src/theme.ts'

const NAV_THEME = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colours.well, card: colours.well, border: colours.border, text: colours.text },
}

export default function Root() {
  // Ready at once when the pairing and cache were read before the first frame (the usual case).
  const [ready, setReady] = useState(() => booted() !== null)
  const sync = useSyncInstance()
  useWakeUps(sync)

  useEffect(() => {
    const started = booted()
    if (started) started.start()
    else
      void loadConnection()
        .then((connection) => (connection ? connectTo(connection, false) : null))
        .finally(() => setReady(true))
    void registerBackgroundSync().catch(() => {})
    // A tapped notification opens its task.
    const tapped = Notifications.addNotificationResponseReceivedListener((response) => {
      const taskId = response.notification.request.content.data?.taskId
      if (typeof taskId === 'string') router.push({ pathname: '/queue/[id]', params: { id: taskId } })
    })
    return () => tapped.remove()
  }, [])

  // Removed on the Mac under Servers: back to pairing, with a word on why.
  const { status } = useSyncState()
  useEffect(() => {
    if (status === 'unpaired') void forgetPairing()
  }, [status])

  // Asked once paired, when there is something to be told about, rather than at first launch.
  const paired = sync !== null
  useEffect(() => {
    if (paired) void Notifications.requestPermissionsAsync().catch(() => {})
  }, [paired])

  // The app icon's badge is the Your turn count.
  const items = useItems()
  const yours = items.filter((i) => i.band === 'your_turn').length
  useEffect(() => {
    void Notifications.setBadgeCountAsync(yours).catch(() => {})
  }, [yours])

  if (!ready) return null
  return (
    // The navigator's own ground, behind every screen and every transition: ours, not the default
    // white that showed at the corners while a screen slid in.
    <ThemeProvider value={NAV_THEME}>
      <StatusBar style={colourScheme === 'light' ? 'dark' : 'light'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colours.well } }}>
        <Stack.Screen name="index" />
        <Stack.Protected guard={sync !== null}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="new" options={{ presentation: 'modal', headerShown: true, title: 'New task' }} />
        </Stack.Protected>
        <Stack.Protected guard={sync === null}>
          <Stack.Screen name="pair" />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  )
}
