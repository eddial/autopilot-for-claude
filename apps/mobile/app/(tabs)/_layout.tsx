import { Stack } from 'expo-router'

/**
 * One screen, the queue: the phone answers and moves tasks along, and settings stay on the Mac. Your
 * Mac (sync, unpair) is a menu beside New task. The group keeps its name so links to /queue hold.
 */
export default function TabsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}
