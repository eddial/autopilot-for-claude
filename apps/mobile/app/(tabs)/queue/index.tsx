import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  PanResponder,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import type { Band, QueueItem } from '@autopilot/contracts'
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect'
import * as Haptics from 'expo-haptics'
import { SymbolView, type SFSymbol } from 'expo-symbols'
import { router, Stack } from 'expo-router'
import { useHeaderHeight } from 'expo-router/react-navigation'
import { StatusLine } from '../../../src/components/StatusLine.tsx'
import { TaskToolbar } from '../../../src/components/TaskToolbar.tsx'
import { TaskView } from '../../../src/components/TaskView.tsx'
import { NewTask } from '../../../src/components/NewTask.tsx'
import { age, rowMeta } from '../../../src/format.ts'
import {
  doneItem,
  groupBy as storedGroupBy,
  rememberDone,
  saveGroupBy,
  serverName,
  unpair,
  useItems,
  useOpenRequest,
  useSyncInstance,
  useSyncState,
} from '../../../src/store.ts'
import { colours, shapes } from '@autopilot/design'
import { emptyWords, rowStatus, sectionsOf, type GroupBy } from '@autopilot/client'
import { Bars, EmptyList, Sides, WorkstreamBadge, COMPOSER_BAR, edgeSpace, GUTTER, shaped, type, useBottomGap } from '../../../src/ui.tsx'

type QueueView = 'needs_me' | 'running' | 'waiting' | 'snoozed' | 'done'
const VIEWS: { id: QueueView; title: string; about: string; bands: Band[]; symbol: SFSymbol }[] = [
  {
    id: 'needs_me',
    title: 'Needs me',
    about: 'Under way and waiting on you',
    bands: ['your_turn', 'triage'],
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
const TITLE_HEIGHT = 30
const TABS_HEIGHT = 40

/**
 * The Duo open, either way up: list and task side by side, as Claude puts its chats beside the
 * conversation. Folded (short) or in a split-view half (narrow) it is one or the other.
 */
const SPLIT_WIDTH = 600
const SPLIT_HEIGHT = 600

export default function QueueScreen() {
  const items = useItems()
  const sync = useSyncInstance()
  const syncState = useSyncState()
  const { status } = syncState
  const { width, height } = useWindowDimensions()
  const split = width >= SPLIT_WIDTH && height >= SPLIT_HEIGHT
  // Upright, iOS lays the bar across the bottom, over the composer's send: the list beside the task
  // is the way through it there, so the arrows stay away.
  const upright = height > width
  const narrow = split && upright
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
  const [groupBy, setGroupBy] = useState<GroupBy>(storedGroupBy)
  const chooseGroupBy = (by: GroupBy) => {
    setGroupBy(by)
    saveGroupBy(by)
  }
  // Done is not kept on the phone: read from the Mac for its tab's count, again when a task leaves
  // the open ones, and when the tab is opened.
  const [done, setDone] = useState<QueueItem[] | null>(null)
  // The tab bar answers at once; the list it shows follows a frame later, so the pill starts moving
  // before the new list is built, and the list slides in already built.
  const listView = useDeferredValue(view)
  const listAll = useDeferredValue(all)
  const current = VIEWS.find((v) => v.id === listView) ?? VIEWS[0]
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

  // A section per workstream, in the order of its most pressing task, the inbox last; or Urgent to Low.
  const sections = useMemo(() => {
    const bands = current?.bands ?? []
    const listed = listAll
      ? openItems.filter((i) => matches(i, filter))
      : (listView === 'done' ? (done ?? []) : items).filter((i) => bands.includes(i.band) && matches(i, filter))
    return sectionsOf(listed, groupBy, !listAll && listView === 'needs_me').map((s) => ({
      name: s.key,
      title: s.title,
      priority: groupBy === 'priority' ? (s.items[0]?.task.priority ?? null) : null,
      count: s.items.length,
      part: s.part ?? null,
      data: folded.has(s.key) ? [] : s.items,
    }))
  }, [items, openItems, listAll, done, listView, current, filter, folded, groupBy])
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
  // A tapped notification: beside the list, on the tab that holds the task, when there is room;
  // on its own screen otherwise. Before the queue has loaded, it waits for it.
  const [wanted, opened] = useOpenRequest()
  const loaded = items.length > 0
  useEffect(() => {
    if (!wanted || !loaded) return
    opened()
    if (!split) return void router.push({ pathname: '/queue/[id]', params: { id: wanted } })
    const band = items.find((i) => i.task.id === wanted)?.band
    const tab = VIEWS.find((v) => v.id !== 'done' && band && v.bands.includes(band))
    setAll(!tab)
    if (tab) setView(tab.id)
    setFilter('')
    setSelected(wanted)
    // items is read once, when the request comes in.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, loaded, split])
  // The open task is a layer over New task: it follows a drag to the right, as iOS's own way back,
  // and slides off to the right, showing New task under it; a short drag springs back. Only a
  // clearly sideways drag: scrolling the conversation stays the scroll view's. It stays off screen until the layer is gone, and is put back before
  // the next task paints, so the old position never shows.
  const [slide] = useState(() => new Animated.Value(0))
  const slideAway = () =>
    Animated.timing(slide, { toValue: width, duration: 220, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setSelected(null)
    })
  // Put back only for the next task: resetting as the slid-off one unmounts can reach the screen a
  // frame before the unmount does, flashing it back in place.
  useLayoutEffect(() => {
    if (selected) slide.setValue(0)
  }, [selected, slide])
  const swipeAway = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, g) => g.dx > 16 && Math.abs(g.dx) > 2.5 * Math.abs(g.dy),
        onPanResponderMove: (_, g) => slide.setValue(Math.max(0, g.dx)),
        onPanResponderRelease: (_, g) => {
          if (g.dx > 100 || g.vx > 0.6) slideAway()
          else Animated.spring(slide, { toValue: 0, useNativeDriver: true }).start()
        },
        onPanResponderTerminate: () => Animated.spring(slide, { toValue: 0, useNativeDriver: true }).start(),
      }),
    // slideAway reads width when it runs.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [slide, width],
  )
  // Folded with a task open beside the list: it stays open, on its own screen.
  useEffect(() => {
    if (split || !selected) return
    router.push({ pathname: '/queue/[id]', params: { id: selected, list: order.join(',') } })
    setSelected(null)
    // order is read when folding, not a reason to.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [split, selected])
  // One callback for every row, so a row redraws only when its own task changes.
  const openRef = useRef(open)
  openRef.current = open
  const openRow = useCallback((id: string) => openRef.current(id), [])
  const selectedItem = split && selected ? (items.find((i) => i.task.id === selected) ?? doneItem(selected)) : undefined
  const at = selected ? order.indexOf(selected) : -1
  const stepTo = (to: string | undefined) => (to ? () => setSelected(to) : null)

  // A phone has no hover: once online, fetch the conversations at the top of the queue in the
  // background, so opening them needs no request.
  const top = items
    .filter((i) => i.band === 'your_turn' || i.band === 'triage')
    .slice(0, 15)
    .map((i) => i.task.id)
    .join(',')
  useEffect(() => {
    if (status === 'online' && top) void sync?.prefetch(top.split(','))
  }, [sync, status, top])

  const tabItems = [...VIEWS, { id: 'all' as const, title: 'All open', symbol: 'square.3.layers.3d' as SFSymbol }]
  const tabOrder: (QueueView | 'all')[] = tabItems.map((v) => v.id)
  const shown: QueueView | 'all' = all ? 'all' : view
  // A sideways swipe across the list moves one tab along, as paging through them: left for the next.
  const pickRef = useRef(pick)
  pickRef.current = pick
  const currentRef = useRef(shown)
  currentRef.current = shown
  const swipeTabs = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 24 && Math.abs(g.dx) > 2.5 * Math.abs(g.dy),
        onPanResponderRelease: (_, g) => {
          if (Math.abs(g.dx) < 60 && Math.abs(g.vx) < 0.5) return
          const here = tabOrder.indexOf(currentRef.current)
          const to = tabOrder[here + (g.dx < 0 ? 1 : -1)]
          if (!to) return
          void Haptics.selectionAsync()
          pickRef.current(to)
        },
      }),
    // The order of the tabs is fixed.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  // Switching tabs slides the new list in from the side it lies on: nothing more.
  const [listShift] = useState(() => new Animated.Value(0))
  const listShown: QueueView | 'all' = listAll ? 'all' : listView
  const lastTab = useRef(listShown)
  const listWidth = split ? Math.min(420, width * 0.42) : width
  useLayoutEffect(() => {
    const from = tabOrder.indexOf(lastTab.current)
    const to = tabOrder.indexOf(listShown)
    lastTab.current = listShown
    if (from === to || from < 0) return
    listShift.setValue((to > from ? 1 : -1) * listWidth)
    Animated.timing(listShift, { toValue: 0, duration: 220, useNativeDriver: true }).start()
    // Only a change of tab slides the list.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [listShown])
  const tabs = (
    <TabBar
      items={tabItems.map((v) => ({ id: v.id, title: v.title, symbol: v.symbol, count: v.id === 'all' ? openItems.length : counts[v.id] }))}
      selected={shown}
      narrow={narrow}
      onPick={(id) => pick(id as QueueView | 'all')}
    />
  )

  const list = (
    // In the split the list is the left column: the right edge's inset (the Duo's bar) is the task's.
    <Sides edges={split ? ['left'] : undefined}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} {...swipeTabs.panHandlers}>
        <Animated.View style={{ flex: 1, transform: [{ translateX: listShift }] }}>
          <SectionList
            style={{ flex: 1 }}
            sections={sections}
            keyExtractor={(i) => i.task.id}
            stickySectionHeadersEnabled={false}
            refreshControl={<RefreshControl refreshing={false} tintColor={colours.text3} onRefresh={() => void sync?.syncOnce(0)} />}
            keyboardDismissMode="on-drag"
            ListFooterComponent={<BottomRoom beside={split} />}
            // The tab's name and what it holds scroll with the list, in the same plane as its rows. Open,
            // the Duo's bar is beside the list (or over the task), never above it: level with the camera.
            ListHeaderComponent={
              <View style={{ paddingTop: split ? edgeSpace(TITLE_HEIGHT) : Math.max(headerHeight + 8, edgeSpace(TITLE_HEIGHT)), gap: 4 }}>
                <Text style={[type.title, styles.heading]} numberOfLines={1}>
                  {listAll ? 'All open' : current?.title}
                </Text>
                <Text style={styles.caption} numberOfLines={1}>
                  {listAll ? 'Every open task, across workstreams' : current?.about}
                </Text>
                <StatusLine />
              </View>
            }

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
                <EmptyList view={listAll ? null : listView} quiet={split && !selectedItem} />
              )
            }
            renderSectionHeader={({ section }) => {
              const shut = folded.has(section.name)
              return (
                <View>
                  {/* Triage, under Needs me: its name and what it holds, set as the tab's own title is. */}
                  {section.part && (
                    <View style={styles.part}>
                      <Text style={[type.title, styles.heading]}>{section.part.title}</Text>
                      <Text style={styles.caption} numberOfLines={2}>
                        {section.part.about}
                      </Text>
                    </View>
                  )}
                  <Pressable
                    style={styles.section}
                    onPress={() => fold(section.name)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: !shut }}
                  >
                    {section.priority === null ? (
                      <WorkstreamBadge name={section.title} />
                    ) : (
                      <View style={styles.priorityBadge}>
                        <Bars priority={section.priority} />
                      </View>
                    )}
                    <Text style={[styles.sectionName, shut && { color: colours.text3 }]}>{section.title}</Text>
                    {shut && <Text style={styles.sectionCount}>{section.count}</Text>}
                  </Pressable>
                </View>
              )
            }}
            // Empty: the list's middle is the empty state's, between the title and the tabs.
            contentContainerStyle={sections.length === 0 ? { flexGrow: 1 } : undefined}
            initialNumToRender={12}
            maxToRenderPerBatch={10}
            windowSize={7}
            renderItem={({ item }) => (
              <Row
                item={item}
                selected={split && item.task.id === selected}
                status={listAll}
                workstream={groupBy === 'priority'}
                onOpen={openRow}
              />
            )}
          />
        </Animated.View>
        {/* The tabs under the list, where the thumb is; search and New in the bar below them. */}
        <BottomRow beside={split}>{tabs}</BottomRow>
      </KeyboardAvoidingView>
    </Sides>
  )

  return (
    <>
      {/* No title in the bar: the page has its own. The bar is see-through, so nothing scrolls under an
          opaque strip; where iOS draws it across the top (split view) the list starts below it. */}
      <Stack.Screen
        options={{
          title: '',
          headerLargeTitle: false,
          headerTransparent: true,
          headerStyle: { backgroundColor: 'transparent' },
          scrollEdgeEffects: { top: 'hidden' },
        }}
      />
      {/* Search is the list's: with a task open beside it, the bar is the task's. */}
      {!selectedItem && (
        <Stack.SearchBar
          placeholder="Search"
          autoCapitalize="none"
          hideWhenScrolling={false}
          // A button that opens into the field, as Claude's search: no long bar across the bottom.
          placement="integratedButton"
          onChangeText={(e) => setFilter(e.nativeEvent.text)}
          onCancelButtonPress={() => setFilter('')}
        />
      )}
      {/* With a task open beside the list: close it, and step through the list with the Mac's thin
          arrows. With none: search, and New (in the split the empty side is New task already). */}
      <Stack.Toolbar placement="bottom">
        {/* Search is a button in the bar at the top, in every pose: never a second one down here. */}
        {/* With a task open beside the list: New task in its place, as Claude's new chat beside its chats. */}
        <Stack.Toolbar.Button
          icon="square.and.pencil"
          accessibilityLabel="New task"
          hidden={!selectedItem || narrow}
          onPress={() => setSelected(null)}
        />
        <Stack.Toolbar.Spacer />
        <Stack.Toolbar.Button
          icon="arrow.up"
          accessibilityLabel="Previous task"
          hidden={!selectedItem || at < 0 || upright}
          disabled={!stepTo(order[at - 1])}
          onPress={() => stepTo(order[at - 1])?.()}
        />
        <Stack.Toolbar.Button
          icon="arrow.down"
          accessibilityLabel="Next task"
          hidden={!selectedItem || at < 0 || upright}
          disabled={!stepTo(order[at + 1])}
          onPress={() => stepTo(order[at + 1])?.()}
        />
        <Stack.Toolbar.Button icon="plus" accessibilityLabel="New task" hidden={split} onPress={() => router.push('/new')} />
      </Stack.Toolbar>
      {selectedItem ? (
        <TaskToolbar
          item={selectedItem}
          closeAfter={false}
          onTop={() => pageTop.current?.()}
          onNew={narrow ? () => setSelected(null) : undefined}
        />
      ) : (
        // Settings at the top: the phone has none of its own (sources and workstreams are the Mac's), just your Mac:
        // how it is reached, and a way to unpair. Syncing runs by itself.
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu icon="gearshape" accessibilityLabel="Settings" title={macTitle(syncState)}>
            <Stack.Toolbar.Menu inline title="Group the list">
              <Stack.Toolbar.MenuAction icon="square.stack" isOn={groupBy === 'workstream'} onPress={() => chooseGroupBy('workstream')}>
                By workstream
              </Stack.Toolbar.MenuAction>
              <Stack.Toolbar.MenuAction icon="chart.bar" isOn={groupBy === 'priority'} onPress={() => chooseGroupBy('priority')}>
                By priority
              </Stack.Toolbar.MenuAction>
            </Stack.Toolbar.Menu>
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
          <View style={{ flex: 1, overflow: 'hidden' }}>
            <NewTask
              onDone={() => undefined}
              edges={['right']}
              autoFocus={false}
              clear={
                !selectedItem && sections.length === 0 && !filter && !(view === 'done' && done === null)
                  ? emptyWords(all ? null : view).title
                  : undefined
              }
            />
            {selectedItem && (
              <Animated.View
                style={[StyleSheet.absoluteFill, { backgroundColor: colours.well, transform: [{ translateX: slide }] }]}
                {...swipeAway.panHandlers}
              >
                <TaskView key={selectedItem.task.id} item={selectedItem} edges={['right']} onTop={toTop} />
              </Animated.View>
            )}
          </View>
        </View>
      ) : (
        list
      )}
    </>
  )
}

type Tab = { id: string; title: string; symbol: SFSymbol; count: number | undefined }

/**
 * The tabs: each status and All, a symbol and a count, on Liquid Glass where iOS has it. The chosen
 * one is marked by a lifted pill that slides to it, so switching (a tap, or a swipe across the list)
 * reads as one movement. In the narrow column only the chosen tab says its count, and is wider.
 */
const TabBar = ({ items, selected, narrow, onPick }: { items: Tab[]; selected: string; narrow: boolean; onPick: (id: string) => void }) => {
  const [frames, setFrames] = useState<Record<string, { x: number; width: number }>>({})
  // Moved on the UI thread (a transform, the native driver), so it keeps the frame rate while the
  // new list renders; its width follows the tab at once.
  const [x] = useState(() => new Animated.Value(0))
  const placed = useRef(false)
  const frame = frames[selected]
  useEffect(() => {
    if (!frame) return
    if (!placed.current) {
      placed.current = true
      x.setValue(frame.x)
      return
    }
    Animated.spring(x, { toValue: frame.x, useNativeDriver: true, damping: 24, stiffness: 300, mass: 0.7 }).start()
  }, [frame, x])
  const glass = isLiquidGlassAvailable()
  const Bar = glass ? GlassView : View
  return (
    <Bar style={[styles.tabs, glass && styles.tabsGlass]} accessibilityRole="tablist">
      {frame && (
        <Animated.View pointerEvents="none" style={[styles.tabOn, { left: 0, width: frame.width, transform: [{ translateX: x }] }]} />
      )}
      {items.map((v) => {
        const on = v.id === selected
        return (
          <Pressable
            key={v.id}
            style={[styles.tab, narrow && on && { flex: 1.8 }]}
            onLayout={(e) => {
              const { x: left, width: w } = e.nativeEvent.layout
              setFrames((all) => (all[v.id]?.x === left && all[v.id]?.width === w ? all : { ...all, [v.id]: { x: left, width: w } }))
            }}
            onPress={() => onPick(v.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={v.count === undefined ? v.title : `${v.title}, ${v.count}`}
          >
            <SymbolView name={v.symbol} size={15} tintColor={on ? colours.text : colours.text3} />
            {v.count !== undefined && (on || !narrow) && <Text style={[styles.tabCount, on && { color: colours.text }]}>{v.count}</Text>}
          </Pressable>
        )
      })}
    </Bar>
  )
}

/**
 * The tabs, on the bottom line: read inside Sides, which measures where this screen's bars are.
 * Beside a task (the split) their bottom edge lines up with the composer's instead.
 */
const useBottomRowGap = (beside: boolean) => {
  const centred = useBottomGap(TABS_HEIGHT)
  const withComposer = useBottomGap(COMPOSER_BAR)
  return beside ? withComposer : centred
}

/** The tabs float over the list's end, so rows scroll on under them and no strip cuts the list off. */
const BottomRow = ({ beside, children }: { beside: boolean; children: ReactNode }) => (
  <View style={{ position: 'absolute', left: 0, right: 0, bottom: useBottomRowGap(beside) }}>{children}</View>
)

/** Room at the end of the list for the tabs floating over it, so the last row can scroll clear. */
const BottomRoom = ({ beside }: { beside: boolean }) => <View style={{ height: useBottomRowGap(beside) + TABS_HEIGHT + 16 }} />

const Row = memo(function Row({
  item,
  selected,
  status,
  workstream,
  onOpen,
}: {
  item: QueueItem
  selected: boolean
  status: boolean
  /** Grouped by priority, where the workstreams mix: its workstream in its line. */
  workstream: boolean
  onOpen: (id: string) => void
}) {
  return (
    <Pressable
      style={[styles.row, selected && { backgroundColor: colours[shapes.row.selected] }]}
      onPress={() => onOpen(item.task.id)}
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
        <Text style={styles.meta} numberOfLines={1}>
          {rowStatus(item) && <Text style={[styles.rowLabel, item.band === 'triage' && { color: colours.urgent }]}>{rowStatus(item)}</Text>}
          {rowStatus(item) ? ' · ' : null}
          {rowMeta(item, workstream)}
        </Text>
      </View>
      {/* When, and under it how much it matters, as on the Mac. */}
      <View style={styles.rowEnd}>
        <Text style={styles.meta}>{age(item.openAsk?.createdAt ?? item.task.updatedAt)}</Text>
        <Bars priority={item.task.priority} listed />
      </View>
    </Pressable>
  )
})

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
  triage: 'tray',
  running: 'hammer',
  waiting: 'clock',
  snoozed: 'moon',
  done: 'flag.checkered',
}

const styles = StyleSheet.create({
  part: { gap: 4, paddingTop: 28, paddingBottom: 2 },
  rowLabel: { color: colours.pilotSoft, fontWeight: '500' },
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
  // On Liquid Glass the bar is the glass itself, no fill of its own.
  tabsGlass: { backgroundColor: 'transparent', borderRadius: 20 },
  // Lifted off the well, as the Mac's; it slides from tab to tab.
  tabOn: {
    position: 'absolute',
    top: 3,
    height: 34,
    // Round, inside the round bar: its curve follows the bar's, 3 points in.
    borderRadius: 17,
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
  priorityBadge: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
})
