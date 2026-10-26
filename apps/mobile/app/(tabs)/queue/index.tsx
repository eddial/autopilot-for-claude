import { useEffect, useMemo, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import type { Band, QueueItem } from '@autopilot/contracts'
import { SymbolView, type SFSymbol } from 'expo-symbols'
import { router, Stack } from 'expo-router'
import { StatusLine } from '../../../src/components/StatusLine.tsx'
import { TaskToolbar } from '../../../src/components/TaskToolbar.tsx'
import { TaskView } from '../../../src/components/TaskView.tsx'
import { age, rowMeta } from '../../../src/format.ts'
import { useItems, useSyncInstance, useSyncState } from '../../../src/store.ts'
import { colours } from '@autopilot/design'
import { Bars, EmptyList, Sides, WorkstreamBadge } from '../../../src/ui.tsx'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

type QueueView = 'needs_me' | 'running' | 'waiting' | 'snoozed' | 'done'
const VIEWS: { id: QueueView; title: string; about: string; bands: Band[]; symbol: SFSymbol }[] = [
  {
    id: 'needs_me',
    title: 'Needs me',
    about: 'Waiting on your answer or a go-ahead',
    bands: ['your_turn', 'new'],
    symbol: 'hand.raised',
  },
  { id: 'running', title: 'Running', about: 'A session is working on it', bands: ['running'], symbol: 'hammer' },
  { id: 'waiting', title: 'Waiting on others', about: "Someone else's move", bands: ['waiting'], symbol: 'clock' },
  { id: 'snoozed', title: 'Snoozed', about: 'Put away until later', bands: ['snoozed'], symbol: 'moon' },
  { id: 'done', title: 'Done', about: 'Closed, newest first', bands: ['done'], symbol: 'flag.checkered' },
]

/** `ws:support from:gmail pricing`, as on the Mac. */
const matches = (item: QueueItem, filter: string): boolean =>
  filter
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => {
      if (word.startsWith('ws:')) return item.task.workstream.startsWith(word.slice(3))
      if (word.startsWith('from:')) return (item.task.source.signal ?? 'you').startsWith(word.slice(5))
      return item.task.title.toLowerCase().includes(word) || item.task.id.toLowerCase() === word
    })

/** Regular width (the Duo's inner display full screen): list and task side by side. */
const SPLIT_WIDTH = 700

export default function QueueScreen() {
  const items = useItems()
  const sync = useSyncInstance()
  const { status } = useSyncState()
  const { width } = useWindowDimensions()
  const split = width >= SPLIT_WIDTH
  const [view, setView] = useState<QueueView>('needs_me')
  // Every open task: the current tab tapped again, as on the Mac.
  const [all, setAll] = useState(false)
  const insets = useSafeAreaInsets()
  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [folded, setFolded] = useState<Set<string>>(new Set())
  // Done is not kept on the phone: read from the Mac for its tab's count, again when a task leaves
  // the open ones, and when the tab is opened.
  const [done, setDone] = useState<QueueItem[] | null>(null)
  const current = VIEWS.find((v) => v.id === view) ?? VIEWS[0]
  const stillOpen = items.filter((i) => i.band !== 'done').length

  useEffect(() => {
    void sync
      ?.online((api) => api.queue.list({ band: 'done' }))
      .then((s) => setDone(s.items))
      .catch(() => {})
    // view and stillOpen are when to read again, not what is read.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [view, sync, stillOpen])

  const openItems = useMemo(() => items.filter((i) => i.band !== 'done'), [items])
  const counts = useMemo(
    () =>
      Object.fromEntries(VIEWS.map((v) => [v.id, v.id === 'done' ? done?.length : items.filter((i) => v.bands.includes(i.band)).length])),
    [items, done],
  )
  // All is every open task across workstreams; it keeps the status tab you came from.
  const pick = (id: QueueView | 'all') => {
    setAll(id === 'all')
    if (id !== 'all') setView(id)
  }

  // A section per workstream, in the order of its most pressing task; the inbox last.
  const sections = useMemo(() => {
    const bands = current?.bands ?? []
    const listed = all
      ? openItems.filter((i) => matches(i, filter))
      : (view === 'done' ? (done ?? []) : items).filter((i) => bands.includes(i.band) && matches(i, filter))
    const names = [...new Set(listed.map((i) => i.task.workstream))]
    const order = [...names.filter((n) => n !== 'inbox'), ...names.filter((n) => n === 'inbox')]
    return order.map((name) => {
      const inSection = listed.filter((i) => i.task.workstream === name)
      return { name, count: inSection.length, data: folded.has(name) ? [] : inSection }
    })
  }, [items, openItems, all, done, view, current, filter, folded])
  const fold = (name: string) =>
    setFolded((f) => {
      const next = new Set(f)
      if (!next.delete(name)) next.add(name)
      return next
    })

  // The list as it reads, top to bottom: what the task screen steps through with its chevrons.
  const order = sections.flatMap((section) => section.data.map((i) => i.task.id))
  const open = (id: string) => {
    if (split) setSelected(id)
    else router.push({ pathname: '/queue/[id]', params: { id, list: order.join(',') } })
  }
  const selectedItem = split ? items.find((i) => i.task.id === selected) : undefined
  const at = selected ? order.indexOf(selected) : -1
  const stepTo = (to: string | undefined) => (to ? () => setSelected(to) : null)

  // A phone has no hover: once online, fetch the conversations at the top of the queue in the
  // background, so opening them needs no request.
  const top = items
    .filter((i) => i.band === 'your_turn' || i.band === 'new')
    .slice(0, 15)
    .map((i) => i.task.id)
    .join(',')
  useEffect(() => {
    if (status === 'online' && top) void sync?.prefetch(top.split(','))
  }, [sync, status, top])

  const tabs = (
    <View style={styles.tabs} accessibilityRole="tablist">
      {/* As on the Mac: each status, then All; every tab its symbol and count. */}
      {[...VIEWS, { id: 'all' as const, title: 'All open', symbol: 'square.stack' as SFSymbol }].map((v) => {
        const on = v.id === 'all' ? all : !all && v.id === view
        const count = v.id === 'all' ? openItems.length : counts[v.id]
        return (
          <Pressable
            key={v.id}
            style={[styles.tab, on && styles.tabOn]}
            onPress={() => pick(v.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={count === undefined ? v.title : `${v.title}, ${count}`}
          >
            <SymbolView name={v.symbol} size={15} tintColor={on ? colours.text : colours.text3} />
            {count !== undefined && (
              <Text
                style={[styles.tabCount, on && { color: colours.text }, v.id === 'needs_me' && count > 0 && { color: colours.pilotSoft }]}
              >
                {count}
              </Text>
            )}
          </Pressable>
        )
      })}
    </View>
  )

  const search = (
    <View style={styles.search}>
      <SymbolView name="magnifyingglass" size={15} tintColor={colours.text3} />
      <TextInput
        style={styles.searchInput}
        placeholder="Search"
        placeholderTextColor={colours.text3}
        value={filter}
        onChangeText={setFilter}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        returnKeyType="search"
        accessibilityLabel="Search tasks"
      />
    </View>
  )

  const list = (
    <Sides>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* The same column as on the Mac: search, then the tabs, then the sections. */}
        <View style={{ paddingTop: split ? 8 : insets.top + 8, gap: 8 }}>
          <StatusLine />
          {search}
          {tabs}
          <Text style={styles.caption} numberOfLines={1}>
            <Text style={styles.captionName}>{all ? 'All open' : current?.title}</Text>
            {' · '}
            {all ? 'Every open task, across workstreams' : current?.about}
          </Text>
        </View>
        <SectionList
          style={{ flex: 1 }}
          sections={sections}
          keyExtractor={(i) => i.task.id}
          stickySectionHeadersEnabled={false}
          refreshControl={<RefreshControl refreshing={false} tintColor={colours.text3} onRefresh={() => void sync?.syncOnce(0)} />}
          keyboardDismissMode="on-drag"

          ListEmptyComponent={
            filter || (view === 'done' && done === null) || (status !== 'online' && view === 'needs_me' && items.length === 0) ? (
              <Text style={styles.empty}>
                {filter
                  ? 'Nothing matches the search.'
                  : view === 'done'
                    ? 'Done is read from your Mac when it is in reach.'
                    : 'Nothing cached yet.'}
              </Text>
            ) : (
              <EmptyList view={all ? null : view} />
            )
          }
          renderSectionHeader={({ section }) => {
            const shut = folded.has(section.name)
            return (
              <Pressable
                style={styles.section}
                onPress={() => fold(section.name)}
                accessibilityRole="button"
                accessibilityState={{ expanded: !shut }}
              >
                <WorkstreamBadge name={section.name} />
                <Text style={[styles.sectionName, shut && { color: colours.text3 }]}>{section.name}</Text>
                {shut && <Text style={styles.sectionCount}>{section.count}</Text>}
              </Pressable>
            )
          }}
          renderItem={({ item }) => (
            <Row item={item} selected={split && item.task.id === selected} status={all} onPress={() => open(item.task.id)} />
          )}
        />
      </KeyboardAvoidingView>
    </Sides>
  )

  return (
    <>
      {/* The tab names itself, so there is no title bar; in the split it carries the selected task's actions. */}
      <Stack.Screen
        options={
          split
            ? { title: all ? 'All open' : (current?.title ?? 'Queue'), headerLargeTitle: false }
            : // The toolbar needs a header; an empty, see-through one puts New in the side bar alone.
              {
                title: '',
                headerLargeTitle: false,
                headerTransparent: true,
                headerStyle: { backgroundColor: 'transparent' },
                scrollEdgeEffects: { top: 'hidden' },
              }
        }
      />
      {selectedItem ? (
        <TaskToolbar
          item={selectedItem}
          closeAfter={false}
          step={at >= 0 ? { previous: stepTo(order[at - 1]), next: stepTo(order[at + 1]) } : undefined}
        />
      ) : (
        // New task in the side bar, where iOS puts a screen's actions on the Duo.
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button icon="plus" accessibilityLabel="New task" onPress={() => router.push('/new')} />
        </Stack.Toolbar>
      )}
      {split ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <View
            style={{ width: Math.min(420, width * 0.42), borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colours.border }}
          >
            {list}
          </View>
          <View style={{ flex: 1 }}>
            {selectedItem ? (
              <TaskView key={selectedItem.task.id} item={selectedItem} />
            ) : (
              <View style={styles.placeholder}>
                <Text style={styles.empty}>Pick a task.</Text>
                <Pressable onPress={() => router.push('/new')}>
                  <Text style={{ color: colours.pilot, fontSize: 15 }}>New task</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      ) : (
        list
      )}
    </>
  )
}

const Row = ({ item, selected, status, onPress }: { item: QueueItem; selected: boolean; status: boolean; onPress: () => void }) => (
  <Pressable style={[styles.row, selected && { backgroundColor: colours.raised }]} onPress={onPress} accessibilityRole="button">
    {/* Under All: where it stands, as its tab draws it; green only when it is your turn. */}
    {status && (
      <View style={styles.status}>
        <SymbolView name={BAND_SYMBOL[item.band]} size={14} tintColor={item.band === 'your_turn' ? colours.pilot : colours.text3} />
      </View>
    )}
    <View style={{ flex: 1 }}>
      <Text style={[styles.title, item.unread && { fontWeight: '500' }]} numberOfLines={2}>
        {item.task.title}
      </Text>
      <Text style={styles.meta} numberOfLines={2}>
        {rowMeta(item, false)}
      </Text>
    </View>
    {/* When, and under it how much it matters, as on the Mac. */}
    <View style={styles.rowEnd}>
      <Text style={styles.meta}>{age(item.openAsk?.createdAt ?? item.task.updatedAt)}</Text>
      <Bars priority={item.task.priority} listed />
    </View>
  </Pressable>
)

/** Each band as the symbol of the tab it shows under. */
const BAND_SYMBOL: Record<QueueItem['band'], SFSymbol> = {
  your_turn: 'hand.raised',
  new: 'hand.raised',
  running: 'hammer',
  waiting: 'clock',
  snoozed: 'moon',
  done: 'flag.checkered',
}

const styles = StyleSheet.create({
  caption: { marginHorizontal: 20, fontSize: 13, color: colours.text3 },
  captionName: { fontWeight: '500', color: colours.text2 },
  tabs: { flexDirection: 'row', gap: 2, marginHorizontal: 12, marginTop: 4, padding: 3, borderRadius: 12, backgroundColor: colours.well },
  tab: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, height: 34, borderRadius: 9 },
  // Lifted off the well, as the Mac's.
  tabOn: {
    backgroundColor: colours.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colours.borderStrong,
    shadowColor: colours.shadow,
    shadowOpacity: 1,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  tabCount: { fontSize: 14, color: colours.text3, fontVariant: ['tabular-nums'] },
  section: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 16, paddingTop: 18, paddingBottom: 8 },
  sectionName: { fontSize: 14, color: colours.text2, fontFamily: 'Menlo' },
  sectionCount: { marginLeft: 'auto', fontSize: 13, color: colours.text3 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 12,
    backgroundColor: colours.surface,
  },
  searchInput: { flex: 1, fontSize: 16, color: colours.text },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: colours.surface,
  },
  status: { width: 16, height: 22, alignItems: 'center', justifyContent: 'center' },
  rowEnd: { alignItems: 'flex-end', gap: 8 },
  title: { fontSize: 16, lineHeight: 22, color: colours.text },
  meta: { marginTop: 3, fontSize: 13, color: colours.text3 },
  empty: { padding: 28, fontSize: 15, lineHeight: 22, color: colours.text3, textAlign: 'center' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colours.surface },
})
