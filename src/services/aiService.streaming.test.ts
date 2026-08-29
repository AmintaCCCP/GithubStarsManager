import { describe, expect, it, vi } from 'vitest';
import type { AIConfig } from '../types';
import {
  AIService,
  AIStreamUnsupportedError,
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

describe('stream delta extractors', () => {  it('extracts OpenAI chat-completions deltas and stops at [DONE]', () => {
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

const baseConfig = (baseUrl: string): AIConfig => ({
  id: 'ai-guard',
  name: 'Guarded',
  apiType: 'openai',
  baseUrl,
  apiKey: 'secret-key',
  model: 'test-model',
  isActive: true,
});

describe('insecure endpoint guard', () => {

  it('refuses to send credentials over plain http to non-local endpoints', async () => {
    const service = new AIService(baseConfig('http://api.example.com/v1'), 'en');
    await expect(service.generateChatText({ system: 's', user: 'u' })).rejects.toThrow(/HTTPS/);
  });

  it('allows plain http only for local addresses', async () => {
    const service = new AIService(baseConfig('http://localhost:11434/v1'), 'en');
    // 守卫放行后请求会继续（测试环境 fetch 未实现），但绝不抛 HTTPS 守卫错误。
    await expect(service.generateChatText({ system: 's', user: 'u' })).rejects.not.toThrow(/HTTPS/);
  });
});

describe('missing Content-Type sniffing', () => {
  it('parses SSE frames even when the Content-Type header is missing', async () => {
    const service = new AIService(baseConfig('https://api.example.com/v1'), 'en');
    // undici 的 Response 构造器会自动补 Content-Type，用最小 stub 模拟真正无头的响应。
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => 'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: {"choices":[{"delta":{"content":" there"}}]}\n\ndata: [DONE]\n\n',
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const chunks: string[] = [];
      const full = await service.generateChatTextStream({ system: 's', user: 'u', onChunk: (delta) => chunks.push(delta) });
      expect(full).toBe('Hi there');
      expect(chunks).toEqual(['Hi', ' there']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('parses headerless SSE frames separated only by bare CR', async () => {
    const service = new AIService(baseConfig('https://api.example.com/v1'), 'en');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => 'data: {"choices":[{"delta":{"content":"A"}}]}\r\rdata: {"choices":[{"delta":{"content":"B"}}]}\r\rdata: [DONE]\r',
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const chunks: string[] = [];
      const full = await service.generateChatTextStream({ system: 's', user: 'u', onChunk: (delta) => chunks.push(delta) });
      expect(full).toBe('AB');
      expect(chunks).toEqual(['A', 'B']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('falls back to plain text when a headerless body is not SSE', async () => {
    const service = new AIService(baseConfig('https://api.example.com/v1'), 'en');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => 'plain answer',
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const chunks: string[] = [];
      const full = await service.generateChatTextStream({ system: 's', user: 'u', onChunk: (delta) => chunks.push(delta) });
      expect(full).toBe('plain answer');
      expect(chunks).toEqual(['plain answer']);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('requestTextStream gating', () => {
  it('rejects streaming for deepseek-reasoner so reasoning_content stays on the blocking path', async () => {
    const config: AIConfig = {
      id: 'ai-reasoner',
      name: 'DeepSeek Reasoner',
      apiType: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'test-key',
      model: 'deepseek-reasoner',
      isActive: true,
    };
    const service = new AIService(config, 'en');

    await expect(service.generateChatTextStream({ system: 's', user: 'u', onChunk: () => {} }))
      .rejects.toBeInstanceOf(AIStreamUnsupportedError);
  });
});
