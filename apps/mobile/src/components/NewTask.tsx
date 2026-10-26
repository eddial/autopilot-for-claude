import { useEffect, useState } from 'react'
import { ActionSheetIOS, StyleSheet, Text, TextInput, View } from 'react-native'
import type { Workstream } from '@autopilot/contracts'
import KV from 'expo-sqlite/kv-store'
import { SymbolView } from 'expo-symbols'
import { useDraft } from '../drafts.ts'
import { useSyncInstance } from '../store.ts'
import { colours } from '@autopilot/design'
import { Chip, Composer, Pilot, Sides, composerInput, GUTTER, type, KeyboardScreen } from '../ui.tsx'

const PRIORITIES = [
  { value: 1, label: 'Urgent' },
  { value: 2, label: 'High' },
  { value: 3, label: 'Normal' },
  { value: 4, label: 'Low' },
]

/** A list to pick one from, the native sheet over the keyboard; the current one ticked. */
const pickFrom = (title: string, options: string[], current: number, then: (index: number) => void) =>
  ActionSheetIOS.showActionSheetWithOptions(
    { title, options: [...options.map((o, i) => (i === current ? `${o} ✓` : o)), 'Cancel'], cancelButtonIndex: options.length },
    (index) => index < options.length && then(index),
  )

/**
 * New task, as Claude's own composer: what to do in one box, the workstream and priority as pills
 * above it, starting and sending inside it. All of it sits on the keyboard, so it fits the Duo's
 * outer screen. The first line is the title, the rest the brief. Works offline: it waits in the
 * outbox and reaches the Mac later. A sheet of its own on a phone; the empty side of the split.
 */
export const NewTask = ({ onDone, edges, autoFocus = true }: { onDone: () => void; edges?: ('left' | 'right')[]; autoFocus?: boolean }) => {
  const sync = useSyncInstance()
  const [text, setText] = useDraft('new:text')
  const [workstream, setWorkstream] = useState<string | null>(null)
  const [priority, setPriority] = useState(3)
  const [start, setStart] = useState(true)
  const [workstreams, setWorkstreams] = useState<Workstream[]>([])

  // The last list seen online, so picking a workstream works offline too.
  useEffect(() => {
    void KV.getItem('autopilot.workstreams').then((cached) => cached && setWorkstreams(JSON.parse(cached) as Workstream[]))
    void sync
      ?.online((api) => api.workstreams.list())
      .then((list) => {
        setWorkstreams(list)
        void KV.setItem('autopilot.workstreams', JSON.stringify(list))
      })
      .catch(() => {})
  }, [sync])

  const streams = workstreams.filter((w) => w.name !== 'autopilot').map((w) => w.name)
  const priorityLabel = PRIORITIES.find((p) => p.value === priority)?.label ?? 'Normal'
  const [first = '', ...rest] = text.trim().split('\n')
  const title = first.trim().slice(0, 120)

  const create = () => {
    if (!sync || !title) return
    void sync.send({
      kind: 'create',
      title,
      brief: [first.trim().slice(120), ...rest].join('\n').trim(),
      start,
      priority,
      ...(workstream ? { workstream } : {}),
    })
    setText('')
    onDone()
  }

  const pickWorkstream = () =>
    pickFrom('Workstream', ['Automatic', ...streams], workstream ? streams.indexOf(workstream) + 1 : 0, (i) =>
      setWorkstream(i === 0 ? null : (streams[i - 1] ?? null)),
    )
  const pickPriority = () =>
    pickFrom(
      'Priority',
      PRIORITIES.map((p) => p.label),
      PRIORITIES.findIndex((p) => p.value === priority),
      (i) => setPriority(PRIORITIES[i]?.value ?? 3),
    )

  return (
    <Sides colour={colours.well} edges={edges}>
      <KeyboardScreen style={styles.screen}>
        <View style={styles.hello}>
          <Pilot pixel={4} />
          <Text style={type.heading}>What needs doing?</Text>
        </View>
        {/* The choices as pills over the box, left-aligned as Claude's are. */}
        <View style={styles.pills}>
          <Chip
            pill
            label={workstream ?? 'Automatic'}
            icon={<SymbolView name="square.stack" size={14} tintColor={colours.text2} />}
            onPress={pickWorkstream}
          />
          <Chip
            pill
            label={priorityLabel}
            icon={<SymbolView name="chart.bar" size={14} tintColor={colours.text2} />}
            onPress={pickPriority}
          />
        </View>
        <Composer
          ready={Boolean(title)}
          onSend={create}
          sendLabel={start ? 'Create and start' : 'Save'}
          tools={
            <Chip
              pill
              label={start ? 'Start now' : 'Start later'}
              icon={<SymbolView name={start ? 'play.fill' : 'pause'} size={12} tintColor={colours.text2} />}
              onPress={() => setStart(!start)}
            />
          }
        >
          <TextInput
            style={composerInput}
            placeholder="Describe a task. The first line is its title."
            placeholderTextColor={colours.text3}
            value={text}
            onChangeText={setText}
            multiline
            autoFocus={autoFocus}
            accessibilityLabel="Task"
          />
        </Composer>
      </KeyboardScreen>
    </Sides>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: GUTTER, paddingTop: 12, gap: 12 },
  hello: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  pills: { flexDirection: 'row', gap: 8 },
})
