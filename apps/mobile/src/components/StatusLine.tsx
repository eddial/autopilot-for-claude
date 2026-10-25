import { StyleSheet, Text } from 'react-native'
import { useSyncState, serverName } from '../store.ts'
import { age } from '../format.ts'
import { colours } from '../theme.ts'

/** Offline, last synced, and what is still waiting to be sent. Silent when all is well. */
export const StatusLine = () => {
  const { status, lastSyncedAt, outbox, conflicts } = useSyncState()
  const parts: string[] = []
  if (status === 'offline') parts.push(`Offline${lastSyncedAt ? `, last synced ${age(lastSyncedAt)} ago` : ''}`)
  if (status === 'connecting' && !lastSyncedAt) parts.push(`Reaching ${serverName()}…`)
  if (outbox.length > 0) parts.push(`${outbox.length} waiting to send`)
  if (conflicts.length > 0) parts.push(`${conflicts.length} not applied`)
  if (parts.length === 0) return null
  return <Text style={styles.line}>{parts.join(' · ')}</Text>
}

const styles = StyleSheet.create({
  line: {
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: 'rgba(217,119,87,0.12)',
    color: colours.claySoft,
    fontSize: 13,
  },
})
