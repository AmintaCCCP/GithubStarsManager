import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../types';
import { AIService } from './aiService';
import {
  ANSWER_FORMAT_DIRECTIVE,
  ANSWER_LENGTH_DIRECTIVE,
  buildEvidenceGatePrompt,
  buildQueryUnderstandingPrompt,
  buildRetrievalPlanPrompt,
  buildSystemPrompt,
  buildUserPrompt,
  evidenceAgentInsufficientResponse,
  makeEvidence,
  noVerifiedSummaryResponse,
  pruneUnverifiableSections,
  sourceBoundEvidenceDigest,
  type RepositoryChatTurnInput,
} from './repositoryChatService';
import {
  buildToolLoopSystemPrompt,
  buildToolLoopTools,
  buildToolLoopUserPrompt,
} from './agentToolLoop';
import { fixturePath, readFixture, shouldUpdateFixtures, writeFixture } from '../test/fixtureIo';

/**
 * i18n 迁移保障网：把 language=zh/en 下发出的全部 AI 请求消息与 prompt 构造器
 * 输出固化为 fixture。迁移后该测试必须逐字节通过，证明 zh/en 的 AI 行为零变化。
 * 重新生成：UPDATE_I18N_FIXTURES=1 npx vitest run src/services/aiPromptFixtures.test.ts
 */
const FIXTURE_FILE = fixturePath(import.meta.url, '__fixtures__/ai-prompts.snapshot.json');

const makeConfig = () => ({
  id: 'fixture-config',
  name: 'fixture',
  apiType: 'openai' as const,
  baseUrl: 'http://localhost:0',
  apiKey: 'fixture-key',
  model: 'gpt-fixture',
  isActive: true,
});

const makeRepo = (partial: Partial<Repository> & Pick<Repository, 'id' | 'name' | 'full_name'>): Repository => ({
  description: 'A sample repository for fixture snapshots',
  html_url: `https://github.com/${partial.full_name}`,
  stargazers_count: 120,
  forks_count: 3,
  forks: 3,
  language: 'TypeScript',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-06-01T00:00:00Z',
  pushed_at: '2024-06-01T00:00:00Z',
  owner: { login: 'acme', avatar_url: '' },
  topics: ['react', 'typescript'],
  ...partial,
});

const makeGist = () => ({
  id: 'gist-1',
  description: 'A sample gist with a small script',
  public: true,
  owner: { login: 'acme' },
  files: {
    'hello.js': { filename: 'hello.js', language: 'JavaScript', size: 42, type: 'application/javascript' },
  },
}) as never;

const README = '# Sample App\n\nA demo repository used by the i18n fixture guard.\n\n## Install\n\nnpm install sample-app\n';

type CapturedCall = { url: string; body: unknown };

const capturedCalls: CapturedCall[] = [];

const installFetchStub = (): void => {
  (window.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string | URL, init?: RequestInit) => {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(String(init?.body ?? '{}'));
    } catch {
      parsed = null;
    }
    capturedCalls.push({ url: String(url), body: parsed });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
};

const captureRequests = async (run: () => Promise<unknown>): Promise<Array<{ role: string; content: string }>[]> => {
  capturedCalls.length = 0;
  await run().catch(() => {
    // 请求已捕获；解析失败/重试耗尽等错误与快照无关
  });
  return capturedCalls.map((call) => {
    const body = call.body as { messages?: Array<{ role: string; content: string }>; input?: Array<{ role: string; content: string }> };
    return body?.messages ?? body?.input ?? [];
  });
};

const makeChatInput = (language: 'zh' | 'en', question: string): RepositoryChatTurnInput => ({
  repository: makeRepo({ id: 42, name: 'sample-app', full_name: 'acme/sample-app' }),
  session: {
    id: 'session-1',
    repositoryId: 42,
    title: language === 'zh' ? '新对话' : 'New conversation',
    sourceRefSha: 'abc123def456',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  messages: [
    { id: 'm1', role: 'user', content: question, createdAt: '2024-01-01T00:00:00Z' },
  ],
  question,
  githubToken: 'fixture-token',
  aiConfig: makeConfig() as never,
  language,
  maxToolsPerTurn: 3,
  taskDepth: 'default',
} as unknown as RepositoryChatTurnInput);

const makeEvidenceForFixture = (repo: Repository) => makeEvidence({
  source: 'github',
  repoFullName: repo.full_name,
  refSha: 'abc123def456',
  path: 'README.md',
  lineStart: 1,
  lineEnd: 12,
  url: `https://github.com/${repo.full_name}/blob/abc123def456/README.md#L1-L12`,
  excerpt: '# Sample App\n\nA demo repository used by the i18n fixture guard.',
} as never);

const UNDERSTANDING = {
  intent: 'usage',
  entities: ['docker'],
  searchConcepts: ['deployment', 'container'],
  likelyDocumentTopics: ['Installation', 'Getting started'],
  informationScope: 'both',
  answerRequirements: [{ id: 'req-1', text: 'how to install the app', kind: 'explicit', status: 'missing' }],
  optionalEnrichment: ['project history'],
} as never;

const buildAIServiceFixtures = async (language: 'zh' | 'en') => {
  const makeService = () => new AIService(makeConfig() as never, language);
  const repo = makeRepo({ id: 42, name: 'sample-app', full_name: 'acme/sample-app' });
  const repoB = makeRepo({ id: 43, name: 'sample-cli', full_name: 'acme/sample-cli' });
  const customCategoryHint = language === 'zh' ? '自定义分类（custom,自定义）' : 'Custom (custom,customized)';
  const customCategories = [language === 'zh' ? '自定义分类' : 'Custom'];
  const result: Record<string, unknown> = {};

  result.analyzeRepository = await captureRequests(() =>
    makeService().analyzeRepository(repo, README, customCategories, customCategoryHint));
  result.analyzeGist = await captureRequests(() => makeService().analyzeGist(makeGist(), 'console.log("hello");'));
  result.analyzeReleaseSummary = await captureRequests(() =>
    makeService().analyzeReleaseSummary('## Changes\n\n- Added feature A\n- Fixed bug B', {
      repoName: 'acme/sample-app',
      tagName: 'v1.2.0',
      releaseName: 'Summer release',
    }));
  result.generateHyDEQuery = await captureRequests(() => makeService().generateHyDEQuery('react state management library'));
  result.searchRepositoriesWithSemanticReranking = await captureRequests(() =>
    makeService().searchRepositoriesWithSemanticReranking([repo, repoB], 'state management'));
  result.searchGistsWithReranking = await captureRequests(() =>
    makeService().searchGistsWithReranking([makeGist()], 'state management'));
  result.searchRepositoriesWithSelection = await captureRequests(() =>
    makeService().searchRepositoriesWithSelection([repo, repoB], 'react state management'));
  result.translateTexts = await captureRequests(() =>
    makeService().translateTexts(['Hello world', 'Install the app'], language === 'zh' ? 'en' : 'zh', undefined));

  const customConfig = {
    ...makeConfig(),
    customPrompt: 'Analyze {LANGUAGE}.\n{REPO_INFO}\n{CATEGORIES_INFO}\nCategories hint: {CATEGORIES_HINT}',
  };
  const customService = new AIService(customConfig as never, language);
  result.createCustomAnalysisPrompt = (customService as unknown as {
    createCustomAnalysisPrompt: (repo: Repository, readme: string, cats: string[], hints: string) => string;
  }).createCustomAnalysisPrompt(repo, README, customCategories, customCategoryHint);

  return result;
};

const buildChatServiceFixtures = (language: 'zh' | 'en') => {
  const question = language === 'zh' ? '这个项目怎么部署？' : 'How do I deploy this project?';
  const chatInput = makeChatInput(language, question);
  const repo = chatInput.repository;
  const evidences = [makeEvidenceForFixture(repo)];
  const result: Record<string, unknown> = {};

  result.ANSWER_FORMAT_DIRECTIVE = ANSWER_FORMAT_DIRECTIVE(language);
  result.ANSWER_LENGTH_DIRECTIVE = {
    quick: ANSWER_LENGTH_DIRECTIVE(language, 'quick'),
    default: ANSWER_LENGTH_DIRECTIVE(language, 'default'),
    deep: ANSWER_LENGTH_DIRECTIVE(language, 'deep'),
    unlimited: ANSWER_LENGTH_DIRECTIVE(language, 'unlimited'),
  };
  result.buildSystemPrompt = {
    quick: buildSystemPrompt(language, 'quick'),
    default: buildSystemPrompt(language, 'default'),
    deep: buildSystemPrompt(language, 'deep'),
    unlimited: buildSystemPrompt(language, 'unlimited'),
  };
  result.buildUserPrompt = buildUserPrompt(chatInput, evidences);
  result.sourceBoundEvidenceDigest = sourceBoundEvidenceDigest(chatInput, evidences);
  result.noVerifiedSummaryResponse = noVerifiedSummaryResponse(language);
  result.pruneUnverifiableSections = pruneUnverifiableSections(
    [
      '## Setup',
      '',
      'Run `npm install` to get started. `/README.md - 1-12`',
      '',
      '## Extra',
      '',
      'An uncited claim that should be pruned.',
    ].join('\n'),
    evidences,
    language,
  );
  result.buildQueryUnderstandingPrompt = buildQueryUnderstandingPrompt(chatInput, ['README.md', 'docs/guide.md', 'src/index.ts']);
  result.buildRetrievalPlanPrompt = buildRetrievalPlanPrompt(
    chatInput,
    UNDERSTANDING,
    new Map(),
    ['README.md', 'docs/guide.md'],
    ['src/index.ts'],
    ['exact install steps'],
    1,
    false,
  );
  result.buildEvidenceGatePrompt = buildEvidenceGatePrompt(
    chatInput,
    UNDERSTANDING,
    evidences,
    new Map(),
    ['README.md'],
    ['src/index.ts'],
    [],
    2,
    true,
  );
  result.evidenceAgentInsufficientResponse = {
    plain: evidenceAgentInsufficientResponse(language, '', false),
    withReason: evidenceAgentInsufficientResponse(language, language === 'zh' ? '预算内未确认。' : 'Not confirmed within budget.', false),
    withToolError: evidenceAgentInsufficientResponse(language, '', true),
  };
  return result;
};

const buildToolLoopFixtures = (language: 'zh' | 'en') => {
  const question = language === 'zh' ? '这个项目怎么部署？' : 'How do I deploy this project?';
  const chatInput = makeChatInput(language, question);
  return {
    buildToolLoopSystemPrompt: buildToolLoopSystemPrompt(language),
    buildToolLoopUserPrompt: buildToolLoopUserPrompt(chatInput, ['README.md', 'docs/guide.md'], ['src/index.ts']),
    buildToolLoopTools: buildToolLoopTools(language),
  };
};

describe('AI prompt fixtures（zh/en 字节级稳定保障）', () => {
  let snapshot: Record<string, unknown>;

  beforeAll(async () => {
    installFetchStub();
    snapshot = {
      aiService: {
        zh: await buildAIServiceFixtures('zh'),
        en: await buildAIServiceFixtures('en'),
      },
      chat: {
        zh: buildChatServiceFixtures('zh'),
        en: buildChatServiceFixtures('en'),
      },
      toolLoop: {
        zh: buildToolLoopFixtures('zh'),
        en: buildToolLoopFixtures('en'),
      },
    };
    if (shouldUpdateFixtures()) {
      writeFixture(FIXTURE_FILE, snapshot);
    }
  });

  it('matches the frozen zh/en prompt fixture byte-for-byte', () => {
    if (shouldUpdateFixtures()) {
      expect(snapshot).not.toBeNull();
      return;
    }
    expect(snapshot).toEqual(readFixture(FIXTURE_FILE));
  });
});
