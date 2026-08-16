/**
 * format.ts 纯函数测试:DSH 消息 → OpenAI 线格式 → checkpoint 文本。
 */

import { describe, expect, it } from 'vitest'
import { renderCheckpointText, toOpenAiMessages } from '../src/format.ts'
import type { SummarizationInput } from '@deepseek-ai/dsh-compaction-basic/src/summarizer.ts'
import type { Message } from '@deepseek-ai/dsh-llm'

function userMessage(text: string): Message {
  return { role: 'user', id: `u-${text.length}`, content: [{ type: 'text', text }], source: { kind: 'user' } } as Message
}

function toolResultMessage(callId: string, text: string): Message {
  return {
    role: 'user',
    id: `t-${callId}`,
    content: [{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text }] }],
    source: { kind: 'tool' },
  } as Message
}

function assistantToolCallMessage(callId: string, name: string): Message {
  return {
    role: 'assistant',
    id: `a-${callId}`,
    content: [{ type: 'tool-call', id: callId, name, arguments: '{}' }],
    source: { kind: 'model', provider: 'p', model: 'm' },
  } as Message
}

function input(messages: Message[], system = 'sys'): SummarizationInput {
  return { system, messages }
}

describe('toOpenAiMessages', () => {
  it('emits system first, then converted messages', () => {
    const out = toOpenAiMessages(input([userMessage('hi')], 'SYSTEM'))
    expect(out[0]).toEqual({ role: 'system', content: 'SYSTEM' })
    expect(out[1]).toEqual({ role: 'user', content: 'hi' })
  })

  it('skips a missing system', () => {
    const out = toOpenAiMessages(input([userMessage('hi')], ''))
    expect(out).toHaveLength(1)
    expect(out[0]!.role).toBe('user')
  })

  it('splits tool-result blocks into role=tool messages with call ids', () => {
    const out = toOpenAiMessages(input([toolResultMessage('c1', '{"a":1}')], ''))
    expect(out).toEqual([{ role: 'tool', tool_call_id: 'c1', content: '{"a":1}' }])
  })

  it('converts assistant tool calls to tool_calls', () => {
    const out = toOpenAiMessages(input([assistantToolCallMessage('c1', 'ls')], ''))
    expect(out[0]!.role).toBe('assistant')
    expect(out[0]!.tool_calls).toEqual([{
      id: 'c1',
      type: 'function',
      function: { name: 'ls', arguments: '{}' },
    }])
  })

  it('joins multiple text blocks with newlines', () => {
    const msg = {
      role: 'user' as const,
      id: 'u1',
      content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }],
      source: { kind: 'user' },
    } as Message
    const out = toOpenAiMessages(input([msg], ''))
    expect(out[0]!.content).toBe('a\nb')
  })
})

describe('renderCheckpointText', () => {
  const response = {
    messages: [
      { role: 'user', content: 'kept' },
      { role: 'tool', tool_call_id: 'c1', content: 'result' },
    ],
    tokens_before: 1000,
    tokens_after: 400,
    tokens_saved: 600,
    compression_ratio: 0.4,
    transforms_applied: ['smart'],
    ccr_hashes: ['abc123'],
  }

  it('renders the header with token accounting', () => {
    const text = renderCheckpointText(response)
    expect(text).toContain('[compressed by headroom: 1000 → 400 tokens (40% of original)]')
  })

  it('renders each message with its role', () => {
    const text = renderCheckpointText(response)
    expect(text).toContain('[user]\nkept')
    expect(text).toContain('[tool (tool c1)]\nresult')
  })

  it('appends a retrieve hint when ccr hashes exist', () => {
    const text = renderCheckpointText(response)
    expect(text).toContain('headroom_retrieve')
    expect(text).toContain('abc123')
  })

  it('omits the retrieve hint when no hashes exist', () => {
    const text = renderCheckpointText({ ...response, ccr_hashes: [] })
    expect(text).not.toContain('headroom_retrieve')
  })
})
