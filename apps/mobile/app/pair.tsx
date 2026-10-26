import { useEffect, useState } from 'react'
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native'
import { pair } from '@autopilot/client'
import { Invite } from '@autopilot/contracts'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useLocalSearchParams } from 'expo-router'
import { randomUUID } from 'expo-crypto'
import * as Device from 'expo-device'
import { SafeAreaView } from 'react-native-safe-area-context'
import { pinnedFetch } from '../src/pinned.ts'
import { connectTo, forgotten } from '../src/store.ts'
import { colours, radius } from '@autopilot/design'
import { Button, Pilot, bannerText, type } from '../src/ui.tsx'

/**
 * First run: Tailscale on the iPhone, then the QR code the Mac app shows under Settings → Devices → Pair a device, or open the same
 * invite as a link (`autopilot://pair?invite=…`), which is how a phone without a camera pairs.
 */
export default function PairScreen() {
  const [permission, requestPermission] = useCameraPermissions()
  const { invite: linked } = useLocalSearchParams<{ invite?: string }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scanned = async (data: string) => {
    if (busy) return
    let invite: Invite
    try {
      invite = Invite.parse(JSON.parse(data))
    } catch {
      setError('That is not an Autopilot pairing code.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const connection = await pair(invite, { name: Device.deviceName ?? 'iPhone', kind: 'iphone' }, pinnedFetch, randomUUID())
      await connectTo(connection, true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  useEffect(() => {
    if (linked) void scanned(linked)
    // Once per link opened; scanned is recreated each render.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [linked])

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.head}>
        <Pilot pixel={4} />
        <Text style={type.heading}>Pair with your Mac</Text>
      </View>
      {/* Your Mac is reached over Tailscale only, at home and away: so it comes first. */}
      <View style={styles.steps}>
        <Step n={1} title="Tailscale on this iPhone">
          Install it, sign in with the same account as on your Mac, and turn on VPN On Demand so it reconnects by itself.
        </Step>
        <Button
          kind="option"
          label="Tailscale in the App Store"
          onPress={() => void Linking.openURL('https://apps.apple.com/app/tailscale/id1470499037')}
          style={styles.store}
        />
        <Step n={2} title="Scan the code on your Mac">
          In Autopilot on the Mac, open Settings, Devices and choose Pair a device.
        </Step>
      </View>
      <View style={styles.camera}>
        {permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={busy ? undefined : ({ data }) => void scanned(data)}
          />
        ) : (
          <Button kind="primary" label="Allow the camera to scan" onPress={() => void requestPermission()} style={styles.allow} />
        )}
        {busy && <ActivityIndicator style={StyleSheet.absoluteFill} color={colours.pilot} size="large" />}
      </View>
      {!error && forgotten() && (
        <Text style={[bannerText('paused'), styles.error]}>
          {forgotten()} no longer knows this iPhone; it was removed under Devices. Pair again to carry on.
        </Text>
      )}
      {error && (
        <Text style={[bannerText(), styles.error]}>
          {error}
          {/fetch|network|reach|timed? ?out/i.test(error) ? ' Check that Tailscale is on, on this iPhone and on your Mac.' : ''}
        </Text>
      )}
    </SafeAreaView>
  )
}

/** One step of pairing: its number, what to do, and how. */
const Step = ({ n, title, children }: { n: number; title: string; children: string }) => (
  <View style={styles.step}>
    <Text style={styles.stepNumber}>{n}</Text>
    <View style={styles.stepText}>
      <Text style={[type.name, { flex: 0 }]}>{title}</Text>
      <Text style={type.meta}>{children}</Text>
    </View>
  </View>
)

const styles = StyleSheet.create({
  steps: { marginTop: 24, gap: 12 },
  step: { flexDirection: 'row', gap: 12 },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colours.borderStrong,
    textAlign: 'center',
    lineHeight: 23,
    fontSize: 13,
    color: colours.text2,
    overflow: 'hidden',
  },
  stepText: { flex: 1, gap: 2 },
  store: { alignSelf: 'flex-start', marginLeft: 36 },
  screen: { flex: 1, backgroundColor: colours.window, padding: 24 },
  head: { alignItems: 'center', gap: 14, marginTop: 24 },
  centred: { textAlign: 'center' },
  camera: {
    marginTop: 20,
    aspectRatio: 1,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colours.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  allow: { alignSelf: 'center' },
  error: { marginTop: 16, textAlign: 'center' },
})
