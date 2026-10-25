import { useState, type ReactNode } from 'react'
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import {
  createdText,
  eventText,
  linkKind,
  linkSource,
  nowText,
  nowTone,
  pendingText,
  shortDate,
  updateAuthor,
  updateLabel,
} from '@autopilot/client'
import type { QueueItem, Update } from '@autopilot/contracts'
import * as Haptics from 'expo-haptics'
import KV from 'expo-sqlite/kv-store'
import { age, BAND_TITLE, titleCase } from '../format.ts'
import { useDetail, useSyncInstance, useSyncState } from '../store.ts'
import { colours, radius, tones, type Tone } from '@autopilot/design'
import { Avatar, Banner, Button, Chip, LinkIcon, Markdown, Pill, Sides, Tag, bannerText, type } from '../ui.tsx'

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
  const [order, setOrder] = useOrder()
  // Oldest first as they happened.
  const entries = [
    <Entry key="created" label={createdText(task)} by={null} at={shortDate(task.createdAt)} who={task.createdBy} body="" event />,
    ...activity.map((u) =>
      u.kind === 'event' ? (
        <Entry key={u.id} label={updateLabel(u)} by={null} at={age(u.createdAt)} who={u.author} body={eventText(u)} event>
          <Links update={u} />
        </Entry>
      ) : (
        <Entry key={u.id} label={updateLabel(u)} by={updateAuthor(u)} at={age(u.createdAt)} who={u.author} body={u.body}>
          <Links update={u} />
        </Entry>
      ),
    ),
    ...pending.flatMap((p) => {
      const { command } = p
      const words = pendingText(command) ?? (command.kind === 'answer' ? options.find((o) => o.id === command.optionId)?.label : undefined)
      return words ? [<Entry key={p.id} label="You" by={null} at="waiting to reach your Mac" who="owner" body={words} sending />] : []
    }),
    <Entry key="now" label="Now" by={null} at={nowText(item)} who="now" tone={nowTone(item)} body="" event />,
  ]
  const shown = order === 'newest' ? [...entries].reverse() : entries
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
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={20}>
      <Sides>
        <ScrollView contentContainerStyle={styles.page} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          <View style={styles.head}>
            <Text style={type.meta}>
              {task.id}
              {task.source.mirrors ? ` · ${task.source.mirrors}` : ''}
            </Text>
            <Text style={type.title}>{task.title}</Text>
            <View style={styles.row}>
              <Pill tone={BAND_TONE[item.band]} label={BAND_TITLE[item.band]} />
              <Tag label={titleCase(task.workstream)} />
              {task.priority <= 2 && <Tag label={task.priority === 1 ? 'Urgent' : 'High priority'} />}
            </View>
          </View>
          {task.brief ? (
            <View style={styles.section}>
              <Text style={type.label}>Brief</Text>
              <Markdown text={task.brief} onLink={open} />
            </View>
          ) : null}
          {task.links.length > 0 && <Linked taskId={task.id} links={task.links} />}
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
              <Text style={[type.meta, { color: colours.pilot }]}>
                {updateLabel(ask)} · {age(ask.createdAt)}
              </Text>
              <Markdown text={ask.body} onLink={open} />
              <Links update={ask} />
              {ask.kind === 'done' && (
                <View style={styles.row}>
                  <Button kind="primary" label="Close it" onPress={() => void send({ kind: 'close', taskId: task.id, outcome: 'done' })} />
                </View>
              )}
              {ask.options.length > 0 && (
                <View style={styles.row}>
                  {ask.options.map((o, i) => (
                    <Button
                      key={o.id}
                      kind={i === 0 ? 'primary' : 'option'}
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
              <View style={styles.sectionHead}>
                <Text style={type.label}>Activity</Text>
                <Chip
                  label={order === 'newest' ? 'Newest first' : 'Oldest first'}
                  onPress={() => setOrder(order === 'newest' ? 'oldest' : 'newest')}
                />
              </View>
              <View style={styles.feed}>
                {/* The rail runs from one avatar to the next; the last entry has none below it. */}
                {shown.map((entry, i) => (
                  <View key={entry.key} style={styles.slot}>
                    {i < shown.length - 1 && <View style={styles.rail} />}
                    {entry}
                  </View>
                ))}
              </View>
            </View>
          )}
        </ScrollView>
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            placeholder={ask?.kind === 'done' ? 'Or ask for more…' : ask ? 'Or answer in words…' : 'Tell the session…'}
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
      </Sides>
    </KeyboardAvoidingView>
  )
}

/** Links open where they live; a file on the Mac cannot open here, so the phone reads it instead. */
const open = (url: string) => {
  if (!url.startsWith('file:')) void Linking.openURL(url)
}

/** What the task points to: one quiet line naming the kinds; each link in its kind once opened. */
const Linked = ({ taskId, links }: { taskId: string; links: QueueItem['task']['links'] }) => {
  const [shown, setShown] = useState(false)
  const kinds = [...new Set(links.map((l) => linkKind(l).label))]
  return (
    <View style={styles.section}>
      <Pressable onPress={() => setShown((s) => !s)} accessibilityRole="button" accessibilityState={{ expanded: shown }}>
        <Text style={type.meta}>
          {shown ? '▾' : '▸'} {links.length} linked · {kinds.join(', ')}
        </Text>
      </Pressable>
      {shown && [...links].reverse().map((l) => <LinkRow key={l.url} taskId={taskId} link={l} />)}
    </View>
  )
}

/** One link: its kind and title; a file on the Mac unfolds to read in place. */
const LinkRow = ({ taskId, link }: { taskId: string; link: QueueItem['task']['links'][number] }) => {
  const sync = useSyncInstance()
  const file = link.url.startsWith('file:')
  const [text, setText] = useState<string | null | undefined>(undefined)
  const [reading, setReading] = useState(false)
  const kind = linkKind(link)
  const press = () => {
    if (!file) return void Linking.openURL(link.url)
    setReading((r) => !r)
    if (text === undefined)
      void sync
        ?.online((api) => api.links.preview({ taskId, url: link.url }))
        .then((p) => setText(p.text))
        .catch(() => setText(null))
  }
  return (
    <View>
      <Pressable onPress={press} accessibilityRole={file ? 'button' : 'link'} style={styles.linkRow}>
        <LinkIcon link={link} />
        <View style={styles.linkText}>
          <Text style={styles.linkTitle} numberOfLines={2}>
            {link.title.replace(/^(file|gmail|slack|github|linear|drive):\s*/i, '')}
          </Text>
          <Text style={type.meta} numberOfLines={1}>
            {[kind.label, link.subtitle ?? (file ? 'On your Mac' : linkSource(link.url))].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </Pressable>
      {reading && (
        <View style={styles.preview}>
          {text === undefined ? (
            <Text style={type.meta}>Reading…</Text>
          ) : text === null ? (
            <Text style={type.meta}>Only readable on the Mac, or the Mac is out of reach.</Text>
          ) : /\.(md|markdown)$/i.test(link.url) ? (
            <Markdown text={text} onLink={open} />
          ) : (
            <Text style={[type.body, styles.mono]}>{text}</Text>
          )}
        </View>
      )}
    </View>
  )
}

type Order = 'newest' | 'oldest'

/** Newest first unless the owner chose otherwise; remembered on the phone. */
const useOrder = (): [Order, (order: Order) => void] => {
  const [order, setOrder] = useState<Order>(() => (KV.getItemSync('autopilot.order') === 'oldest' ? 'oldest' : 'newest'))
  return [
    order,
    (next) => {
      setOrder(next)
      void KV.setItem('autopilot.order', next)
    },
  ]
}

const BAND_TONE: Record<QueueItem['band'], Tone> = {
  your_turn: 'pilot',
  new: 'quiet',
  running: 'claude',
  waiting: 'paused',
  snoozed: 'paused',
  done: 'quiet',
}

const Links = ({ update }: { update: Update }) =>
  update.attachments.length > 0 ? (
    <View style={styles.row}>
      {update.attachments.map((a) =>
        // A file on the Mac cannot open here: it reads in place instead.
        a.url.startsWith('file:') ? (
          <View key={a.url} style={styles.fullWidth}>
            <LinkRow taskId={update.taskId} link={a} />
          </View>
        ) : (
          <Chip
            key={a.url}
            icon={<LinkIcon link={a} size={12} />}
            label={
              update.kind === 'event' ? `Open in ${linkSource(a.url)}` : a.title.replace(/^(file|gmail|slack|github|linear|drive):\s*/i, '')
            }
            onPress={() => open(a.url)}
          />
        ),
      )}
    </View>
  ) : null

/** One entry on the rail: a mark in its tone, who and when, and what it says. */
const Entry = ({
  label,
  by,
  at,
  who,
  tone = 'quiet',
  body,
  sending,
  children,
}: {
  label: string
  by: string | null
  at: string
  who: Update['author'] | 'now'
  tone?: Tone
  body: string
  sending?: boolean
  /** A one-line event: "Session linked …". */
  event?: boolean
  children?: ReactNode
}) => (
  <View style={[styles.entry, sending && { opacity: 0.6 }]}>
    <View style={styles.avatar}>
      {who === 'now' ? (
        <View style={styles.now}>
          <View style={[styles.nowDot, { backgroundColor: tones[tone].dot }]} />
        </View>
      ) : (
        <Avatar who={who} />
      )}
    </View>
    <Text style={[type.meta, styles.entryHead]}>
      <Text style={{ color: colours.text2 }}>{label}</Text>
      {event ? (body ? ` ${body}` : '') : by ? ` · ${by}` : ''} · {at}
    </Text>
    {event ? null : <Markdown text={body} onLink={open} />}
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
    borderColor: colours.pilot,
    backgroundColor: colours.pilotTint,
  },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  linkText: { flex: 1, gap: 2 },
  fullWidth: { width: '100%' },
  linkTitle: { fontSize: 15, color: colours.text },
  preview: { marginLeft: 26, marginBottom: 6, padding: 12, borderRadius: 10, backgroundColor: colours.window },
  mono: { fontFamily: 'Menlo', fontSize: 13, lineHeight: 19 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  feed: { paddingLeft: 36 },
  slot: { paddingBottom: 20 },
  rail: { position: 'absolute', left: -25, top: 26, bottom: 4, width: 1, backgroundColor: colours.borderStrong },
  entryHead: { lineHeight: 22 },
  now: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colours.raised,
  },
  nowDot: { width: 8, height: 8, borderRadius: 4 },
  entry: { gap: 4 },
  avatar: { position: 'absolute', left: -36, top: 0 },
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
  send: { width: 34, height: 34, borderRadius: 10, backgroundColor: colours.pilot, alignItems: 'center', justifyContent: 'center' },
  sendText: { fontSize: 18, fontWeight: '700', color: colours.well },
})
