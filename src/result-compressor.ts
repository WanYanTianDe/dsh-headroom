/**
 * Tool-result compression: shrink over-budget tool outputs through the local
 * Headroom proxy at every step boundary, before the historical compaction
 * pass sees the surface. Each replacement follows the shared shadow-price
 * protocol — a `compaction/prune` metering event immediately followed by a
 * `tool/result` surface replace — so the original content stays in the
 * session log, the replacement is replay-recoverable, and the model can
 * restore the full text through the `headroom_retrieve` tool with the CCR
 * hash embedded in the compressed text.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { freezeMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
// Type-only: the `compaction/prune` SessionEventMap merge.
import type {} from '@deepseek-ai/dsh-compaction'
// Type-only: the `ctx.tokenMeter` Context merge for the shadow pricing.
import type {} from '@deepseek-ai/dsh-token-meter'
import type { Session, SessionEvent, ToolResultMessage } from '@deepseek-ai/dsh-session'
import type { HeadroomClient, HeadroomCompressResponse } from './client.ts'
import { routedModel } from './engine.ts'

/** Prefix marking a headroom-compressed tool result; scanners skip these. */
export const COMPRESSED_RESULT_PREFIX = '[compressed by headroom'

/** Tool-result compression policy; defaults live in {@link RESULT_COMPRESSION_DEFAULTS}. */
export interface ResultCompressionConfig {
  /** Total switch. */
  enabled: boolean
  /** Compress tool-result text above this many Unicode code points. */
  thresholdChars: number
  /** Replace only when the proxy saves at least this fraction of tokens. */
  minSavingsRatio: number
  /** Most tool results compressed in one pre-step pass. */
  maxPerStep: number
}

/** Default tool-result compression policy. */
export const RESULT_COMPRESSION_DEFAULTS: ResultCompressionConfig = {
  enabled: true,
  thresholdChars: 8_192,
  minSavingsRatio: 0.15,
  maxPerStep: 3,
}

/** Merge partial configuration over the defaults. */
export function resolveResultCompression(
  config: Partial<ResultCompressionConfig> | undefined,
): ResultCompressionConfig {
  return {
    enabled: config?.enabled ?? RESULT_COMPRESSION_DEFAULTS.enabled,
    thresholdChars: config?.thresholdChars ?? RESULT_COMPRESSION_DEFAULTS.thresholdChars,
    minSavingsRatio: config?.minSavingsRatio ?? RESULT_COMPRESSION_DEFAULTS.minSavingsRatio,
    maxPerStep: config?.maxPerStep ?? RESULT_COMPRESSION_DEFAULTS.maxPerStep,
  }
}

/** Text length in Unicode code points; non-text blocks cost zero. */
export function measureText(blocks: readonly ContentBlock[]): number {
  let chars = 0
  for (const block of blocks) {
    if (block.type === 'text') chars += Array.from(block.text).length
  }
  return chars
}

/** Whether content carries the headroom compression marker on its first block. */
export function isCompressedResult(blocks: readonly ContentBlock[]): boolean {
  const first = blocks[0]
  return first?.type === 'text' && first.text.startsWith(COMPRESSED_RESULT_PREFIX)
}

/** One candidate tool-result surface node for compression. */
export interface ResultCandidate {
  readonly seq: number
  readonly event: SessionEvent<'tool/result'>
}

/**
 * Collect over-budget, uncompressed tool-result surface nodes in surface
 * order. Nodes below the threshold or already carrying the compression
 * marker are skipped, so a pass never re-compresses its own output.
 * @param session - session whose current surface is scanned.
 * @param thresholdChars - minimum text length (code points) that qualifies.
 * @returns candidate surface nodes in surface order.
 */
export function scanResultCandidates(session: Session, thresholdChars: number): ResultCandidate[] {
  const candidates: ResultCandidate[] = []
  for (const seq of [...session.surface.nodes]) {
    const event = session.events[seq]
    if (event?.type !== 'tool/result') continue
    const result = event.data.message.content[0]
    if (result === undefined) continue
    if (isCompressedResult(result.content)) continue
    if (measureText(result.content) < thresholdChars) continue
    candidates.push({ seq, event })
  }
  return candidates
}

/**
 * Whether a compression is worth replacing the original: the proxy must
 * report enough token savings to justify losing the verbatim text.
 * @param tokensBefore - proxy-reported token count of the original.
 * @param tokensAfter - proxy-reported token count of the compressed result.
 * @param minSavingsRatio - required minimum saved fraction (0..1).
 * @returns true when the replacement is strictly smaller than the budget.
 */
export function shouldReplace(tokensBefore: number, tokensAfter: number, minSavingsRatio: number): boolean {
  if (tokensBefore <= 0) return false
  return tokensAfter < tokensBefore * (1 - minSavingsRatio)
}

/**
 * Render the compressed tool-result text: a retrieval header carrying the
 * token accounting and the CCR hashes, then the compressed content.
 * @param text - compressed tool-result text from the proxy.
 * @param tokensBefore - proxy-reported token count of the original.
 * @param tokensAfter - proxy-reported token count of the compressed result.
 * @param ccrHashes - CCR store hashes; original content is retrievable with them.
 * @returns the replacement text block content.
 */
export function renderCompressedResult(
  text: string,
  tokensBefore: number,
  tokensAfter: number,
  ccrHashes: readonly string[],
): string {
  const remaining = tokensBefore > 0 ? Math.round((tokensAfter / tokensBefore) * 100) : 0
  const ccr = ccrHashes.length > 0
    ? ` Original retrievable via the headroom_retrieve tool with one of these hashes: ${ccrHashes.join(', ')}.`
    : ''
  return `${COMPRESSED_RESULT_PREFIX}: ${tokensBefore} → ${tokensAfter} tokens (${remaining}% of original).${ccr}]\n${text}`
}

/** One landed tool-result compression replacement. */
export interface ResultCompressOutcome {
  readonly seq: number
  /** The seq of the appended replacement `tool/result` event. */
  readonly replacementSeq: number
  readonly tokensBefore: number
  readonly tokensAfter: number
}

/** Extract the compressed text from a proxy compress response. */
function compressedText(response: HeadroomCompressResponse): string | undefined {
  const message = response.messages[0]
  if (typeof message !== 'object' || message === null) return undefined
  const content = (message as { content?: unknown }).content
  return typeof content === 'string' && content.length > 0 ? content : undefined
}

/** The tool-result message's single result block, when present. */
function resultBlock(message: ToolResultMessage): Extract<ContentBlock, { type: 'tool-result' }> | undefined {
  const block = message.content[0]
  return block?.type === 'tool-result' ? block : undefined
}

/**
 * Compress the over-budget tool results of one session through the proxy,
 * replacing each qualified node with a headroom-compressed text block via the
 * shared shadow-price protocol. Skips nodes the proxy cannot compress or that
 * fail the savings test; earlier replacements stay durable when a later one
 * fails.
 * @param ctx - context providing the token meter for shadow pricing.
 * @param client - healthy headroom proxy client.
 * @param agent - agent owning the session; its routed model reports to the proxy.
 * @param session - session whose current surface is rewritten.
 * @param config - resolved tool-result compression policy.
 * @param attempted - seqs already tried without a replacement; the pass skips
 * them so low-yield candidates ahead of better ones cannot starve the budget.
 * Every tried seq (replaced or not) is added, so later passes advance.
 * @param signal - cancellation; a pass aborts between candidates.
 * @returns landed replacements with token accounting.
 */
export async function compressSessionResults(
  ctx: Context,
  client: HeadroomClient,
  agent: Agent,
  session: Session,
  config: ResultCompressionConfig,
  attempted: Set<number>,
  signal?: AbortSignal,
): Promise<ResultCompressOutcome[]> {
  const candidates = scanResultCandidates(session, config.thresholdChars)
    .filter((candidate) => !attempted.has(candidate.seq))
    .slice(0, config.maxPerStep)
  const outcomes: ResultCompressOutcome[] = []
  for (const { seq, event } of candidates) {
    attempted.add(seq)
    signal?.throwIfAborted()
    const message = event.data.message
    const result = resultBlock(message)
    if (result === undefined) continue
    const text = result.content
      .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
    if (text.length === 0) continue

    // The proxy requires a model for token estimation; the routed model is
    // the honest estimate, the harness default stands in before any request.
    const model = routedModel(agent) ?? 'deepseek-chat'
    const response = await client.compress(
      [{ role: 'tool', tool_call_id: result.toolCallId, content: text }],
      model,
    )
    signal?.throwIfAborted()
    const compressed = compressedText(response)
    if (compressed === undefined) continue
    if (!shouldReplace(response.tokens_before, response.tokens_after, config.minSavingsRatio)) continue

    const replaced = renderCompressedResult(
      compressed,
      response.tokens_before,
      response.tokens_after,
      response.ccr_hashes,
    )
    const replacement = freezeMessage<ToolResultMessage>({
      ...message,
      content: [{ ...result, content: [{ type: 'text', text: replaced }] }],
    })
    // Shadow-price protocol: the metering event and its replacement are
    // appended synchronously adjacent, so pure consumers subtract the
    // shadowed node's heuristic price without retaining per-node state.
    session.append('compaction/prune', {
      shadowedRange: { start: seq, end: seq },
      shadowedSeqs: [seq],
      shadowedTokenCount: ctx.tokenMeter.estimateMessage(message),
    })
    const replacementEvent = session.append('tool/result', { ...event.data, message: replacement }, {
      surfaceOp: { op: 'replace', start: seq, end: seq },
      sourceEventSeqs: [seq],
    })
    outcomes.push({
      seq,
      replacementSeq: replacementEvent.seq,
      tokensBefore: response.tokens_before,
      tokensAfter: response.tokens_after,
    })
  }
  return outcomes
}

/**
 * Install the per-step tool-result compression listener. Runs before the
 * historical compaction pass so the surface it prices is already slimmed.
 * Skips silently when the proxy is unavailable or the live config disables
 * compression; a failed pass degrades to the original content.
 * @param ctx - plugin context.
 * @param resolveConfig - live policy resolver, read at every step boundary so
 * settings changes apply without a restart.
 */
export function installResultCompression(
  ctx: Context,
  resolveConfig: () => ResultCompressionConfig,
): void {
  // Tried-but-unprofitable tool results per session, so later passes advance
  // past them instead of re-attempting the same low-yield candidates.
  const attempted = new WeakMap<Session, Set<number>>()
  ctx.on('agent/pre-step', async ({ agent, signal }, next): Promise<PreStepDecision> => {
    const config = resolveConfig()
    const client = ctx.headroomClient
    if (config.enabled && client !== undefined && !signal.aborted) {
      try {
        let tried = attempted.get(agent.session)
        if (tried === undefined) {
          tried = new Set<number>()
          attempted.set(agent.session, tried)
        }
        const outcomes = await compressSessionResults(ctx, client, agent, agent.session, config, tried, signal)
        if (outcomes.length > 0) {
          const before = outcomes.reduce((sum, outcome) => sum + outcome.tokensBefore, 0)
          const after = outcomes.reduce((sum, outcome) => sum + outcome.tokensAfter, 0)
          ctx.logger.info('dsh-headroom: compressed %d tool result(s) (%d → %d tokens)', outcomes.length, before, after)
        }
      } catch (error) {
        ctx.logger.warn('dsh-headroom: tool-result compression failed: %s', message(error))
      }
    }
    return next()
  })
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
