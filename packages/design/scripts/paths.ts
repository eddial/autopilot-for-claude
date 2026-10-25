import { fileURLToPath } from 'node:url'

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
export const CSS_PATH = fileURLToPath(new URL('../../../apps/desktop/src/tokens.css', import.meta.url))
