import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIConfig, Repository } from '../../types';
import type { RepositoryChatSession, ToolEvidence } from '../../types/repositoryChat';
import type { ChatToolEventInput } from './loop';

const mocks = vi.hoisted(() => ({
  generateChatText: vi.fn(),
  generateChatTextStream: vi.fn(),
  generateWithTools: vi.fn(),
  getRepositoryTree: vi.fn(),
  getRepositoryFile: vi.fn(),
  getRepositoryMarkdownEvidenceFile: vi.fn(),
  getRepositoryReleases: vi.fn(),
  searchRepositoryIssues: vi.fn(),
  getRepositoryIssueComments: vi.fn(),
}));

vi.mock('../aiService', () => ({
  AIService: class {
    generateChatTextDetailed = async (...args: Parameters<typeof mocks.generateChatText>) => ({ text: await mocks.generateChatText(...args), finishReason: 'stop' });
    generateChatTextStream = mocks.generateChatTextStream;
    generateWithTools = vi.fn();
  },
  isAIStreamUnsupportedError: (error: unknown): boolean => error instanceof Error && error.name === 'AIStreamUnsupportedError',
}));

vi.mock('../githubApiFactory', () => ({
  createGitHubApiService: () => ({
    getRepositoryTree: mocks.getRepositoryTree,
    getRepositoryFile: mocks.getRepositoryFile,
    getRepositoryMarkdownEvidenceFile: mocks.getRepositoryMarkdownEvidenceFile,
    getRepositoryReleases: mocks.getRepositoryReleases,
    searchRepositoryIssues: mocks.searchRepositoryIssues,
    getRepositoryIssueComments: mocks.getRepositoryIssueComments,
  }),
}));

import { runToolLoopRepositoryChatTurn } from '../agentToolLoop';
import { runEvidenceDrivenRepositoryChatTurn, synthesizeVerifiedAnswer, type RepositoryChatTurnInput } from './loop';

const repository: Repository = {
  id: 1,
  name: 'example',
  full_name: 'owner/example',
  description: 'Example repository',
  html_url: 'https://github.com/owner/example',
  stargazers_count: 1,
  forks_count: 0,
  forks: 0,
  language: 'TypeScript',
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
  pushed_at: '2026-08-01T00:00:00.000Z',
  owner: { login: 'owner', avatar_url: 'https://example.com/avatar.png' },
  topics: ['example'],
};

const session: RepositoryChatSession = {
  id: 'session-1',
  repoId: repository.id,
  repoFullName: repository.full_name,
  sourceRefSha: 'abcdef1234567890',
  title: 'New conversation',
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z',
};

const aiConfig: AIConfig = {
  id: 'ai-1',
  name: 'Test AI',
  apiType: 'openai',
  baseUrl: 'https://example.com/v1',
  apiKey: 'test-key',
  model: 'test-model',
  isActive: true,
};

const turnInput = (question: string, overrides: Partial<RepositoryChatTurnInput> = {}): RepositoryChatTurnInput => ({
  repository,
  session,
  messages: [],
  question,
  githubToken: 'github-token',
  aiConfig,
  language: 'en' as const,
  maxToolsPerTurn: 12,
  agentBudget: { maxTurns: 6, maxToolCalls: 12, maxReadFiles: 8, maxCodeReads: 3, maxNoProgressRounds: 2, maxDurationMs: 90_000 },
  ...overrides,
});

const README_WITH_INSTALL = [
  '# Example Project',
  '',
  '## Install',
  'Run `npx example install` to set up the CLI.',
  '',
  '## License',
  'MIT licensed.',
].join('\n');

const INSTALL_SECTION_REFERENCE = '/README.md - 3-5';

const CITED_ANSWER = `Run \`npx example install\` to set up the CLI. \`${INSTALL_SECTION_REFERENCE}\``;
const installEvidence: ToolEvidence = {
  id: 'evidence-install',
  source: 'github',
  repoFullName: repository.full_name,
  path: 'README.md',
  lineStart: 3,
  lineEnd: 5,
  url: 'https://github.com/owner/example/blob/abcdef1234567890/README.md#L3-L5',
  excerpt: 'Run npx example install to set up the CLI.',
  retrievedAt: '2026-08-01T00:00:00.000Z',
};

const configureTreeAndFiles = (contents: Record<string, string>) => {
  mocks.getRepositoryTree.mockResolvedValue({
    ref: session.sourceRefSha,
    truncated: false,
    entries: Object.keys(contents).map((path) => ({ path, type: 'blob' })),
  });
  mocks.getRepositoryFile.mockImplementation(async (_owner: string, _repo: string, path: string) => ({
    path,
    ref: session.sourceRefSha,
    sha: `file-${path}`,
    size: contents[path]?.length ?? 0,
    content: contents[path],
  }));
  mocks.getRepositoryMarkdownEvidenceFile.mockImplementation((...args: unknown[]) => mocks.getRepositoryFile(...args));
};

/** 按系统提示词路由模型响应：理解 / 规划 / 校验 / 回答各走各的 fixture。 */
const respondByPrompt = (handlers: { understanding?: string; plan?: string; gate?: string; answer?: () => string }) => {
  let answerCalls = 0;
  mocks.generateChatText.mockImplementation(async (options: { system?: string }) => {
    const system = options.system ?? '';
    if (system.includes('Query Understanding')) return handlers.understanding ?? '{}';
    if (system.includes('retrieval planner')) return handlers.plan ?? '{}';
    if (system.includes('Evidence Gate')) return handlers.gate ?? '{}';
    answerCalls += 1;
    return handlers.answer?.() ?? '';
  });
  return () => answerCalls;
};

const turnMetricsEvent = (events: ChatToolEventInput[]): { fastPath: boolean; endReason: string; llmCalls: number; toolCalls: number; rounds: number; totalMs: number; ttftMs?: number } | null => {
  const detail = events.filter((event) => event.toolName === 'turn_metrics').at(-1)?.detail;
  return detail ? JSON.parse(detail) : null;
};

describe('runEvidenceDrivenRepositoryChatTurn fast path (§1.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('answers a first-turn install question from the root README with a single LLM call', async () => {
    configureTreeAndFiles({ 'README.md': README_WITH_INSTALL, 'docs/other.md': 'plain notes' });
    respondByPrompt({ answer: () => CITED_ANSWER });
    const events: ChatToolEventInput[] = [];

    const result = await runEvidenceDrivenRepositoryChatTurn(turnInput('How do I install this project?', {
      onToolEvent: (event) => events.push(event),
    }));

    // 回答前 LLM 调用 1 次：understanding / plan / gate 全部跳过。
    expect(mocks.generateChatText).toHaveBeenCalledTimes(1);
    expect(mocks.generateChatText.mock.calls[0]?.[0]?.system).toContain('Repository Copilot');
    expect(mocks.generateChatText.mock.calls[0]?.[0]?.system).toContain('Install with the skills CLI');
    expect(result.evidences).toHaveLength(1);
    expect(result.evidences[0]).toMatchObject({ path: 'README.md', lineStart: 3, lineEnd: 5 });
    expect(result.content).toContain('npx example install');

    const metrics = turnMetricsEvent(events);
    expect(metrics).toMatchObject({ fastPath: true, endReason: 'fast_path', llmCalls: 1, toolCalls: 2, rounds: 0 });
  });

  it('records ttft and streams the fast-path answer when streaming is enabled', async () => {
    configureTreeAndFiles({ 'README.md': README_WITH_INSTALL });
    respondByPrompt({});
    mocks.generateChatTextStream.mockImplementation(async (options: { onChunk?: (delta: string) => void }) => {
      options.onChunk?.('Run ');
      options.onChunk?.(`\`npx example install\` \`${INSTALL_SECTION_REFERENCE}\``);
      return `Run \`npx example install\` \`${INSTALL_SECTION_REFERENCE}\``;
    });
    const events: ChatToolEventInput[] = [];

    await runEvidenceDrivenRepositoryChatTurn(turnInput('How do I install this project?', {
      streaming: true,
      onAnswerChunk: vi.fn(),
      onToolEvent: (event) => events.push(event),
    }));

    expect(mocks.generateChatText).not.toHaveBeenCalled();
    expect(mocks.generateChatTextStream).toHaveBeenCalledTimes(1);
    const metrics = turnMetricsEvent(events);
    expect(metrics).toMatchObject({ fastPath: true, endReason: 'fast_path', llmCalls: 1 });
    expect(metrics?.ttftMs).toBeGreaterThanOrEqual(0);
  });

  it('runs the full loop when the setting is disabled', async () => {
    configureTreeAndFiles({ 'README.md': README_WITH_INSTALL, 'docs/other.md': 'plain usage notes without headings' });
    const answerCalls = respondByPrompt({});
    const events: ChatToolEventInput[] = [];

    await runEvidenceDrivenRepositoryChatTurn(turnInput('How do I install this project?', {
      fastPath: false,
      onToolEvent: (event) => events.push(event),
    }));

    // understanding 被调用（第一个 LLM 调用不是回答）。
    expect(mocks.generateChatText.mock.calls[0]?.[0]?.system).toContain('Query Understanding');
    expect(answerCalls()).toBeGreaterThanOrEqual(1);
    const metrics = turnMetricsEvent(events);
    expect(metrics).toMatchObject({ fastPath: false });
    expect(metrics?.llmCalls).toBe(mocks.generateChatText.mock.calls.length);
    expect(metrics?.rounds).toBeGreaterThanOrEqual(1);
  });

  it('runs the full loop for deep and unlimited depths', async () => {
    configureTreeAndFiles({ 'README.md': README_WITH_INSTALL, 'docs/other.md': 'plain usage notes without headings' });
    respondByPrompt({});

    await runEvidenceDrivenRepositoryChatTurn(turnInput('How do I install this project?', { taskDepth: 'deep' }));
    await runEvidenceDrivenRepositoryChatTurn(turnInput('How do I install this project?', { taskDepth: 'unlimited' }));

    // 两次运行各自都以 understanding 开头（快速路径未启用）。
    const understandingCalls = mocks.generateChatText.mock.calls
      .filter((call) => String((call[0] as { system?: string })?.system).includes('Query Understanding'));
    expect(understandingCalls).toHaveLength(2);
  });

  it('runs the full loop for follow-up questions that already have an assistant answer', async () => {
    configureTreeAndFiles({ 'README.md': README_WITH_INSTALL, 'docs/other.md': 'plain usage notes without headings' });
    respondByPrompt({});
    const messages = [
      { id: 'm1', sessionId: session.id, role: 'user' as const, content: 'What is this project?', status: 'complete' as const, evidenceIds: [], createdAt: '2026-08-26T00:00:01.000Z' },
      { id: 'm2', sessionId: session.id, role: 'assistant' as const, content: 'A demo project. `/README.md - 1-1`', status: 'complete' as const, evidenceIds: [], createdAt: '2026-08-26T00:00:02.000Z' },
    ];

    await runEvidenceDrivenRepositoryChatTurn(turnInput('How do I install this project?', { messages: [...messages, messages[0]] }));

    expect(mocks.generateChatText.mock.calls[0]?.[0]?.system).toContain('Query Understanding');
  });

  it('falls back to the full loop when the README has no matching section', async () => {
    configureTreeAndFiles({ 'README.md': '# Example Project\n\n## Changelog\n\n1.0.0', 'docs/other.md': 'plain usage notes without headings' });
    respondByPrompt({});
    const events: ChatToolEventInput[] = [];

    await runEvidenceDrivenRepositoryChatTurn(turnInput('How do I install this project?', {
      onToolEvent: (event) => events.push(event),
    }));

    expect(mocks.generateChatText.mock.calls[0]?.[0]?.system).toContain('Query Understanding');
    const metrics = turnMetricsEvent(events);
    expect(metrics).toMatchObject({ fastPath: false });
    // README 只读取一次：快速路径的读取被完整循环的缓存复用。
    const readmeReads = mocks.getRepositoryFile.mock.calls.filter((call: unknown[]) => call[2] === 'README.md');
    expect(readmeReads).toHaveLength(1);
  });

  it('falls back to the full loop when the fast-path answer cannot be verified', async () => {
    configureTreeAndFiles({ 'README.md': README_WITH_INSTALL });
    // 快速路径的回答与引用修复都不可核验时，才回落完整循环。
    respondByPrompt({
      answer: () => (mocks.generateChatText.mock.calls.length <= 2 ? 'I cannot verify any of this.' : CITED_ANSWER),
    });
    const events: ChatToolEventInput[] = [];

    const result = await runEvidenceDrivenRepositoryChatTurn(turnInput('How do I install this project?', {
      onToolEvent: (event) => events.push(event),
    }));

    // 第 1、2 次调用是快速路径回答与修复（未被引用校验通过），随后回落完整循环。
    expect(mocks.generateChatText.mock.calls[0]?.[0]?.system).toContain('Repository Copilot');
    expect(mocks.generateChatText.mock.calls[1]?.[0]?.system).toContain('Repository Copilot');
    expect(mocks.generateChatText.mock.calls[2]?.[0]?.system).toContain('Query Understanding');
    expect(result.content).toContain('npx example install');
    const answerRounds = events
      .filter((event) => event.toolName === 'synthesize_answer' && event.stage === 'answer')
      .map((event) => event.round);
    expect(answerRounds).toContain(0);
    expect(answerRounds).toContain(1);
    const metrics = turnMetricsEvent(events);
    expect(metrics).toMatchObject({ fastPath: false });
    expect(metrics?.llmCalls).toBe(mocks.generateChatText.mock.calls.length);
  });

  it('clears an unverified streamed fast-path draft before falling back', async () => {
    configureTreeAndFiles({ 'README.md': README_WITH_INSTALL, 'docs/other.md': 'plain usage notes without headings' });
    respondByPrompt({ answer: () => 'I cannot verify any of this.' });
    mocks.generateChatTextStream
      .mockImplementationOnce(async (options: { onChunk?: (delta: string) => void }) => {
        options.onChunk?.('Unverified fast-path draft.');
        return 'Unverified fast-path draft.';
      })
      .mockImplementationOnce(async (options: { onChunk?: (delta: string) => void }) => {
        options.onChunk?.(CITED_ANSWER);
        return CITED_ANSWER;
      });
    const onAnswerChunk = vi.fn();

    const result = await runEvidenceDrivenRepositoryChatTurn(turnInput('How do I install this project?', {
      streaming: true,
      onAnswerChunk,
    }));

    const streamed = onAnswerChunk.mock.calls.map((call) => String(call[0]));
    const clearedAt = streamed.indexOf('');
    expect(clearedAt).toBeGreaterThan(0);
    expect(streamed.slice(0, clearedAt)).toContain('Unverified fast-path draft.');
    const understandingCallIndex = mocks.generateChatText.mock.calls.findIndex(
      ([options]) => String((options as { system?: string })?.system).includes('Query Understanding'),
    );
    expect(understandingCallIndex).toBeGreaterThanOrEqual(0);
    expect(onAnswerChunk.mock.invocationCallOrder[clearedAt]).toBeLessThan(
      mocks.generateChatText.mock.invocationCallOrder[understandingCallIndex]!,
    );
    expect(streamed.slice(clearedAt + 1).join('')).toContain('npx example install');
    expect(result.content).toContain('npx example install');
  });

  it('answers install and deployment questions with evidence from both matched sections', async () => {
    const readme = [
      '# Example Project',
      '',
      '## Install',
      'Run `npx example install`.',
      '',
      '## Deployment',
      'Deploy with `docker compose up`.',
    ].join('\n');
    configureTreeAndFiles({ 'README.md': readme });
    respondByPrompt({
      answer: () => 'Install with `npx example install` `/README.md - 3-5` and deploy with docker `/README.md - 6-7`',
    });
    const events: ChatToolEventInput[] = [];

    const result = await runEvidenceDrivenRepositoryChatTurn(turnInput('How do I install and deploy this project?', {
      onToolEvent: (event) => events.push(event),
    }));

    // 问题同时命中安装与部署意图：两类章节都进入证据，仍是单次回答调用。
    expect(mocks.generateChatText).toHaveBeenCalledTimes(1);
    expect(result.evidences.map((evidence) => evidence.lineStart)).toEqual([3, 6]);
    expect(result.content).toContain('npx example install');
    expect(result.content).toContain('/README.md - 6-7');
    expect(turnMetricsEvent(events)).toMatchObject({ fastPath: true, endReason: 'fast_path', llmCalls: 1 });
  });

  it('keeps the read budget available for the fallback loop when maxReadFiles is 1', async () => {
    configureTreeAndFiles({ 'README.md': '# Example Project\n\n## Changelog\n\n1.0.0', 'docs/deploy.md': 'plain deployment notes without headings' });
    respondByPrompt({});
    const events: ChatToolEventInput[] = [];

    await runEvidenceDrivenRepositoryChatTurn(turnInput('How do I install this project?', {
      agentBudget: { maxTurns: 4, maxToolCalls: 12, maxReadFiles: 1, maxCodeReads: 0, maxNoProgressRounds: 2, maxDurationMs: 90_000 },
      onToolEvent: (event) => events.push(event),
    }));

    // 快速路径的 README 预读不占用读取预算：回落循环仍能读取部署文档。
    const deployReads = mocks.getRepositoryFile.mock.calls.filter((call: unknown[]) => call[2] === 'docs/deploy.md');
    expect(deployReads).toHaveLength(1);
    expect(turnMetricsEvent(events)).toMatchObject({ fastPath: false });
  });

  it('answers through the fast path in the native tool loop without model tool calls', async () => {
    configureTreeAndFiles({ 'README.md': README_WITH_INSTALL, 'docs/other.md': 'plain usage notes without headings' });
    respondByPrompt({ answer: () => CITED_ANSWER });
    const events: ChatToolEventInput[] = [];

    const result = await runToolLoopRepositoryChatTurn(turnInput('How do I install this project?', {
      onToolEvent: (event) => events.push(event),
    }));

    expect(mocks.generateWithTools).not.toHaveBeenCalled();
    expect(mocks.generateChatText).toHaveBeenCalledTimes(1);
    expect(result.evidences).toHaveLength(1);
    expect(result.evidences[0]).toMatchObject({ path: 'README.md', lineStart: 3, lineEnd: 5 });
    expect(turnMetricsEvent(events)).toMatchObject({ fastPath: true, endReason: 'fast_path', llmCalls: 1, rounds: 0 });
  });

  it('records an aborted turn_metrics event when the user stops the turn', async () => {
    configureTreeAndFiles({ 'README.md': README_WITH_INSTALL });
    respondByPrompt({});
    const events: ChatToolEventInput[] = [];
    const controller = new AbortController();
    controller.abort();

    await expect(runEvidenceDrivenRepositoryChatTurn(turnInput('How do I install this project?', {
      signal: controller.signal,
      onToolEvent: (event) => events.push(event),
    }))).rejects.toThrow();

    expect(turnMetricsEvent(events)).toMatchObject({ fastPath: false, endReason: 'aborted' });
  });
});

describe('synthesizeVerifiedAnswer answer intent', () => {
  it('uses creative formatting when the question asks for an article even if retrieval intent is general', async () => {
    const callModelWithRetry = vi.fn().mockResolvedValue(`An article about the project. \`${INSTALL_SECTION_REFERENCE}\``);

    await synthesizeVerifiedAnswer(
      {} as never,
      turnInput('Write an article about this project'),
      [installEvidence],
      1,
      1000,
      callModelWithRetry,
    );

    const system = callModelWithRetry.mock.calls[0]?.[5];
    expect(system).toContain('Structure: deliver the requested work');
    expect(system).not.toContain('Structure: lead with what the project is');
  });

  it('keeps a 70%-covered answer but marks the remaining uncited facts', async () => {
    const answer = Array.from({ length: 10 }, (_, index) => (
      `Version ${index + 1} is documented.${index < 7 ? ` \`${INSTALL_SECTION_REFERENCE}\`` : ''}`
    )).join('\n\n');
    const callModelWithRetry = vi.fn().mockResolvedValue(answer);

    const content = await synthesizeVerifiedAnswer(
      {} as never,
      turnInput('How do I install this project?'),
      [installEvidence],
      1,
      2000,
      callModelWithRetry,
    );

    expect(callModelWithRetry).toHaveBeenCalledTimes(1);
    expect(content).toContain('Version 7 is documented.');
    expect(content).toContain('Unverified or missing information');
    expect(content).toContain('Version 10 is documented.');
  });

  it('marks remaining uncited facts in a 70%-covered creative answer', async () => {
    const answer = Array.from({ length: 10 }, (_, index) => (
      `Version ${index + 1} is documented.${index < 7 ? ` \`${INSTALL_SECTION_REFERENCE}\`` : ''}`
    )).join('\n\n');
    const callModelWithRetry = vi.fn().mockResolvedValue(answer);

    const content = await synthesizeVerifiedAnswer(
      {} as never,
      turnInput('Write an article about this project'),
      [installEvidence],
      1,
      2000,
      callModelWithRetry,
    );

    expect(content).toContain('Version 7 is documented.');
    expect(content).toContain('Unverified or missing information');
    expect(content).toContain('Version 10 is documented.');
  });

  it('lifts a standalone citation before validating the answer', async () => {
    const answer = [
      'Run this:',
      '',
      '```bash',
      'npm install',
      '```',
      '',
      `\`${INSTALL_SECTION_REFERENCE}\``,
    ].join('\n');
    const callModelWithRetry = vi.fn().mockResolvedValue(answer);

    const content = await synthesizeVerifiedAnswer(
      {} as never,
      turnInput('How do I install this project?'),
      [installEvidence],
      1,
      1000,
      callModelWithRetry,
    );

    expect(content).toContain(`Run this: \`${INSTALL_SECTION_REFERENCE}\``);
    expect(content).toContain('npm install');
    expect(content).not.toContain('Unverified or missing information');
  });
});
