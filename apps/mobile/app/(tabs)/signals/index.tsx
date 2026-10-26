import { useCallback, useState } from 'react'
import { RefreshControl, ScrollView, StyleSheet, Text } from 'react-native'
import type { Signal, Workstream } from '@autopilot/contracts'
import { signalName } from '@autopilot/client'
import { Stack, useFocusEffect } from 'expo-router'
import { ago } from '../../../src/format.ts'
import { useSyncInstance } from '../../../src/store.ts'
import { colours } from '@autopilot/design'
import { Card, CardHead, Dot, Sides, type, WorkstreamBadge } from '../../../src/ui.tsx'

const HEALTH = { ok: 'pilot', failing: 'alert', paused: 'paused' } as const

/**
 * Set up, as on the Mac: the sources and the workstreams. Read here; changed on the Mac, which
 * holds the connectors and the files.
 */
export default function SetupScreen() {
  const sync = useSyncInstance()
  const [signals, setSignals] = useState<Signal[] | null>(null)
  const [workstreams, setWorkstreams] = useState<Workstream[]>([])
  const [offline, setOffline] = useState(false)
  const load = useCallback(() => {
    void sync
      ?.online((api) => Promise.all([api.signals.list(), api.workstreams.list()]))
      .then(([list, streams]) => {
        setSignals(list)
        setWorkstreams(streams)
        setOffline(false)
      })
      .catch(() => setOffline(true))
  }, [sync])
  // Each time the tab is opened, so a signal added or paused on the Mac shows.
  useFocusEffect(load)

  return (
    <>
      <Stack.Screen options={{ title: 'Set up' }} />
      <Sides>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colours.text3} />}
        >
          {offline && <Text style={type.note}>Your Mac is out of reach; set-up shows when it is back.</Text>}
          <Text style={[type.label, styles.label]}>Sources</Text>
          {signals?.length === 0 && <Text style={type.note}>No sources yet. Add them on the Mac, in Set up.</Text>}
          {signals?.map((s) => (
            <Card key={s.name}>
              <CardHead>
                <Dot tone={HEALTH[s.health.state]} />
                <Text style={type.name}>{signalName(s.name)}</Text>
                {s.health.state === 'paused' ? (
                  <Text style={type.meta}>Paused</Text>
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
          {workstreams.length > 0 && <Text style={[type.label, styles.label]}>Workstreams</Text>}
          {workstreams.map((w) => {
            return (
              <Card key={w.name}>
                <CardHead>
                  <WorkstreamBadge name={w.name} />
                  <Text style={type.name}>{w.name}</Text>
                </CardHead>
                <Text style={type.meta} numberOfLines={4}>
                  {w.routing.replace(/\s+/g, ' ')}
                </Text>
                {w.urgent ? <Text style={type.meta}>Urgent: {w.urgent}</Text> : null}
              </Card>
            )
          })}
        </ScrollView>
      </Sides>
    </>
  )
}

const styles = StyleSheet.create({
  label: { marginTop: 10, marginLeft: 4 },
})
