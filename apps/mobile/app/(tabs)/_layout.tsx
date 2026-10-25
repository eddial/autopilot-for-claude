import { NativeTabs } from 'expo-router/native-tabs'
import { useItems } from '../../src/store.ts'
import { colours } from '@autopilot/design'

/**
 * Native tabs, so iOS can move them into the vertical bar on the iPhone Duo's outer display and in
 * landscape (docs/PRODUCT.md, iPhone Duo). Hand-built tabs would stay at the bottom.
 */
export default function TabsLayout() {
  const yours = useItems().filter((i) => i.band === 'your_turn').length
  return (
    <NativeTabs tintColor={colours.clay}>
      <NativeTabs.Trigger name="queue">
        <NativeTabs.Trigger.Icon sf="tray.full" />
        <NativeTabs.Trigger.Label>Queue</NativeTabs.Trigger.Label>
        {yours > 0 && <NativeTabs.Trigger.Badge>{String(yours)}</NativeTabs.Trigger.Badge>}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="signals">
        <NativeTabs.Trigger.Icon sf="antenna.radiowaves.left.and.right" />
        <NativeTabs.Trigger.Label>Signals</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="servers">
        <NativeTabs.Trigger.Icon sf="desktopcomputer" />
        <NativeTabs.Trigger.Label>Servers</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}
