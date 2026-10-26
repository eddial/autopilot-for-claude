import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import type { Band, QueueItem } from '@autopilot/contracts'
import { SymbolView, type SFSymbol } from 'expo-symbols'
import { router, Stack } from 'expo-router'
import { useHeaderHeight } from 'expo-router/react-navigation'
import { StatusLine } from '../../../src/components/StatusLine.tsx'
import { TaskToolbar } from '../../../src/components/TaskToolbar.tsx'
import { TaskView } from '../../../src/components/TaskView.tsx'
import { age, rowMeta } from '../../../src/format.ts'
import { doneItem, rememberDone, serverName, unpair, useItems, useSyncInstance, useSyncState } from '../../../src/store.ts'
import { colours, shapes } from '@autopilot/design'
import { Bars, EmptyList, Sides, WorkstreamBadge, edgeSpace, GUTTER, shaped, type, useBottomGap } from '../../../src/ui.tsx'

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

/** The title's line, and the tab bar's: what edgeSpace centres on the edge line. */
const TITLE_HEIGHT = 34
const TABS_HEIGHT = 40

/** Regular width (the Duo's inner display full screen): list and task side by side. */
const SPLIT_WIDTH = 700

export default function QueueScreen() {
  const items = useItems()
  const sync = useSyncInstance()
  const syncState = useSyncState()
  const { status } = syncState
  const { width } = useWindowDimensions()
  const split = width >= SPLIT_WIDTH
  const [view, setView] = useState<QueueView>('needs_me')
  // Every open task: the current tab tapped again, as on the Mac.
  const [all, setAll] = useState(false)
  // The page starts under the bar where iOS draws one across the top: the title's line is counted from the screen's edge.
  const headerHeight = useHeaderHeight()
  const [selected, setSelected] = useState<string | null>(null)
  const pageTop = useRef<(() => void) | null>(null)
  const toTop = useCallback((scrollUp: () => void) => {
    pageTop.current = scrollUp
  }, [])
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
      .then((s) => {
        rememberDone(s.items)
        setDone(s.items)
      })
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
  const selectedItem = split && selected ? (items.find((i) => i.task.id === selected) ?? doneItem(selected)) : undefined
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
      {[...VIEWS, { id: 'all' as const, title: 'All open', symbol: 'square.3.layers.3d' as SFSymbol }].map((v) => {
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

  const list = (
    // In the split the list is the left column: the right edge's inset (the Duo's bar) is the task's.
    <Sides edges={split ? ['left'] : undefined}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* The same column as on the Mac: search, then the tabs, then the sections. */}
        {/* The title level with the camera beside it, as the tabs are with the last button. */}
        <View style={{ paddingTop: Math.max(8, edgeSpace(TITLE_HEIGHT) - headerHeight), gap: 4 }}>
          <Text style={[type.heading, styles.heading]} numberOfLines={1}>
            {all ? 'All open' : current?.title}
          </Text>
          <Text style={styles.caption} numberOfLines={1}>
            {all ? 'Every open task, across workstreams' : current?.about}
          </Text>
          <StatusLine />
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
        {/* The tabs under the list, where the thumb is; search and New in the bar below them. */}
        <BottomRow>{tabs}</BottomRow>
      </KeyboardAvoidingView>
    </Sides>
  )

  return (
    <>
      {/* No title in the bar: the page has its own. The bar is solid, so where iOS draws it inside the window
          (split screen on the Duo) the list is laid out beside it rather than under it. */}
      <Stack.Screen
        options={{
          title: '',
          headerLargeTitle: false,
          headerTransparent: false,
          headerStyle: { backgroundColor: colours.well },
          scrollEdgeEffects: { top: 'hidden' },
        }}
      />
      {/* Search folds into the bar at the bottom, beside New: both in reach of the thumb. */}
      <Stack.SearchBar
        placeholder="Search"
        autoCapitalize="none"
        hideWhenScrolling={false}
        onChangeText={(e) => setFilter(e.nativeEvent.text)}
        onCancelButtonPress={() => setFilter('')}
      />
      <Stack.Toolbar placement="bottom">
        <Stack.Toolbar.SearchBarSlot />
        <Stack.Toolbar.Spacer />
        {/* In the split, the way through the list sits here too, with the Mac's thin arrows. */}
        <Stack.Toolbar.Button
          icon="arrow.up"
          accessibilityLabel="Previous task"
          hidden={!selectedItem || at < 0}
          disabled={!stepTo(order[at - 1])}
          onPress={() => stepTo(order[at - 1])?.()}
        />
        <Stack.Toolbar.Button
          icon="arrow.down"
          accessibilityLabel="Next task"
          hidden={!selectedItem || at < 0}
          disabled={!stepTo(order[at + 1])}
          onPress={() => stepTo(order[at + 1])?.()}
        />
        <Stack.Toolbar.Button icon="plus" accessibilityLabel="New task" onPress={() => router.push('/new')} />
      </Stack.Toolbar>
      {selectedItem ? (
        <TaskToolbar item={selectedItem} closeAfter={false} onTop={() => pageTop.current?.()} />
      ) : (
        // Settings at the top: the phone has none of its own (sources and workstreams are the Mac's), just your Mac:
        // how it is reached, and a way to unpair. Syncing runs by itself.
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu icon="gearshape" accessibilityLabel="Settings" title={macTitle(syncState)}>
            <Stack.Toolbar.MenuAction
              icon="xmark"
              destructive
              onPress={() =>
                Alert.alert('Unpair this iPhone?', 'Anything still waiting to send is lost. You can pair again from the Mac.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Unpair', style: 'destructive', onPress: () => void unpair() },
                ])
              }
            >
              Unpair
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
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
              <TaskView key={selectedItem.task.id} item={selectedItem} edges={['right']} onTop={toTop} />
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

/** The tabs, on the bottom line: read inside Sides, which measures where this screen's bars are. */
const BottomRow = ({ children }: { children: ReactNode }) => <View style={{ marginBottom: useBottomGap(TABS_HEIGHT) }}>{children}</View>

const Row = ({ item, selected, status, onPress }: { item: QueueItem; selected: boolean; status: boolean; onPress: () => void }) => (
  <Pressable
    style={[styles.row, selected && { backgroundColor: colours[shapes.row.selected] }]}
    onPress={onPress}
    accessibilityRole="button"
  >
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

const ROUTE = { lan: 'on your home network', tailscale: 'over Tailscale' } as const

/** Your Mac, as the menu beside New task names it: which, how it is reached, when it last synced. */
const macTitle = (state: ReturnType<typeof useSyncState>): string => {
  const { status, routeKind, lastSyncedAt, outbox } = state
  const reached =
    status === 'online' ? `Connected ${routeKind ? ROUTE[routeKind] : ''}`.trim() : status === 'connecting' ? 'Connecting…' : 'Out of reach'
  const synced = lastSyncedAt ? (age(lastSyncedAt) === 'now' ? 'synced just now' : `synced ${age(lastSyncedAt)} ago`) : 'not synced yet'
  return [serverName(), reached, synced, outbox.length > 0 ? `${outbox.length} waiting to send` : null].filter(Boolean).join(' · ')
}

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
  heading: { marginHorizontal: GUTTER },
  caption: { marginHorizontal: GUTTER, fontSize: 13, color: colours.text3 },
  tabs: {
    flexDirection: 'row',
    gap: 2,
    marginHorizontal: GUTTER,
    marginTop: 8,
    padding: 3,
    borderRadius: shapes.tabs.radius,
    backgroundColor: colours.window,
  },
  tab: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    height: 34,
    borderRadius: shapes.tab.radius,
  },
  // Lifted off the well, as the Mac's.
  tabOn: {
    backgroundColor: colours[shapes.tab.selected],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colours[shapes.tab.edge],
    shadowColor: colours.shadow,
    shadowOpacity: 1,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  tabCount: { fontSize: 14, color: colours.text3, fontVariant: ['tabular-nums'] },
  section: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: GUTTER, paddingTop: 18, paddingBottom: 8 },
  sectionName: { fontSize: 14, fontWeight: '500', color: colours.text2 },
  sectionCount: { marginLeft: 'auto', fontSize: 13, color: colours.text3 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginHorizontal: GUTTER,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 11,
    ...shaped('row'),
  },
  status: { width: 16, height: 22, alignItems: 'center', justifyContent: 'center' },
  rowEnd: { alignItems: 'flex-end', gap: 8 },
  title: { fontSize: 16, lineHeight: 22, color: colours.text },
  meta: { marginTop: 3, fontSize: 13, color: colours.text3 },
  empty: { padding: 28, fontSize: 15, lineHeight: 22, color: colours.text3, textAlign: 'center' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colours.well },
})
