import { useCallback, useEffect, useState } from 'react'
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { Signal } from '@autopilot/contracts'
import { Stack } from 'expo-router'
import { age, titleCase } from '../../../src/format.ts'
import { useSyncInstance } from '../../../src/store.ts'
import { colours } from '../../../src/theme.ts'

const HEALTH = { ok: colours.pilot, failing: colours.clay, paused: colours.muted } as const

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
  useEffect(load, [load])

  return (
    <>
      <Stack.Screen options={{ title: 'Signals' }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 10 }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colours.text3} />}>
        {offline && <Text style={styles.note}>Your Mac is out of reach; signals show when it is back.</Text>}
        {signals?.length === 0 && <Text style={styles.note}>No signals yet. Add them on the Mac under Set up.</Text>}
        {signals?.map((s) => (
          <View key={s.name} style={styles.card}>
            <View style={styles.head}>
              <View style={[styles.dot, { backgroundColor: HEALTH[s.health.state] }]} />
              <Text style={styles.name}>{titleCase(s.name)}</Text>
              {s.lastRunAt && <Text style={styles.meta}>ran {age(s.lastRunAt)} ago</Text>}
            </View>
            <Text style={styles.meta}>
              Last day: {s.last24h.filed} filed, {s.last24h.updated} added, {s.last24h.dropped} left alone
            </Text>
            {s.health.message && <Text style={[styles.meta, { color: colours.claySoft }]}>{s.health.message}</Text>}
          </View>
        ))}
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  card: { padding: 14, borderRadius: 14, backgroundColor: colours.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colours.border, gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  name: { flex: 1, fontSize: 16, color: colours.body },
  meta: { fontSize: 13, color: colours.text3 },
  note: { fontSize: 14, color: colours.text3, padding: 8 },
})
