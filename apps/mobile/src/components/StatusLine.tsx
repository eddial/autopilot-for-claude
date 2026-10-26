import { StyleSheet, View } from 'react-native'
import { useSyncState, serverName } from '../store.ts'
import { ago } from '../format.ts'
import { Banner } from '../ui.tsx'

const changes = (n: number) => (n === 1 ? '1 change' : `${n} changes`)

/**
 * Syncing runs by itself: live while your Mac is in reach, and caught up the moment it is back.
 * This line shows only when it is not live, and says what happens next. Silent when all is well.
 */
export const StatusLine = () => {
  const { status, lastSyncedAt, outbox, conflicts } = useSyncState()
  const parts: string[] = []
  if (status === 'offline')
    parts.push(
      `Can't reach ${serverName()}${lastSyncedAt ? ` (last synced ${ago(lastSyncedAt)})` : ''}. ${
        outbox.length > 0 ? `Your ${changes(outbox.length)} are kept here and` : 'Everything'
      } will sync as soon as it's back.`,
    )
  else if (status === 'connecting' && !lastSyncedAt) parts.push(`Reaching ${serverName()}…`)
  else if (outbox.length > 0) parts.push(`Sending ${changes(outbox.length)}…`)
  if (conflicts.length > 0) parts.push(`${changes(conflicts.length)} not applied`)
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
