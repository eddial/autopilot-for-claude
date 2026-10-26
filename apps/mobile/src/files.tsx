import { useState } from 'react'
import { ActionSheetIOS, Pressable, StyleSheet, Text, View } from 'react-native'
import type { Link } from '@autopilot/contracts'
import { randomUUID } from 'expo-crypto'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { SymbolView } from 'expo-symbols'
import { colours, radius } from '@autopilot/design'
import { useSyncInstance } from './store.ts'

/** A file on its way into a reply: uploading, kept on the Mac, or refused. */
type Sent = { key: string; name: string; link: Link | null; failed: string | null }

type Picked = { uri: string; name: string; type: string; size?: number | null | undefined }

const MAX_BYTES = 20 * 1024 * 1024

/** A picked file's bytes as base64, read through fetch: no file-system module needed. */
const base64 = async (uri: string): Promise<string> => {
  const blob = await (await fetch(uri)).blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result).replace(/^data:[^,]*,/, '')))
    reader.addEventListener('error', () => reject(new Error('Could not read the file')))
    reader.readAsDataURL(blob)
  })
}

/**
 * Files picked for a reply, as on the Mac: each uploads to the Mac as soon as it is picked (only
 * while the Mac can be reached; files do not wait in the outbox) and shows as a chip until sent.
 */
export const useFiles = (taskId: string) => {
  const sync = useSyncInstance()
  const [files, setFiles] = useState<Sent[]>([])
  const set = (key: string, changes: Partial<Sent>) => setFiles((all) => all.map((f) => (f.key === key ? { ...f, ...changes } : f)))

  const add = (picked: Picked[]) => {
    for (const file of picked) {
      const key = randomUUID()
      const tooBig = (file.size ?? 0) > MAX_BYTES
      setFiles((all) => [...all, { key, name: file.name, link: null, failed: tooBig ? 'Over 20 MB' : null }])
      if (tooBig || !sync) continue
      void base64(file.uri)
        .then((data) => sync.online((api) => api.files.upload({ idempotencyKey: key, taskId, name: file.name, type: file.type, data })))
        .then(
          (link) => set(key, { link }),
          () => set(key, { failed: 'Not sent: is your Mac reachable?' }),
        )
    }
  }

  /** The paperclip: photos or a file, from the sheet iOS shows. */
  const pick = () =>
    ActionSheetIOS.showActionSheetWithOptions({ options: ['Photo Library', 'Choose File', 'Cancel'], cancelButtonIndex: 2 }, (i) => {
      if (i === 0)
        void ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 0.9 }).then((r) => {
          if (!r.canceled)
            add(
              r.assets.map((a) => ({
                uri: a.uri,
                name: a.fileName ?? `Photo.${a.mimeType?.split('/')[1] ?? 'jpg'}`,
                type: a.mimeType ?? 'image/jpeg',
                size: a.fileSize,
              })),
            )
        })
      if (i === 1)
        void DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true }).then((r) => {
          if (!r.canceled)
            add(r.assets.map((a) => ({ uri: a.uri, name: a.name, type: a.mimeType ?? 'application/octet-stream', size: a.size })))
        })
    })

  return {
    files,
    links: files.flatMap((f) => (f.link ? [f.link] : [])),
    /** Still uploading: sending waits for these. */
    busy: files.some((f) => !f.link && !f.failed),
    pick,
    remove: (key: string) => setFiles((all) => all.filter((f) => f.key !== key)),
    clear: () => setFiles([]),
  }
}

/** The files in a reply before it is sent, each with a way to take it out again. */
export const FileChips = ({ files, onRemove }: { files: Sent[]; onRemove: (key: string) => void }) =>
  files.length > 0 ? (
    <View style={styles.chips}>
      {files.map((f) => (
        <View key={f.key} style={[styles.chip, !f.link && !f.failed && { opacity: 0.6 }, f.failed ? { borderColor: colours.clay } : null]}>
          <SymbolView name="doc" size={13} tintColor={colours.text3} />
          <Text style={styles.name} numberOfLines={1}>
            {f.name}
          </Text>
          <Text style={styles.meta}>{f.failed ?? (f.link ? f.link.subtitle : 'Adding…')}</Text>
          <Pressable onPress={() => onRemove(f.key)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${f.name}`}>
            <SymbolView name="xmark" size={11} tintColor={colours.text3} />
          </Pressable>
        </View>
      ))}
    </View>
  ) : null

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginHorizontal: 12 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 260,
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colours.borderStrong,
    backgroundColor: colours.raised,
  },
  name: { flexShrink: 1, fontSize: 13, color: colours.text },
  meta: { fontSize: 12, color: colours.text3 },
})
