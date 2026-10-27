import { useEffect, useState } from 'react'
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import type { Link } from '@autopilot/contracts'
import { colours, radius } from '@autopilot/design'
import { useSyncInstance } from '../store.ts'

/** A picture on the Mac, which the Mac can send whole. */
export const isPicture = (url: string) => /^file:.*\.(png|jpe?g|gif|webp)$/i.test(url)

/** Each picture read once while the app runs, however often its update draws. */
const pictures = new Map<string, Promise<string | null>>()

const usePicture = (taskId: string, url: string): string | null | undefined => {
  const sync = useSyncInstance()
  const [src, setSrc] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    if (!sync) return
    let read = pictures.get(url)
    if (!read) {
      read = sync
        .online((api) => api.links.preview({ taskId, url }))
        .then(
          (p) => p.image ?? null,
          () => {
            // Out of reach of the Mac: try again next time it draws.
            pictures.delete(url)
            return null
          },
        )
      pictures.set(url, read)
    }
    let live = true
    void read.then((s) => live && setSrc(s))
    return () => {
      live = false
    }
  }, [sync, taskId, url])
  return src
}

/** The pictures an update attaches, as thumbnails; a tap opens one full screen, to pinch and zoom. */
export const Shots = ({ taskId, links }: { taskId: string; links: Link[] }) => {
  const [open, setOpen] = useState<Link | null>(null)
  if (links.length === 0) return null
  return (
    <View style={styles.shots}>
      {links.map((l) => (
        <Shot key={l.url} taskId={taskId} link={l} onOpen={() => setOpen(l)} />
      ))}
      {open && <Large taskId={taskId} link={open} onClose={() => setOpen(null)} />}
    </View>
  )
}

const caption = (link: Link) => link.title.replace(/^screenshot:\s*/i, '')

const Shot = ({ taskId, link, onOpen }: { taskId: string; link: Link; onOpen: () => void }) => {
  const src = usePicture(taskId, link.url)
  return (
    <Pressable
      onPress={src ? onOpen : undefined}
      accessibilityRole="imagebutton"
      accessibilityLabel={`Open ${link.title}`}
      style={styles.figure}
    >
      <View style={styles.thumb}>
        {src ? (
          <Image source={{ uri: src }} style={styles.thumbImage} resizeMode="cover" />
        ) : (
          <Text style={styles.empty}>{src === null ? 'On your Mac' : ''}</Text>
        )}
      </View>
      <Text style={styles.caption} numberOfLines={1}>
        {caption(link)}
      </Text>
    </Pressable>
  )
}

const Large = ({ taskId, link, onClose }: { taskId: string; link: Link; onClose: () => void }) => {
  const src = usePicture(taskId, link.url)
  const { width, height } = useWindowDimensions()
  return (
    <Modal
      visible
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
      supportedOrientations={['portrait', 'landscape']}
    >
      <View style={styles.large}>
        <ScrollView
          maximumZoomScale={4}
          minimumZoomScale={1}
          centerContent
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.largeContent}
        >
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close the picture">
            {src && <Image source={{ uri: src }} style={{ width, height: height - 120 }} resizeMode="contain" />}
          </Pressable>
        </ScrollView>
        <Text style={styles.largeCaption} numberOfLines={2}>
          {link.title}
        </Text>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  shots: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  figure: { width: 150, gap: 4 },
  thumb: {
    width: 150,
    height: 100,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colours.border,
    backgroundColor: colours.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbImage: { width: '100%', height: '100%' },
  empty: { fontSize: 12, color: colours.text3 },
  caption: { fontSize: 12, color: colours.text3 },
  large: { flex: 1, backgroundColor: colours.well, paddingTop: 60, paddingBottom: 40 },
  largeContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  largeCaption: { textAlign: 'center', fontSize: 13, color: colours.text2, paddingHorizontal: 24, paddingTop: 12 },
})
