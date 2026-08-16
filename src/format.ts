/**
 * Message conversion between the DSH compaction vocabulary and the
 * OpenAI-style wire shape the Headroom proxy consumes, plus rendering of the
 * compressed result into the checkpoint summary text.
 */

import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import type { SummarizationInput } from '@deepseek-ai/dsh-compaction-basic/src/summarizer.ts'
import type { HeadroomCompressResponse } from './client.ts'

/** OpenAI-style wire message accepted by /v1/compress. */
export interface OpenAiWireMessage {
  role: string
  content: unknown
  tool_call_id?: string
  tool_calls?: unknown[]
}

/** Convert a DSH summarization input to the OpenAI message shape. */
export function toOpenAiMessages(input: SummarizationInput): OpenAiWireMessage[] {
  const messages: OpenAiWireMessage[] = []
  if (input.system !== undefined && input.system.length > 0) {
    messages.push({ role: 'system', content: input.system })
  }
  for (const message of input.messages) {
    messages.push(...messageToOpenAi(message))
  }
  return messages
}

function messageToOpenAi(message: Message): OpenAiWireMessage[] {
  const toolResults = message.content.filter(
    (block): block is Extract<ContentBlock, { type: 'tool-result' }> => block.type === 'tool-result',
  )
  if (toolResults.length > 0) {
    return toolResults.map((block) => ({
      role: 'tool',
      tool_call_id: block.toolCallId,
      content: blocksToText(block.content),
    }))
  }
  if (message.role === 'assistant') {
    const toolCalls = message.content.filter(
      (block): block is Extract<ContentBlock, { type: 'tool-call' }> => block.type === 'tool-call',
    )
    if (toolCalls.length > 0) {
      return [{
        role: 'assistant',
        content: blocksToText(message.content.filter((block) => block.type !== 'tool-call')),
        tool_calls: toolCalls.map((block) => ({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: block.arguments },
        })),
      }]
    }
  }
  return [{ role: message.role, content: blocksToText(message.content) }]
}

function blocksToText(blocks: readonly ContentBlock[]): string {
  return blocks.map(blockToText).filter((text) => text.length > 0).join('\n')
}

function blockToText(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
      return block.text
    case 'reasoning':
      return ''
    case 'image':
      return '[image]'
    case 'tool-call':
      return JSON.stringify({ id: block.id, name: block.name, arguments: block.arguments })
    case 'tool-result':
      return blocksToText(block.content)
    default:
      return JSON.stringify(block)
  }
}

/** Render compressed wire messages as the checkpoint summary text. */
export function renderCheckpointText(response: HeadroomCompressResponse): string {
  const lines = response.messages.map((message) => renderWireMessage(message as OpenAiWireMessage))
  const remaining = Math.round(response.compression_ratio * 100)
  const header = `[compressed by headroom: ${response.tokens_before} → ${response.tokens_after} tokens (${remaining}% of original)]`
  const ccr = response.ccr_hashes.length > 0
    ? `\nOriginal content is retrievable via the headroom_retrieve tool with one of these hashes: ${response.ccr_hashes.join(', ')}`
    : ''
  return `${header}\n\n${lines.join('\n\n')}${ccr}`
}

function renderWireMessage(message: OpenAiWireMessage): string {
  const content = typeof message.content === 'string'
    ? message.content
    : JSON.stringify(message.content ?? null)
  const call = message.tool_call_id === undefined ? '' : ` (tool ${message.tool_call_id})`
  return `[${message.role}${call}]\n${content}`
}
