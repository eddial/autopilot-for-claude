import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { pair } from '@autopilot/client'
import { Invite } from '@autopilot/contracts'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { randomUUID } from 'expo-crypto'
import * as Device from 'expo-device'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Pilot } from '../src/components/Pilot.tsx'
import { pinnedFetch } from '../src/pinned.ts'
import { connectTo } from '../src/store.ts'
import { colours, serif } from '../src/theme.ts'

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
        <Text style={styles.title}>Pair with your Mac</Text>
        <Text style={styles.lead}>
          On the Mac, open Autopilot, go to Servers and choose Pair a device. Be on the same Wi-Fi, or both on Tailscale, then scan the code.
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
          <Pressable style={styles.button} onPress={() => void requestPermission()}>
            <Text style={styles.buttonText}>Allow the camera to scan</Text>
          </Pressable>
        )}
        {busy && <ActivityIndicator style={StyleSheet.absoluteFill} color={colours.clay} size="large" />}
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colours.window, padding: 24 },
  head: { alignItems: 'center', gap: 14, marginTop: 24 },
  title: { fontFamily: serif, fontSize: 28, color: colours.text },
  lead: { fontSize: 15, lineHeight: 22, color: colours.text2, textAlign: 'center' },
  camera: { marginTop: 28, aspectRatio: 1, borderRadius: 20, overflow: 'hidden', backgroundColor: colours.surface, alignItems: 'center', justifyContent: 'center' },
  button: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12, backgroundColor: colours.clay },
  buttonText: { color: colours.well, fontSize: 15, fontWeight: '600' },
  error: { marginTop: 16, color: colours.claySoft, fontSize: 14, textAlign: 'center' },
})
