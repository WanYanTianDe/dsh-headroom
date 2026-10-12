/**
 * `/headroom` command semantics: argument parsing (show / set / unset), value
 * coercion by key kind, and host-side writes of the plugin's own config fields.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { HeadroomSettings } from '../src/index.ts'
import { executeHeadroomCommand, parseHeadroomCommand } from '../src/command.ts'

const ENTRY = 'dsh-headroom'

/** Live-settings reader over a mutable record. */
function makeLive(initial: HeadroomSettings = {}) {
  const value: HeadroomSettings = { ...initial }
  return { read: () => ({ ...value }), value }
}

/** Context double carrying only the settings service the command writes through. */
function makeCtx() {
  return { settings: { mutate: vi.fn(async () => {}) } } as unknown as Context
}

describe('parseHeadroomCommand', () => {
  it('shows settings without arguments', () => {
    expect(parseHeadroomCommand('')).toEqual({ kind: 'show' })
    expect(parseHeadroomCommand('   ')).toEqual({ kind: 'show' })
  })

  it('parses typed set commands', () => {
    expect(parseHeadroomCommand('set port 9000')).toEqual({ kind: 'set', key: 'port', value: 9000 })
    expect(parseHeadroomCommand('set autoInstall false')).toEqual({ kind: 'set', key: 'autoInstall', value: false })
    expect(parseHeadroomCommand('set command C:/x/headroom.exe')).toEqual({
      kind: 'set', key: 'command', value: 'C:/x/headroom.exe',
    })
    expect(parseHeadroomCommand('set resultCompressionThresholdChars 4096')).toEqual({
      kind: 'set', key: 'resultCompressionThresholdChars', value: 4096,
    })
  })

  it('rejects malformed values and unknown keys as a show', () => {
    expect(parseHeadroomCommand('set port abc')).toEqual({ kind: 'show' })
    expect(parseHeadroomCommand('set port 70000')).toEqual({ kind: 'show' })
    expect(parseHeadroomCommand('set autoInstall yes')).toEqual({ kind: 'show' })
    expect(parseHeadroomCommand('set unknownKey 1')).toEqual({ kind: 'show' })
    expect(parseHeadroomCommand('set port')).toEqual({ kind: 'show' })
  })

  it('parses unset for known keys only', () => {
    expect(parseHeadroomCommand('unset port')).toEqual({ kind: 'unset', key: 'port' })
    expect(parseHeadroomCommand('unset unknownKey')).toEqual({ kind: 'show' })
  })
})

describe('executeHeadroomCommand', () => {
  it('shows the current settings', async () => {
    const live = makeLive({ port: 8787, autoInstall: true })
    const result = await executeHeadroomCommand(makeCtx(), live.read, () => ENTRY, { kind: 'show' })
    expect(result.kind).toBe('success')
    expect((result as { text: string }).text).toContain('"port": 8787')
  })

  it('writes a typed value into the entry config', async () => {
    const ctx = makeCtx()
    const result = await executeHeadroomCommand(ctx, makeLive().read, () => ENTRY, { kind: 'set', key: 'port', value: 9000 })
    expect(result.kind).toBe('success')
    expect(ctx.settings.mutate).toHaveBeenCalledWith(ENTRY, [{ op: 'set', path: ['headroom', 'port'], value: 9000 }])
  })

  it('clears a field so the composition layer applies again', async () => {
    const ctx = makeCtx()
    const result = await executeHeadroomCommand(ctx, makeLive({ port: 9000 }).read, () => ENTRY, { kind: 'unset', key: 'port' })
    expect(result.kind).toBe('success')
    expect(ctx.settings.mutate).toHaveBeenCalledWith(ENTRY, [{ op: 'unset', path: ['headroom', 'port'] }])
  })

  it('reports host refusals as an error result', async () => {
    const ctx = makeCtx()
    ;(ctx.settings.mutate as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      throw new Error('schema rejected')
    })
    const result = await executeHeadroomCommand(ctx, makeLive().read, () => ENTRY, { kind: 'set', key: 'port', value: 9000 })
    expect(result.kind).toBe('error')
    expect((result as { text: string }).text).toContain('schema rejected')
  })
})
