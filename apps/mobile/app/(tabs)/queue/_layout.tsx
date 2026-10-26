import { Stack } from 'expo-router'
import { colours, fonts } from '@autopilot/design'

/** A native stack: its header and toolbar items are what iOS moves into the Duo's vertical bar. */
export default function TabStack() {
  return (
    <Stack
      screenOptions={{
        headerLargeTitle: true,
        // No hairline under the bar: on the Duo it stops short at the side bar.
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colours.well },
        headerLargeTitleStyle: { fontFamily: fonts.serifNative, color: colours.text },
        headerTitleStyle: { color: colours.text },
        headerTintColor: colours.pilot,
        contentStyle: { backgroundColor: colours.well },
      }}
    />
  )
}
