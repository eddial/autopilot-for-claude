import { useRef, useState, type ComponentRef, type ReactNode } from 'react'
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import {
  filedBy,
  isPaste,
  pasteSize,
  signalName,
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
import { SymbolView } from 'expo-symbols'
import { age, ago, BAND_TITLE } from '../format.ts'
import { useDraft } from '../drafts.ts'
import { FileChips, useFiles } from '../files.tsx'
import { useDetail, useSyncInstance, useSyncState } from '../store.ts'
import { colours, radius, tones, type Tone } from '@autopilot/design'
import { Avatar, Banner, Button, Chip, LinkIcon, Markdown, Pill, Sides, Tag, bannerText, type } from '../ui.tsx'

/** A task: its brief, what waits on you, and its activity; the same in a pushed screen and in the wide split. */
export const TaskView = ({ item, onTitleOff }: { item: QueueItem; onTitleOff?: (off: boolean) => void }) => {
  const sync = useSyncInstance()
  const { conflicts, outbox } = useSyncState()
  const { task, openAsk } = item
  // From the phone's own copy, kept current by the feed; the ask from the queue until it has one.
  const detail = useDetail(task.id)
  const [text, setText] = useDraft(`${task.id}:composer`)
  // The page opens at its end, the newest entry above the reply, and follows new entries while
  // you are there; scrolled up, it stays put.
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null)
  const pinned = useRef(true)
  // Where the title ends on the page, and whether it is out of sight (the bar then says it).
  const titleEnd = useRef(0)
  const titleOff = useRef(false)
  const viewport = useRef(0)
  const showTitle = (offset: number) => {
    const off = offset > titleEnd.current
    if (off === titleOff.current) return
    titleOff.current = off
    onTitleOff?.(off)
  }

  const pending = outbox.filter((p) => 'taskId' in p.command && p.command.taskId === task.id)
  const answered = new Set(pending.flatMap((p) => (p.command.kind === 'answer' ? [p.command.updateId] : [])))
  const updates = detail?.updates ?? (openAsk ? [openAsk] : [])
  // What needs the owner comes last, after the activity: everything else, oldest first.
  const ask = updates.find((u) => u.open && !answered.has(u.id)) ?? null
  const activity = updates.filter((u) => u !== ask)
  const options = updates.flatMap((u) => u.options)
  const send = async (command: Parameters<NonNullable<typeof sync>['send']>[0]) => {
    if (!sync) return
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    await sync.send(command)
  }

  // From how it began to where it stands now, read downwards like a conversation.
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
    // Where it stands now: what waits on you, as the last entry with its answers, or the Now line.
    ask ? (
      <Entry key="ask" label={updateLabel(ask)} by={null} at={age(ask.createdAt)} who={ask.author} body={ask.body} card>
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
      </Entry>
    ) : (
      <Entry key="now" label="Now" by={null} at={nowText(item)} who="now" tone={nowTone(item)} body="" event />
    ),
  ]
  const refused = conflicts.filter((c) => 'taskId' in c.command && c.command.taskId === task.id)

  const files = useFiles(task.id)
  const ready = (text.trim().length > 0 || files.links.length > 0) && !files.busy
  const reply = () => {
    const body = text.trim()
    if (!ready) return
    const attachments = files.links.length > 0 ? { attachments: files.links } : {}
    setText('')
    files.clear()
    void send(
      ask
        ? { kind: 'answer', taskId: task.id, updateId: ask.id, text: body, ...attachments }
        : { kind: 'instruct', taskId: task.id, body, ...attachments },
    )
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={20}>
      <Sides>
        <ScrollView
          ref={scroll}
          contentContainerStyle={styles.page}
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="interactive"
          scrollEventThrottle={100}
          onScroll={({ nativeEvent: e }) => {
            pinned.current = e.contentSize.height - e.contentOffset.y - e.layoutMeasurement.height < 24
            showTitle(e.contentOffset.y + e.contentInset.top)
          }}
          onLayout={(e) => {
            viewport.current = e.nativeEvent.layout.height
          }}
          onContentSizeChange={(_, height) => {
            if (!pinned.current) return
            scroll.current?.scrollToEnd({ animated: false })
            // Jumping to the end sends no scroll event: say where the title is from the sizes.
            showTitle(height - viewport.current)
          }}
        >
          <View
            style={styles.head}
            onLayout={(e) => {
              titleEnd.current = e.nativeEvent.layout.y + e.nativeEvent.layout.height
            }}
          >
            <Text style={type.meta}>
              {task.id}
              {task.source.mirrors ? ` · ${task.source.mirrors}` : ''}
            </Text>
            <Text style={type.title}>{task.title}</Text>
            <View style={styles.row}>
              <Pill tone={BAND_TONE[item.band]} label={BAND_TITLE[item.band]} />
              <Tag label={task.workstream} />
              {task.priority <= 2 && <Tag label={task.priority === 1 ? 'Urgent' : 'High priority'} />}
              <Text style={type.meta}>
                {filedBy(task)} · {ago(task.createdAt)}
              </Text>
            </View>
          </View>
          {task.brief ? (
            <View style={styles.section}>
              <Text style={type.label}>Brief</Text>
              <Folded text={task.brief} onLink={open} />
            </View>
          ) : null}
          {(detail?.signals ?? []).length > 0 && (
            <View style={styles.section}>
              <Text style={type.label}>Signal</Text>
              {(detail?.signals ?? []).map((m) => (
                <Pressable
                  key={`${m.url}-${m.at}`}
                  style={styles.signal}
                  onPress={() => /^https?:\/\//.test(m.url) && open(m.url)}
                  accessibilityRole="link"
                  accessibilityLabel={`${signalName(m.signal)}: ${m.title}`}
                >
                  <Text style={type.meta}>
                    {signalName(m.signal)}
                    {m.channel ? ` · ${m.channel}` : ''}
                  </Text>
                  <Text style={styles.signalTitle}>{m.title}</Text>
                  <Text style={type.meta}>
                    {m.sender} · {Number.isNaN(Date.parse(m.at)) ? m.at : ago(m.at)}
                    {m.action === 'updated' ? ' · added' : ''}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          {task.links.length > 0 && <Linked taskId={task.id} links={task.links} />}
          <View style={styles.section}>
            <Text style={type.label}>Activity</Text>
            <View style={styles.feed}>
              {/* The rail runs from one avatar to the next; the last entry has none below it. */}
              {entries.map((entry, i) => (
                <View key={entry.key} style={styles.slot}>
                  {i < entries.length - 1 && <View style={styles.rail} />}
                  {entry}
                </View>
              ))}
            </View>
          </View>
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
        </ScrollView>
        <FileChips files={files.files} onRemove={files.remove} />
        <View style={styles.composer}>
          <Pressable style={styles.attach} onPress={files.pick} hitSlop={6} accessibilityRole="button" accessibilityLabel="Attach files">
            <SymbolView name="paperclip" size={18} tintColor={colours.text2} />
          </Pressable>
          <TextInput
            style={styles.input}
            placeholder={ask?.kind === 'done' ? 'Or ask for more…' : ask ? 'Or answer in words…' : 'Tell the session…'}
            placeholderTextColor={colours.text3}
            value={text}
            onChangeText={setText}
            multiline
            accessibilityLabel="Reply to Autopilot"
          />
          <Pressable style={[styles.send, !ready && { opacity: 0.4 }]} onPress={reply} disabled={!ready} accessibilityLabel="Send">
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
  event,
  card,
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
  /** What waits on you: its words and answers in a card on the rail. */
  card?: boolean
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
    <View style={card ? styles.ask : styles.entryBody} accessibilityLabel={card ? 'Needs you' : undefined}>
      <Text style={[type.meta, styles.entryHead]}>
        <Text style={{ color: colours.text2 }}>{label}</Text>
        {event ? (body ? ` ${body}` : '') : by ? ` · ${by}` : ''} · {at}
      </Text>
      {event ? null : who === 'owner' && isPaste(body) ? <Pasted text={body} /> : <Markdown text={body} onLink={open} />}
      {children}
    </View>
  </View>
)

/** A long message of the owner's, most likely pasted: a card with its first words, opened on a tap. */
const Pasted = ({ text }: { text: string }) => {
  const [shown, setShown] = useState(false)
  return (
    <View style={styles.pasted}>
      <Pressable
        style={styles.pastedHead}
        onPress={() => setShown((s) => !s)}
        accessibilityRole="button"
        accessibilityState={{ expanded: shown }}
      >
        <SymbolView name="doc.text" size={16} tintColor={colours.text3} />
        <View>
          <Text style={styles.pastedTitle}>Pasted text</Text>
          <Text style={type.meta}>
            {pasteSize(text)} · {shown ? 'Hide' : 'Show'}
          </Text>
        </View>
      </Pressable>
      {shown ? (
        <Markdown text={text} onLink={open} />
      ) : (
        <Text style={[type.meta, styles.pastedPeek]} numberOfLines={2}>
          {text}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colours.surface },
  page: { padding: 20, gap: 24, paddingBottom: 32 },
  head: { gap: 6 },
  section: { gap: 8 },
  signal: { gap: 2, marginTop: 8, padding: 12, borderRadius: radius.md, backgroundColor: colours.surface },
  signalTitle: { fontSize: 15, lineHeight: 21, color: colours.textBody },
  folded: { maxHeight: 200, overflow: 'hidden' },
  pasted: {
    gap: 6,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colours.borderStrong,
    backgroundColor: colours.surface,
  },
  pastedHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pastedTitle: { fontSize: 15, color: colours.textBody },
  pastedPeek: { lineHeight: 18 },
  more: { marginTop: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  // Neutral, as on the Mac: the avatar on the rail says who asks.
  ask: {
    gap: 8,
    padding: 14,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colours.borderStrong,
    backgroundColor: colours.open,
  },
  entryBody: { gap: 4 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  linkText: { flex: 1, gap: 2 },
  fullWidth: { width: '100%' },
  linkTitle: { fontSize: 15, color: colours.text },
  preview: { marginLeft: 26, marginBottom: 6, padding: 12, borderRadius: 10, backgroundColor: colours.window },
  mono: { fontFamily: 'Menlo', fontSize: 13, lineHeight: 19 },
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
    paddingLeft: 6,
    borderRadius: radius.xl,
    backgroundColor: colours.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colours.borderStrong,
  },
  attach: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, maxHeight: 140, fontSize: 16, color: colours.text, paddingVertical: 6 },
  send: { width: 34, height: 34, borderRadius: 10, backgroundColor: colours.pilot, alignItems: 'center', justifyContent: 'center' },
  sendText: { fontSize: 18, fontWeight: '700', color: colours.well },
})

/** A long brief folded to its first lines, as on the Mac; Show more opens it. */
const Folded = ({ text, onLink }: { text: string; onLink: (url: string) => void }) => {
  const [shown, setShown] = useState(false)
  const long = text.length > 360 || text.split('\n').length > 6
  return (
    <>
      <View style={long && !shown ? styles.folded : null}>
        <Markdown text={text} onLink={onLink} />
      </View>
      {long && (
        <Pressable onPress={() => setShown((o) => !o)} accessibilityRole="button" hitSlop={8}>
          <Text style={[type.meta, styles.more]}>{shown ? 'Show less' : 'Show more'}</Text>
        </Pressable>
      )}
    </>
  )
}
