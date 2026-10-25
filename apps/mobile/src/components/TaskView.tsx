import { useState, type ReactNode } from 'react'
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { pendingText, updateAuthor, updateLabel, updateTone } from '@autopilot/client'
import type { QueueItem, Update } from '@autopilot/contracts'
import * as Haptics from 'expo-haptics'
import { age, titleCase } from '../format.ts'
import { useDetail, useSyncInstance, useSyncState } from '../store.ts'
import { colours, radius, tones, type Tone } from '@autopilot/design'
import { Banner, Button, Chip, bannerText, type } from '../ui.tsx'

/** A task: its brief, what waits on you, and its activity; the same in a pushed screen and in the wide split. */
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
  // What needs the owner goes on top; the activity below is everything else, oldest first.
  const ask = updates.find((u) => u.open && !answered.has(u.id)) ?? null
  const activity = updates.filter((u) => u !== ask)
  const options = updates.flatMap((u) => u.options)
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
    void send(ask ? { kind: 'answer', taskId: task.id, updateId: ask.id, text: body } : { kind: 'instruct', taskId: task.id, body })
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={styles.page} contentInsetAdjustmentBehavior="automatic">
        <View style={styles.head}>
          <Text style={type.meta}>
            {titleCase(task.workstream)} · {task.id}
            {task.source.mirrors ? ` · ${task.source.mirrors}` : ''}
          </Text>
          <Text style={type.title}>{task.title}</Text>
        </View>
        {task.brief ? (
          <View style={styles.section}>
            <Text style={type.meta}>Brief</Text>
            <Text style={type.body}>{task.brief}</Text>
          </View>
        ) : null}
        {refused.map((c) => (
          <Banner key={c.id}>
            <Text style={bannerText()}>
              {c.reason === 'already_answered'
                ? 'Answered on the Mac before this arrived.'
                : c.reason === 'task_closed'
                  ? 'The task was closed meanwhile.'
                  : c.message}
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
          </Banner>
        ))}
        {ask && (
          <View style={styles.ask} accessibilityLabel="Needs you">
            <Text style={[type.meta, { color: colours.clay }]}>
              {updateLabel(ask)} · {age(ask.createdAt)}
            </Text>
            <Text style={type.body}>{ask.body}</Text>
            <Links update={ask} />
            {ask.options.length > 0 && (
              <View style={styles.row}>
                {ask.options.map((o) => (
                  <Button
                    key={o.id}
                    kind="option"
                    label={o.label}
                    onPress={() => void send({ kind: 'answer', taskId: task.id, updateId: ask.id, optionId: o.id })}
                  />
                ))}
              </View>
            )}
          </View>
        )}
        {/* With only an ask so far, the card is the whole story. */}
        {!(ask && activity.length === 0 && pending.length === 0) && (
          <View style={styles.section}>
            <Text style={type.meta}>Activity</Text>
            <View style={styles.feed}>
              {activity.map((u) => (
                <Entry key={u.id} label={updateLabel(u)} by={updateAuthor(u)} at={age(u.createdAt)} tone={updateTone(u)} body={u.body}>
                  <Links update={u} />
                </Entry>
              ))}
              {pending.map((p) => {
                const { command } = p
                const words =
                  pendingText(command) ?? (command.kind === 'answer' ? options.find((o) => o.id === command.optionId)?.label : undefined)
                return words ? (
                  <Entry key={p.id} label="You" by={null} at="waiting to reach your Mac" tone="quiet" body={words} sending />
                ) : null
              })}
              {activity.length === 0 && pending.length === 0 && <Text style={type.meta}>{detail ? 'Nothing yet.' : ''}</Text>}
            </View>
          </View>
        )}
      </ScrollView>
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder={ask ? 'Or answer in words…' : 'Tell the session…'}
          placeholderTextColor={colours.text3}
          value={text}
          onChangeText={setText}
          multiline
          accessibilityLabel="Reply to Autopilot"
        />
        <Pressable
          style={[styles.send, !text.trim() && { opacity: 0.4 }]}
          onPress={reply}
          disabled={!text.trim()}
          accessibilityLabel="Send"
        >
          <Text style={styles.sendText}>↑</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

const Links = ({ update }: { update: Update }) =>
  update.attachments.length > 0 ? (
    <View style={styles.row}>
      {update.attachments.map((a) => (
        <Chip key={a.url} label={a.title} onPress={() => void Linking.openURL(a.url)} />
      ))}
    </View>
  ) : null

/** One entry on the rail: a mark in its tone, who and when, and what it says. */
const Entry = ({
  label,
  by,
  at,
  tone,
  body,
  sending,
  children,
}: {
  label: string
  by: string | null
  at: string
  tone: Tone
  body: string
  sending?: boolean
  children?: ReactNode
}) => (
  <View style={[styles.entry, sending && { opacity: 0.6 }]}>
    <View style={[styles.mark, { backgroundColor: tones[tone].dot }]} />
    <Text style={type.meta}>
      <Text style={{ color: colours.text2 }}>{label}</Text>
      {by ? ` · ${by}` : ''} · {at}
    </Text>
    <Text style={type.body}>{body}</Text>
    {children}
  </View>
)

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colours.surface },
  page: { padding: 20, gap: 24, paddingBottom: 32 },
  head: { gap: 6 },
  section: { gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ask: {
    gap: 8,
    padding: 16,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colours.clay,
    backgroundColor: colours.open,
  },
  feed: { marginLeft: 4, paddingLeft: 18, borderLeftWidth: 1, borderLeftColor: colours.borderStrong, gap: 20 },
  entry: { gap: 4 },
  mark: { position: 'absolute', left: -23, top: 4, width: 9, height: 9, borderRadius: 5, borderWidth: 2, borderColor: colours.surface },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    margin: 12,
    padding: 8,
    paddingLeft: 14,
    borderRadius: radius.xl,
    backgroundColor: colours.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colours.borderStrong,
  },
  input: { flex: 1, maxHeight: 140, fontSize: 16, color: colours.text, paddingVertical: 6 },
  send: { width: 34, height: 34, borderRadius: 10, backgroundColor: colours.clay, alignItems: 'center', justifyContent: 'center' },
  sendText: { fontSize: 18, fontWeight: '700', color: colours.well },
})
