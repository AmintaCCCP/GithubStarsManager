import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Repository } from '../types';
import {
  AIService,
  AIRequestError,
  isAbortError,
  isRateLimitedError,
  getRetryAfterMsFromError,
  isAIToolCallUnsupportedError,
  supportsChatToolCalls,
  type AIToolLoopMessage,
} from './aiService';
import { isToolCallCapableApiType } from '../constants/aiCapabilities';
import { logger } from './logger';

// Minimal AIConfig that lets AIService construct without a real token.
const makeConfig = () => ({
  id: 'test',
  name: 'test',
  apiType: 'openai' as const,
  baseUrl: 'http://localhost:0',
  apiKey: '',
  model: 'gpt-test',
  isActive: true,
});

it('redacts plugin AI request details from debug logs', () => {
  const debug = vi.spyOn(logger, 'debug').mockImplementation(() => {});
  const isDebugMode = vi.spyOn(logger, 'isDebugMode').mockReturnValue(true);
  try {
    const service = new AIService(makeConfig() as never, 'en', true);
    const logRequest = service as unknown as { logAIRequestDebug: (
      startTime: number,
      context: { apiType: string; model: string; configId: string },
      result: { responseLength: number },
      details: Record<string, unknown>,
    ) => void };
    logRequest.logAIRequestDebug(Date.now(), { apiType: 'openai', model: 'example', configId: 'test' },
      { responseLength: 5 }, { url: 'https://secret.example/key', requestBody: 'private prompt', responseBody: 'private answer', status: 200 });
    expect(debug).toHaveBeenCalledOnce();
    const metadata = debug.mock.calls[0][2];
    expect(metadata).toEqual(expect.objectContaining({ status: 200, responseLength: 5 }));
    expect(JSON.stringify(metadata)).not.toContain('private');
    expect(JSON.stringify(metadata)).not.toContain('secret.example');
  } finally {
    debug.mockRestore();
    isDebugMode.mockRestore();
  }
});

function makeRepo(partial: Partial<Repository> & Pick<Repository, 'id' | 'name' | 'full_name'>): Repository {
  return {
    description: null,
    html_url: `https://github.com/${partial.full_name}`,
    stargazers_count: 0,
    forks_count: 0,
    forks: 0,
    language: 'TypeScript',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-06-01T00:00:00Z',
    pushed_at: '2024-06-01T00:00:00Z',
    owner: { login: 'owner', avatar_url: '' },
    topics: [],
    ...partial,
  };
}

describe('AIService.searchRepositoriesWithSelection — 词法兜底', () => {
  beforeEach(() => {
    // Force the AI request path to fail so we fall back to performEnhancedBasicSearch.
    (window.fetch as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('network disabled in test');
    });
  });

  it('ranks a license-matching repo above a higher-star non-matching repo when the query mixes license + other terms', async () => {
    // A matches both the name term ("react") and the license term ("mit").
    const repoA = makeRepo({
      id: 1,
      name: 'react-app',
      full_name: 'acme/react-app',
      stargazers_count: 500,
      license: 'MIT',
    });
    // B has far more stars and matches the name term, but NOT the license term.
    const repoB = makeRepo({
      id: 2,
      name: 'react-lib',
      full_name: 'acme/react-lib',
      stargazers_count: 1000,
      license: 'Apache-2.0',
    });

    const service = new AIService(makeConfig() as never, 'en');
    const results = await service.searchRepositoriesWithSelection([repoA, repoB], 'react mit');

    const ids = results.map((r) => r.id);
    // With the license weight, A's license match outweighs B's popularity edge.
    expect(ids).toEqual([1, 2]);
    expect(results).toHaveLength(2);
  });

  it('does not crash when a repo carries a raw GitHub license object (toLowerCase defensive)', async () => {
    // Regression for "e.toLowerCase is not a function": a repo whose license never passed
    // through toLicenseSpdxId (legacy persisted store / third-party import) keeps a raw
    // GitHub object `{ key, spdx_id, ... }`. performEnhancedBasicSearch must reduce it via
    // normalizeLicense rather than (repo.license || '').toLowerCase().
    const repoA = makeRepo({
      id: 3,
      name: 'react-legacy',
      full_name: 'acme/react-legacy',
      stargazers_count: 10,
      license: { spdx_id: 'MIT', key: 'MIT', name: 'MIT License', url: 'https://api.github.com/licenses/mit' } as never,
    });

    const service = new AIService(makeConfig() as never, 'en');
    // Should resolve the license object to 'MIT' and rank the repo — not throw.
    const results = await service.searchRepositoriesWithSelection([repoA], 'mit');
    expect(results.map((r) => r.id)).toEqual([3]);
  });

  it('finds a repo by its custom tag via static fallback search', async () => {
    const repo = makeRepo({
      id: 4,
      name: 'skill-pack',
      full_name: 'acme/skill-pack',
      description: 'A collection of prompts',
      ai_tags: ['效率工具'],
      custom_tags: ['技能'],
    });

    const results = await AIService.searchRepositories([repo], '技能');
    expect(results.map((r) => r.id)).toEqual([4]);
  });

  it('finds a repo matching only through custom_tags via enhanced search', async () => {
    const repo = makeRepo({
      id: 6,
      name: 'skill-pack',
      full_name: 'acme/skill-pack',
      description: 'A collection of prompts',
      ai_tags: ['效率工具'],
      custom_tags: ['技能'],
    });

    const service = new AIService(makeConfig() as never, 'zh');
    const results = service['performEnhancedBasicSearch']([repo], '技能', ['技能']);
    expect(results.map((r) => r.id)).toEqual([6]);
  });

  it('扩展词与查询词相同时不重复计分（词级剔除）', async () => {
    const repo = makeRepo({ id: 20, name: 'markdown', full_name: 'acme/markdown' });

    const service = new AIService(makeConfig() as never, 'zh');
    const scored = service['scoreRepositoriesByKeywords']([repo], 'markdown editor', ['Markdown', 'acme']);

    // 'Markdown' 等于查询词 'markdown'，剔除后不再对 name/fullName 重复计分；
    // 'acme'（fullName 命中）仍正常计分：name 0.4 + fullName 0.35 + 扩展词 0.2 = 0.95
    //（若词级剔除失效则为 1.4）
    expect(scored[0].score).toBeCloseTo(0.95, 10);
  });

  it('中文查询无 AI 扩展词时按 CJK bigram 召回，兜底不再整串零命中', async () => {
    const repo = makeRepo({
      id: 30,
      name: 'stars-manager',
      full_name: 'acme/stars-manager',
      description: '管理 GitHub 星标仓库的工具',
    });

    const service = new AIService(makeConfig() as never, 'zh');
    // "星标仓库"无空格切不出词，整串也不在描述里；bigram "星标"/"仓库" 命中描述
    const scored = service['scoreRepositoriesByKeywords']([repo], '星标仓库', []);
    expect(scored).toHaveLength(1);
    expect(scored[0].score).toBeGreaterThan(0);
  });
});

describe('AIService.searchRepositoriesWithSelection — LLM 精选', () => {
  const fetchJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const chatResponse = (content: string) => fetchJson({ choices: [{ message: { content } }] });
  const mockFetch = () => {
    const fetchMock = window.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockReset();
    return fetchMock;
  };
  const captureBody = async (init?: RequestInit) => JSON.parse(String(init?.body)) as Record<string, unknown>;

  it('扩展查询后把候选摘要交给 LLM 精选，并按模型排序返回（携带意图说明）', async () => {
    const fetchMock = mockFetch();
    const requests: Array<Record<string, unknown>> = [];
    fetchMock.mockImplementationOnce(async (_url, init) => {
      requests.push(await captureBody(init));
      return chatResponse('{"intent":"找 markdown 编辑器","keywords":["markdown","editor"],"synonyms":[]}');
    });
    fetchMock.mockImplementationOnce(async (_url, init) => {
      requests.push(await captureBody(init));
      return chatResponse('[880000002, 880000001]');
    });

    const repoA = makeRepo({ id: 880000001, name: 'quick-md', full_name: 'acme/quick-md', description: 'a markdown editor', stargazers_count: 900 });
    const repoB = makeRepo({ id: 880000002, name: 'random-tool', full_name: 'acme/random-tool', description: 'unrelated', stargazers_count: 5000 });

    const service = new AIService(makeConfig() as never, 'zh');
    const results = await service.searchRepositoriesWithSelection([repoA, repoB], 'markdown 编辑器');

    expect(results.map((r) => r.id)).toEqual([880000002, 880000001]);
    // 扩展请求要求模型复述意图；精选请求携带意图说明与候选摘要
    expect(String((requests[0].messages as Array<{ content: string }>)[1].content)).toContain('"intent"');
    const selectionPrompt = String((requests[1].messages as Array<{ content: string }>)[1].content);
    expect(selectionPrompt).toContain('用户意图说明：找 markdown 编辑器');
    expect(selectionPrompt).toContain('共 2 个');
    expect(selectionPrompt).toContain('acme/quick-md');
    // 精选请求统一给足预算，避免自定义推理模型把 800 全耗在 reasoning 上
    expect(requests[1].max_tokens).toBe(4096);
  });

  it('模型把候选行号当作 ID 返回时按行号解析，重排结果不被静默丢弃', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockImplementationOnce(async () => chatResponse('{"intent":"","keywords":[],"synonyms":[]}'));
    fetchMock.mockImplementationOnce(async () => chatResponse('[2, 1]'));

    const repoA = makeRepo({ id: 730000001, name: 'alpha', full_name: 'acme/alpha' });
    const repoB = makeRepo({ id: 730000002, name: 'beta', full_name: 'acme/beta' });

    const service = new AIService(makeConfig() as never, 'zh');
    const results = await service.searchRepositoriesWithSelection([repoA, repoB], 'anything');

    expect(results.map((r) => r.id)).toEqual([730000002, 730000001]);
  });

  it('模型明确返回空数组时呈现空结果，而不是回退到词法噪声', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockImplementationOnce(async () => chatResponse('{"intent":"","keywords":["foo"],"synonyms":[]}'));
    fetchMock.mockImplementationOnce(async () => chatResponse('[]'));

    const repoA = makeRepo({ id: 740000001, name: 'foo-tool', full_name: 'acme/foo-tool' });

    const service = new AIService(makeConfig() as never, 'zh');
    const results = await service.searchRepositoriesWithSelection([repoA], '不存在的东西');

    expect(results).toEqual([]);
  });

  it('大库先词法召回：候选按上限截断注入精选提示词', async () => {
    const fetchMock = mockFetch();
    const requests: Array<Record<string, unknown>> = [];
    fetchMock.mockImplementationOnce(async (_url, init) => {
      requests.push(await captureBody(init));
      return chatResponse('{"intent":"","keywords":["thing"],"synonyms":[]}');
    });
    fetchMock.mockImplementationOnce(async (_url, init) => {
      requests.push(await captureBody(init));
      return chatResponse('[900001]');
    });

    const target = makeRepo({ id: 900001, name: 'target-thing', full_name: 'acme/target-thing', description: 'the thing you want', stargazers_count: 10 });
    const pads = Array.from({ length: 159 }, (_, i) =>
      makeRepo({ id: 900002 + i, name: `junk-${i}`, full_name: `acme/junk-${i}`, stargazers_count: i }));

    const service = new AIService(makeConfig() as never, 'zh');
    const results = await service.searchRepositoriesWithSelection([target, ...pads], 'thing');

    const selectionPrompt = String((requests[1].messages as Array<{ content: string }>)[1].content);
    expect(selectionPrompt).toContain('共 100 个');
    expect(results.map((r) => r.id)).toEqual([900001]);
  });

  it('调用方取消（abort）时不做词法兜底，取消异常向上传播', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockImplementationOnce(async () => {
      throw Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
    });
    const controller = new AbortController();

    const repoA = makeRepo({ id: 750000001, name: 'foo-tool', full_name: 'acme/foo-tool' });

    const service = new AIService(makeConfig() as never, 'zh');
    // 取消 ≠ AI 失败：不能把词法兜底结果当作搜索结果返回
    await expect(
      service.searchRepositoriesWithSelection([repoA], 'foo', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('推理模型的精选调用复用更大的 token 预算，避免推理耗尽预算后静默退化', async () => {
    const fetchMock = mockFetch();
    const requests: Array<Record<string, unknown>> = [];
    fetchMock.mockImplementationOnce(async (_url, init) => {
      requests.push(await captureBody(init));
      return chatResponse('{"intent":"","keywords":[],"synonyms":[]}');
    });
    fetchMock.mockImplementationOnce(async (_url, init) => {
      requests.push(await captureBody(init));
      return chatResponse('[]');
    });

    const repo = makeRepo({ id: 760000001, name: 'foo-tool', full_name: 'acme/foo-tool' });
    const service = new AIService({ ...makeConfig(), reasoningEffort: 'high' } as never, 'zh');
    await service.searchRepositoriesWithSelection([repo], 'foo');

    // 扩展请求给思考模型留足余量；精选请求复用重排序的 4096 预算（推理 token 共享预算）
    expect(requests[0].max_tokens).toBe(2000);
    expect(requests[1].max_tokens).toBe(4096);
  });

  it('AI 请求失败时通过 onFallback 通知调用方，并回退词法得分序', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('Failed to fetch');
    });
    const onFallback = vi.fn();

    const repoA = makeRepo({ id: 770000001, name: 'foo-tool', full_name: 'acme/foo-tool' });

    const service = new AIService(makeConfig() as never, 'zh');
    const results = await service.searchRepositoriesWithSelection([repoA], 'foo', { onFallback });

    // 端点抖动/配置问题时：回调说明原因，结果退到词法命中而非空
    expect(onFallback).toHaveBeenCalledWith('ai_failed');
    expect(results.map((r) => r.id)).toEqual([770000001]);
  });

  it('模型判定无相关仓库时保留空结果，并通过 onFallback 说明原因', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockImplementationOnce(async () => chatResponse('{"intent":"","keywords":[],"synonyms":[]}'));
    fetchMock.mockImplementationOnce(async () => chatResponse('[]'));
    const onFallback = vi.fn();

    const repo = makeRepo({ id: 780000001, name: 'foo-tool', full_name: 'acme/foo-tool' });

    const service = new AIService(makeConfig() as never, 'zh');
    const results = await service.searchRepositoriesWithSelection([repo], '完全无关的查询', { onFallback });

    expect(onFallback).toHaveBeenCalledWith('ai_empty');
    expect(results).toEqual([]);
  });

  it('模型返回的 ID 全部无法落位时按响应无效处理，回退词法而非空态', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockImplementationOnce(async () => chatResponse('{"intent":"","keywords":["foo"],"synonyms":[]}'));
    fetchMock.mockImplementationOnce(async () => chatResponse('[999999999, 888888888]'));
    const onFallback = vi.fn();

    const repo = makeRepo({ id: 790000001, name: 'foo-tool', full_name: 'acme/foo-tool' });

    const service = new AIService(makeConfig() as never, 'zh');
    const results = await service.searchRepositoriesWithSelection([repo], 'foo', { onFallback });

    // 幻觉 ID ≠ 模型判空：不能把无效响应当成"无相关结果"呈现空态
    expect(onFallback).toHaveBeenCalledWith('unparseable');
    expect(results.map((r) => r.id)).toEqual([790000001]);
  });
});

describe('AIService.searchRepositoriesWithSemanticReranking — 行号兜底', () => {
  const fetchJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  beforeEach(() => {
    (window.fetch as ReturnType<typeof vi.fn>).mockReset();
  });

  it('模型把候选行号当作 ID 返回时按行号解析，重排结果不再被静默丢弃', async () => {
    // 回归：旧的 repoById.get(id) 解析会把行号响应整份丢弃，重排静默失效
    const repoA = makeRepo({ id: 730000001, name: 'alpha', full_name: 'acme/alpha', stargazers_count: 10 });
    const repoB = makeRepo({ id: 730000002, name: 'beta', full_name: 'acme/beta', stargazers_count: 5 });
    (window.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      fetchJson({ choices: [{ message: { content: '[2, 1]' } }] }),
    );

    const service = new AIService(makeConfig() as never, 'zh');
    const results = await service.searchRepositoriesWithSemanticReranking([repoA, repoB], 'anything');

    expect(results.map((r) => r.id)).toEqual([730000002, 730000001]);
  });

  it('真实 ID 优先于行号解析，未被排到的仓库追加在末尾', async () => {
    const repoA = makeRepo({ id: 730000001, name: 'alpha', full_name: 'acme/alpha' });
    const repoB = makeRepo({ id: 730000002, name: 'beta', full_name: 'acme/beta' });
    const repoC = makeRepo({ id: 730000003, name: 'gamma', full_name: 'acme/gamma' });
    (window.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      fetchJson({ choices: [{ message: { content: '[730000003, 1]' } }] }),
    );

    const service = new AIService(makeConfig() as never, 'zh');
    const results = await service.searchRepositoriesWithSemanticReranking([repoA, repoB, repoC], 'anything');

    // 730000003 按真实 ID 命中；1 在候选范围内按行号解析为 repoA；repoB 未被排到，追加在末尾
    expect(results.map((r) => r.id)).toEqual([730000003, 730000001, 730000002]);
  });
});

describe('AIRequestError / 限流辅助函数', () => {
  it('构造错误并标记 isRateLimit', () => {
    const err = new AIRequestError('rate limited', 429, 5000);
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(5000);
    expect(err.isRateLimit).toBe(true);
    expect(err.name).toBe('AIRequestError');
  });

  it('isRateLimitedError 识别 429 或限流信息', () => {
    expect(isRateLimitedError(new AIRequestError('x', 429))).toBe(true);
    expect(isRateLimitedError({ statusCode: 429 })).toBe(true);
    expect(isRateLimitedError(new Error('Too Many Requests'))).toBe(true);
    expect(isRateLimitedError(new Error('network down'))).toBe(false);
    expect(isRateLimitedError(null)).toBe(false);
  });

  it('getRetryAfterMsFromError 取有效毫秒数', () => {
    expect(getRetryAfterMsFromError(new AIRequestError('x', 429, 1234))).toBe(1234);
    expect(getRetryAfterMsFromError({})).toBeUndefined();
    expect(getRetryAfterMsFromError(undefined)).toBeUndefined();
  });
});


describe('AIService.generateWithTools — native function calling', () => {
  // generateWithTools / supportsChatToolCalls 均要求显式勾选 supportsToolCalls。
  const toolCallConfig = { ...makeConfig(), supportsToolCalls: true as const };
  const tools = [
    { name: 'read_documentation', description: 'Read docs', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  ];
  const messages: AIToolLoopMessage[] = [
    { role: 'user', content: 'Question: What is this repo?' },
    { role: 'assistant', content: null, toolCalls: [{ id: 'call_1', name: 'read_documentation', arguments: '{"path":"README.md"}' }] },
    { role: 'tool', toolCallId: 'call_1', content: 'SOURCE: /README.md - 1-5' },
  ];
  const fetchJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  beforeEach(() => {
    (window.fetch as ReturnType<typeof vi.fn>).mockReset();
  });

  it('sends the tools payload with tool results and parses returned tool calls', async () => {
    const service = new AIService(toolCallConfig);
    (window.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(fetchJson({
      choices: [{
        message: {
          content: '',
          tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'ready_to_answer', arguments: '{"missing":[]}' } }],
        },
      }],
    }));

    const result = await service.generateWithTools({ system: 'agent rules', messages, tools, temperature: 0, maxTokens: 1_200 });

    const [, init] = (window.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(Array.isArray(requestBody.tools)).toBe(true);
    expect(requestBody.tool_choice).toBe('auto');
    const sentMessages = requestBody.messages as Array<Record<string, unknown>>;
    expect(sentMessages[0]).toEqual({ role: 'system', content: 'agent rules' });
    expect(sentMessages[2]).toMatchObject({ role: 'assistant', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_documentation' } }] });
    // content 为空时必须整体省略：显式 null / 空字符串在部分网关上会被拒绝。
    expect(sentMessages[2]).not.toHaveProperty('content');
    expect(sentMessages[3]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: 'SOURCE: /README.md - 1-5' });
    expect(result.content).toBe('');
    expect(result.toolCalls).toEqual([{ id: 'call_2', name: 'ready_to_answer', arguments: '{"missing":[]}' }]);
  });

  it('converts endpoint rejection of tools into AIToolCallUnsupportedError', async () => {
    const service = new AIService(toolCallConfig);
    (window.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(fetchJson({ error: { message: 'tools is not supported by this model' } }, 400));

    await expect(service.generateWithTools({ system: 'rules', messages, tools }))
      .rejects.toSatisfy(isAIToolCallUnsupportedError);
  });

  it('throws AIToolCallUnsupportedError for protocol families without tool support', async () => {
    const service = new AIService({ ...makeConfig(), apiType: 'claude' });
    await expect(service.generateWithTools({ system: 'rules', messages, tools }))
      .rejects.toSatisfy(isAIToolCallUnsupportedError);
    expect(window.fetch).not.toHaveBeenCalled();
    // 能力判定 = 协议族支持 且 显式勾选；两者缺一不可。
    expect(supportsChatToolCalls({ apiType: 'openai-compatible', supportsToolCalls: true })).toBe(true);
    expect(supportsChatToolCalls({ apiType: 'openai-compatible' })).toBe(false);
    expect(supportsChatToolCalls({ apiType: 'gemini', supportsToolCalls: true })).toBe(false);
    expect(isToolCallCapableApiType('openai-compatible')).toBe(true);
    expect(isToolCallCapableApiType('claude')).toBe(false);
  });
});

describe('AIService.analyzeRepository language following', () => {
  const extractMessages = (body: unknown): Array<{ role: string; content: string }> => {
    const parsed = body as { messages?: Array<{ role: string; content: string }>; input?: Array<{ role: string; content: string }> };
    return parsed.messages ?? parsed.input ?? [];
  };

  const lastMessages = (): Array<{ role: string; content: string }> => {
    const calls = (window.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = calls[calls.length - 1] as [string, RequestInit] | undefined;
    return extractMessages(JSON.parse(String(lastCall?.[1]?.body)));
  };

  beforeEach(() => {
    (window.fetch as ReturnType<typeof vi.fn>).mockReset();
    (window.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: '{"summary":"A sample analysis of the repository.","tags":["tool"],"platforms":["web"]}' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
  });

  it('keeps the English user prompt verbatim for en', async () => {
    const service = new AIService(makeConfig() as never, 'en');
    await service.analyzeRepository(makeRepo({ id: 1, name: 'sample', full_name: 'acme/sample' }), '# readme');
    const joined = lastMessages().map((message) => message.content).join('\n');
    expect(joined).toContain('A concise English overview');
    expect(joined).toContain('"summary": "English overview"');
    expect(joined).not.toContain('Write ALL user-facing output');
  });

  it('does not force English output when the UI language is Japanese', async () => {
    const service = new AIService(makeConfig() as never, 'ja');
    await service.analyzeRepository(makeRepo({ id: 1, name: 'sample', full_name: 'acme/sample' }), '# readme');
    const joined = lastMessages().map((message) => message.content).join('\n');
    expect(joined).not.toContain('A concise English overview');
    expect(joined).not.toContain('"summary": "English overview"');
    expect(joined).toContain('Write ALL user-facing output in Japanese (日本語)');
  });
});

describe('AIService.expandSearchQuery — 查询扩展公开方法', () => {
  const fetchJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const chatResponse = (content: string) => fetchJson({ choices: [{ message: { content } }] });
  const mockFetch = () => {
    const fetchMock = window.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockReset();
    return fetchMock;
  };
  const captureBody = async (init?: RequestInit) => JSON.parse(String(init?.body)) as Record<string, unknown>;

  it('解析模型返回的意图与关键词（keywords/categories/synonyms 合并去重）', async () => {
    const fetchMock = mockFetch();
    const requests: Array<Record<string, unknown>> = [];
    fetchMock.mockImplementationOnce(async (_url, init) => {
      requests.push(await captureBody(init));
      return chatResponse('{"intent":"找 markdown 编辑器","keywords":["markdown","editor"],"categories":["cli"],"synonyms":["md","markdown"]}');
    });

    const service = new AIService(makeConfig() as never, 'zh');
    const result = await service.expandSearchQuery('markdown 编辑器');

    expect(result.intent).toBe('找 markdown 编辑器');
    expect(result.terms).toEqual(['markdown', 'editor', 'cli', 'md']);
    // 请求形态与既有扩展阶段一致：思考预算 2000、低温
    expect(requests[0].max_tokens).toBe(2000);
    expect(requests[0].temperature).toBe(0.1);
  });

  it('模型返回空内容时 requestText 抛错（与既有扩展阶段行为一致）', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockImplementationOnce(async () => chatResponse(''));

    const service = new AIService(makeConfig() as never, 'zh');
    // requestText 对空 content 统一抛错，扩展阶段（重构前后）同样不会拿到空结果
    await expect(service.expandSearchQuery('anything')).rejects.toThrow('No content received from AI service');
  });
});

describe('AIService.selectRelevantRepositories — evidence 证据行', () => {
  const fetchJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const chatResponse = (content: string) => fetchJson({ choices: [{ message: { content } }] });
  const mockFetch = () => {
    const fetchMock = window.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockReset();
    return fetchMock;
  };
  const captureBody = async (init?: RequestInit) => JSON.parse(String(init?.body)) as Record<string, unknown>;

  it('不传 evidence 时精选提示词与 searchRepositoriesWithSelection 逐字节一致；传 evidence（全网发现）切换宽松排序提示词并追加证据行', async () => {
    const repoA = makeRepo({ id: 910000001, name: 'md-tool', full_name: 'acme/md-tool', description: 'a markdown tool' });
    const repoB = makeRepo({ id: 910000002, name: 'other', full_name: 'acme/other', description: 'unrelated' });
    const query = 'markdown 编辑器';
    const intent = '找 markdown 编辑器';

    // 基线：完整三段式搜索的第二次请求（精选）提示词
    const fetchMock = mockFetch();
    let baselinePrompt = '';
    fetchMock.mockImplementationOnce(async () => chatResponse(`{"intent":"${intent}","keywords":[],"synonyms":[]}`));
    fetchMock.mockImplementationOnce(async (_url, init) => {
      const body = await captureBody(init);
      baselinePrompt = String((body.messages as Array<{ content: string }>)[1].content);
      return chatResponse('[]');
    });
    const pipelineService = new AIService(makeConfig() as never, 'zh');
    await pipelineService.searchRepositoriesWithSelection([repoA, repoB], query);

    // 直调（无 evidence）：与基线逐字节一致
    fetchMock.mockImplementationOnce(async (_url, init) => {
      const body = await captureBody(init);
      const directPrompt = String((body.messages as Array<{ content: string }>)[1].content);
      expect(directPrompt).toBe(baselinePrompt);
      return chatResponse('[]');
    });
    const service = new AIService(makeConfig() as never, 'zh');
    await service.selectRelevantRepositories([repoA, repoB], query, intent);
    expect(baselinePrompt).not.toBe('');
    expect(baselinePrompt).not.toContain('matches=');

    // 传 evidence（全网发现路径）：提示词切换为宽松排序模式 + 证据行追加
    let evidenceSystem = '';
    let evidencePrompt = '';
    fetchMock.mockImplementationOnce(async (_url, init) => {
      const body = await captureBody(init);
      evidenceSystem = String((body.messages as Array<{ content: string }>)[0].content);
      evidencePrompt = String((body.messages as Array<{ content: string }>)[1].content);
      return chatResponse('[]');
    });
    const evidence = new Map<string, string>([
      ['acme/md-tool', 'matches=5; paths=README.md,package.json; langs=TypeScript'],
    ]);
    await service.selectRelevantRepositories([repoA, repoB], query, intent, undefined, evidence);
    // 证据行出现在 md-tool 摘要块的末尾（meta 行之后、块间距之前）
    expect(evidencePrompt).toContain('   matches=5; paths=README.md,package.json; langs=TypeScript');
    const evidenceLine = '   matches=5; paths=README.md,package.json; langs=TypeScript';
    const mdBlockEnd = evidencePrompt.indexOf(evidenceLine);
    const metaLine = evidencePrompt.indexOf('acme/md-tool');
    expect(metaLine).toBeGreaterThan(-1);
    expect(mdBlockEnd).toBeGreaterThan(metaLine);
    // 无证据的仓库不受影响
    expect(evidencePrompt).toContain('acme/other');
    // 全网发现提示词不再含过滤式"凑数即判空"措辞（实测会让 flash 模型在噪声
    // 候选池上塌缩到空数组），改为"选最相关、忽略无关、仅当全部候选无关才判空"
    expect(evidencePrompt).not.toContain('凑数');
    expect(evidencePrompt).toContain('不要因为候选池中多数仓库无关就返回空数组');
    expect(evidenceSystem).not.toContain('返回空数组');
  });

  it('en 语言下 evidence 路径同样切换为宽松排序提示词', async () => {
    const repoA = makeRepo({ id: 910000001, name: 'md-tool', full_name: 'acme/md-tool', description: 'a markdown tool' });
    const fetchMock = mockFetch();
    let enSystem = '';
    let enPrompt = '';
    fetchMock.mockImplementationOnce(async (_url, init) => {
      const body = await captureBody(init);
      enSystem = String((body.messages as Array<{ content: string }>)[0].content);
      enPrompt = String((body.messages as Array<{ content: string }>)[1].content);
      return chatResponse('[]');
    });
    const enService = new AIService(makeConfig() as never, 'en');
    await enService.selectRelevantRepositories(
      [repoA],
      'markdown editor',
      '',
      undefined,
      new Map([['acme/md-tool', 'matches=1; paths=README.md; langs=']]),
    );
    expect(enPrompt).not.toContain('loosely related');
    expect(enPrompt).toContain('never return [] just because most candidates are irrelevant');
    expect(enSystem).not.toContain('return an empty array');
  });
});

describe('AIService.expandSearchQuery — 多语言关键词约束（multilingual）', () => {
  const fetchJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const chatResponse = (content: string) => fetchJson({ choices: [{ message: { content } }] });
  const mockFetch = () => {
    const fetchMock = window.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockReset();
    return fetchMock;
  };
  const captureBody = async (init?: RequestInit) => JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };

  it('multilingual: true 时用户提示词追加双语约束；默认调用不追加（仓库页提示词逐字节不变）', async () => {
    const fetchMock = mockFetch();
    const requests: Array<string> = [];
    fetchMock.mockImplementation(async (_url, init) => {
      requests.push(String((await captureBody(init)).messages[1].content));
      return chatResponse('{"intent":"i","keywords":["k"],"synonyms":[]}');
    });

    const service = new AIService(makeConfig() as never, 'zh');
    await service.expandSearchQuery('markdown 编辑器', undefined);
    await service.expandSearchQuery('markdown 编辑器', undefined, { multilingual: true });

    // 默认路径：无追加段（与 createSearchPrompt 原文一致）
    expect(requests[0]).not.toContain('补充约束');
    // 多语言路径：追加双语约束（原语言 + 英文，英文查询补中文）
    expect(requests[1]).toContain('补充约束');
    expect(requests[1]).toContain('查询原语言与英文');
    // 追加段在原提示词之后，且原文完整保留
    expect(requests[1].startsWith(requests[0])).toBe(true);
    expect(requests[1].length).toBeGreaterThan(requests[0].length);
  });
});

describe('AIService.generateRepoSearchQueries — GitHub 语法槽', () => {
  const fetchJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const chatResponse = (content: string) => fetchJson({ choices: [{ message: { content } }] });
  const mockFetch = () => {
    const fetchMock = window.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockReset();
    return fetchMock;
  };
  const captureBody = async (init?: RequestInit) => JSON.parse(String(init?.body)) as {
    messages: Array<{ content: string }>;
    temperature: number;
    max_tokens: number;
  };

  it('从垃圾文本中提取 JSON 对象，过滤非法条目且不提前截断', async () => {
    const fetchMock = mockFetch();
    let body: Awaited<ReturnType<typeof captureBody>> | undefined;
    const content = [
      'noise before',
      JSON.stringify({
        queries: [
          { terms: ['terminal', 'file manager'], scope: 'metadata' },
          { terms: ['password vault'], scope: 'readme' },
          { terms: ['todo task'], scope: 'any' },
          { terms: ['code review'], scope: 'METADATA' },
          { terms: ['photo backup'], scope: 'readme' },
          { terms: ['sixth query'], scope: 'any' },
          { terms: 'not-an-array', scope: 'metadata' },
          { terms: ['bad scope'], scope: 'topic' },
          { terms: [], scope: 'any' },
        ],
      }),
      'noise after',
    ].join('\n');
    fetchMock.mockImplementationOnce(async (_url, init) => {
      body = await captureBody(init);
      return chatResponse(content);
    });

    const result = await new AIService(makeConfig() as never, 'zh')
      .generateRepoSearchQueries('终端文件管理器', '找终端文件管理器');

    expect(result).toEqual([
      { terms: ['terminal', 'file manager'], scope: 'metadata' },
      { terms: ['password vault'], scope: 'readme' },
      { terms: ['todo task'], scope: 'any' },
      { terms: ['code review'], scope: 'metadata' },
      { terms: ['photo backup'], scope: 'readme' },
      { terms: ['sixth query'], scope: 'any' },
    ]);
    expect(body?.temperature).toBe(0.1);
    expect(body?.max_tokens).toBe(4096);
    const userPrompt = body?.messages[1].content ?? '';
    expect(userPrompt).toContain('至少 2 条 metadata');
    expect(userPrompt).toContain('至少 1 条 readme');
    expect(userPrompt).toContain('禁止只写泛词');
  });

  it('跳过提示词示例对象，选择首个含有效查询的 JSON 对象', async () => {
    const fetchMock = mockFetch();
    const content = [
      JSON.stringify({ queries: [{ terms: ['example term'], scope: 'metadata | readme | any' }] }),
      JSON.stringify({ queries: [{ terms: ['terminal manager'], scope: 'metadata' }] }),
    ].join('\n');
    fetchMock.mockResolvedValueOnce(chatResponse(content));

    await expect(new AIService(makeConfig() as never, 'zh').generateRepoSearchQueries('终端文件管理器', 'i'))
      .resolves.toEqual([{ terms: ['terminal manager'], scope: 'metadata' }]);
  });

  it('未闭合的散落 { 不会吞掉后面的完整查询对象', async () => {
    const fetchMock = mockFetch();
    const content = `{ stray\n${JSON.stringify({ queries: [{ terms: ['terminal manager'], scope: 'metadata' }] })}`;
    fetchMock.mockResolvedValueOnce(chatResponse(content));

    await expect(new AIService(makeConfig() as never, 'zh').generateRepoSearchQueries('q', 'i'))
      .resolves.toEqual([{ terms: ['terminal manager'], scope: 'metadata' }]);
  });

  it.each([
    ['普通端点', makeConfig()],
    ['reasoning 兼容端点', { ...makeConfig(), reasoningEffort: 'medium' }],
  ])('%s统一使用 4096 max_tokens', async (_label, config) => {
    const fetchMock = mockFetch();
    let maxTokens: number | undefined;
    fetchMock.mockImplementationOnce(async (_url, init) => {
      maxTokens = (await captureBody(init)).max_tokens;
      return chatResponse('{"queries":[{"terms":["x"],"scope":"any"}]}');
    });

    await new AIService(config as never, 'zh').generateRepoSearchQueries('q', 'i');
    expect(maxTokens).toBe(4096);
  });

  it('非数组、非法 JSON 或请求失败时返回 []', async () => {
    const fetchMock = mockFetch();
    fetchMock
      .mockResolvedValueOnce(chatResponse('{"queries":"not-an-array"}'))
      .mockResolvedValueOnce(chatResponse('not json at all'))
      .mockRejectedValueOnce(new Error('network down'));
    const service = new AIService(makeConfig() as never, 'zh');

    await expect(service.generateRepoSearchQueries('q', 'i')).resolves.toEqual([]);
    await expect(service.generateRepoSearchQueries('q', 'i')).resolves.toEqual([]);
    await expect(service.generateRepoSearchQueries('q', 'i')).resolves.toEqual([]);
  });

  it('abort 向上传播；en 提示词包含同等语法槽约束', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));
    const service = new AIService(makeConfig() as never, 'zh');
    await expect(service.generateRepoSearchQueries('q', 'i')).rejects.toSatisfy(isAbortError);

    let enPrompt = '';
    fetchMock.mockImplementationOnce(async (_url, init) => {
      const body = await captureBody(init);
      enPrompt = body.messages[1].content;
      return chatResponse('{"queries":[{"terms":["x"],"scope":"any"}]}');
    });
    await new AIService(makeConfig() as never, 'en').generateRepoSearchQueries('q', 'i');
    expect(enPrompt).toContain('At least 2 metadata queries');
    expect(enPrompt).toContain('at least 1 readme query');
    expect(enPrompt).toContain('never use only generic words');
  });
});

describe('AIService vector query analysis and graded reranking', () => {
  const fetchJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
  const chatResponse = (content: string) => fetchJson({ choices: [{ message: { content } }] });

  beforeEach(() => {
    (window.fetch as ReturnType<typeof vi.fn>).mockReset();
  });

  it('parses strict JSON query analysis and truncates overlong fields', async () => {
    (window.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(chatResponse(`\`\`\`json
{
  "intent": "${'i'.repeat(250)}",
  "keywords": [" Skill ", "skill", "README", "", "readme"],
  "idealDescription": "${'d'.repeat(650)}",
  "facets": {
    "artifact": ["skill"],
    "action": ["optimize"],
    "domain": ["github readme"],
    "platform": ["codex"]
  },
  "highPrecisionTerms": ["README", "skill"],
  "lowConfidenceFacets": []
}
\`\`\``));
    const result = await new AIService(makeConfig() as never, 'zh').analyzeVectorSearchQuery('优化 readme');

    expect(result?.intent).toHaveLength(200);
    expect(result?.idealDescription).toHaveLength(600);
    expect(result?.keywords).toEqual(['skill', 'readme']);
    expect(result?.facets.artifact).toEqual(['skill']);
  });

  it('returns null for malformed analysis or wrong field types', async () => {
    const fetch = window.fetch as ReturnType<typeof vi.fn>;
    fetch.mockResolvedValueOnce(chatResponse('not json'));
    const service = new AIService(makeConfig() as never, 'zh');
    await expect(service.analyzeVectorSearchQuery('x')).resolves.toBeNull();

    fetch.mockResolvedValueOnce(chatResponse(JSON.stringify({
      intent: 'intent',
      keywords: ['x'],
      idealDescription: 'ideal',
      facets: { artifact: 'skill', action: [], domain: [], platform: [] },
      highPrecisionTerms: [],
      lowConfidenceFacets: [],
    })));
    await expect(service.analyzeVectorSearchQuery('x')).resolves.toBeNull();

    fetch.mockResolvedValueOnce(chatResponse(JSON.stringify({
      intent: 'intent',
      keywords: [],
      idealDescription: '   ',
      facets: { artifact: [], action: [], domain: [], platform: [] },
      highPrecisionTerms: [],
      lowConfidenceFacets: [],
    })));
    await expect(service.analyzeVectorSearchQuery('x')).resolves.toMatchObject({
      intent: 'intent',
      idealDescription: '',
    });

    fetch.mockResolvedValueOnce(chatResponse(JSON.stringify({
      intent: 'intent',
      keywords: [],
      idealDescription: '   ',
      facets: { artifact: [], action: [], domain: [], platform: [] },
      highPrecisionTerms: [],
      lowConfidenceFacets: [],
    })));
    await expect(service.analyzeSimilarRepositorySource(
      makeRepo({ id: 1, name: 'source', full_name: 'owner/source' }),
      '',
    )).resolves.toBeNull();
  });

  it('builds a bounded source profile prompt without popularity or repository identity', async () => {
    (window.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(chatResponse(JSON.stringify({
      intent: 'optimize GitHub README files',
      keywords: ['github', 'readme', 'skill'],
      idealDescription: 'A peer agent skill for README quality.',
      facets: { artifact: ['skill'], action: ['optimize'], domain: ['readme'], platform: ['codex'] },
      highPrecisionTerms: ['readme', 'skill'],
      lowConfidenceFacets: [],
    })));
    const repo = makeRepo({
      id: 101,
      name: 'readme-brand',
      full_name: 'acme/readme-brand',
      description: 'Agent skill for README quality',
      ai_tags: ['skill'],
      stargazers_count: 99999,
    });
    const result = await new AIService(makeConfig() as never, 'zh')
      .analyzeSimilarRepositorySource(repo, '# README mention', undefined);
    const [, init] = (window.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const messages = JSON.parse(String(init.body)).messages as Array<{ content: string }>;
    const prompt = messages.map(message => message.content).join('\n');

    expect(result?.idealDescription).toContain('peer agent skill');
    expect(prompt).not.toContain('acme/readme-brand');
    expect(prompt).not.toContain('99999');
  });

  it('accepts complete grades by real ID or ordinal and distinguishes empty', () => {
    const repos = [
      makeRepo({ id: 101, name: 'a', full_name: 'acme/a' }),
      makeRepo({ id: 202, name: 'b', full_name: 'acme/b' }),
    ];
    const service = new AIService(makeConfig() as never, 'zh');

    expect(service.parseGradedRerankResult('{"grades":[{"id":202,"grade":2},{"id":1,"grade":1}]}', repos))
      .toEqual({ status: 'complete', grades: new Map([[202, 2], [101, 1]]) });
    expect(service.parseGradedRerankResult('{"grades":[]}', repos))
      .toEqual({ status: 'empty', grades: new Map() });
  });

  it.each([
    ['missing candidate', '{"grades":[{"id":101,"grade":2}]}'],
    ['unknown ID', '{"grades":[{"id":101,"grade":2},{"id":202,"grade":1},{"id":999,"grade":0}]}'],
    ['duplicate ID', '{"grades":[{"id":101,"grade":2},{"id":101,"grade":1},{"id":202,"grade":0}]}'],
    ['invalid grade', '{"grades":[{"id":101,"grade":3},{"id":202,"grade":0}]}'],
  ])('returns invalid for %s', (_label, content) => {
    const repos = [
      makeRepo({ id: 101, name: 'a', full_name: 'acme/a' }),
      makeRepo({ id: 202, name: 'b', full_name: 'acme/b' }),
    ];
    const result = new AIService(makeConfig() as never, 'zh').parseGradedRerankResult(content, repos);
    expect(result.status).toBe('invalid');
  });

  it('sends one grade per candidate and never includes ranking scores or stars', async () => {
    (window.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      chatResponse('{"grades":[{"id":101,"grade":2},{"id":202,"grade":0}]}'),
    );
    const repos = [
      makeRepo({ id: 101, name: 'a', full_name: 'acme/a', stargazers_count: 99999 }),
      makeRepo({ id: 202, name: 'b', full_name: 'acme/b' }),
    ];
    const result = await new AIService(makeConfig() as never, 'zh').rerankRepositoriesGraded(
      repos,
      'query',
      null,
    );
    const [, init] = (window.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const messages = JSON.parse(String(init.body)).messages as Array<{ content: string }>;
    const prompt = messages.map(message => message.content).join('\n');

    expect(result?.status).toBe('complete');
    expect(prompt).toContain('Return one grade for every candidate, exactly once.');
    expect(prompt).not.toContain('99999');
    expect(prompt).not.toContain('RRF');
  });

  it('returns empty for no candidates without calling the LLM', async () => {
    const result = await new AIService(makeConfig() as never, 'zh').rerankRepositoriesGraded(
      [],
      'query',
      null,
    );

    expect(result).toEqual({ status: 'empty', grades: new Map() });
    expect(window.fetch).not.toHaveBeenCalled();
  });

  it('reranks similar repositories from the cleaned peer profile only', async () => {
    (window.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      chatResponse('{"grades":[{"id":101,"grade":2},{"id":202,"grade":0}]}'),
    );
    const repos = [
      makeRepo({ id: 101, name: 'a', full_name: 'acme/a', stargazers_count: 99999 }),
      makeRepo({ id: 202, name: 'b', full_name: 'acme/b' }),
    ];
    const result = await new AIService(makeConfig() as never, 'zh').rerankSimilarRepositoriesGraded(
      makeRepo({ id: 999, name: 'private-brand', full_name: 'source-owner/private-brand' }),
      repos,
      {
        intent: 'maintain README documentation',
        keywords: ['readme', 'documentation'],
        idealDescription: 'A peer documentation maintenance skill.',
        facets: {
          artifact: ['skill'],
          action: ['maintain'],
          domain: ['readme'],
          platform: ['codex'],
        },
        highPrecisionTerms: ['readme', 'skill'],
        lowConfidenceFacets: [],
      },
      undefined,
    );
    const [, init] = (window.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const messages = JSON.parse(String(init.body)).messages as Array<{ content: string }>;
    const prompt = messages.map(message => message.content).join('\n');

    expect(result?.status).toBe('complete');
    expect(prompt).toContain('Source intent: maintain README documentation');
    expect(prompt).not.toContain('source-owner/private-brand');
    expect(prompt).not.toContain('99999');
    expect(prompt).not.toContain('RRF');
  });

  it('parses JSON that follows an inline <think> chain', async () => {
    (window.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(chatResponse(
      '<think>Let me reason about { this query } carefully... but never output JSON</think>{"grades":[{"id":101,"grade":2}]}',
    ));
    const repos = [
      makeRepo({ id: 101, name: 'a', full_name: 'acme/a' }),
      makeRepo({ id: 202, name: 'b', full_name: 'acme/b' }),
    ];
    const result = await new AIService(makeConfig() as never, 'zh').rerankRepositoriesGraded(repos, 'query', null);
    expect(result?.status).toBe('invalid');
    expect(result?.grades.get(101)).toBe(2);
  });

  it('keeps the private lexical delegate identical to the public static implementation', () => {
    const repo = makeRepo({ id: 4, name: 'skill-pack', full_name: 'acme/skill-pack', custom_tags: ['技能'] });
    const service = new AIService(makeConfig() as never, 'zh');
    const publicResult = AIService.rankLexicalCandidates([repo], '技能', ['skill']);
    const privateResult = service['scoreRepositoriesByKeywords']([repo], '技能', ['skill']);
    expect(privateResult).toEqual(publicResult);
  });
});

describe('AIService — 慢/限流 OpenAI 兼容网关的防御性解析', () => {
  const fetchJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const mockFetch = () => {
    const fetchMock = window.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockReset();
    return fetchMock;
  };

  it('HTTP 200 携带 429/throttling 错误体时转为限流 AIRequestError', async () => {
    mockFetch().mockResolvedValueOnce(fetchJson({
      error: { message: 'max connections reached', type: 'throttling_error', code: '429' },
    }));
    const service = new AIService(makeConfig() as never, 'zh');
    const error: unknown = await service.expandSearchQuery('anything').then(() => null, e => e);
    expect(error).toBeInstanceOf(AIRequestError);
    const aiError = error as AIRequestError;
    expect(aiError.status).toBe(429);
    expect(aiError.isRateLimit).toBe(true);
    expect(isRateLimitedError(aiError)).toBe(true);
    expect(aiError.message).toContain('max connections reached');
  });

  it('HTTP 200 错误体 message 含 rate-limit 字样时也转为限流 AIRequestError', async () => {
    mockFetch().mockResolvedValueOnce(fetchJson({
      error: { message: 'rate-limit exceeded' },
    }));
    const service = new AIService(makeConfig() as never, 'zh');
    const error: unknown = await service.expandSearchQuery('anything').then(() => null, e => e);
    expect(error).toBeInstanceOf(AIRequestError);
    expect((error as AIRequestError).status).toBe(429);
    expect(isRateLimitedError(error)).toBe(true);
  });

  it('HTTP 200 字符串错误内容为明确限流短语时转为 429', async () => {
    mockFetch().mockResolvedValueOnce(fetchJson({
      error: 'rate-limit exceeded',
    }));
    const service = new AIService(makeConfig() as never, 'zh');
    const error: unknown = await service.expandSearchQuery('anything').then(() => null, e => e);
    expect(error).toBeInstanceOf(AIRequestError);
    expect((error as AIRequestError).status).toBe(429);
    expect(isRateLimitedError(error)).toBe(true);
  });

  it('HTTP 200 错误体 message 仅包含 rate_limit 字样但不表示限流时仍为 502', async () => {
    mockFetch().mockResolvedValueOnce(fetchJson({
      error: { type: 'invalid_request_error', message: 'invalid parameter: rate_limit must be positive' },
    }));
    const service = new AIService(makeConfig() as never, 'zh');
    const error: unknown = await service.expandSearchQuery('anything').then(() => null, e => e);
    expect(error).toBeInstanceOf(AIRequestError);
    expect((error as AIRequestError).status).toBe(502);
    expect(isRateLimitedError(error)).toBe(false);
  });

  it('HTTP 200 非限流网关错误即使消息含 rate limit 也不触发限流判定', async () => {
    mockFetch().mockResolvedValueOnce(fetchJson({
      error: { type: 'upstream_error', message: 'upstream rate limit hit for key' },
    }));
    const service = new AIService(makeConfig() as never, 'zh');
    const error: unknown = await service.expandSearchQuery('anything').then(() => null, e => e);
    expect(error).toBeInstanceOf(AIRequestError);
    expect((error as AIRequestError).status).toBe(502);
    expect((error as AIRequestError).isRateLimit).toBe(false);
    expect(isRateLimitedError(error)).toBe(false);
  });

  it('真实 HTTP 503 错误详情含限流短语时仍判定为限流', async () => {
    mockFetch().mockResolvedValueOnce(fetchJson({ error: 'rate limit exceeded' }, 503));
    const service = new AIService(makeConfig() as never, 'zh');
    const error: unknown = await service.expandSearchQuery('anything').then(() => null, e => e);
    expect(error).toBeInstanceOf(AIRequestError);
    expect((error as AIRequestError).status).toBe(503);
    expect((error as AIRequestError).fromGatewayBody).toBe(false);
    expect(isRateLimitedError(error)).toBe(true);
  });

  it('HTTP 200 携带非限流网关错误体时转为 502 AIRequestError', async () => {
    mockFetch().mockResolvedValueOnce(fetchJson({
      error: { message: 'upstream unavailable', code: 'bad_gateway' },
    }));
    const service = new AIService(makeConfig() as never, 'zh');
    const error: unknown = await service.expandSearchQuery('anything').then(() => null, e => e);
    expect(error).toBeInstanceOf(AIRequestError);
    const aiError = error as AIRequestError;
    expect(aiError.status).toBe(502);
    expect(aiError.isRateLimit).toBe(false);
    expect(aiError.message).toContain('upstream unavailable');
  });

  it('普通 openai 兼容配置的连接测试在 30s 才超时（不再 10s 判“渠道不可用”）', async () => {
    vi.useFakeTimers();
    try {
      const service = new AIService(makeConfig() as never);
      mockFetch().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
      }));
      let settled = false;
      let result: unknown;
      const pending = service.testConnection().then((value) => { result = value; settled = true; }, () => { settled = true; });
      await vi.advanceTimersByTimeAsync(29999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
      await pending;
      expect(result).toMatchObject({ success: false, errorType: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('analyzeRepository 遇到 AbortError 不记“AI analysis failed”日志但仍抛出', async () => {
    mockFetch().mockRejectedValue(new DOMException('signal is aborted without reason', 'AbortError'));
    const errorFromLogger = vi.spyOn(logger, 'errorFromError').mockImplementation(() => {});
    try {
      const service = new AIService(makeConfig() as never, 'zh');
      await expect(service.analyzeRepository(makeRepo({ id: 1, name: 'sample', full_name: 'acme/sample' }), '# readme'))
        .rejects.toSatisfy(isAbortError);
      expect(errorFromLogger).not.toHaveBeenCalled();
    } finally {
      errorFromLogger.mockRestore();
    }
  });

  it('analyzeRepository 非 AbortError 仍照常记录失败日志', async () => {
    mockFetch().mockRejectedValue(new Error('network down'));
    const errorFromLogger = vi.spyOn(logger, 'errorFromError').mockImplementation(() => {});
    try {
      const service = new AIService(makeConfig() as never, 'zh');
      await expect(service.analyzeRepository(makeRepo({ id: 1, name: 'sample', full_name: 'acme/sample' }), '# readme'))
        .rejects.toThrow('network down');
      expect(errorFromLogger).toHaveBeenCalledWith('ai', 'AI analysis failed', expect.any(Error), expect.anything());
    } finally {
      errorFromLogger.mockRestore();
    }
  });

  it('testConnection 对 HTTP 200 网关错误体按映射状态码分类', async () => {
    mockFetch().mockResolvedValueOnce(fetchJson({
      error: { message: 'max connections reached', code: '429' },
    }));
    const service = new AIService(makeConfig() as never);
    const result = await service.testConnection();
    expect(result).toMatchObject({ success: false, statusCode: 429, errorType: 'unknown' });
    expect(result.message).toContain('HTTP 429');
  });

  it('testConnection 映射状态码优先于消息中的 network 关键词', async () => {
    mockFetch().mockResolvedValueOnce(fetchJson({
      error: { message: 'network capacity exceeded', code: '429' },
    }));
    const service = new AIService(makeConfig() as never);
    const result = await service.testConnection();
    expect(result).toMatchObject({ success: false, statusCode: 429, errorType: 'unknown' });
    expect(result.message).toContain('HTTP 429');
  });

  it('testConnection 普通错误消息含网络关键词与 IP 地址时归类为 network', async () => {
    mockFetch().mockRejectedValueOnce(new Error('network request failed to 127.0.0.1'));
    const service = new AIService(makeConfig() as never);
    const result = await service.testConnection();
    expect(result).toMatchObject({ success: false, errorType: 'network' });
  });

  it('testConnection 已映射状态码的 AIRequestError 不因消息含 abort 关键词被归类为超时', async () => {
    mockFetch().mockResolvedValueOnce(fetchJson({
      error: { message: 'connection aborted by gateway', code: '429' },
    }));
    const service = new AIService(makeConfig() as never);
    const result = await service.testConnection();
    expect(result).toMatchObject({ success: false, statusCode: 429, errorType: 'unknown' });
    expect(result.message).toContain('HTTP 429');
  });

  it('analyzeRepository 信号已中止但请求抛出普通 Error 时不记录失败日志', async () => {
    mockFetch().mockRejectedValue(new Error('network down'));
    const errorFromLogger = vi.spyOn(logger, 'errorFromError').mockImplementation(() => {});
    try {
      const controller = new AbortController();
      controller.abort();
      const service = new AIService(makeConfig() as never, 'zh');
      await expect(service.analyzeRepository(makeRepo({ id: 1, name: 'sample', full_name: 'acme/sample' }), '# readme', undefined, undefined, controller.signal))
        .rejects.toThrow('network down');
      expect(errorFromLogger).not.toHaveBeenCalled();
    } finally {
      errorFromLogger.mockRestore();
    }
  });

  it('requestTextStream 缺失 Content-Type 的 HTTP 200 限流错误体转为 429 AIRequestError', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ error: { message: 'max connections reached', type: 'throttling_error', code: '429' } }),
    });
    const service = new AIService(makeConfig() as never, 'zh');
    const error: unknown = await service.generateChatTextStream({ system: 's', user: 'u', onChunk: () => {} }).then(() => null, e => e);
    expect(error).toBeInstanceOf(AIRequestError);
    expect((error as AIRequestError).status).toBe(429);
    expect(isRateLimitedError(error)).toBe(true);
  });

  it('requestTextStream application/json 的 HTTP 200 网关错误体转为 502 AIRequestError', async () => {
    mockFetch().mockResolvedValueOnce(fetchJson({ error: { message: 'bad gateway', type: 'bad_gateway' } }, 200));
    const service = new AIService(makeConfig() as never, 'zh');
    const error: unknown = await service.generateChatTextStream({ system: 's', user: 'u', onChunk: () => {} }).then(() => null, e => e);
    expect(error).toBeInstanceOf(AIRequestError);
    expect((error as AIRequestError).status).toBe(502);
  });

  it('requestTextStream SSE 帧携带网关错误体时转为 429 AIRequestError', async () => {
    mockFetch().mockResolvedValueOnce(new Response(
      'data: {"error":{"message":"max connections reached","type":"throttling_error","code":"429"}}\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ));
    const service = new AIService(makeConfig() as never, 'zh');
    const error: unknown = await service.generateChatTextStream({ system: 's', user: 'u', onChunk: () => {} }).then(() => null, e => e);
    expect(error).toBeInstanceOf(AIRequestError);
    expect((error as AIRequestError).status).toBe(429);
  });

  it('requestTextStream 增量后接 SSE 错误帧时整体抛出 429 AIRequestError', async () => {
    const chunks: string[] = [];
    mockFetch().mockResolvedValueOnce(new Response(
      'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'
      + 'data: {"error":{"message":"max connections reached","type":"throttling_error","code":"429"}}\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ));
    const service = new AIService(makeConfig() as never, 'zh');
    const error: unknown = await service.generateChatTextStream({ system: 's', user: 'u', onChunk: (delta) => chunks.push(delta) }).then(() => null, e => e);
    expect(error).toBeInstanceOf(AIRequestError);
    expect((error as AIRequestError).status).toBe(429);
    expect(chunks).toEqual(['partial']);
  });

  it('requestTextStream SSE 错误帧后连接挂起时也立即抛出 429', async () => {
    const encoder = new TextEncoder();
    const hangingBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"error":{"message":"max connections reached","type":"throttling_error","code":"429"}}\n\n'));
        // 故意不关闭流：模拟网关发送错误帧后保持连接。
      },
    });
    mockFetch().mockResolvedValueOnce(new Response(hangingBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));
    const service = new AIService(makeConfig() as never, 'zh');
    const error: unknown = await service.generateChatTextStream({ system: 's', user: 'u', onChunk: () => {} }).then(() => null, e => e);
    expect(error).toBeInstanceOf(AIRequestError);
    expect((error as AIRequestError).status).toBe(429);
  }, 2000);

  it('requestTextStream 缺失 Content-Type 时纯文本中的 data: 行不被误判为网关错误帧', async () => {
    const plainText = 'Sure!\ndata: {"error":{"message":"not really","code":"bad_gateway"}}\nDone';
    mockFetch().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => plainText,
    });
    const service = new AIService(makeConfig() as never, 'zh');
    const result = await service.generateChatTextStream({ system: 's', user: 'u', onChunk: () => {} });
    expect(result).toBe(plainText);
  });

  it('requestTextStream 缺失 Content-Type 时 id 前缀的普通文本行不被误判为 SSE 帧', async () => {
    const plainText = 'identity check\ndata: {"error":{"message":"x","code":"429"}}';
    mockFetch().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => plainText,
    });
    const service = new AIService(makeConfig() as never, 'zh');
    const result = await service.generateChatTextStream({ system: 's', user: 'u', onChunk: () => {} });
    expect(result).toBe(plainText);
  });
});
