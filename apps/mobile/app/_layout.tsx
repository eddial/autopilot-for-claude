import { useEffect, useState } from 'react'
import { router, Stack } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { StatusBar } from 'expo-status-bar'
import { booted, connectTo, loadConnection, registerBackgroundSync, useItems, useSyncInstance, useWakeUps } from '../src/store.ts'
import { colours } from '@autopilot/design'

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
    void Notifications.requestPermissionsAsync().catch(() => {})
    // A tapped notification opens its task.
    const tapped = Notifications.addNotificationResponseReceivedListener((response) => {
      const taskId = response.notification.request.content.data?.taskId
      if (typeof taskId === 'string') router.push({ pathname: '/queue/[id]', params: { id: taskId } })
    })
    return () => tapped.remove()
  }, [])

  // The app icon's badge is the Your turn count.
  const items = useItems()
  const yours = items.filter((i) => i.band === 'your_turn').length
  useEffect(() => {
    void Notifications.setBadgeCountAsync(yours).catch(() => {})
  }, [yours])

  if (!ready) return null
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colours.window } }}>
        <Stack.Protected guard={sync !== null}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="new" options={{ presentation: 'modal', headerShown: true, title: 'New task' }} />
        </Stack.Protected>
        <Stack.Protected guard={sync === null}>
          <Stack.Screen name="pair" />
        </Stack.Protected>
      </Stack>
    </>
  )
}
