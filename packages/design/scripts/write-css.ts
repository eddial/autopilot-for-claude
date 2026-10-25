import { writeFileSync } from 'node:fs'
import { css } from '../src/css.ts'
import { CSS_PATH } from './paths.ts'

writeFileSync(CSS_PATH, css())
