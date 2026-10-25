import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Stack } from 'expo-router'
import { age } from '../../../src/format.ts'
import { serverName, unpair, useSyncInstance, useSyncState } from '../../../src/store.ts'
import { colours } from '../../../src/theme.ts'

const ROUTE = { lan: 'on your home network', tailscale: 'through Tailscale' } as const

/** The Mac this phone is paired with, how it is reached, and what is waiting to be sent. */
export default function ServersScreen() {
  const sync = useSyncInstance()
  const { status, routeKind, lastSyncedAt, outbox } = useSyncState()
  const reached =
    status === 'online' ? `Connected ${routeKind ? ROUTE[routeKind] : ''}` : status === 'connecting' ? 'Connecting…' : 'Out of reach'
  return (
    <>
      <Stack.Screen options={{ title: 'Servers' }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 10 }}>
        <View style={styles.card}>
          <View style={styles.head}>
            <View style={[styles.dot, { backgroundColor: status === 'online' ? colours.pilot : colours.muted }]} />
            <Text style={styles.name}>{serverName()}</Text>
          </View>
          <Text style={styles.meta}>{reached}</Text>
          <Text style={styles.meta}>{lastSyncedAt ? `Last synced ${age(lastSyncedAt)} ago` : 'Not synced yet'}</Text>
          {outbox.length > 0 && <Text style={[styles.meta, { color: colours.claySoft }]}>{outbox.length} waiting to send</Text>}
          <Pressable style={styles.button} onPress={() => void sync?.syncOnce(0)}>
            <Text style={styles.buttonText}>Sync now</Text>
          </Pressable>
        </View>
        <Text style={styles.note}>
          Away from home, install Tailscale on this iPhone and your Mac with the same account and turn on VPN On Demand. Autopilot tries
          your home network first and Tailscale next.
        </Text>
        <Pressable
          style={[styles.button, { alignSelf: 'flex-start' }]}
          onPress={() =>
            Alert.alert('Unpair this iPhone?', 'Anything still waiting to send is lost. You can pair again from the Mac.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Unpair', style: 'destructive', onPress: () => void unpair() },
            ])
          }
        >
          <Text style={[styles.buttonText, { color: colours.claySoft }]}>Unpair</Text>
        </Pressable>
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: colours.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colours.border,
    gap: 6,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  name: { flex: 1, fontSize: 17, color: colours.body },
  meta: { fontSize: 13, color: colours.text3 },
  note: { fontSize: 14, lineHeight: 20, color: colours.text3, padding: 4 },
  button: {
    marginTop: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: colours.raised,
    alignSelf: 'flex-start',
  },
  buttonText: { fontSize: 15, color: colours.text },
})
