/**
 * 客户端 apply 测试:卡片必须注册进 keyed 槽位 plugins.bundle.config,
 * 且 key 等于本 bundle 的包名(Plugins 页按包名把卡片渲染到该 bundle 的页面)。
 */

import { describe, expect, it } from 'vitest'
import * as clientPlugin from '../src/client/index.ts'
import { HeadroomCardController, HEADROOM_ENTRY_ID } from '../src/client/headroom-card-controller.ts'
import type { HeadroomFormScope, HeadroomSettings } from '../src/client/headroom-card-controller.ts'

/** 最小 HeadroomFormScope stub:内存值 + set/unset + 订阅。 */
function stubScope(initial: HeadroomSettings = {}): HeadroomFormScope {
  let value: HeadroomSettings | undefined = { ...initial }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => ({ status: 'ready', value, writable: true }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: async (field, next) => {
      value = { ...value, [field]: next }
      for (const listener of listeners) listener()
      return true
    },
    unset: async (field) => {
      const next: Record<string, unknown> = { ...value }
      delete next[field]
      value = next as HeadroomSettings
      for (const listener of listeners) listener()
      return true
    },
  }
}

interface Registration {
  options: Record<string, unknown>
  component: unknown
}

describe('client apply', () => {
  it('registers the card into the keyed plugins.bundle.config seat under the package name', () => {
    const registrations: Registration[] = []
    const localeNamespaces: string[] = []
    const requestedEntries: string[] = []
    const injectedSeats: string[] = []

    const ctx = {
      slots: {
        // 座位可能晚于本插件声明,官方页面统一先 inject 再 register。
        inject: (name: string, register: () => () => void) => {
          injectedSeats.push(name)
          return register()
        },
        register: (options: Record<string, unknown>, component: unknown) => {
          registrations.push({ options, component })
          return () => {}
        },
      },
      locale: {
        register: (namespace: string) => { localeNamespaces.push(namespace) },
      },
      configForms: {
        get: (entryId: string) => {
          requestedEntries.push(entryId)
          return stubScope()
        },
      },
      effect: (callback: () => void) => {
        // Cordis runs an effect's callback immediately at registration.
        callback()
        return () => {}
      },
    }

    clientPlugin.apply(ctx as never)

    expect(localeNamespaces).toEqual(['dsh-headroom'])
    expect(requestedEntries).toEqual([HEADROOM_ENTRY_ID])
    expect(injectedSeats).toEqual(['plugins.bundle.config'])
    expect(registrations).toHaveLength(1)
    expect(registrations[0]?.options.name).toBe('plugins.bundle.config')
    // keyed 槽位:key 是 bundle 的包名,Plugins 页按它找到该 bundle 的页面。
    expect(registrations[0]?.options.key).toBe('@wanyantiande/dsh-headroom')
    expect(registrations[0]?.options.locale).toBe('dsh-headroom')
    expect(typeof registrations[0]?.options.inject).toBe('function')
  })

  it('inject face exposes the card snapshot and form actions', () => {
    const scope = stubScope({ port: 8787 })
    const controller = new HeadroomCardController(scope)
    const face = controller.inject()
    expect(face.hooks.headroomCard.getSnapshot().port).toBe('8787')
    expect(typeof face.save).toBe('function')
    expect(typeof face.discard).toBe('function')
  })
})
