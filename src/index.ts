/**
 * dsh-headroom: Headroom context compression for DeepSeek Harness.
 *
 * Mounts four pieces:
 *  1. the `headroom` settings namespace — the browser settings card and this
 *     host plugin share it; user values override the cordis composition layer;
 *  2. a Headroom proxy lifecycle (reuse / auto-install / spawn) that exposes
 *     `ctx.headroomClient` once the local service is healthy and restarts the
 *     service when the settings namespace changes;
 *  3. a HeadroomCompactionEngine registered as `ctx.compaction`, taking over
 *     the compaction service from compaction-basic (its entry is disabled
 *     at runtime when present);
 *  4. the `headroom_retrieve` model tool for restoring CCR-compressed originals.
 *
 * Everything degrades gracefully: when no proxy is reachable the plugin stays
 * loaded, the compaction backend reports "not ready" (the inherited region
 * transaction keeps the original surface), and the tool returns an error.
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { HeadroomCompactionEngine } from './engine.ts'
import type { HeadroomEngineConfig } from './engine.ts'
import { DEFAULT_HEADROOM_PORT, resolveServiceConfig, startHeadroomService } from './service.ts'
import type { HeadroomServiceConfig } from './service.ts'

export const name = 'dsh-headroom'
/** Services the plugin and its compaction engine read through the context. */
export const inject: string[] = ['settings', 'tools', 'llm', 'tokenMeter', 'sessions']

export interface Config {
  /** Headroom proxy wiring; the `headroom` settings namespace overrides these. */
  headroom?: Partial<HeadroomServiceConfig>
  /** Model id reported to the proxy for token estimation; defaults to the routed model. */
  model?: string
  /** Compact at this fraction of the model's context window (default 0.8). */
  thresholdRatio?: number
  /** Recent context retained as a fraction of the model's window (default 0.16). */
  retainRatio?: number
  /** Absolute recent-context budget; mutually exclusive with `retainRatio`. */
  retainTokens?: number
  /** Extra attempts after the first compaction when pressure remains above threshold (default 1). */
  compactionRetries?: number
  /** Maximum retries after canonical context overflow (default 1). */
  maxOverflowRetries?: number
  /** Enable automatic step-boundary pressure and overflow-recovery listeners (default true). */
  auto?: boolean
}

const serviceConfigSchema = z.object({
  baseUrl: z.string(),
  port: z.number().step(1).min(1).max(65535),
  command: z.string(),
  pythonPath: z.string(),
  uvCommand: z.string(),
  autoInstall: z.boolean(),
  installTimeoutMs: z.number().step(1).min(1_000),
  startTimeoutMs: z.number().step(1).min(1_000),
})

export const Config: z<Config> = z.object({
  headroom: serviceConfigSchema,
  model: z.string(),
  thresholdRatio: z.number(),
  retainRatio: z.number(),
  retainTokens: z.number().step(1).min(0),
  compactionRetries: z.number().step(1).min(0),
  maxOverflowRetries: z.number().step(1).min(0),
  auto: z.boolean(),
})

/** Settings namespace shared with the browser card. */
export const HEADROOM_SETTINGS_NS = settingsNamespace('headroom')

/** Fields the settings card edits; optional fields fall back to the composition layer. */
export interface HeadroomSettings {
  /** Headroom executable path. */
  command?: string
  /**
   * Python interpreter path; when set, headroom runs as `python -m headroom`,
   * so the user can pin the Python version that serves the proxy.
   */
  pythonPath?: string
  /** uv executable path used when auto-installing headroom. */
  uvCommand?: string
  /** Proxy port for a spawned service. */
  port?: number
  /** Proxy base URL; empty reuses the port-derived default. */
  baseUrl?: string
  /** Auto-install headroom-ai via uv when the command is missing. */
  autoInstall?: boolean
}

const headroomSettingsSchema = z.object({
  command: z.string(),
  pythonPath: z.string(),
  uvCommand: z.string(),
  port: z.number().step(1).min(1).max(65535),
  baseUrl: z.string(),
  autoInstall: z.boolean(),
})

/** Every key BasicCompactionEngine's config validation accepts. */
const BASIC_CONFIG_KEYS = [
  'thresholdRatio',
  'retainRatio',
  'retainTokens',
  'summarizationProvider',
  'summarizationModel',
  'maxTokens',
  'compactionRetries',
  'maxOverflowRetries',
  'modelPolicies',
  'auto',
] as const

function engineConfig(config: Config): HeadroomEngineConfig {
  const engine: HeadroomEngineConfig = {}
  if (config.model !== undefined) engine.model = config.model
  for (const key of BASIC_CONFIG_KEYS) {
    const value = config[key as keyof Config]
    if (value !== undefined) (engine as Record<string, unknown>)[key] = value
  }
  return engine
}

export function apply(ctx: Context, config: Config): void {
  ctx.provide('headroomClient', undefined)
  const scope = ctx.settings.register(HEADROOM_SETTINGS_NS, headroomSettingsSchema, {
    base: {
      command: config.headroom?.command ?? '',
      pythonPath: config.headroom?.pythonPath ?? '',
      uvCommand: config.headroom?.uvCommand ?? '',
      port: config.headroom?.port ?? DEFAULT_HEADROOM_PORT,
      baseUrl: config.headroom?.baseUrl ?? '',
      autoInstall: config.headroom?.autoInstall ?? true,
    },
    applies: 'live',
  })

  installProxyLifecycle(ctx, scope)

  installEngine(ctx, config)

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'headroom_retrieve',
    description: 'Restore original content that the Headroom compression proxy replaced with a compacted checkpoint. Pass the exact ccr hash listed in a <compacted-summary> block of the conversation; returns the original tool output or message text.',
    parameters: {
      hash: { type: 'string', description: 'CCR hash shown in the compacted checkpoint.' },
    },
    output: {
      schema: { type: 'json' },
      render(_args: unknown, value: unknown) {
        const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
        return [{ type: 'text', text }]
      },
    },
    async execute(args: { hash: string }) {
      const client = ctx.headroomClient
      if (client === undefined) {
        throw new Error('headroom service is not ready: no proxy is reachable')
      }
      return (await client.retrieve(args.hash)) as JsonValue
    },
  })), 'dsh-headroom: tool')
}

/**
 * Run the proxy lifecycle off the settings namespace: start once, restart on
 * every settings change, and dispose on plugin unload. Restarts are serialized
 * so an older spawn can never be killed by the newer restart that reused it,
 * and proxy ownership follows the restart that actually spawned it.
 */
function installProxyLifecycle(
  ctx: Context,
  scope: SettingsScope<HeadroomSettings>,
): void {
  ctx.effect(() => {
    let current: { dispose: () => void } | undefined
    let generation = 0
    let queue: Promise<void> = Promise.resolve()
    let lastLaunchKey = ''

    const restart = (): void => {
      queue = queue.then(async () => {
        const id = ++generation
        const settings = scope.get()
        const launchKey = JSON.stringify({
          command: settings.command ?? null,
          pythonPath: settings.pythonPath ?? null,
          uvCommand: settings.uvCommand ?? null,
          port: settings.port ?? null,
          baseUrl: settings.baseUrl ?? null,
          autoInstall: settings.autoInstall ?? null,
        })
        // A launch-shape change must replace the running proxy even when it
        // is healthy (e.g. switching the Python interpreter); otherwise the
        // reused service would keep the old interpreter forever.
        if (launchKey !== lastLaunchKey && current !== undefined) {
          current.dispose()
          current = undefined
        }
        lastLaunchKey = launchKey
        const service = resolveServiceConfig({
          command: settings.command || undefined,
          pythonPath: settings.pythonPath || undefined,
          uvCommand: settings.uvCommand || undefined,
          port: settings.port,
          baseUrl: settings.baseUrl || undefined,
          autoInstall: settings.autoInstall,
        })
        const started = await startHeadroomService(ctx, service)
        if (id !== generation) {
          started.dispose()
          return
        }
        if (started.reused) {
          // An already-healthy proxy keeps the previous owner's dispose.
          ctx.reflect.set('headroomClient', started.client)
          return
        }
        current?.dispose()
        ctx.reflect.set('headroomClient', started.client)
        current = { dispose: started.dispose }
      }).catch((error: unknown) => {
        // A failed restart must not break later ones: keep the queue alive.
        ctx.logger.warn('dsh-headroom: proxy restart failed: %s', message(error))
      })
    }

    void restart()
    const stopWatch = scope.watch(() => restart())
    return () => {
      generation += 1
      stopWatch()
      current?.dispose()
      ctx.reflect.set('headroomClient', undefined)
    }
  }, 'dsh-headroom: proxy lifecycle')
}

/**
 * Register the headroom compaction engine as `ctx.compaction`. The Service
 * constructor provides the name immediately, so a duplicate-registration
 * conflict with the default compaction-basic backend surfaces synchronously;
 * in that case disable its loader entry first, then retry.
 */
function installEngine(ctx: Context, config: Config): void {
  try {
    new HeadroomCompactionEngine(ctx, engineConfig(config))
    ctx.logger.info('dsh-headroom: compaction engine registered (backend=headroom)')
  } catch (error) {
    if (!serviceConflict(error)) {
      ctx.logger.warn('dsh-headroom: compaction engine registration failed: %s', message(error))
      return
    }
    void takeOverCompaction(ctx, config)
  }
}

async function takeOverCompaction(ctx: Context, config: Config): Promise<void> {
  const loader = (ctx as unknown as {
    loader?: { update(id: string, options: { disabled: boolean }): Promise<unknown> }
  }).loader
  if (loader === undefined) {
    ctx.logger.warn(
      'dsh-headroom: no loader available to take over the compaction service; '
      + 'disable compaction-basic in cordis.patch.yml and restart dsh web',
    )
    return
  }
  try {
    await loader.update('compaction-basic', { disabled: true })
    new HeadroomCompactionEngine(ctx, engineConfig(config))
    ctx.logger.info('dsh-headroom: disabled compaction-basic and registered the headroom engine')
  } catch (error) {
    ctx.logger.warn('dsh-headroom: could not take over the compaction service: %s', message(error))
  }
}

function serviceConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes('has been registered')
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
