import { useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { pair } from '@autopilot/client'
import { Invite } from '@autopilot/contracts'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { randomUUID } from 'expo-crypto'
import * as Device from 'expo-device'
import { SafeAreaView } from 'react-native-safe-area-context'
import { pinnedFetch } from '../src/pinned.ts'
import { connectTo } from '../src/store.ts'
import { colours, radius } from '@autopilot/design'
import { Button, Pilot, bannerText, type } from '../src/ui.tsx'

/** First run: scan the QR code the Mac app shows under Servers → Pair a device. */
export default function PairScreen() {
  const [permission, requestPermission] = useCameraPermissions()
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

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.head}>
        <Pilot pixel={4} />
        <Text style={type.heading}>Pair with your Mac</Text>
        <Text style={[type.lead, styles.centred]}>
          On the Mac, open Autopilot, go to Servers and choose Pair a device. Be on the same Wi-Fi, or both on Tailscale, then scan the
          code.
        </Text>
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
        {busy && <ActivityIndicator style={StyleSheet.absoluteFill} color={colours.clay} size="large" />}
      </View>
      {error && <Text style={[bannerText(), styles.error]}>{error}</Text>}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colours.window, padding: 24 },
  head: { alignItems: 'center', gap: 14, marginTop: 24 },
  centred: { textAlign: 'center' },
  camera: {
    marginTop: 28,
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
