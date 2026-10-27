import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import {
  filedBy,
  firstLookQuestions,
  isArtifact,
  isPaste,
  pasteSize,
  signalChannel,
  signalMark,
  signalName,
  signalSender,
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
  withoutQuestions,
} from '@autopilot/client'
import type { QueueItem, TaskSignal, Update } from '@autopilot/contracts'
import * as Haptics from 'expo-haptics'
import { SymbolView } from 'expo-symbols'
import { age, ago, BAND_TITLE } from '../format.ts'
import { useDraft } from '../drafts.ts'
import { FileChips, useFiles } from '../files.tsx'
import { useDetail, useSyncInstance, useSyncState } from '../store.ts'
import { colours, radius, tones, type Tone } from '@autopilot/design'
import {
  Avatar,
  Banner,
  Button,
  Chip,
  Composer,
  ComposerTool,
  Dot,
  LinkIcon,
  SourceMark,
  TriageMark,
  Markdown,
  Sides,
  Tag,
  bannerText,
  composerInput,
  GUTTER,
  KeyboardScreen,
  shaped,
  type,
} from '../ui.tsx'

/** A task: its brief, what waits on you, and its activity; the same in a pushed screen and in the wide split. */
export const TaskView = ({
  item,
  onTitleOff,
  edges,
  onTop,
}: {
  item: QueueItem
  onTitleOff?: (off: boolean) => void
  /** Hands over a way back to the top of the page, for the bar's button. */
  onTop?: (toTop: () => void) => void
  /** The screen edges it touches; in the split, only the right. */
  edges?: ('left' | 'right')[]
}) => {
  const sync = useSyncInstance()
  const { conflicts, outbox } = useSyncState()
  const { task, openAsk } = item
  // From the phone's own copy, kept current by the feed; the ask from the queue until it has one.
  const detail = useDetail(task.id)
  const [text, setText] = useDraft(`${task.id}:composer`)
  // The page opens at its end, the newest entry above the reply, and follows new entries while
  // you are there; scrolled up, it stays put.
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null)
  useEffect(() => onTop?.(() => scroll.current?.scrollTo({ y: 0, animated: true })), [onTop])
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
  // New, with questions from the first look: asked as the last entry, Before I start, which also
  // starts it; the first look then shows without them.
  const questions = !ask && item.band === 'triage' ? firstLookQuestions(updates) : []
  const asking = questions.length > 0
  const activity = updates
    .filter((u) => u !== ask)
    .map((u) => (asking && u.author === 'scout' && u.kind === 'info' ? { ...u, body: withoutQuestions(u.body) } : u))
  const options = updates.flatMap((u) => u.options)
  const send = async (command: Parameters<NonNullable<typeof sync>['send']>[0]) => {
    if (!sync) return
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    await sync.send(command)
  }

  // Before I start: what you know goes with the start; nothing written starts it as it is.
  const start = () => {
    const body = text.trim()
    setText('')
    void send(
      body
        ? { kind: 'instruct', taskId: task.id, body: `Answers to the first look's questions:\n\n${body}` }
        : { kind: 'start', taskId: task.id },
    )
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
        <Entry
          key={u.id}
          label={updateLabel(u)}
          by={updateAuthor(u)}
          at={age(u.createdAt)}
          who={u.author}
          body={u.body}
          // The newest shows in full; older long ones fold.
          folds={u !== activity.at(-1) || ask !== null || asking}
        >
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
    ) : asking ? (
      <Entry
        key="before"
        label="Before I start"
        by={null}
        at={age(task.createdAt)}
        who="scout"
        body={questions.map((q) => `- ${q}`).join('\n')}
        card
      >
        <View style={styles.row}>
          <Button kind="primary" label={text.trim() ? 'Start with these answers' : 'Start without answering'} onPress={() => start()} />
        </View>
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
    if (asking && ready) return start()
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
    <KeyboardScreen style={styles.screen}>
      <Sides edges={edges}>
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
              <View style={styles.status}>
                {item.band === 'triage' ? <TriageMark /> : <Dot tone={BAND_TONE[item.band]} />}
                <Text style={type.meta}>{BAND_TITLE[item.band]}</Text>
              </View>
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
          <Linked taskId={task.id} links={task.links.filter(isArtifact)} noun="artifact" />
          <Linked taskId={task.id} links={task.links.filter((l) => !isArtifact(l))} noun="linked" />
          {/* As on the Mac: what the session made, what it points to, then where it came from. */}
          <Signals signals={detail?.signals ?? []} />
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
        <View style={styles.composerWrap}>
          <Composer ready={ready} onSend={reply} tools={<ComposerTool symbol="plus" label="Attach files" onPress={files.pick} />}>
            <TextInput
              style={composerInput}
              placeholder={
                asking
                  ? 'Answer what you know…'
                  : ask?.kind === 'done'
                    ? 'Or ask for changes…'
                    : ask
                      ? 'Or answer in your own words…'
                      : item.session && item.session.state !== 'ended'
                        ? 'Reply to the session…'
                        : item.session
                          ? 'Reply to pick it up again…'
                          : 'Reply to start a session…'
              }
              placeholderTextColor={colours.text3}
              value={text}
              onChangeText={setText}
              multiline
              accessibilityLabel="Reply to Autopilot"
            />
          </Composer>
        </View>
      </Sides>
    </KeyboardScreen>
  )
}

/** Where the task came from, newest first: three, and the rest on a tap. */
const Signals = ({ signals }: { signals: TaskSignal[] }) => {
  const [all, setAll] = useState(false)
  if (signals.length === 0) return null
  const newest = [...signals].sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))
  return (
    <View style={styles.section}>
      <Text style={type.label}>Signal</Text>
      {(all ? newest : newest.slice(0, 3)).map((m) => (
        <Pressable
          key={`${m.url}-${m.at}`}
          style={styles.signal}
          onPress={() => /^https?:\/\//.test(m.url) && open(m.url)}
          accessibilityRole="link"
          accessibilityLabel={`${signalName(m.signal)}: ${m.title}`}
        >
          <SignalHead signal={m.signal} url={m.url} channel={signalChannel(m)} />
          <Text style={styles.signalTitle}>{m.title}</Text>
          <Text style={type.meta}>
            {[signalSender(m), Number.isNaN(Date.parse(m.at)) ? m.at : ago(m.at)].filter(Boolean).join(' · ')}
            {m.action === 'updated' ? ' · added' : ''}
          </Text>
        </Pressable>
      ))}
      {signals.length > 3 && <MoreToggle open={all} onToggle={() => setAll((x) => !x)} count={signals.length} />}
    </View>
  )
}

/** Where a signal heard it: the source's mark, its name, the channel. */
const SignalHead = ({ signal, url, channel }: { signal: string; url: string; channel: string | null | undefined }) => {
  const mark = signalMark(signal, url)
  return (
    <View style={styles.signalHead}>
      {mark && <SourceMark mark={mark} size={12} />}
      <Text style={type.meta}>
        {signalName(signal)}
        {channel ? ` · ${channel}` : ''}
      </Text>
    </View>
  )
}

/** Opens or folds long text or a long list: the word and a chevron, as on the Mac. */
const MoreToggle = ({ open: on, onToggle, count }: { open: boolean; onToggle: () => void; count?: number }) => (
  <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: on }} hitSlop={8} style={styles.more}>
    <Text style={styles.moreText}>{on ? 'Show less' : count ? `Show all ${count}` : 'Show more'}</Text>
    <SymbolView name={on ? 'chevron.up' : 'chevron.down'} size={11} tintColor={colours.text2} />
  </Pressable>
)

/** Links open where they live; a file on the Mac cannot open here, so the phone reads it instead. */
const open = (url: string) => {
  if (!url.startsWith('file:')) void Linking.openURL(url)
}

/** What the task points to, or its artifacts: one quiet line naming the kinds; each link in its kind once opened. */
const Linked = ({ taskId, links, noun }: { taskId: string; links: QueueItem['task']['links']; noun: 'linked' | 'artifact' }) => {
  const [shown, setShown] = useState(false)
  if (links.length === 0) return null
  const kinds = [...new Set(links.map((l) => linkKind(l).label))]
  return (
    <View style={styles.section}>
      <Pressable onPress={() => setShown((s) => !s)} accessibilityRole="button" accessibilityState={{ expanded: shown }}>
        <Text style={type.meta}>
          {shown ? '▾' : '▸'} {links.length} {noun === 'artifact' && links.length !== 1 ? 'artifacts' : noun} · {kinds.join(', ')}
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
  triage: 'quiet',
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
  folds,
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
  /** An older long entry: its first lines, the rest on a tap, as on the Mac. */
  folds?: boolean
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
      {event ? null : who === 'owner' && isPaste(body) ? (
        <Pasted text={body} />
      ) : folds ? (
        <Folded text={body} onLink={open} />
      ) : (
        <Markdown text={body} onLink={open} />
      )}
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
  screen: { flex: 1, backgroundColor: colours.well },
  page: { paddingHorizontal: GUTTER, paddingTop: 20, gap: 24, paddingBottom: 32 },
  head: { gap: 6 },
  section: { gap: 8 },
  // On the page's own colour: no box, so its text starts on the page's margin like the rest.
  signal: { gap: 2, marginTop: 8, paddingVertical: 6 },
  signalHead: { flexDirection: 'row', alignItems: 'center', gap: 5 },
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
  more: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  moreText: { fontSize: 13, fontWeight: '500', color: colours.text2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  // A plain box, as on the Mac: the avatar on the rail says who asks.
  ask: { ...shaped('ask'), gap: 8, padding: 14 },
  entryBody: { gap: 4 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  linkText: { flex: 1, gap: 2 },
  fullWidth: { width: '100%' },
  linkTitle: { fontSize: 15, color: colours.text },
  preview: { marginLeft: 26, marginBottom: 6, padding: 12, borderRadius: 10, backgroundColor: colours.surface },
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
    backgroundColor: colours.surface,
  },
  nowDot: { width: 8, height: 8, borderRadius: 4 },
  entry: { gap: 4 },
  avatar: { position: 'absolute', left: -36, top: 0 },
  composerWrap: { marginHorizontal: GUTTER, marginTop: 12 },
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
      {long && <MoreToggle open={shown} onToggle={() => setShown((o) => !o)} />}
    </>
  )
}
