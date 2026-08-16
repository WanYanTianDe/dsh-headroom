/**
 * service.ts 配置解析测试(resolveServiceConfig 纯函数)。
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_HEADROOM_PORT, resolveServiceConfig } from '../src/service.ts'

describe('resolveServiceConfig', () => {
  it('applies defaults for an empty config', () => {
    const config = resolveServiceConfig(undefined)
    expect(config.port).toBe(DEFAULT_HEADROOM_PORT)
    expect(config.baseUrl).toBe(`http://127.0.0.1:${DEFAULT_HEADROOM_PORT}`)
    expect(config.autoInstall).toBe(true)
    expect(config.installTimeoutMs).toBe(10 * 60_000)
    expect(config.startTimeoutMs).toBe(60_000)
  })

  it('derives the base URL from the port', () => {
    expect(resolveServiceConfig({ port: 9999 }).baseUrl).toBe('http://127.0.0.1:9999')
  })

  it('an explicit base URL wins over the port-derived one', () => {
    const config = resolveServiceConfig({ port: 9999, baseUrl: 'http://proxy.internal:1' })
    expect(config.baseUrl).toBe('http://proxy.internal:1')
    expect(config.port).toBe(9999)
  })

  it('passes through command, pythonPath and uvCommand', () => {
    const config = resolveServiceConfig({
      command: 'C:/tools/headroom.exe',
      pythonPath: 'C:/Python313/python.exe',
      uvCommand: 'C:/uv/uv.exe',
    })
    expect(config.command).toBe('C:/tools/headroom.exe')
    expect(config.pythonPath).toBe('C:/Python313/python.exe')
    expect(config.uvCommand).toBe('C:/uv/uv.exe')
  })
})
