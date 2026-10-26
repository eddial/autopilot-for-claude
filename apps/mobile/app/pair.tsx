import { useEffect, useState } from 'react'
import { ActivityIndicator, AppState, Linking, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { pair } from '@autopilot/client'
import { Invite } from '@autopilot/contracts'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useLocalSearchParams } from 'expo-router'
import { randomUUID } from 'expo-crypto'
import * as Device from 'expo-device'
import { SafeAreaView } from 'react-native-safe-area-context'
import PinnedFetchNative from '../modules/pinned-fetch/src/index.ts'
import { pinnedFetch } from '../src/pinned.ts'
import { connectTo, forgotten } from '../src/store.ts'
import { colours, radius } from '@autopilot/design'
import { Button, Check, Pilot, bannerText, type } from '../src/ui.tsx'

/**
 * First run, in two screens: a checklist for Tailscale on the iPhone (the Mac is reached over it
 * only), then the QR code the Mac app shows under Settings → Devices → Pair a device, or open the same
 * invite as a link (`autopilot://pair?invite=…`), which is how a phone without a camera pairs.
 */
export default function PairScreen() {
  const [permission, requestPermission] = useCameraPermissions()
  const { invite: linked } = useLocalSearchParams<{ invite?: string }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tailnet = useTailnet()
  // The checklist: what the app can't see for itself is ticked by hand. Connected means installed
  // and signed in; VPN On Demand it can't see.
  const [ticked, setTicked] = useState({ install: false, account: false, demand: false })
  const tick = (key: keyof typeof ticked) => setTicked((t) => ({ ...t, [key]: !t[key] }))
  const [scanning, setScanning] = useState(Boolean(linked))
  const { width, height } = useWindowDimensions()
  // Side by side when the screen is wider than tall (landscape, or the Duo open): the steps
  // beside the camera, so neither is cut off.
  const wide = width > height
  const cameraSize = Math.max(160, Math.min(wide ? height - 48 : height * 0.45, (wide ? width / 2 : width) - 48))

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

  const camera = (
    <View style={[styles.camera, { width: cameraSize, height: cameraSize }]}>
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
  )

  const failure = error && (
    <Text style={[bannerText(), styles.error]}>
      {error}
      {/fetch|network|reach|timed? ?out/i.test(error)
        ? tailnet
          ? ' Check that Tailscale on this iPhone is signed in to the same account as your Mac.'
          : ' Tailscale isn\u2019t connected on this iPhone.'
        : ''}
    </Text>
  )

  if (!scanning) {
    const ready = tailnet !== null && ticked.demand
    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={[styles.content, wide ? styles.wide : styles.narrow]}>
          <View style={[styles.head, wide && styles.column]}>
            <Pilot pixel={4} />
            <Text style={type.heading}>Set up Tailscale</Text>
            <Text style={[type.meta, styles.centred]}>
              Your iPhone reaches your Mac over Tailscale, at home and away. Only Autopilot&apos;s traffic goes through it.
            </Text>
          </View>
          <View style={[styles.checks, wide && styles.column]}>
            <Check
              done={ticked.install || tailnet !== null}
              known={tailnet !== null}
              title="Install Tailscale"
              detail="On this iPhone and on your Mac."
              onToggle={() => tick('install')}
            >
              {tailnet === null && (
                <Button
                  kind="option"
                  label="Tailscale in the App Store"
                  onPress={() => void Linking.openURL('https://apps.apple.com/app/tailscale/id1470499037')}
                  style={styles.store}
                />
              )}
            </Check>
            <Check
              done={ticked.account || tailnet !== null}
              known={tailnet !== null}
              title="Sign in with the same account"
              detail="The same Tailscale account on your Mac and on this iPhone."
              onToggle={() => tick('account')}
            />
            <Check
              done={ticked.demand}
              title="Turn on VPN On Demand"
              detail="In Tailscale, tap the circle with your initial at the top, then VPN On Demand, and switch it on. It reconnects by itself."
              onToggle={() => tick('demand')}
            />
            <Check
              done={tailnet !== null}
              known
              title={tailnet ? 'Connected' : 'Connect'}
              detail={tailnet ? `This iPhone is on Tailscale as ${tailnet}.` : 'Switch Tailscale on. This ticks itself once it is.'}
              onToggle={() => undefined}
            />
            <Button kind="primary" label="Continue" disabled={!ready} onPress={() => setScanning(true)} style={styles.next} />
          </View>
        </ScrollView>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.content, wide && styles.wide]}>
        <View style={wide ? styles.column : undefined}>
          <View style={styles.head}>
            <Pilot pixel={4} />
            <Text style={type.heading}>Scan the code on your Mac</Text>
            <Text style={[type.meta, styles.centred]}>In Autopilot on the Mac, open Settings, Devices and choose Pair a device.</Text>
          </View>
          {!error && forgotten() && (
            <Text style={[bannerText('paused'), styles.error]}>
              {forgotten()} no longer knows this iPhone; it was removed under Devices. Pair again to carry on.
            </Text>
          )}
          {failure}
          <Button kind="secondary" label="Back to Tailscale" onPress={() => setScanning(false)} style={styles.back} />
        </View>
        {camera}
      </ScrollView>
    </SafeAreaView>
  )
}

/** This iPhone's Tailscale address, or null: checked again every few seconds and on coming back to the app. */
const useTailnet = () => {
  const [address, setAddress] = useState<string | null>(() => PinnedFetchNative.tailnetAddress())
  useEffect(() => {
    const check = () => setAddress(PinnedFetchNative.tailnetAddress())
    const timer = setInterval(check, 3000)
    const app = AppState.addEventListener('change', (next) => next === 'active' && check())
    return () => {
      clearInterval(timer)
      app.remove()
    }
  }, [])
  return address
}

const styles = StyleSheet.create({
  checks: { gap: 20 },
  store: { alignSelf: 'flex-start', marginTop: 6 },
  next: { alignSelf: 'stretch', alignItems: 'center' },
  back: { alignSelf: 'center', marginTop: 16 },
  narrow: { maxWidth: 520, width: '100%', alignSelf: 'center' },
  centred: { textAlign: 'center' },
  screen: { flex: 1, backgroundColor: colours.well },
  content: { padding: 24, gap: 20, alignItems: 'stretch' },
  wide: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 32 },
  column: { flex: 1, maxWidth: 420 },
  head: { alignItems: 'center', gap: 14, marginTop: 8 },
  camera: {
    alignSelf: 'center',
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colours.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  allow: { alignSelf: 'center' },
  error: { marginTop: 16, textAlign: 'center' },
})
