import { useCallback, useEffect, useRef } from 'react'
import { Pressable, Text, useWindowDimensions, View } from 'react-native'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { TaskToolbar } from '../../../src/components/TaskToolbar.tsx'
import { TaskView } from '../../../src/components/TaskView.tsx'
import { doneItem, requestOpen, useItems } from '../../../src/store.ts'
import { colours } from '@autopilot/design'

/** A way to another task in the same screen, or none at the end of the list. */
const go = (to: string | undefined) => (to ? () => router.setParams({ id: to }) : null)

/**
 * The title in the bar, which goes back to the top of the page when tapped. iOS sizes a title of
 * our own to its text and centres it: it takes the bar's width instead, left as the system's was.
 */
const TapTitle = ({ title, onPress }: { title: string; onPress: () => void }) => {
  const { width } = useWindowDimensions()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityHint="Back to the top" style={{ width: width - 114 }}>
      <Text numberOfLines={1} style={{ fontSize: 17, fontWeight: '600', color: colours.text }}>
        {title}
      </Text>
    </Pressable>
  )
}

export default function TaskScreen() {
  // The list it was opened from, in its order then: answering one does not take it out from under you.
  const { id, list } = useLocalSearchParams<{ id: string; list?: string }>()
  const order = list ? list.split(',') : []
  const at = order.indexOf(id)
  const step = at >= 0 ? { previous: go(order[at - 1]), next: go(order[at + 1]) } : undefined
  const item = useItems().find((i) => i.task.id === id) ?? doneItem(id)
  // Unfolded with a task open: the queue shows it beside the list, on the tab that holds it.
  const { width, height } = useWindowDimensions()
  const roomy = width >= 600 && height >= 600
  useEffect(() => {
    if (!roomy || !router.canGoBack()) return
    requestOpen(id)
    router.back()
  }, [roomy, id])
  const pageTop = useRef<(() => void) | null>(null)
  const toTop = useCallback((scrollUp: () => void) => {
    pageTop.current = scrollUp
  }, [])
  if (!item) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colours.well }}>
        <Stack.Screen options={{ title: '' }} />
        <Text style={{ color: colours.text3 }}>This task is closed or not here yet.</Text>
      </View>
    )
  }
  return (
    <>
      {/* The bar says the title from the start: setting it once the page had jumped to its end moved
          everything down a beat after the screen slid in. A tap on it goes back to the top, as a tap
          on the status bar does elsewhere: no button for it in a bar with little room. */}
      <Stack.Screen
        options={{
          title: item.task.title,
          headerLargeTitle: false,
          headerStyle: { backgroundColor: colours.well },
        }}
      />
      <Stack.Title asChild>
        <TapTitle title={item.task.title} onPress={() => pageTop.current?.()} />
      </Stack.Title>
      <TaskToolbar item={item} closeAfter step={step} />
      <TaskView key={item.task.id} item={item} onTop={toTop} />
    </>
  )
}
