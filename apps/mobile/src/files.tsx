import { useState } from 'react'
import { ActionSheetIOS, Pressable, StyleSheet, Text, View } from 'react-native'
import type { Link } from '@autopilot/contracts'
import { randomUUID } from 'expo-crypto'
import * as Clipboard from 'expo-clipboard'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { SymbolView } from 'expo-symbols'
import { colours, radius } from '@autopilot/design'
import { useSyncInstance } from './store.ts'

/** A file on its way into a reply: uploading, kept on the Mac, or refused. For a new task, its bytes. */
type Sent = { key: string; name: string; link: Link | null; failed: string | null; type?: string; data?: string | null }

/** A picked file, by where it is; a pasted one comes as its bytes. */
type Picked = { uri: string; name: string; type: string; size?: number | null | undefined; data?: string }

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

const sizeText = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

/**
 * Files picked or pasted into a reply, as on the Mac: each uploads to the Mac as soon as it is added
 * (only while the Mac can be reached; files do not wait in the outbox) and shows as a chip until
 * sent. With no task yet (a new one), they are kept as their bytes and go with the task instead.
 */
export const useFiles = (taskId: string | null) => {
  const sync = useSyncInstance()
  const [files, setFiles] = useState<Sent[]>([])
  const set = (key: string, changes: Partial<Sent>) => setFiles((all) => all.map((f) => (f.key === key ? { ...f, ...changes } : f)))

  const add = (picked: Picked[]) => {
    for (const file of picked) {
      const key = randomUUID()
      const size = file.size ?? (file.data ? Math.floor((file.data.length * 3) / 4) : 0)
      const tooBig = size > MAX_BYTES
      setFiles((all) => [...all, { key, name: file.name, link: null, failed: tooBig ? 'Over 20 MB' : null, type: file.type, data: null }])
      if (tooBig) continue
      const bytes = file.data ? Promise.resolve(file.data) : base64(file.uri)
      if (taskId === null) {
        void bytes.then(
          (data) =>
            set(key, { data, link: { url: `about:blank#${key}`, title: file.name, subtitle: sizeText(size || (data.length * 3) / 4) } }),
          () => set(key, { failed: 'Could not read it' }),
        )
        continue
      }
      if (!sync) continue
      void bytes
        .then((data) => sync.online((api) => api.files.upload({ idempotencyKey: key, taskId, name: file.name, type: file.type, data })))
        .then(
          (link) => set(key, { link }),
          () => set(key, { failed: 'Not sent: is your Mac reachable?' }),
        )
    }
  }

  /** An image copied anywhere, pasted in as a PNG. */
  const paste = () =>
    void Clipboard.getImageAsync({ format: 'png' }).then((image) => {
      if (image) add([{ uri: '', name: 'Pasted image.png', type: 'image/png', data: image.data.replace(/^data:[^,]*,/, '') }])
    })

  /** The paperclip: photos or a file, from the sheet iOS shows. */
  const pick = () =>
    void Clipboard.hasImageAsync().then((copied) => {
      const options = [...(copied ? ['Paste Image'] : []), 'Photo Library', 'Choose File', 'Cancel']
      ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: options.length - 1 }, (chosen) => {
        // The same numbers whether or not Paste is offered.
        const i = copied ? chosen - 1 : chosen
        if (i === -1) paste()
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
    })

  return {
    files,
    links: files.flatMap((f) => (f.link ? [f.link] : [])),
    /** For a new task: the files' bytes, to go with it. */
    newFiles: () =>
      files.flatMap((f) => (f.data && !f.failed ? [{ name: f.name, type: f.type ?? 'application/octet-stream', data: f.data }] : [])),
    /** Still uploading: sending waits for these. */
    busy: files.some((f) => !f.link && !f.failed),
    pick,
    paste,
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
