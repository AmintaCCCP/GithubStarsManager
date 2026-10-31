import { describe, expect, it, vi } from 'vitest';
import { AIService } from './aiService';

const makeConfig = (overrides: Record<string, unknown> = {}) => ({
  id: 'test',
  name: 'test',
  apiType: 'openai' as const,
  baseUrl: 'http://localhost:0',
  apiKey: '',
  model: 'gpt-test',
  isActive: true,
  ...overrides,
});

const okResponse = (content: string, finishReason = 'stop') => new Response(
  JSON.stringify({ choices: [{ message: { content }, finish_reason: finishReason }] }),
  { status: 200, headers: { 'Content-Type': 'application/json' } },
);

const chatBodies = (): Array<Record<string, unknown>> => (window.fetch as ReturnType<typeof vi.fn>).mock.calls
  .map((call: unknown[]) => JSON.parse(String((call[1] as RequestInit | undefined)?.body ?? '{}')));

describe('AIService.generateChatTextDetailed (internal JSON steps)', () => {
  it('adds JSON response_format and disables thinking for internal-json on openai-compatible endpoints, but not for answers', async () => {
    (window.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => okResponse('{"ok":true}'));
    const service = new AIService(makeConfig({ apiType: 'openai-compatible', model: 'glm-4.7' }) as never, 'en');

    await service.generateChatTextDetailed({ system: 's', user: 'u', maxTokens: 800, purpose: 'internal-json' });
    await service.generateChatText({ system: 's', user: 'u', maxTokens: 800 });

    const bodies = chatBodies();
    expect(bodies[0].response_format).toEqual({ type: 'json_object' });
    expect(bodies[0].thinking).toEqual({ type: 'disabled' });
    expect(bodies[1].response_format).toBeUndefined();
    expect(bodies[1].thinking).toBeUndefined();
  });

  it('raises max_tokens to at least 4000 for reasoning models on internal steps', async () => {
    (window.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => okResponse('{"ok":true}'));
    const service = new AIService(makeConfig({ model: 'deepseek-r1' }) as never, 'en');

    await service.generateChatTextDetailed({ system: 's', user: 'u', maxTokens: 800, purpose: 'internal-json' });
    await service.generateChatTextDetailed({ system: 's', user: 'u', maxTokens: 800 });

    const bodies = chatBodies();
    expect(bodies[0].max_tokens).toBe(4000);
    expect(bodies[1].max_tokens).toBe(800);
  });

  it('falls back to a plain request when the endpoint rejects response_format with 400', async () => {
    (window.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'response_format is not supported' } }), { status: 400 }))
      .mockResolvedValueOnce(okResponse('{"ok":true}'));
    const service = new AIService(makeConfig({ apiType: 'openai-compatible' }) as never, 'en');

    const result = await service.generateChatTextDetailed({ system: 's', user: 'u', purpose: 'internal-json' });

    expect(result.text).toBe('{"ok":true}');
    const bodies = chatBodies();
    expect(bodies[0].response_format).toEqual({ type: 'json_object' });
    expect(bodies[1].response_format).toBeUndefined();
  });

  it('retries once with doubled tokens and a JSON-only instruction when length truncation yields no text', async () => {
    (window.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(okResponse('', 'length'))
      .mockResolvedValueOnce(okResponse('{"ok":true}'));
    const service = new AIService(makeConfig()) as unknown as AIService;

    const result = await service.generateChatTextDetailed({ system: 's', user: 'PLAN', maxTokens: 900, purpose: 'internal-json' });

    expect(result).toEqual({ text: '{"ok":true}', finishReason: 'stop' });
    const bodies = chatBodies();
    expect(bodies[0].max_tokens).toBe(900);
    expect(bodies[1].max_tokens).toBe(1800);
    const retryMessages = bodies[1].messages as Array<{ role: string; content: string }>;
    expect(retryMessages.at(-1)?.content).toContain('PLAN');
    expect(retryMessages.at(-1)?.content).toContain('直接输出 JSON，不要思考过程');
  });

  it('does not retry plain requests when a non-JSON-mode 400 happens', async () => {
    (window.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'context length exceeded' } }), { status: 400 }));
    const service = new AIService(makeConfig({ apiType: 'openai-compatible' }) as never, 'en');

    await expect(service.generateChatTextDetailed({ system: 's', user: 'u', purpose: 'internal-json' }))
      .rejects.toThrow('AI API error: 400');
    expect(chatBodies()).toHaveLength(1);
  });

  it('falls back to a plain request when the doubled length retry returns 400', async () => {
    (window.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(okResponse('', 'length'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'response_format is not supported' } }), { status: 400 }))
      .mockResolvedValueOnce(okResponse('{"ok":true}'));
    const service = new AIService(makeConfig()) as unknown as AIService;

    const result = await service.generateChatTextDetailed({ system: 's', user: 'PLAN', maxTokens: 900, purpose: 'internal-json' });

    expect(result.text).toBe('{"ok":true}');
    const bodies = chatBodies();
    expect(bodies).toHaveLength(3);
    expect(bodies[2].response_format).toBeUndefined();
    expect(bodies[2].max_tokens).toBe(900);
  });
});
