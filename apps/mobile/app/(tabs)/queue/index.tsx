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
import { Sides, WorkstreamBadge } from '../../../src/ui.tsx'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

type QueueView = 'needs_me' | 'running' | 'waiting' | 'snoozed' | 'done'
const VIEWS: { id: QueueView; title: string; bands: Band[]; symbol: SFSymbol }[] = [
  { id: 'needs_me', title: 'Needs me', bands: ['your_turn', 'new'], symbol: 'tray' },
  { id: 'running', title: 'Running', bands: ['running'], symbol: 'rays' },
  { id: 'waiting', title: 'Waiting on others', bands: ['waiting'], symbol: 'clock' },
  { id: 'snoozed', title: 'Snoozed', bands: ['snoozed'], symbol: 'moon' },
  { id: 'done', title: 'Done', bands: ['done'], symbol: 'flag.checkered' },
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
  // Done is not kept on the phone: read from the Mac when the tab is opened.
  const [done, setDone] = useState<QueueItem[] | null>(null)
  const current = VIEWS.find((v) => v.id === view) ?? VIEWS[0]

  useEffect(() => {
    if (view !== 'done') return
    void sync
      ?.online((api) => api.queue.list({ band: 'done' }))
      .then((s) => setDone(s.items))
      .catch(() => {})
  }, [view, sync])

  const openItems = useMemo(() => items.filter((i) => i.band !== 'done'), [items])
  const counts = useMemo(
    () =>
      Object.fromEntries(VIEWS.map((v) => [v.id, v.id === 'done' ? done?.length : items.filter((i) => v.bands.includes(i.band)).length])),
    [items, done],
  )
  const pick = (id: QueueView) => {
    setAll(id === view && id !== 'done' && !all)
    setView(id)
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

  const open = (id: string) => {
    if (split) setSelected(id)
    else router.push({ pathname: '/queue/[id]', params: { id } })
  }
  const selectedItem = split ? items.find((i) => i.task.id === selected) : undefined

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
      {VIEWS.map((v) => {
        const on = v.id === view
        const name = on && all ? 'All open' : v.title
        const count = on && all ? openItems.length : counts[v.id]
        return (
          <Pressable
            key={v.id}
            style={[styles.tab, on && styles.tabOn]}
            onPress={() => pick(v.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={count === undefined ? name : `${name}, ${count}`}
          >
            <SymbolView name={v.symbol} size={15} tintColor={on ? colours.text : colours.text3} />
            {on && (
              <Text style={styles.tabName} numberOfLines={1}>
                {name}
              </Text>
            )}
            {count !== undefined && (
              <Text
                style={[
                  styles.tabCount,
                  on && { color: colours.text },
                  v.id === 'needs_me' && !all && count > 0 && { color: colours.pilotSoft },
                ]}
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
        {/* The same column as on the Mac: tabs, then search with New task beside it, then the sections. */}
        <View style={{ paddingTop: split ? 8 : insets.top + 8, gap: 8 }}>
          <StatusLine />
          {tabs}
          {search}
        </View>
        <SectionList
          style={{ flex: 1 }}
          sections={sections}
          keyExtractor={(i) => i.task.id}
          stickySectionHeadersEnabled={false}
          refreshControl={<RefreshControl refreshing={false} tintColor={colours.text3} onRefresh={() => void sync?.syncOnce(0)} />}
          keyboardDismissMode="on-drag"

          ListEmptyComponent={
            <Text style={styles.empty}>
              {filter
                ? 'Nothing matches the search.'
                : view === 'done' && done === null
                  ? 'Done is read from your Mac when it is in reach.'
                  : status === 'online' || view !== 'needs_me'
                    ? 'Nothing here. Autopilot fills this as signals file and sessions hand over.'
                    : 'Nothing cached yet.'}
            </Text>
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
          renderItem={({ item }) => <Row item={item} selected={split && item.task.id === selected} onPress={() => open(item.task.id)} />}
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
        <TaskToolbar item={selectedItem} closeAfter={false} />
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

const Row = ({ item, selected, onPress }: { item: QueueItem; selected: boolean; onPress: () => void }) => (
  <Pressable style={[styles.row, selected && { backgroundColor: colours.raised }]} onPress={onPress} accessibilityRole="button">
    <View style={[styles.dot, dotStyle(item)]} />
    <View style={{ flex: 1 }}>
      <Text style={[styles.title, !item.unread && { color: colours.text2 }]} numberOfLines={2}>
        {item.task.title}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {rowMeta(item, false)}
      </Text>
    </View>
    <Text style={styles.meta}>{age(item.openAsk?.createdAt ?? item.task.updatedAt)}</Text>
  </Pressable>
)

const dotStyle = (item: QueueItem) => {
  switch (item.band) {
    case 'your_turn':
      return item.unread ? { backgroundColor: colours.pilot } : { borderWidth: 1.5, borderColor: colours.pilot }
    case 'running':
      return { backgroundColor: colours.clay }
    case 'waiting':
    case 'snoozed':
      return { backgroundColor: colours.amber }
    case 'new':
      return { backgroundColor: colours.text2 }
    default:
      return { backgroundColor: colours.muted }
  }
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: 2, marginHorizontal: 12, marginTop: 4, padding: 3, borderRadius: 12, backgroundColor: colours.well },
  tab: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, height: 34, borderRadius: 9 },
  tabOn: { flex: 2.6, backgroundColor: colours.button },
  tabName: { flexShrink: 1, fontSize: 14, color: colours.text },
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
  dot: { width: 9, height: 9, borderRadius: 5, marginTop: 7 },
  title: { fontSize: 16, lineHeight: 22, color: colours.textBody },
  meta: { marginTop: 3, fontSize: 13, color: colours.text3 },
  empty: { padding: 28, fontSize: 15, lineHeight: 22, color: colours.text3, textAlign: 'center' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colours.surface },
})
