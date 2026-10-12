/**
 * `/headroom` human command: view or change the plugin's settings without the
 * browser card. The command reads the plugin's live Config references and
 * writes the same fields host-side through the settings service, so it works
 * on every harness version.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-settings'
import type { HeadroomSettings } from './index.ts'

const USAGE = 'Usage: /headroom (no args) | /headroom set <key> <value> | /headroom unset <key>'

/** Settings keys the command accepts, mapped to their value kinds. */
const KEY_KINDS: Record<string, 'number' | 'boolean' | 'string'> = {
  port: 'number',
  baseUrl: 'string',
  command: 'string',
  pythonPath: 'string',
  uvCommand: 'string',
  autoInstall: 'boolean',
  resultCompressionEnabled: 'boolean',
  resultCompressionThresholdChars: 'number',
}

/** Settings keys mapped to their path inside the plugin's own Config. */
const KEY_PATHS: Record<string, readonly string[]> = {
  port: ['headroom', 'port'],
  baseUrl: ['headroom', 'baseUrl'],
  command: ['headroom', 'command'],
  pythonPath: ['headroom', 'pythonPath'],
  uvCommand: ['headroom', 'uvCommand'],
  autoInstall: ['headroom', 'autoInstall'],
  resultCompressionEnabled: ['resultCompression', 'enabled'],
  resultCompressionThresholdChars: ['resultCompression', 'thresholdChars'],
}

/** One parsed command request. */
export type HeadroomCommand =
  | { kind: 'show' }
  | { kind: 'set'; key: string; value: unknown }
  | { kind: 'unset'; key: string }

/**
 * Parse a `/headroom` raw input into a command request.
 * @param raw - the invocation's raw input (arguments only).
 * @returns the parsed request.
 */
export function parseHeadroomCommand(raw: string): HeadroomCommand {
  const tokens = raw.trim().split(/\s+/).filter((token) => token.length > 0)
  if (tokens.length === 0) return { kind: 'show' }
  const first = tokens[0]
  const key = tokens[1]
  if (first === 'unset' && tokens.length === 2 && key !== undefined && key in KEY_KINDS) {
    return { kind: 'unset', key }
  }
  if (first === 'set' && tokens.length >= 3 && key !== undefined && key in KEY_KINDS) {
    const value = parseValue(key, tokens.slice(2).join(' '))
    if (value !== undefined) return { kind: 'set', key, value }
  }
  return { kind: 'show' }
}

/** Parse one value string by the key's kind; `undefined` on malformed input. */
function parseValue(key: string, text: string): unknown {
  const kind = KEY_KINDS[key]
  if (kind === 'number') {
    const parsed = Number(text)
    if (!Number.isFinite(parsed)) return undefined
    if (key === 'port' && (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535)) return undefined
    if (key === 'resultCompressionThresholdChars' && (!Number.isInteger(parsed) || parsed < 1)) return undefined
    return parsed
  }
  if (kind === 'boolean') {
    if (text === 'true') return true
    if (text === 'false') return false
    return undefined
  }
  return text
}

/** Render the current resolved settings as the command's success text. */
export function renderSettings(settings: HeadroomSettings): string {
  return JSON.stringify(settings, null, 2)
}


/**
 * Execute one parsed command against the live settings and the config form.
 * @param ctx - context carrying the settings service.
 * @param live - reader of the plugin's current settings.
 * @param ownEntry - resolves the profile row id owning the config form.
 * @param command - the parsed request.
 * @returns the command's result.
 */
export async function executeHeadroomCommand(
  ctx: Context,
  live: () => HeadroomSettings,
  ownEntry: () => string,
  command: HeadroomCommand,
): Promise<CommandResult> {
  try {
    if (command.kind === 'show') {
      return { kind: 'success', text: `Current settings:\n${renderSettings(live())}` }
    }
    const path = KEY_PATHS[command.key]
    if (path === undefined) return { kind: 'error', text: USAGE }
    await ctx.settings.mutate(ownEntry(), command.kind === 'unset'
      ? [{ op: 'unset', path }]
      : [{ op: 'set', path, value: command.value }])
    return {
      kind: 'success',
      text: command.kind === 'unset'
        ? `Cleared ${command.key}; the composition default applies.`
        : `Set ${command.key} = ${JSON.stringify(command.value)}.`,
    }
  } catch (error: unknown) {
    return { kind: 'error', text: `Failed to update settings: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * Register the `/headroom` command.
 * @param ctx - context carrying the command registry and settings service.
 * @param live - reader of the plugin's current settings.
 * @param ownEntry - resolves the profile row id owning the config form.
 */
export function installHeadroomCommand(
  ctx: Context,
  live: () => HeadroomSettings,
  ownEntry: () => string,
): void {
  ctx.effect(() => ctx.commands.register({
    name: 'headroom',
    description: 'View or change Headroom compression settings',
    handler: (invocation: CommandInvocation): Promise<CommandResult> => {
      const command = parseHeadroomCommand(invocation.rawInput)
      if (command.kind === 'show' && invocation.rawInput.trim().length > 0) {
        return Promise.resolve({ kind: 'error', text: USAGE })
      }
      return executeHeadroomCommand(ctx, live, ownEntry, command)
    },
  }), 'dsh-headroom: command')
}
