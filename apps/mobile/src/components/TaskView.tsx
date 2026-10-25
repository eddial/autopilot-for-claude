import { useState } from 'react'
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { pendingText } from '@autopilot/client'
import type { QueueItem, TaskDetail, Update } from '@autopilot/contracts'
import * as Haptics from 'expo-haptics'
import { age, titleCase, updateLabel } from '../format.ts'
import { useDetail, useSyncInstance, useSyncState } from '../store.ts'
import { colours, serif } from '../theme.ts'

/** A task's conversation with the reply box; the same in a pushed screen and in the wide split. */
export const TaskView = ({ item }: { item: QueueItem }) => {
  const sync = useSyncInstance()
  const { conflicts, outbox } = useSyncState()
  const { task, openAsk } = item
  // From the phone's own copy, kept current by the feed; the ask from the queue until it has one.
  const detail = useDetail(task.id)
  const [text, setText] = useState('')

  const pending = outbox.filter((p) => 'taskId' in p.command && p.command.taskId === task.id)
  const answered = new Set(pending.flatMap((p) => (p.command.kind === 'answer' ? [p.command.updateId] : [])))
  const updates = detail?.updates ?? (openAsk ? [openAsk] : [])
  const refused = conflicts.filter((c) => 'taskId' in c.command && c.command.taskId === task.id)

  const send = async (command: Parameters<NonNullable<typeof sync>['send']>[0]) => {
    if (!sync) return
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    await sync.send(command)
  }

  const reply = () => {
    const body = text.trim()
    if (!body) return
    setText('')
    void send(openAsk ? { kind: 'answer', taskId: task.id, updateId: openAsk.id, text: body } : { kind: 'instruct', taskId: task.id, body })
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={styles.timeline} contentInsetAdjustmentBehavior="automatic">
        <Text style={styles.meta}>
          {titleCase(task.workstream)} · {task.id}
          {task.source.mirrors ? ` · ${task.source.mirrors}` : ''}
        </Text>
        <Text style={styles.title}>{task.title}</Text>
        {task.brief ? <Text style={[styles.body, { color: colours.text2 }]}>{task.brief}</Text> : null}
        {updates.map((u) => (
          <Entry key={u.id} update={u} answered={answered.has(u.id)} onOption={(optionId) => void send({ kind: 'answer', taskId: task.id, updateId: u.id, optionId })} />
        ))}
        {pending.map((p) => {
          const words = pendingText(p.command) ?? optionLabel(detail, p.command)
          return words ? (
            <View key={p.id} style={[styles.bubble, { opacity: 0.6 }]}>
              <Text style={styles.bubbleText}>{words}</Text>
              <Text style={styles.pending}>Waiting to reach your Mac</Text>
            </View>
          ) : null
        })}
        {refused.map((c) => (
          <View key={c.id} style={styles.conflict}>
            <Text style={styles.conflictText}>
              {c.reason === 'already_answered' ? 'Answered on the Mac before this arrived.' : c.reason === 'task_closed' ? 'The task was closed meanwhile.' : c.message}
            </Text>
            <View style={styles.row}>
              {c.command.kind === 'answer' && c.command.text ? (
                <Chip
                  label="Send as a new instruction"
                  onPress={() => {
                    const body = c.command.kind === 'answer' ? (c.command.text ?? '') : ''
                    sync?.dismissConflict(c.id)
                    void send({ kind: 'instruct', taskId: task.id, body })
                  }}
                />
              ) : null}
              <Chip label="Dismiss" onPress={() => sync?.dismissConflict(c.id)} />
            </View>
          </View>
        ))}
      </ScrollView>
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder={openAsk ? 'Answer…' : 'Tell the session…'}
          placeholderTextColor={colours.text3}
          value={text}
          onChangeText={setText}
          multiline
          accessibilityLabel="Reply to Autopilot"
        />
        <Pressable style={[styles.send, !text.trim() && { opacity: 0.4 }]} onPress={reply} disabled={!text.trim()} accessibilityLabel="Send">
          <Text style={styles.sendText}>↑</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

const optionLabel = (detail: TaskDetail | null, command: { kind: string; optionId?: string }): string | null => {
  if (command.kind !== 'answer' || !command.optionId) return null
  for (const u of detail?.updates ?? []) {
    const option = u.options.find((o) => o.id === command.optionId)
    if (option) return option.label
  }
  return null
}

const Entry = ({ update, answered, onOption }: { update: Update; answered: boolean; onOption: (optionId: string) => void }) => {
  const asking = update.open && !answered
  if (update.kind === 'instruction' && update.author === 'owner') {
    return (
      <View style={styles.bubble}>
        <Text style={styles.bubbleText}>{update.body}</Text>
      </View>
    )
  }
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.label, asking && { color: colours.clay }]}>
        {updateLabel(update)}
        {update.author === 'session' ? '' : ` · ${titleCase(update.author)}`} · {age(update.createdAt)}
      </Text>
      <Text style={styles.body}>{update.body}</Text>
      {update.attachments.length > 0 && (
        <View style={styles.row}>
          {update.attachments.map((a) => (
            <Chip key={a.url} label={a.title} onPress={() => void Linking.openURL(a.url)} />
          ))}
        </View>
      )}
      {asking && update.options.length > 0 && (
        <View style={styles.row}>
          {update.options.map((o) => (
            <Pressable key={o.id} style={styles.option} onPress={() => onOption(o.id)} accessibilityRole="button">
              <Text style={styles.optionText}>{o.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  )
}

const Chip = ({ label, onPress }: { label: string; onPress: () => void }) => (
  <Pressable style={styles.chip} onPress={onPress} accessibilityRole="button">
    <Text style={styles.chipText}>{label}</Text>
  </Pressable>
)

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colours.surface },
  timeline: { padding: 20, gap: 18, paddingBottom: 32 },
  meta: { fontSize: 13, color: colours.text3 },
  title: { fontFamily: serif, fontSize: 24, lineHeight: 30, color: colours.text, marginTop: -8 },
  label: { fontSize: 13, color: colours.text3 },
  body: { fontSize: 16, lineHeight: 24, color: colours.body },
  bubble: { alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: colours.well, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleText: { fontSize: 16, lineHeight: 22, color: colours.body },
  pending: { marginTop: 4, fontSize: 12, color: colours.text3 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, backgroundColor: colours.button, borderWidth: StyleSheet.hairlineWidth, borderColor: colours.borderStrong },
  optionText: { fontSize: 15, color: colours.text },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: colours.border },
  chipText: { fontSize: 13, color: colours.text2 },
  conflict: { padding: 12, borderRadius: 12, backgroundColor: 'rgba(217,119,87,0.12)', gap: 8 },
  conflictText: { fontSize: 14, color: colours.claySoft },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, margin: 12, padding: 10, borderRadius: 18, backgroundColor: colours.raised, borderWidth: StyleSheet.hairlineWidth, borderColor: colours.borderStrong },
  input: { flex: 1, maxHeight: 140, fontSize: 16, color: colours.text, paddingVertical: 6 },
  send: { width: 34, height: 34, borderRadius: 10, backgroundColor: colours.clay, alignItems: 'center', justifyContent: 'center' },
  sendText: { fontSize: 18, fontWeight: '700', color: colours.well },
})
