/**
 * Headroom proxy lifecycle: command discovery, first-run auto-install via uv,
 * and child-process management. The service degrades cleanly — when no proxy
 * is reachable the plugin stays loaded with compression disabled.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { HeadroomClient } from './client.ts'

export const DEFAULT_HEADROOM_PORT = 8787

export interface HeadroomServiceConfig {
  /** Base URL of the compression proxy. */
  baseUrl: string
  /** Port for the spawned proxy. */
  port: number
  /** Explicit headroom executable path; otherwise discovered. */
  command?: string
  /**
   * Python interpreter path; when set, headroom runs as `python -m headroom`.
   * Takes precedence over `command`; lets the user pin a specific Python
   * version for the proxy.
   */
  pythonPath?: string
  /** Explicit uv executable path used for the auto-install; otherwise discovered. */
  uvCommand?: string
  /** Auto-install headroom-ai via uv when the command is missing. */
  autoInstall: boolean
  /** Timeout for the uv tool install run. */
  installTimeoutMs: number
  /** Timeout waiting for the spawned proxy to become healthy. */
  startTimeoutMs: number
}

export function resolveServiceConfig(config: Partial<HeadroomServiceConfig> | undefined): HeadroomServiceConfig {
  const port = config?.port ?? DEFAULT_HEADROOM_PORT
  return {
    baseUrl: config?.baseUrl ?? `http://127.0.0.1:${port}`,
    port,
    command: config?.command,
    pythonPath: config?.pythonPath,
    uvCommand: config?.uvCommand,
    autoInstall: config?.autoInstall ?? true,
    installTimeoutMs: config?.installTimeoutMs ?? 10 * 60_000,
    startTimeoutMs: config?.startTimeoutMs ?? 60_000,
  }
}

export interface HeadroomService {
  /**
   * Ready proxy client, or `undefined` when the service degraded (no command
   * found or the spawned proxy never became healthy). Callers publish the
   * undefined state so consumers see "not ready" instead of a broken client.
   */
  client: HeadroomClient | undefined
  dispose: () => void
  /** True when an already-healthy proxy was reused; the caller keeps its previous dispose ownership. */
  reused: boolean
}

/** One spawnable launch form: executable plus any fixed argument prefix. */
interface Launch {
  command: string
  prefix: string[]
}

/**
 * Resolve how to launch the proxy: an explicit `pythonPath` runs the headroom
 * CLI module under that interpreter; otherwise the headroom executable is
 * discovered.
 */
async function resolveLaunch(
  ctx: Context,
  config: HeadroomServiceConfig,
): Promise<Launch | undefined> {
  if (config.pythonPath !== undefined && config.pythonPath.length > 0) {
    const py = findExecutable(config.pythonPath)
    if (py !== undefined) {
      // Installed wheels expose `headroom.cli`; some builds also ship
      // `headroom.__main__` (`-m headroom`). Probe both, prefer the former.
      // A probe that hangs or throws must not break the restart chain.
      const cliOk = probeModule(py, ['-m', 'headroom.cli', '--version'])
      if (cliOk) {
        ctx.logger.info('dsh-headroom: using python %s (-m headroom.cli)', py)
        return { command: py, prefix: ['-m', 'headroom.cli'] }
      }
      const pkgOk = probeModule(py, ['-m', 'headroom', '--version'])
      if (pkgOk) {
        ctx.logger.info('dsh-headroom: using python %s (-m headroom)', py)
        return { command: py, prefix: ['-m', 'headroom'] }
      }
      ctx.logger.warn(
        'dsh-headroom: pythonPath %s cannot run headroom as a module; falling back to command discovery',
        config.pythonPath,
      )
    } else {
      ctx.logger.warn('dsh-headroom: pythonPath %s not found; falling back to command discovery', config.pythonPath)
    }
  }
  const command = findExecutable(config.command) ?? findOnPath('headroom') ?? uvToolBin('headroom')
  if (command !== undefined) return { command, prefix: [] }
  return undefined
}

/** Probe one `python -m <module>` invocation; only a clean exit 0 means yes. */
function probeModule(py: string, args: string[]): boolean {
  try {
    const probe = spawnSync(py, args, {
      stdio: 'ignore',
      timeout: 5_000,
      shell: false,
    })
    return probe.error === undefined && probe.status === 0
  } catch {
    return false
  }
}

/**
 * Bring the proxy up: reuse a healthy service, else discover or auto-install
 * the command, spawn it, and wait for health. Never throws — failures degrade
 * to a disabled compression backend with a logged reason.
 */
export async function startHeadroomService(
  ctx: Context,
  config: HeadroomServiceConfig,
): Promise<HeadroomService> {
  const client = new HeadroomClient(config.baseUrl)
  if (await client.health()) {
    ctx.logger.info('dsh-headroom: reusing headroom proxy at %s', config.baseUrl)
    return { client, dispose: () => {}, reused: true }
  }

  let launch = await resolveLaunch(ctx, config)
  if (launch === undefined && config.autoInstall) {
    // With an explicit pythonPath, install headroom into that interpreter.
    const py = config.pythonPath !== undefined && config.pythonPath.length > 0
      ? findExecutable(config.pythonPath)
      : undefined
    if (py !== undefined) {
      ctx.logger.info('dsh-headroom: installing headroom-ai into %s via pip (first run)…', py)
      try {
        await runAndWait(py, ['-m', 'pip', 'install', 'headroom-ai[all]'], config.installTimeoutMs)
      } catch (error) {
        ctx.logger.warn('dsh-headroom: pip auto-install failed: %s', errorMessage(error))
      }
      launch = await resolveLaunch(ctx, config)
    } else {
      const uv = findExecutable(config.uvCommand) ?? findOnPath('uv') ?? wingetUv()
      if (uv === undefined) {
        ctx.logger.warn(
          'dsh-headroom: headroom not found and uv is not installed; '
          + 'install it with `uv tool install "headroom-ai[all]"` (install uv first if needed)',
        )
        return { client: undefined, dispose: () => {}, reused: false }
      }
      ctx.logger.info('dsh-headroom: installing headroom-ai via uv (first run)…')
      try {
        await runAndWait(uv, ['tool', 'install', '--python', '3.13', 'headroom-ai[all]'], config.installTimeoutMs)
      } catch (error) {
        ctx.logger.warn('dsh-headroom: auto-install failed: %s', errorMessage(error))
        return { client: undefined, dispose: () => {}, reused: false }
      }
      launch = await resolveLaunch(ctx, config)
    }
  }
  if (launch === undefined) {
    ctx.logger.warn('dsh-headroom: headroom command not found; compression disabled. '
      + 'Install it with `uv tool install "headroom-ai[all]"`, set config.headroom.command, '
      + 'or set config.headroom.pythonPath to a Python that has headroom-ai installed.')
    return { client: undefined, dispose: () => {}, reused: false }
  }

  const child = spawn(launch.command, [...launch.prefix, 'proxy', '--port', String(config.port)], {
    stdio: 'ignore',
    windowsHide: true,
  })
  child.on('error', (error) => ctx.logger.warn('dsh-headroom: proxy failed to start: %s', errorMessage(error)))
  child.on('exit', (code) => ctx.logger.warn('dsh-headroom: proxy exited early with code %s', String(code)))

  const deadline = Date.now() + config.startTimeoutMs
  while (Date.now() < deadline) {
    if (await client.health()) {
      ctx.logger.info('dsh-headroom: proxy ready at %s', config.baseUrl)
      return { client, dispose: () => killProcessTree(child), reused: false }
    }
    await sleep(500)
  }
  ctx.logger.warn('dsh-headroom: proxy did not become healthy within %sms; compression disabled', config.startTimeoutMs)
  killProcessTree(child)
  return { client: undefined, dispose: () => {}, reused: false }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Resolve one explicit executable candidate; a leading `~` expands to the home directory. */
function findExecutable(candidate: string | undefined): string | undefined {
  if (candidate === undefined || candidate.length === 0) return undefined
  const expanded = candidate === '~' || candidate.startsWith('~/') || candidate.startsWith('~\\')
    ? join(homedir(), candidate.slice(1))
    : candidate
  if (existsSync(expanded)) return expanded
  if (process.platform === 'win32' && existsSync(`${expanded}.exe`)) return `${expanded}.exe`
  return undefined
}

/** Resolve a bare command name through the process PATH. */
function findOnPath(name: string): string | undefined {
  const probe = spawnSync(name, ['--version'], { stdio: 'ignore', timeout: 3_000, shell: false })
  return probe.error === undefined && probe.status !== null ? name : undefined
}

/** uv tool installs land in ~/.local/bin by default. */
function uvToolBin(name: string): string | undefined {
  const binDir = process.env.UV_TOOL_BIN_DIR
  const base = binDir !== undefined && binDir.length > 0 ? binDir : join(homedir(), '.local', 'bin')
  const candidate = join(base, name)
  return findExecutable(candidate)
}

/** Locate a winget-installed uv (the astral-sh.uv package layout). */
function wingetUv(): string | undefined {
  if (process.platform !== 'win32') return undefined
  const packagesDir = join(homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages')
  if (!existsSync(packagesDir)) return undefined
  for (const entry of readdirSync(packagesDir)) {
    if (!entry.startsWith('astral-sh.uv')) continue
    const candidate = join(packagesDir, entry, 'uv.exe')
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/** Run one command to completion, rejecting on non-zero exit or timeout. */
function runAndWait(command: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${command} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with ${String(code)}: ${stderr.slice(-2_000)}`))
    })
  })
}

/** Terminate the child and (on Windows) its process tree. */
function killProcessTree(child: ReturnType<typeof spawn>): void {
  if (child.pid === undefined) return
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {
      // The tree may already be gone; the plain kill below is the fallback.
    }
  }
  child.kill()
}
