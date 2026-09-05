import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Repository } from '../types';
import {
  AIService,
  AIRequestError,
  isRateLimitedError,
  getRetryAfterMsFromError,
  isAIToolCallUnsupportedError,
  supportsChatToolCalls,
  type AIToolLoopMessage,
} from './aiService';
import { isToolCallCapableApiType } from '../constants/aiCapabilities';

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
    // 普通模型的精选请求维持紧凑预算
    expect(requests[1].max_tokens).toBe(800);
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
