import { NativeModule, requireOptionalNativeModule } from 'expo'

/** A pasted image or file, copied into the app's temporary directory. */
export type PastedFile = { uri: string; name: string; type: string; size: number }

declare class PasteFilesNative extends NativeModule<{ onPasteFiles: (event: { files: PastedFile[] }) => void }> {}

/** The Swift module in ios/PasteFilesModule.swift; missing in a build made before it. */
export default requireOptionalNativeModule<PasteFilesNative>('PasteFiles')
