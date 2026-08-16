/**
 * Loader-tree takeover semantics: every `compaction-basic` entry must be
 * disabled (patch and preset layers can each carry one under the same id),
 * and rollback restores each entry's previous flag in order.
 */

import { describe, expect, it, vi } from 'vitest'
import { restoreCompactionEntries, setCompactionEntries } from '../src/index.ts'
import type { LoaderEntryLike, LoaderLike } from '../src/index.ts'

function makeEntry(id: string, disabled?: boolean | null): LoaderEntryLike {
  const entry: LoaderEntryLike = {
    id,
    options: { disabled },
    update: vi.fn(async (options: { disabled?: boolean | null }) => {
      if (options.disabled === undefined || options.disabled === null) {
        delete entry.options.disabled
      } else {
        entry.options.disabled = options.disabled
      }
      return undefined
    }),
    parent: { tree: { write: vi.fn() } },
  }
  return entry
}

function makeLoader(entries?: LoaderEntryLike[]): LoaderLike {
  const update = vi.fn(async () => undefined)
  return {
    ...(entries === undefined ? {} : { entries: () => entries }),
    update,
  }
}

describe('setCompactionEntries', () => {
  it('disables every compaction-basic entry across the tree and records the previous state', async () => {
    const first = makeEntry('compaction-basic')
    const second = makeEntry('compaction-basic', false)
    const unrelated = makeEntry('llm')
    const loader = makeLoader([first, second, unrelated])

    const restore = await setCompactionEntries(loader, true)

    expect(first.options.disabled).toBe(true)
    expect(second.options.disabled).toBe(true)
    expect(unrelated.options.disabled).toBeUndefined()
    expect(first.parent.tree.write).toHaveBeenCalledTimes(1)
    expect(second.parent.tree.write).toHaveBeenCalledTimes(1)
    expect(restore).toEqual([
      { id: 'compaction-basic', disabled: undefined },
      { id: 'compaction-basic', disabled: false },
    ])
  })

  it('falls back to the tree-level update when the loader offers no entries view', async () => {
    const loader = makeLoader()
    const restore = await setCompactionEntries(loader, true)

    expect(loader.update).toHaveBeenCalledWith('compaction-basic', { disabled: true })
    expect(restore).toEqual([{ id: 'compaction-basic', disabled: true }])
  })

  it('returns an empty restore list when no entry matches and the fallback throws', async () => {
    const loader = makeLoader([makeEntry('llm')])
    loader.update = vi.fn(async () => {
      throw new Error('cannot resolve entry compaction-basic')
    })
    await expect(setCompactionEntries(loader, true)).rejects.toThrow('cannot resolve entry')
  })
})

describe('restoreCompactionEntries', () => {
  it('restores recorded flags in order, unsetting the flag where the record has none', async () => {
    const first = makeEntry('compaction-basic', true)
    const second = makeEntry('compaction-basic', true)
    const loader = makeLoader([first, second])

    await restoreCompactionEntries(loader, [
      { id: 'compaction-basic', disabled: undefined },
      { id: 'compaction-basic', disabled: false },
    ])

    expect(first.options.disabled).toBeUndefined()
    expect(second.options.disabled).toBe(false)
    expect(first.parent.tree.write).toHaveBeenCalledTimes(1)
    expect(second.parent.tree.write).toHaveBeenCalledTimes(1)
  })

  it('skips restore records whose entries no longer exist', async () => {
    const remaining = makeEntry('compaction-basic', true)
    const loader = makeLoader([remaining])

    await expect(restoreCompactionEntries(loader, [
      { id: 'compaction-basic', disabled: undefined },
      { id: 'compaction-basic', disabled: false },
    ])).resolves.toBeUndefined()

    expect(remaining.options.disabled).toBeUndefined()
  })
})
