import { describe, expect, it } from 'vitest';
import {
  consumeSseStream,
  extractClaudeDelta,
  extractGeminiDelta,
  extractOpenAiChatDelta,
  extractOpenAiResponsesDelta,
} from './aiService';

const streamFrom = (chunks: string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    },
  });
};

describe('consumeSseStream', () => {
  it('dispatches complete events and buffers lines split across chunks', async () => {
    const payloads: string[] = [];
    await consumeSseStream(streamFrom([
      'data: {"a":1}\n\ndata: {"b"',
      ':2}\n\n',
      'data: [DON',
      'E]\n\n',
    ]), (payload) => payloads.push(payload));
    expect(payloads).toEqual(['{"a":1}', '{"b":2}', '[DONE]']);
  });

  it('handles CRLF separators and ignores event/comment lines', async () => {
    const payloads: string[] = [];
    await consumeSseStream(streamFrom([
      'event: delta\r\ndata: first\r\n\r\n: keep-alive\n\ndata: second\n\n',
    ]), (payload) => payloads.push(payload));
    expect(payloads).toEqual(['first', 'second']);
  });
});

describe('stream delta extractors', () => {
  it('extracts OpenAI chat-completions deltas and stops at [DONE]', () => {
    expect(extractOpenAiChatDelta('{"choices":[{"delta":{"content":"Hello"}}]}')).toBe('Hello');
    expect(extractOpenAiChatDelta('{"choices":[{"delta":{}}]}')).toBe('');
    expect(extractOpenAiChatDelta('[DONE]')).toBe('');
    expect(extractOpenAiChatDelta('not json')).toBe('');
  });

  it('extracts OpenAI Responses output_text deltas only', () => {
    expect(extractOpenAiResponsesDelta('{"type":"response.output_text.delta","delta":"Hi"}')).toBe('Hi');
    expect(extractOpenAiResponsesDelta('{"type":"response.completed","delta":"ignored"}')).toBe('');
    expect(extractOpenAiResponsesDelta('not json')).toBe('');
  });

  it('extracts Claude text_delta blocks only', () => {
    expect(extractClaudeDelta('{"type":"content_block_delta","delta":{"type":"text_delta","text":"Bonjour"}}')).toBe('Bonjour');
    expect(extractClaudeDelta('{"type":"content_block_start","delta":{"type":"text_delta","text":"x"}}')).toBe('');
    expect(extractClaudeDelta('{"type":"content_block_delta","delta":{"type":"thinking_delta","text":"secret"}}')).toBe('');
    expect(extractClaudeDelta('not json')).toBe('');
  });

  it('extracts Gemini text parts while skipping thought parts', () => {
    expect(extractGeminiDelta('{"candidates":[{"content":{"parts":[{"text":"Ciao"},{"thought":true,"text":"hidden"}]}}]}')).toBe('Ciao');
    expect(extractGeminiDelta('{"candidates":[]}')).toBe('');
    expect(extractGeminiDelta('not json')).toBe('');
  });
});
