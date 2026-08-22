/**
 * 客户端 apply 测试:卡片必须注册进 keyed 槽位 settings.plugin.item,
 * 且 key 等于卡片编辑的 settings 命名空间(headroom)——宿主 tab 按此 key
 * 配对命名空间与卡片,缺 key 的注册会在 slots.register 处直接抛错。
 */

import { describe, expect, it } from 'vitest'
import * as clientPlugin from '../src/client/index.ts'
import { HeadroomCardController } from '../src/client/headroom-card-controller.ts'
import type { HeadroomSettings } from '../src/client/headroom-card-controller.ts'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'

/** 最小 SettingsScope stub:内存值 + set/unset + 订阅(与 controller spec 同款)。 */
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

interface Registration {
  options: Record<string, unknown>
  component: unknown
}

describe('client apply', () => {
  it('registers the card into the keyed settings.plugin.item slot under the headroom key', () => {
    const registrations: Registration[] = []
    const localeNamespaces: string[] = []
    const boundNamespaces: string[] = []

    const ctx = {
      slots: {
        inject: (_name: string, generator: () => Iterator<unknown>) => {
          // The real slots injector walks the generator; the register mock
          // inside it captures the options.
          for (const _item of generator()) { /* captured via register */ }
        },
        register: (options: Record<string, unknown>, component: unknown) => {
          registrations.push({ options, component })
          return () => {}
        },
      },
      locale: {
        register: (namespace: string) => { localeNamespaces.push(namespace) },
      },
      settingsScope: {
        bind: (spec: { namespace: string }) => {
          boundNamespaces.push(spec.namespace)
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
    expect(boundNamespaces).toEqual(['headroom'])
    expect(registrations).toHaveLength(1)
    expect(registrations[0]?.options.name).toBe('settings.plugin.item')
    // keyed 槽位:key 是编辑的命名空间;宿主 tab 依赖该 key 发现卡片。
    expect(registrations[0]?.options.key).toBe('headroom')
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
