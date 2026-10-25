import { Text, View } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { TaskToolbar } from '../../../src/components/TaskToolbar.tsx'
import { TaskView } from '../../../src/components/TaskView.tsx'
import { useItems } from '../../../src/store.ts'
import { colours } from '@autopilot/design'

export default function TaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const item = useItems().find((i) => i.task.id === id)
  if (!item) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colours.surface }}>
        <Stack.Screen options={{ title: '' }} />
        <Text style={{ color: colours.text3 }}>This task is closed or not here yet.</Text>
      </View>
    )
  }
  return (
    <>
      <Stack.Screen options={{ title: '', headerLargeTitle: false, headerStyle: { backgroundColor: colours.surface } }} />
      <TaskToolbar item={item} closeAfter />
      <TaskView item={item} />
    </>
  )
}
