import { Stack } from 'expo-router'
import { colours, fonts } from '@autopilot/design'

/** A native stack: its header and toolbar items are what iOS moves into the Duo's vertical bar. */
export default function TabStack() {
  return (
    <Stack
      screenOptions={{
        headerLargeTitle: true,
        headerStyle: { backgroundColor: colours.window },
        headerLargeTitleStyle: { fontFamily: fonts.serifNative, color: colours.text },
        headerTitleStyle: { color: colours.text },
        headerTintColor: colours.clay,
        contentStyle: { backgroundColor: colours.window },
      }}
    />
  )
}
