import { router, Stack } from 'expo-router'
import { NewTask } from '../src/components/NewTask.tsx'

/** New task as a sheet: the composer, and a way out. */
export default function NewTaskScreen() {
  return (
    <>
      <Stack.Screen options={{ title: '', headerTransparent: true, headerShadowVisible: false }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Cancel" onPress={() => router.back()} />
      </Stack.Toolbar>
      <NewTask onDone={() => router.back()} />
    </>
  )
}
