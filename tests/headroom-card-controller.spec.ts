/**
 * headroom-card-controller 状态机测试:staged 草稿、save 提交、失败保留。
 * 使用最小 stub SettingsScope 与 runtime-client mock(vitest alias)。
 */

import { describe, expect, it, vi } from 'vitest'
import { HeadroomCardController } from '../src/client/headroom-card-controller.ts'
import type { HeadroomSettings } from '../src/client/headroom-card-controller.ts'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'

/** 最小 SettingsScope stub:内存值 + set/unset + 订阅。 */
function stubScope(initial: HeadroomSettings = {}): SettingsScope<HeadroomSettings> {
  let value: HeadroomSettings | undefined = { ...initial }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => ({
      status: 'ready',
      value,
      base: null,
      user: value,
      revision: 1,
      writable: true,
      mode: 'host',
    }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: async (field, next) => {
      value = { ...value, [field]: next }
    },
    unset: async (field) => {
      value = { ...value }
      delete (value as Record<string, unknown>)[field]
    },
  } as SettingsScope<HeadroomSettings>
}

function snapshot(controller: HeadroomCardController): ReturnType<HeadroomCardController['inject']> {
  return controller.inject()
}

describe('HeadroomCardController', () => {
  it('renders stored values as drafts', () => {
    const scope = stubScope({ port: 8787, command: 'C:/headroom.exe' })
    const controller = new HeadroomCardController(scope)
    const face = snapshot(controller)
    const state = face.hooks.headroomCard.getSnapshot()
    expect(state.port).toBe('8787')
    expect(state.command).toBe('C:/headroom.exe')
    expect(state.available).toBe(true)
  })

  it('staging a draft makes the form dirty and marks it on save', async () => {
    const scope = stubScope({})
    const controller = new HeadroomCardController(scope)
    const face = snapshot(controller)
    face.edit('command', 'C:/new/headroom.exe')
    let state = face.hooks.headroomCard.getSnapshot()
    expect(state.dirty).toBe(true)
    expect(state.command).toBe('C:/new/headroom.exe')

    face.save()
    await vi.waitFor(() => {
      const state = face.hooks.headroomCard.getSnapshot()
      expect(state.dirty).toBe(false)
    })
    expect(scope.getSnapshot().value?.command).toBe('C:/new/headroom.exe')
  })

  it('an invalid port blocks the save', async () => {
    const scope = stubScope({})
    const controller = new HeadroomCardController(scope)
    const face = snapshot(controller)
    face.edit('port', '99999')
    const state = face.hooks.headroomCard.getSnapshot()
    expect(state.invalid).toBe(true)
    face.save()
    await Promise.resolve()
    await Promise.resolve()
    expect(scope.getSnapshot().value?.port).toBeUndefined()
  })

  it('discard drops staged edits', () => {
    const scope = stubScope({ command: 'C:/keep.exe' })
    const controller = new HeadroomCardController(scope)
    const face = snapshot(controller)
    face.edit('command', 'C:/discard.exe')
    face.discard()
    const state = face.hooks.headroomCard.getSnapshot()
    expect(state.dirty).toBe(false)
    expect(state.command).toBe('C:/keep.exe')
  })

  it('toggleAutoInstall writes immediately through the scope', async () => {
    const scope = stubScope({ autoInstall: true })
    const controller = new HeadroomCardController(scope)
    const face = snapshot(controller)
    face.toggleAutoInstall()
    await Promise.resolve()
    expect(scope.getSnapshot().value?.autoInstall).toBe(false)
  })

  it('dispose unsubscribes from the scope', async () => {
    const scope = stubScope({})
    const controller = new HeadroomCardController(scope)
    controller.dispose()
    // 卸载后 scope 更新不应再发布(不抛即通过)
    await scope.set('command', 'C:/after-unload.exe')
    expect(scope.getSnapshot().value?.command).toBe('C:/after-unload.exe')
  })
})
