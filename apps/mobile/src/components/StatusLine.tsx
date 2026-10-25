import { StyleSheet, View } from 'react-native'
import { useSyncState, serverName } from '../store.ts'
import { age } from '../format.ts'
import { Banner } from '../ui.tsx'

/** Offline, last synced, and what is still waiting to be sent. Silent when all is well. */
export const StatusLine = () => {
  const { status, lastSyncedAt, outbox, conflicts } = useSyncState()
  const parts: string[] = []
  if (status === 'offline') parts.push(`Offline${lastSyncedAt ? `, last synced ${age(lastSyncedAt)} ago` : ''}`)
  if (status === 'connecting' && !lastSyncedAt) parts.push(`Reaching ${serverName()}…`)
  if (outbox.length > 0) parts.push(`${outbox.length} waiting to send`)
  if (conflicts.length > 0) parts.push(`${conflicts.length} not applied`)
  if (parts.length === 0) return null
  return (
    <View style={styles.inset}>
      <Banner>{parts.join(' · ')}</Banner>
    </View>
  )
}

const styles = StyleSheet.create({
  inset: { marginHorizontal: 16, marginBottom: 8 },
})
