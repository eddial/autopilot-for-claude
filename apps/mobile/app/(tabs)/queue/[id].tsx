import { useCallback, useRef } from 'react'
import { Text, View } from 'react-native'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { TaskToolbar } from '../../../src/components/TaskToolbar.tsx'
import { TaskView } from '../../../src/components/TaskView.tsx'
import { doneItem, useItems } from '../../../src/store.ts'
import { colours } from '@autopilot/design'

/** A way to another task in the same screen, or none at the end of the list. */
const go = (to: string | undefined) => (to ? () => router.setParams({ id: to }) : null)

export default function TaskScreen() {
  // The list it was opened from, in its order then: answering one does not take it out from under you.
  const { id, list } = useLocalSearchParams<{ id: string; list?: string }>()
  const order = list ? list.split(',') : []
  const at = order.indexOf(id)
  const step = at >= 0 ? { previous: go(order[at - 1]), next: go(order[at + 1]) } : undefined
  const item = useItems().find((i) => i.task.id === id) ?? doneItem(id)
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
          everything down a beat after the screen slid in. */}
      <Stack.Screen options={{ title: item.task.title, headerLargeTitle: false, headerStyle: { backgroundColor: colours.well } }} />
      <TaskToolbar item={item} closeAfter step={step} onTop={() => pageTop.current?.()} />
      <TaskView key={item.task.id} item={item} onTop={toTop} />
    </>
  )
}
