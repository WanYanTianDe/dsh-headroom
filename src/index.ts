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
import { installResultCompression, resolveResultCompression } from './result-compressor.ts'
import type { ResultCompressionConfig } from './result-compressor.ts'
import { installHeadroomCommand } from './command.ts'

export const name = 'dsh-headroom'
/** Services the plugin and its compaction engine read through the context. */
export const inject: string[] = ['settings', 'tools', 'llm', 'tokenMeter', 'sessions', 'commands']

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
  /** Tool-result compression policy; the settings namespace overrides `enabled` and `thresholdChars`. */
  resultCompression?: Partial<ResultCompressionConfig>
  /**
   * Compress request mode: `'ccr'` makes the proxy write CCR retrieval hashes
   * so `headroom_retrieve` can restore lossy replacements (default).
   */
  compressMode?: 'ccr' | 'default'
  /** Warm the Kompress model at proxy startup so the first real request is not skipped (default true). */
  prewarm?: boolean
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
  savingsProfile: z.string(),
  kompressMustKeep: z.boolean(),
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
  resultCompression: z.object({
    enabled: z.boolean(),
    thresholdChars: z.number().step(1).min(1),
    minSavingsRatio: z.number(),
    maxPerStep: z.number().step(1).min(1),
  }),
  compressMode: z.union([z.const('ccr'), z.const('default')]),
  prewarm: z.boolean(),
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
  /** Tool-result compression switch; absent falls back to the composition layer. */
  resultCompressionEnabled?: boolean
  /** Tool-result compression threshold in characters; absent falls back to the composition layer. */
  resultCompressionThresholdChars?: number
}

const headroomSettingsSchema = z.object({
  command: z.string(),
  pythonPath: z.string(),
  uvCommand: z.string(),
  port: z.number().step(1).min(1).max(65535),
  baseUrl: z.string(),
  autoInstall: z.boolean(),
  resultCompressionEnabled: z.boolean(),
  resultCompressionThresholdChars: z.number().step(1).min(1),
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

export function apply(ctx: Context, config: Config): void {  ctx.provide('headroomClient', undefined)
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

  installProxyLifecycle(ctx, scope, config)

  // Tool-result compression runs before the historical compaction pass, so
  // the surface the compaction prices is already slimmed.
  installResultCompression(ctx, () => liveResultConfig(scope, config))

  installEngine(ctx, config)

  installTakeoverRollback(ctx)

  installHeadroomCommand(ctx, scope, HEADROOM_SETTINGS_NS)

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
 * Result-compression policy resolved at a step boundary: settings values
 * override the composition layer, which itself defaults over the baked-in
 * policy defaults.
 */
function liveResultConfig(scope: SettingsScope<HeadroomSettings>, config: Config): ResultCompressionConfig {
  const base = resolveResultCompression(config.resultCompression)
  const settings = scope.get()
  return {
    ...base,
    enabled: settings.resultCompressionEnabled ?? base.enabled,
    thresholdChars: settings.resultCompressionThresholdChars ?? base.thresholdChars,
  }
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
  config: Config,
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
          ...config.headroom,
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
        if (config.prewarm !== false && started.client !== undefined) {
          // Warm the Kompress model so the first real compression is not
          // skipped while the model loads (a noop there would be cached).
          void started.client.compress(
            [{ role: 'user', content: 'headroom prewarm' }],
            'deepseek-chat',
            'default',
          ).catch(() => undefined)
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

/** BasicCompactionEngine's default retention ratio, mirrored for load-time validation. */
const DEFAULT_RETAIN_RATIO = 0.16

/**
 * Validate the effective compaction policy the headroom engine would resolve,
 * mirroring BasicCompactionConfig's load-time checks (`resolveConfig` is not
 * exported from the compaction-basic package). The point is not to duplicate
 * the harness policy engine but to catch a rejected config BEFORE any Service
 * registration, so a bad policy cannot leave a half-initialized `compaction`
 * service behind.
 * @param config - the engine config passed to {@link HeadroomCompactionEngine}.
 * @throws the same style of `BasicCompactionConfig: ...` errors the engine
 * constructor would throw, on any load-time-invalid policy.
 */
export function assertValidEngineConfig(config: HeadroomEngineConfig): void {
  const ratio = (name: string, value: number): void => {
    if (value < 0 || value > 1) {
      throw new Error(`BasicCompactionConfig: ${name} (${value}) must be between 0 and 1`)
    }
  }
  const numberOrThrow = (name: string, value: unknown): number | undefined => {
    if (value === undefined) return undefined
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`BasicCompactionConfig: ${name} must be a finite number`)
    }
    return value
  }
  const thresholdRatio = numberOrThrow('thresholdRatio', config.thresholdRatio) ?? 0.8
  ratio('thresholdRatio', thresholdRatio)
  const retainRatio = numberOrThrow('retainRatio', config.retainRatio)
  const retainTokens = numberOrThrow('retainTokens', config.retainTokens)
  if (retainRatio !== undefined) ratio('retainRatio', retainRatio)
  if (retainRatio !== undefined && retainTokens !== undefined) {
    throw new Error('BasicCompactionConfig: retainRatio and retainTokens are mutually exclusive')
  }
  const resolvedRetainRatio = retainRatio ?? (retainTokens === undefined ? DEFAULT_RETAIN_RATIO : undefined)
  if (resolvedRetainRatio !== undefined && resolvedRetainRatio >= thresholdRatio) {
    throw new Error(
      `BasicCompactionConfig: retainRatio (${resolvedRetainRatio}) must be less than `
      + `the resolved thresholdRatio (${thresholdRatio})`,
    )
  }
}

/**
 * Register the headroom compaction engine as `ctx.compaction`. The Service
 * constructor provides the name immediately, so a duplicate-registration
 * conflict with the default compaction-basic backend surfaces synchronously;
 * in that case the loader entry of compaction-basic is disabled at runtime
 * and the headroom engine takes over. The takeover is rolled back when this
 * plugin unloads (see {@link installTakeoverRollback}).
 */
function installEngine(ctx: Context, config: Config): void {
  // Validate the compaction policy BEFORE any Service registration: a rejected
  // config (e.g. `retainRatio >= thresholdRatio`) would otherwise leave a
  // half-initialized `compaction` service behind (the Cordis Service
  // constructor registers before `BasicCompactionEngine` resolves config),
  // silently disabling automatic compaction. Fail loud and keep the
  // compaction-basic backend untouched instead.
  try {
    assertValidEngineConfig(engineConfig(config))
  } catch (error) {
    ctx.logger.warn('dsh-headroom: invalid compaction config, keeping the default backend: %s', message(error))
    return
  }
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

/** Whether this plugin disabled compaction-basic loader entries at runtime. */
let compactionTakenOver = false
/** Original disabled flags of the entries this plugin disabled, for rollback. */
let compactionRestore: Array<{ id: string; disabled?: boolean | null }> = []

/** Loader-surface view this plugin needs; the loader service is not typed on Context. */
export interface LoaderEntryLike {
  id: string
  options: { disabled?: boolean | null }
  update(options: { disabled?: boolean | null }, create?: boolean, force?: boolean): Promise<unknown>
  parent: { tree: { write(): void } }
}

/** Loader-surface view this plugin needs; the loader service is not typed on Context. */
export interface LoaderLike {
  entries?(): Iterable<LoaderEntryLike>
  update(id: string, options: { disabled: boolean }, parent?: string | null): Promise<unknown>
}

function loaderOf(ctx: Context): LoaderLike | undefined {
  return (ctx as unknown as { loader?: LoaderLike }).loader
}

/**
 * Whether a loader entry names the `compaction-basic` row. The effective id
 * carries the owning subtree's prefix (`include:compaction-basic` under the
 * file-backed include tree), so the bare id alone never matches; the suffix
 * keeps the match robust to any prefixing layer while staying blind to ids
 * that merely end in the same name from a different namespace.
 */
function isCompactionEntry(entry: LoaderEntryLike): boolean {
  return entry.id === 'compaction-basic' || entry.id.endsWith(':compaction-basic')
}

/**
 * Set every `compaction-basic` entry's disabled flag across the loader tree.
 * Patch and preset layers can each carry an entry under the same id, and a
 * bare `loader.update(id, ...)` only touches the first match in the current
 * tree, so the takeover walks `entries()` instead. When the loader offers no
 * `entries()` view, falls back to the tree-level update. Returns each touched
 * entry's previous `disabled` value so the caller can restore them on unload.
 * @param loader - the loader service surface.
 * @param disabled - the disabled flag to write onto every match.
 * @returns per-entry restore records (id plus the previous disabled value).
 */
export async function setCompactionEntries(
  loader: LoaderLike,
  disabled: boolean,
): Promise<Array<{ id: string; disabled?: boolean | null }>> {
  const targets = [...(loader.entries?.() ?? [])].filter(isCompactionEntry)
  if (targets.length === 0) {
    await loader.update('compaction-basic', { disabled })
    return [{ id: 'compaction-basic', disabled }]
  }
  const restore = targets.map((entry) => ({ id: entry.id, disabled: entry.options.disabled }))
  for (const entry of targets) {
    await entry.update({ disabled }, false, true)
    entry.parent.tree.write()
  }
  return restore
}

/**
 * Restore the disabled flags recorded by {@link setCompactionEntries}, pairing
 * restore records with the tree's current `compaction-basic` entries in order.
 * Entries that no longer exist are skipped; a record with `disabled` unset
 * removes the flag again (the entry re-inherits its composition default).
 * @param loader - the loader service surface.
 * @param restore - records previously returned by {@link setCompactionEntries}.
 */
export async function restoreCompactionEntries(
  loader: LoaderLike,
  restore: Array<{ id: string; disabled?: boolean | null }>,
): Promise<void> {
  const targets = [...(loader.entries?.() ?? [])].filter(isCompactionEntry)
  for (const [index, item] of restore.entries()) {
    const entry = targets[index]
    if (entry === undefined) continue
    await entry.update({ disabled: item.disabled }, false, true)
    entry.parent.tree.write()
  }
}

async function takeOverCompaction(ctx: Context, config: Config): Promise<void> {
  const loader = loaderOf(ctx)
  if (loader === undefined) {
    ctx.logger.warn(
      'dsh-headroom: no loader available to take over the compaction service; '
      + 'disable compaction-basic in cordis.patch.yml and restart dsh web',
    )
    return
  }
  try {
    compactionRestore = await setCompactionEntries(loader, true)
    new HeadroomCompactionEngine(ctx, engineConfig(config))
    compactionTakenOver = true
    ctx.logger.info('dsh-headroom: disabled compaction-basic entries and registered the headroom engine')
  } catch (error) {
    // The takeover left compaction-basic disabled but could not mount the
    // headroom engine: restore the original entries so the harness keeps a
    // working compaction backend instead of a service vacuum.
    try {
      await restoreCompactionEntries(loader, compactionRestore)
      compactionRestore = []
    } catch (restoreError) {
      ctx.logger.warn('dsh-headroom: could not restore compaction-basic after takeover failure: %s', message(restoreError))
    }
    ctx.logger.warn('dsh-headroom: could not take over the compaction service: %s', message(error))
  }
}

/**
 * Restore the disabled compaction-basic entries when this plugin unloads, so
 * the harness keeps a working compaction service after dsh-headroom is
 * removed. The restore retries until the headroom engine's `compaction`
 * service has been released by this fiber's disposal (disposers run in
 * parallel, so the service may still be registered for a moment).
 */
function installTakeoverRollback(ctx: Context): void {
  ctx.effect(() => {
    let attempted = false
    return async () => {
      if (!compactionTakenOver || attempted) return
      attempted = true
      const loader = loaderOf(ctx)
      if (loader === undefined) return
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50))
        try {
          await restoreCompactionEntries(loader, compactionRestore)
          ctx.logger.info('dsh-headroom: restored compaction-basic entries on unload')
          return
        } catch {
          // compaction service still held by this fiber's disposal; retry
        }
      }
      ctx.logger.warn(
        'dsh-headroom: could not restore compaction-basic entries on unload; '
        + 'remove their `disabled: true` markers in the loader tree or restart dsh web',
      )
    }
  }, 'dsh-headroom: compaction takeover rollback')
}

function serviceConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes('has been registered')
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
