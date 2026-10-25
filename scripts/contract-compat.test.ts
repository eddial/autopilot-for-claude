import { describe, expect, it } from 'vitest'
import { breakingChanges } from './contract-compat.ts'

const procedure = (input: object, output: object, scopes = ['owner']) => ({ meta: { scopes }, input, output })
const object = (properties: Record<string, object>, required: string[] = []) => ({ type: 'object', properties, required })

describe('contract compatibility', () => {
  it('lets additions through and flags what breaks an app that has not updated', () => {
    const base = {
      'tasks.get': procedure(
        object({ id: { type: 'string' } }, ['id']),
        object({ title: { type: 'string' }, band: { enum: ['new', 'done'] } }, ['title', 'band']),
      ),
      'tasks.old': procedure(object({}), object({})),
    }
    const compatible = {
      ...base,
      'tasks.get': procedure(
        object({ id: { type: 'string' }, extra: { type: 'string' } }, ['id']),
        object({ title: { type: 'string' }, band: { enum: ['new', 'done'] }, more: { type: 'string' } }, ['title', 'band']),
      ),
      'tasks.new': procedure(object({}), object({})),
    }
    expect(breakingChanges(base, compatible)).toEqual([])

    const breaking = {
      'tasks.get': procedure(
        object({ id: { type: 'string' }, extra: { type: 'string' } }, ['id', 'extra']),
        object({ band: { enum: ['new', 'done', 'archived'] } }, []),
        [],
      ),
    }
    expect(breakingChanges(base, breaking)).toEqual([
      'tasks.get: no longer open to owner',
      'tasks.get input.extra: newly required input',
      'tasks.get output.title: no longer returned',
      'tasks.get output.band: may now be missing',
      'tasks.get output.band: can now return "archived"',
      'tasks.old: removed',
    ])
  })
})
