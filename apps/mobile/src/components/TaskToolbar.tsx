import { useEffect, useRef } from 'react'
import { Alert, Linking } from 'react-native'
import type { SFSymbol } from 'expo-symbols'
import type { QueueItem } from '@autopilot/contracts'
import { router, Stack } from 'expo-router'
import { firstLookQuestions, linkGroups, linkKind, linkSource, PRIORITY_NAMES } from '@autopilot/client'
import { useDetail, useSyncInstance } from '../store.ts'
import { colours, tones } from '@autopilot/design'

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

/** Each band as the symbol of the tab it shows under. */
export const BAND_SYMBOL: Record<QueueItem['band'], SFSymbol> = {
  your_turn: 'hand.raised',
  fyi: 'info.circle',
  triage: 'tray',
  running: 'hammer',
  waiting: 'clock',
  snoozed: 'moon',
  done: 'flag.checkered',
}

/** Each band's colour, as the dot beside its name on the page; triage in the urgent orange of its mark. */
const BAND_DOT: Record<QueueItem['band'], string> = {
  your_turn: tones.pilot.dot,
  fyi: tones.paused.dot,
  triage: colours.urgent,
  running: tones.claude.dot,
  waiting: tones.paused.dot,
  snoozed: tones.paused.dot,
  done: tones.quiet.dot,
}

const GROUP_ICONS = {
  artifacts: 'doc.text',
  pulls: 'arrow.triangle.pull',
  issues: 'checklist',
  messages: 'bubble.left',
  linked: 'link',
} as const

/**
 * What the task points to, as one bar button the Mac's side column stands in for: a menu with a
 * section per kind (artifacts, pull requests, issues, messages, the rest), newest first, each link
 * opening where it lives. A file stays on the Mac: the page reads it. Hidden without links.
 * A function, not a component: the bar only takes its own items as direct children.
 */
export const linksMenu = (links: QueueItem['task']['links'], hidden = false) => (
  <Stack.Toolbar.Menu icon="link" accessibilityLabel="Links" title="Links" hidden={hidden || links.length === 0}>
    {linkGroups(links).map((g) => (
      <Stack.Toolbar.Menu key={g.key} inline title={g.heading}>
        {[...g.links].reverse().map((l) => {
          const file = l.url.startsWith('file:')
          return (
            <Stack.Toolbar.MenuAction
              key={l.url}
              icon={GROUP_ICONS[g.key]}
              subtitle={[linkKind(l).label, l.subtitle ?? (file ? 'On your Mac' : linkSource(l.url))].filter(Boolean).join(' · ')}
              disabled={file}
              onPress={() => void Linking.openURL(l.url)}
            >
              {l.title.replace(/^(file|gmail|slack|github|linear|drive):\s*/i, '')}
            </Stack.Toolbar.MenuAction>
          )
        })}
      </Stack.Toolbar.Menu>
    ))}
  </Stack.Toolbar.Menu>
)

/**
 * A task's actions as native bar items. At the top: the prominent action (Open session, or Start)
 * in ink as on the Mac, then one status button, the task's band as its tab draws it, that marks it
 * done, snoozes it or says not for me; ⋯ only in the split, for New task and back to the top (a
 * pushed screen goes back to the top with a tap on its title). The Duo's bar is short: every button
 * more and iOS folds the arrows into an overflow ⋯ of its own. At the bottom, in a pushed screen: the
 * links and the way through the list, with the Mac's thin arrows (the split puts both in its own
 * bottom bar, beside search).
 */
export const TaskToolbar = ({
  item,
  closeAfter,
  step,
  onTop,
  onNew,
}: {
  item: QueueItem
  closeAfter: boolean
  /** Through the list the task was opened from, as Mail goes through messages: up and down. */
  step?: { previous: (() => void) | null; next: (() => void) | null }
  /** Back to the top of the page, in the split, whose bar has no title to tap: the brief, where the newest entry opens it at the bottom. */
  onTop?: () => void
  /** New task, first in the bar: the Duo open upright, where the bottom row is the list's. */
  onNew?: () => void
}) => {
  const sync = useSyncInstance()
  const opening = useRef(false)
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
  const snoozes = snoozeTimes().map((t) => (
    <Stack.Toolbar.MenuAction
      key={t.label}
      onPress={() => void sync?.send({ kind: 'snooze', taskId: task.id, until: t.until.toISOString() })}
    >
      {t.label}
    </Stack.Toolbar.MenuAction>
  ))
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
            icon="hammer.fill"
            accessibilityLabel="Start"
            onPress={() => void sync?.send({ kind: 'start', taskId: task.id })}
          />
        ) : null}
        {/* Where it stands, as the dot in its colour beside the status on the page: one button for every way to put it away. */}
        <Stack.Toolbar.Menu
          icon="circle.inset.filled"
          tintColor={BAND_DOT[item.band]}
          accessibilityLabel="Status"
          title="Status"
          hidden={closed}
        >
          <Stack.Toolbar.MenuAction icon="checkmark" onPress={() => done('done')}>
            Mark done
          </Stack.Toolbar.MenuAction>
          {/* The ball is still theirs: an FYI seen, or news that asks nothing of you. */}
          <Stack.Toolbar.MenuAction
            icon="clock"
            hidden={item.band !== 'your_turn' && item.band !== 'fyi'}
            onPress={() => void sync?.send({ kind: 'wait', taskId: task.id })}
          >
            Back to waiting
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.Menu icon="moon" title="Snooze">
            {snoozes}
          </Stack.Toolbar.Menu>
          <Stack.Toolbar.MenuAction icon="xmark" destructive onPress={() => done('canceled')}>
            Not for me
          </Stack.Toolbar.MenuAction>
          {/* Not where it stands but how much it matters: its own entry, the current one ticked. */}
          <Stack.Toolbar.Menu icon="cellularbars" title="Priority">
            {Object.entries(PRIORITY_NAMES).map(([value, name]) => (
              <Stack.Toolbar.MenuAction
                key={value}
                isOn={task.priority === Number(value)}
                onPress={() => void sync?.send({ kind: 'edit', taskId: task.id, priority: Number(value) })}
              >
                {name}
              </Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
        </Stack.Toolbar.Menu>
        {/* Upright on the open Duo (onNew) the bottom bar is the list's: the links come up here. */}
        {linksMenu(task.links, !onNew)}
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="More" title="More" hidden={!onTop && !onNew}>
          <Stack.Toolbar.MenuAction icon="square.and.pencil" hidden={!onNew} onPress={() => onNew?.()}>
            New task
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="arrow.up.to.line" hidden={!onTop} onPress={() => onTop?.()}>
            Back to the top
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      {step && (
        <Stack.Toolbar placement="bottom">
          {linksMenu(task.links)}
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
