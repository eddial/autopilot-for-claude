import { useEffect, useMemo, useState } from 'react'
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import type { Band, QueueItem } from '@autopilot/contracts'
import { router, Stack } from 'expo-router'
import { StatusLine } from '../../../src/components/StatusLine.tsx'
import { TaskToolbar } from '../../../src/components/TaskToolbar.tsx'
import { TaskView } from '../../../src/components/TaskView.tsx'
import { age, BAND_TITLE, rowMeta } from '../../../src/format.ts'
import { useItems, useSyncInstance, useSyncState } from '../../../src/store.ts'
import { colours } from '../../../src/theme.ts'

type QueueView = 'needs_me' | 'all' | 'running' | 'waiting' | 'snoozed'
const VIEWS: { id: QueueView; title: string; bands: Band[] }[] = [
  { id: 'needs_me', title: 'Needs me', bands: ['your_turn', 'new'] },
  { id: 'all', title: 'Everything', bands: ['your_turn', 'new', 'running', 'waiting', 'snoozed'] },
  { id: 'running', title: 'Running', bands: ['running'] },
  { id: 'waiting', title: 'Waiting on others', bands: ['waiting'] },
  { id: 'snoozed', title: 'Snoozed', bands: ['snoozed'] },
]

/** Regular width (the Duo's inner display full screen): list and task side by side. */
const SPLIT_WIDTH = 700

export default function QueueScreen() {
  const items = useItems()
  const sync = useSyncInstance()
  const { status } = useSyncState()
  const { width } = useWindowDimensions()
  const split = width >= SPLIT_WIDTH
  const [view, setView] = useState<QueueView>('needs_me')
  const [selected, setSelected] = useState<string | null>(null)
  const current = VIEWS.find((v) => v.id === view) ?? VIEWS[0]

  const sections = useMemo(() => {
    const bands = current?.bands ?? []
    return bands
      .map((band) => ({ band, title: BAND_TITLE[band], data: items.filter((i) => i.band === band) }))
      .filter((s) => s.data.length > 0)
  }, [items, current])

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

  const list = (
    <SectionList
      style={{ flex: 1 }}
      contentInsetAdjustmentBehavior="automatic"
      sections={sections}
      keyExtractor={(i) => i.task.id}
      stickySectionHeadersEnabled={false}
      refreshControl={<RefreshControl refreshing={false} tintColor={colours.text3} onRefresh={() => void sync?.syncOnce(0)} />}
      ListHeaderComponent={<StatusLine />}
      ListEmptyComponent={
        <Text style={styles.empty}>
          {status === 'online' ? 'Nothing needs you. Autopilot fills this as signals file and sessions hand over.' : 'Nothing cached yet.'}
        </Text>
      }
      renderSectionHeader={({ section }) => (
        <Text style={[styles.section, section.band === 'your_turn' && { color: colours.claySoft }]}>
          {section.title} <Text style={{ color: colours.text3 }}>{section.data.length}</Text>
        </Text>
      )}
      renderItem={({ item }) => <Row item={item} selected={split && item.task.id === selected} onPress={() => open(item.task.id)} />}
    />
  )

  return (
    <>
      <Stack.Screen options={{ title: current?.title ?? 'Queue' }} />
      {/* The prominent action is New task; then the view picker. On a selected task in the split, its actions. */}
      {selectedItem ? (
        <TaskToolbar item={selectedItem} closeAfter={false} />
      ) : (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            variant="prominent"
            tintColor={colours.clay}
            icon="plus"
            accessibilityLabel="New task"
            onPress={() => router.push('/new')}
          />
          <Stack.Toolbar.Menu icon="line.3.horizontal.decrease.circle" accessibilityLabel="View" title="View">
            {VIEWS.map((v) => (
              <Stack.Toolbar.MenuAction key={v.id} isOn={v.id === view} onPress={() => setView(v.id)}>
                {v.title}
              </Stack.Toolbar.MenuAction>
            ))}
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
              <TaskView key={selectedItem.task.id} item={selectedItem} />
            ) : (
              <View style={styles.placeholder}>
                <Text style={styles.empty}>Pick a task.</Text>
                <Pressable onPress={() => router.push('/new')}>
                  <Text style={{ color: colours.clay, fontSize: 15 }}>New task</Text>
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
        {rowMeta(item)}
      </Text>
    </View>
    <Text style={styles.meta}>{age(item.openAsk?.createdAt ?? item.task.updatedAt)}</Text>
  </Pressable>
)

const dotStyle = (item: QueueItem) => {
  switch (item.band) {
    case 'your_turn':
      return item.unread ? { backgroundColor: colours.clay } : { borderWidth: 1.5, borderColor: colours.clay }
    case 'running':
      return { backgroundColor: colours.pilot }
    case 'new':
      return { backgroundColor: colours.text2 }
    default:
      return { backgroundColor: colours.muted }
  }
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 6, fontSize: 13, color: colours.text3 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginHorizontal: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
  },
  dot: { width: 9, height: 9, borderRadius: 5, marginTop: 7 },
  title: { fontSize: 16, lineHeight: 22, color: colours.body },
  meta: { marginTop: 3, fontSize: 13, color: colours.text3 },
  empty: { padding: 28, fontSize: 15, lineHeight: 22, color: colours.text3, textAlign: 'center' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colours.surface },
})
