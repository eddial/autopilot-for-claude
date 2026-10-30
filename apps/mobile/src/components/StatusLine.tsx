import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native'
import { syncStatus, type SyncAction, type SyncLight } from '@autopilot/client'
import { colours } from '@autopilot/design'
import { serverName, useSyncInstance, useSyncState } from '../store.ts'

/** The clock to the second, for a countdown. */
const seconds = () => Math.floor(Date.now() / 1000)
const everySecond = (changed: () => void) => {
  const timer = setInterval(changed, 1000)
  return () => clearInterval(timer)
}
const never = () => () => {}

const LIGHT: Record<SyncLight, string> = {
  live: colours.pilot,
  trying: colours.amber,
  off: colours.muted,
  problem: colours.clay,
}

const ACTION: Record<SyncAction['kind'], string> = { retry: 'Try now', open: 'Open', dismiss: 'Dismiss' }

/**
 * Where syncing with your Mac stands, as a light and a line: silent while live, a pulsing amber
 * light while it reaches for the Mac, a dark one with a countdown when it can't (tap to try now),
 * a clay one naming a change the Mac refused (tap to open its task), and a green "Back online" for
 * a moment when it returns.
 */
export const StatusLine = ({ onOpen }: { onOpen: (taskId: string) => void }) => {
  const sync = useSyncInstance()
  const state = useSyncState()
  // The countdown ticks once a second, only while there is one.
  const now = new Date(useSyncExternalStore(state.nextTryAt ? everySecond : never, seconds) * 1000)
  // Back from offline: said once, then quiet again.
  const [back, setBack] = useState(false)
  const was = useRef(state.status)
  useEffect(() => {
    const before = was.current
    was.current = state.status
    if (state.status !== 'online' || before !== 'offline') return
    setBack(true)
    const timer = setTimeout(() => setBack(false), 2500)
    return () => clearTimeout(timer)
  }, [state.status])

  const status =
    syncStatus(state, serverName(), now) ?? (back ? { light: 'live' as const, title: 'Back online', detail: null, action: null } : null)
  if (!status) return null
  const { action } = status
  const press = () => {
    if (action?.kind === 'retry') sync?.kick()
    else if (action?.kind === 'open') onOpen(action.taskId)
    else if (action?.kind === 'dismiss') sync?.dismissConflict(action.conflictId)
  }
  const label = action ? ACTION[action.kind] : null
  return (
    <Pressable
      style={styles.row}
      disabled={!action}
      onPress={press}
      accessibilityRole={action ? 'button' : 'text'}
      accessibilityLabel={[status.title, status.detail, label ? `Tap to ${label.toLowerCase()}` : null].filter(Boolean).join('. ')}
    >
      <Light light={status.light} />
      <View style={styles.words}>
        <Text style={styles.title} numberOfLines={1}>
          {status.title}
        </Text>
        {status.detail && <Text style={styles.detail}>{status.detail}</Text>}
      </View>
      {label && <Text style={styles.action}>{label}</Text>}
    </Pressable>
  )
}

/** The status light; it breathes while trying, on the native driver. */
const Light = ({ light }: { light: SyncLight }) => {
  const [pulse] = useState(() => new Animated.Value(1))
  useEffect(() => {
    if (light !== 'trying') {
      pulse.setValue(1)
      return
    }
    const run = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    )
    run.start()
    return () => run.stop()
  }, [light, pulse])
  return (
    <View style={styles.lightBox}>
      <Animated.View style={[styles.light, { backgroundColor: LIGHT[light], opacity: pulse }]} />
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, marginHorizontal: 16, marginTop: 6, marginBottom: 6, alignItems: 'flex-start' },
  lightBox: { height: 20, justifyContent: 'center' },
  light: { width: 8, height: 8, borderRadius: 4 },
  words: { flex: 1, gap: 2 },
  title: { fontSize: 14, lineHeight: 20, color: colours.text2 },
  action: { fontSize: 14, lineHeight: 20, color: colours.text },
  detail: { fontSize: 13, lineHeight: 18, color: colours.text3 },
})
