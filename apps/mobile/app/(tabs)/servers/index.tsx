import { Alert, ScrollView, StyleSheet, Text } from 'react-native'
import { Stack } from 'expo-router'
import { age } from '../../../src/format.ts'
import { serverName, unpair, useSyncInstance, useSyncState } from '../../../src/store.ts'
import { colours } from '@autopilot/design'
import { Button, Card, CardHead, Dot, Sides, type } from '../../../src/ui.tsx'

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
      <Sides>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 10 }}>
          <Card>
            <CardHead>
              <Dot tone={status === 'online' ? 'pilot' : 'quiet'} />
              <Text style={type.name}>{serverName()}</Text>
            </CardHead>
            <Text style={type.meta}>{reached}</Text>
            <Text style={type.meta}>{lastSyncedAt ? `Last synced ${age(lastSyncedAt)} ago` : 'Not synced yet'}</Text>
            {outbox.length > 0 && <Text style={[type.meta, { color: colours.amberSoft }]}>{outbox.length} waiting to send</Text>}
            <Button label="Sync now" onPress={() => void sync?.syncOnce(0)} style={styles.gap} />
          </Card>
          <Text style={type.note}>
            Away from home, install Tailscale on this iPhone and your Mac with the same account and turn on VPN On Demand. Autopilot tries
            your home network first and Tailscale next.
          </Text>
          <Button
            kind="destructive"
            label="Unpair"
            onPress={() =>
              Alert.alert('Unpair this iPhone?', 'Anything still waiting to send is lost. You can pair again from the Mac.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Unpair', style: 'destructive', onPress: () => void unpair() },
              ])
            }
          />
        </ScrollView>
      </Sides>
    </>
  )
}

const styles = StyleSheet.create({
  gap: { marginTop: 6 },
})
