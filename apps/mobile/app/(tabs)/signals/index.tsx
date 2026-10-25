import { useCallback, useState } from 'react'
import { RefreshControl, ScrollView, Text } from 'react-native'
import type { Signal } from '@autopilot/contracts'
import { signalName } from '@autopilot/client'
import { Stack, useFocusEffect } from 'expo-router'
import { ago } from '../../../src/format.ts'
import { useSyncInstance } from '../../../src/store.ts'
import { colours } from '@autopilot/design'
import { Card, CardHead, Dot, Sides, type } from '../../../src/ui.tsx'

const HEALTH = { ok: 'pilot', failing: 'alert', paused: 'paused' } as const

/** What is listening, and whether it is healthy. Read-only here; changes happen on the Mac. */
export default function SignalsScreen() {
  const sync = useSyncInstance()
  const [signals, setSignals] = useState<Signal[] | null>(null)
  const [offline, setOffline] = useState(false)
  const load = useCallback(() => {
    void sync
      ?.online((api) => api.signals.list())
      .then((list) => {
        setSignals(list)
        setOffline(false)
      })
      .catch(() => setOffline(true))
  }, [sync])
  // Each time the tab is opened, so a signal added or paused on the Mac shows.
  useFocusEffect(load)

  return (
    <>
      <Stack.Screen options={{ title: 'Signals' }} />
      <Sides>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colours.text3} />}
        >
          {offline && <Text style={type.note}>Your Mac is out of reach; signals show when it is back.</Text>}
          {signals?.length === 0 && <Text style={type.note}>No signals yet. Add them on the Mac under Set up.</Text>}
          {signals?.map((s) => (
            <Card key={s.name}>
              <CardHead>
                <Dot tone={HEALTH[s.health.state]} />
                <Text style={type.name}>{signalName(s.name)}</Text>
                {s.health.state === 'paused' ? (
                  <Text style={type.meta}>paused</Text>
                ) : (
                  s.lastRunAt && <Text style={type.meta}>ran {ago(s.lastRunAt)}</Text>
                )}
              </CardHead>
              <Text style={type.meta}>
                Last day: {s.last24h.filed} filed, {s.last24h.updated} added, {s.last24h.dropped} left alone
              </Text>
              {s.health.message && <Text style={[type.meta, { color: colours.claySoft }]}>{s.health.message}</Text>}
            </Card>
          ))}
        </ScrollView>
      </Sides>
    </>
  )
}
