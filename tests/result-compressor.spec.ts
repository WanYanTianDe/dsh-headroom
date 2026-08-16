/**
 * Tool-result compression semantics: candidate scanning (threshold + marker),
 * savings judgment, replacement rendering, and the shadow-price append
 * protocol (compaction/prune immediately before a tool/result surface replace).
 */

import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  COMPRESSED_RESULT_PREFIX,
  compressSessionResults,
  isCompressedResult,
  measureText,
  renderCompressedResult,
  resolveResultCompression,
  scanResultCandidates,
  shouldReplace,
} from '../src/result-compressor.ts'
import type { HeadroomClient, HeadroomCompressResponse } from '../src/client.ts'

function toolResultEvent(seq: number, text: string, callId = 'call-1') {
  return {
    type: 'tool/result',
    seq,
    time: 1,
    data: {
      message: {
        role: 'tool',
        source: { callId, plugin: 'mock' },
        content: [{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text }] }],
      },
    },
  }
}

function makeSession(events: Array<Record<string, unknown>>) {
  const bySeq: Record<number, Record<string, unknown>> = {}
  for (const event of events) bySeq[event.seq as number] = event
  const appended: Array<{ type: string; data: unknown; opts?: unknown }> = []
  const session = {
    surface: { nodes: Object.keys(bySeq).map(Number) },
    events: bySeq,
    append: (type: string, data: unknown, opts?: unknown) => {
      appended.push({ type, data, opts })
      return { seq: 100 + appended.length }
    },
  }
  return { session: session as unknown as Session, appended }
}

function mockClient(response: Partial<HeadroomCompressResponse> = {}) {
  const compress = vi.fn(async () => ({
    messages: [{ role: 'tool', content: 'compressed short text' }],
    tokens_before: 1000,
    tokens_after: 100,
    tokens_saved: 900,
    compression_ratio: 0.1,
    transforms_applied: [],
    ccr_hashes: ['ccr_abc'],
    ...response,
  }))
  return { client: { compress } as unknown as HeadroomClient, compress }
}

const mockCtx = { tokenMeter: { estimateMessage: () => 100 } } as unknown as Context

describe('measureText', () => {
  it('counts Unicode code points across text blocks only', () => {
    expect(measureText([{ type: 'text', text: 'abc' }, { type: 'reasoning', text: 'x' }])).toBe(3)
    expect(measureText([{ type: 'text', text: '😀😀' }])).toBe(2)
    expect(measureText([])).toBe(0)
  })
})

describe('isCompressedResult', () => {
  it('recognizes the compression marker on the first text block', () => {
    expect(isCompressedResult([{ type: 'text', text: `${COMPRESSED_RESULT_PREFIX}: 1000 → 100` }])).toBe(true)
    expect(isCompressedResult([{ type: 'text', text: 'plain output' }])).toBe(false)
    expect(isCompressedResult([{ type: 'reasoning', text: COMPRESSED_RESULT_PREFIX }])).toBe(false)
    expect(isCompressedResult([])).toBe(false)
  })
})

describe('shouldReplace', () => {
  it('requires savings strictly above the ratio budget', () => {
    expect(shouldReplace(1000, 100, 0.2)).toBe(true)
    expect(shouldReplace(1000, 799, 0.2)).toBe(true)
    expect(shouldReplace(1000, 800, 0.2)).toBe(false)
    expect(shouldReplace(1000, 1000, 0.2)).toBe(false)
    expect(shouldReplace(1000, 1200, 0.2)).toBe(false)
  })

  it('rejects degenerate token accounting', () => {
    expect(shouldReplace(0, 0, 0.2)).toBe(false)
  })
})

describe('renderCompressedResult', () => {
  it('embeds token accounting and the CCR hashes for retrieval', () => {
    const text = renderCompressedResult('compressed', 2000, 500, ['ccr_x', 'ccr_y'])
    expect(text.startsWith(`${COMPRESSED_RESULT_PREFIX}: 2000 → 500 tokens (25% of original).`)).toBe(true)
    expect(text).toContain('ccr_x')
    expect(text).toContain('ccr_y')
    expect(text).toContain('headroom_retrieve')
    expect(text.endsWith(']\ncompressed')).toBe(true)
  })

  it('omits the retrieval hint without hashes', () => {
    const text = renderCompressedResult('compressed', 1000, 100, [])
    expect(text).not.toContain('headroom_retrieve')
  })
})

describe('resolveResultCompression', () => {
  it('merges partial configuration over the defaults', () => {
    const resolved = resolveResultCompression({ thresholdChars: 42 })
    expect(resolved).toEqual({
      enabled: true,
      thresholdChars: 42,
      minSavingsRatio: 0.2,
      maxPerStep: 3,
    })
    expect(resolveResultCompression(undefined).thresholdChars).toBe(16_384)
  })
})

describe('scanResultCandidates', () => {
  it('collects over-budget uncompressed tool results in surface order', () => {
    const big = toolResultEvent(5, 'x'.repeat(20_000))
    const small = toolResultEvent(6, 'tiny')
    const marked = toolResultEvent(7, 'x'.repeat(20_000))
    marked.data.message.content[0].content[0].text = `${COMPRESSED_RESULT_PREFIX}: 1 → 1]`
    const { session } = makeSession([big, small, marked, { type: 'user/message', seq: 8, time: 1, data: {} }])
    const candidates = scanResultCandidates(session, 16_384)
    expect(candidates.map((candidate) => candidate.seq)).toEqual([5])
  })
})

describe('compressSessionResults', () => {
  it('replaces a qualified node through the shadow-price protocol', async () => {
    const event = toolResultEvent(5, 'x'.repeat(20_000))
    const { session, appended } = makeSession([event])
    const { client, compress } = mockClient()
    const outcomes = await compressSessionResults(mockCtx, client, session, resolveResultCompression(undefined))

    expect(compress).toHaveBeenCalledWith([{ role: 'tool', tool_call_id: 'call-1', content: 'x'.repeat(20_000) }])
    expect(appended).toHaveLength(2)
    expect(appended[0]).toMatchObject({
      type: 'compaction/prune',
      data: { shadowedRange: { start: 5, end: 5 }, shadowedSeqs: [5], shadowedTokenCount: 100 },
    })
    expect(appended[1]).toMatchObject({
      type: 'tool/result',
      opts: { surfaceOp: { op: 'replace', start: 5, end: 5 }, sourceEventSeqs: [5] },
    })
    const replacementMessage = (appended[1] as { data: { message: { content: Array<{ content: Array<{ text: string }> }> } } }).data.message
    expect(replacementMessage.content[0].content[0].text.startsWith(COMPRESSED_RESULT_PREFIX)).toBe(true)
    expect(replacementMessage.content[0].content[0].text).toContain('ccr_abc')
    expect(outcomes).toEqual([{ seq: 5, replacementSeq: 102, tokensBefore: 1000, tokensAfter: 100 }])
  })

  it('keeps the original when the proxy reports no meaningful savings', async () => {
    const event = toolResultEvent(5, 'x'.repeat(20_000))
    const { session, appended } = makeSession([event])
    const { client } = mockClient({ tokens_after: 900 })
    await compressSessionResults(mockCtx, client, session, resolveResultCompression(undefined))
    expect(appended).toHaveLength(0)
  })

  it('skips nodes already carrying the compression marker', async () => {
    const event = toolResultEvent(5, 'x'.repeat(20_000))
    event.data.message.content[0].content[0].text = `${COMPRESSED_RESULT_PREFIX}: 1 → 1]`
    const { session, appended } = makeSession([event])
    const { client } = mockClient()
    await compressSessionResults(mockCtx, client, session, resolveResultCompression(undefined))
    expect(appended).toHaveLength(0)
  })

  it('respects maxPerStep', async () => {
    const { session, appended } = makeSession([
      toolResultEvent(5, 'x'.repeat(20_000), 'call-1'),
      toolResultEvent(6, 'y'.repeat(20_000), 'call-2'),
    ])
    const { client } = mockClient()
    await compressSessionResults(mockCtx, client, session, resolveResultCompression({ maxPerStep: 1 }))
    expect(appended).toHaveLength(2)
  })

  it('degrades to the original when the proxy output is unusable', async () => {
    const event = toolResultEvent(5, 'x'.repeat(20_000))
    const { session, appended } = makeSession([event])
    const { client } = mockClient({ messages: [], tokens_after: 50 })
    await compressSessionResults(mockCtx, client, session, resolveResultCompression(undefined))
    expect(appended).toHaveLength(0)
  })
})
