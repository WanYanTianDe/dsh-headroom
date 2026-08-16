/**
 * Headroom compaction backend: replaces LLM summarization with the local
 * Headroom compression proxy.
 *
 * All replay/region/durability machinery (pressure triggers, overflow
 * recovery, checkpoint transactions, the manual compact command) is inherited
 * from BasicCompactionEngine; only the summarizer is swapped, so the
 * replacement checkpoint stays replay-aware and reconstructable.
 */

import type { Context } from '@deepseek-ai/cordis'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import type {
  SummarizationInput,
  SummaryResult,
} from '@deepseek-ai/dsh-compaction-basic/src/summarizer.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { HeadroomClient } from './client.ts'
import { renderCheckpointText, toOpenAiMessages } from './format.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Headroom proxy client, present once the local service is ready. */
    headroomClient?: HeadroomClient
  }
}

/** Headroom-specific compaction policy; the rest inherits BasicCompactionConfig. */
export interface HeadroomEngineConfig {
  /** Model id reported to the proxy for token estimation; defaults to the routed model. */
  model?: string
  /** All remaining fields are BasicCompactionConfig fields. */
  [key: string]: unknown
}

export class HeadroomCompactionEngine extends BasicCompactionEngine {
  static inject = ['llm', 'tokenMeter', 'sessions']

  private readonly headroomModel: string | undefined

  constructor(ctx: Context, config: HeadroomEngineConfig = {}) {
    const { model, ...base } = config
    super(ctx, base)
    this.headroomModel = model
  }

  /**
   * Condense the replayed conversation region through the local proxy instead
   * of a paid LLM summarization call. The compressed message list is rendered
   * as text so the inherited checkpoint transaction can frame it.
   */
  protected override async summarize(
    input: SummarizationInput,
    agent: Agent,
    signal?: AbortSignal,
  ): Promise<SummaryResult> {
    signal?.throwIfAborted()
    const client = this.ctx.headroomClient
    if (client === undefined) {
      throw new Error('dsh-headroom: headroom service is not ready; compaction deferred until the proxy responds')
    }
    const model = this.headroomModel ?? routedModel(agent)
    const response = await client.compress(toOpenAiMessages(input), model)
    signal?.throwIfAborted()
    const text = renderCheckpointText(response)
    if (text.trim().length === 0) {
      throw new Error('dsh-headroom: compression produced no output')
    }
    return {
      summary: [{ type: 'text', text }],
      provider: 'headroom',
      model: model ?? 'headroom-proxy',
      // This backend never calls through the context's LLM seam; the
      // llmStreamCall marker stays absent.
    }
  }
}

/** The conversation's routed model, when the session has one. */
function routedModel(agent: Agent): string | undefined {
  const header = agent.session.requestHeader()?.config
  if (header !== undefined && header.model.length > 0) return header.model
  if (agent.options.model !== undefined && agent.options.model.length > 0) {
    return agent.options.model
  }
  return undefined
}
