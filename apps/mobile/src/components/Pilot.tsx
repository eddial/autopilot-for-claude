import { View } from 'react-native'

const ROWS = [
  '...NNNNNNNNNN...',
  '..NNNNGYYGNNNN..',
  '..KKKKKKKKKKKK..',
  '.VVVVVVVVVVVVVV.',
  '..BBBBBBBBBBBB..',
  '..BhAAKKKKhAAB..',
  'BBBAAABBBBAAABBB',
  'BBBBBBBBBBBBBBBB',
  '..BBBBBBBBBBBB..',
  '..BBBBBBBBBBBB..',
  '...B.B....B.B...',
  '...B.B....B.B...',
]
const COLOURS: Record<string, string> = {
  B: '#5DB08F',
  N: '#26303A',
  G: '#E2B84B',
  Y: '#F4D67E',
  K: '#0E0E0E',
  V: '#1A1A1A',
  A: '#17262E',
  h: '#9CC3D2',
}

/** The pilot, Autopilot's mascot, drawn in squares. */
export const Pilot = ({ pixel = 3 }: { pixel?: number }) => (
  <View accessibilityRole="image" accessibilityLabel="Autopilot">
    {ROWS.map((row, y) => (
      <View key={y} style={{ flexDirection: 'row' }}>
        {[...row].map((cell, x) => (
          <View key={x} style={{ width: pixel, height: pixel, backgroundColor: COLOURS[cell] ?? 'transparent' }} />
        ))}
      </View>
    ))}
  </View>
)
