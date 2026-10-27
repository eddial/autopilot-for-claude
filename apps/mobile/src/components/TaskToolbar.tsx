import { useEffect, useRef } from 'react'
import { Alert, Linking, useWindowDimensions } from 'react-native'
import type { QueueItem } from '@autopilot/contracts'
import { router, Stack } from 'expo-router'
import { firstLookQuestions } from '@autopilot/client'
import { useDetail, useSyncInstance } from '../store.ts'
import { colours } from '@autopilot/design'

const snoozeTimes = (): { label: string; until: Date }[] => {
  const now = new Date()
  const at = (days: number, hour: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() + days)
    d.setHours(hour, 0, 0, 0)
    return d
  }
  const monday = (8 - now.getDay()) % 7 || 7
  return [
    { label: 'For an hour', until: new Date(now.getTime() + 3_600_000) },
    { label: 'This evening', until: at(0, 18) },
    { label: 'Tomorrow morning', until: at(1, 9) },
    { label: 'Monday morning', until: at(monday, 9) },
  ].filter((t) => t.until > now)
}

/**
 * A task's actions as native bar items. At the top: the prominent action (Open session, or Start)
 * in ink as on the Mac, Mark done and Snooze each their own button, Not for me behind ⋯, and back
 * to the top of the page. At the bottom, in a pushed screen: the way through the list, with the
 * Mac's thin arrows (the split puts them in its own bottom bar, beside search).
 */
export const TaskToolbar = ({
  item,
  closeAfter,
  step,
  onTop,
}: {
  item: QueueItem
  closeAfter: boolean
  /** Through the list the task was opened from, as Mail goes through messages: up and down. */
  step?: { previous: (() => void) | null; next: (() => void) | null }
  /** Back to the top of the page: the brief, where the newest entry opens it at the bottom. */
  onTop?: () => void
}) => {
  const sync = useSyncInstance()
  const opening = useRef(false)
  // A short screen (the Duo folded, in landscape) has room in its bar for only so many buttons:
  // back to the top goes first, so the way through the list stays out of the overflow menu.
  const short = useWindowDimensions().height < 500
  const { task, session } = item
  const closed = item.band === 'done'
  // Before I start in the timeline starts it when the first look has questions: one Start, there.
  const detail = useDetail(task.id)
  const asking = item.band === 'triage' && firstLookQuestions(detail?.updates ?? []).length > 0
  const running = session && session.state !== 'ended' ? session.remoteControlUrl : null
  const openSession = () => {
    if (running) return void Linking.openURL(running)
    opening.current = true
    if (session?.state === 'ended') void sync?.send({ kind: 'resume', taskId: task.id })
    Alert.alert('Opening the session', 'Your Mac is bringing it back with Remote Control. It opens here in a moment.')
  }
  // Asked to open: the link once the session has one.
  useEffect(() => {
    if (opening.current && running) {
      opening.current = false
      void Linking.openURL(running)
    }
  }, [running])
  const done = (outcome: 'done' | 'canceled') => {
    void sync?.send({ kind: 'close', taskId: task.id, outcome })
    if (closeAfter && router.canGoBack()) router.back()
  }
  return (
    <>
      {/* Each its own item, directly in the toolbar: the native bar ignores fragments inside it. */}
      <Stack.Toolbar placement="right">
        {session ? (
          // Into the Claude session, as the Mac's Open session. Running: its Remote Control link. Ended
          // (handed over, or the Mac's server restarted): the Mac brings the same conversation back with
          // Remote Control, and its new link opens as soon as it is there.
          <Stack.Toolbar.Button
            variant="prominent"
            tintColor={colours.text}
            icon="arrow.up.forward.app"
            accessibilityLabel="Open session"
            onPress={openSession}
          />
        ) : item.band === 'triage' && !asking ? (
          <Stack.Toolbar.Button
            variant="prominent"
            tintColor={colours.text}
            icon="play.fill"
            accessibilityLabel="Start"
            onPress={() => void sync?.send({ kind: 'start', taskId: task.id })}
          />
        ) : null}
        <Stack.Toolbar.Button icon="checkmark" accessibilityLabel="Mark done" hidden={closed} onPress={() => done('done')} />
        <Stack.Toolbar.Menu icon="moon" accessibilityLabel="Snooze" title="Snooze" hidden={closed}>
          {snoozeTimes().map((t) => (
            <Stack.Toolbar.MenuAction
              key={t.label}
              onPress={() => void sync?.send({ kind: 'snooze', taskId: task.id, until: t.until.toISOString() })}
            >
              {t.label}
            </Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="More" title="More" hidden={closed}>
          <Stack.Toolbar.MenuAction icon="xmark" destructive onPress={() => done('canceled')}>
            Not for me
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Button
          icon="arrow.up.to.line"
          accessibilityLabel="Back to the top"
          hidden={!onTop || short}
          onPress={() => onTop?.()}
        />
      </Stack.Toolbar>
      {step && (
        <Stack.Toolbar placement="bottom">
          <Stack.Toolbar.Spacer />
          <Stack.Toolbar.Button
            icon="arrow.up"
            accessibilityLabel="Previous task"
            disabled={!step.previous}
            onPress={() => step.previous?.()}
          />
          <Stack.Toolbar.Button icon="arrow.down" accessibilityLabel="Next task" disabled={!step.next} onPress={() => step.next?.()} />
        </Stack.Toolbar>
      )}
    </>
  )
}
