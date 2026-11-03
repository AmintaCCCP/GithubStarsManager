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
import { reusablePriorEvidence, runEvidenceDrivenRepositoryChatTurn, synthesizeVerifiedAnswer, type RepositoryChatTurnInput } from './loop';

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
const RELEASES = [{
  id: 1,
  tag_name: 'v2.0.0',
  name: 'Second release',
  body: 'Adds a desktop build.',
  published_at: '2026-08-20T00:00:00.000Z',
  html_url: 'https://github.com/owner/example/releases/tag/v2.0.0',
  prerelease: false,
  assets: [],
}];
const installEvidence: ToolEvidence = {
  id: 'evidence-install',
  source: 'github',
  repoFullName: repository.full_name,
  refSha: session.sourceRefSha,
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

describe('reusablePriorEvidence (§5.1)', () => {
  it('reuses only immutable GitHub file evidence from the same pinned SHA', () => {
    const releaseEvidence: ToolEvidence = {
      id: 'evidence-release',
      source: 'github',
      repoFullName: repository.full_name,
      path: 'release-v1.0.0.md',
      lineStart: 1,
      lineEnd: 3,
      url: 'https://github.com/owner/example/releases/tag/v1.0.0',
      excerpt: 'Release v1.0.0',
      retrievedAt: '2026-08-01T00:00:00.000Z',
    };
    const webEvidence: ToolEvidence = {
      ...installEvidence,
      id: 'evidence-web',
      source: 'web',
    };
    const otherRepositoryEvidence: ToolEvidence = {
      ...installEvidence,
      id: 'evidence-other-repository',
      repoFullName: 'owner/other',
    };

    expect(reusablePriorEvidence(turnInput('Can you repeat that?', {
      priorEvidence: [installEvidence, releaseEvidence, webEvidence, otherRepositoryEvidence],
    }))).toEqual([installEvidence]);
  });
});

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

  it('falls back to the full loop when the fast path only reports “not found”', async () => {
    configureTreeAndFiles({ 'README.md': README_WITH_INSTALL, 'docs/other.md': 'plain usage notes without headings' });
    let answerCalls = 0;
    respondByPrompt({
      answer: () => {
        answerCalls += 1;
        return answerCalls <= 2 ? '> Not found in the files read: install steps' : CITED_ANSWER;
      },
    });
    const events: ChatToolEventInput[] = [];

    const result = await runEvidenceDrivenRepositoryChatTurn(turnInput('How do I install this project?', {
      onToolEvent: (event) => events.push(event),
    }));

    expect(result.content).toContain('npx example install');
    expect(mocks.generateChatText.mock.calls.some((call) => (
      String((call[0] as { system?: string })?.system).includes('Query Understanding')
    ))).toBe(true);
    expect(turnMetricsEvent(events)).toMatchObject({ fastPath: false });
  });

  it('falls back to the full loop when the “not found” note has no blockquote prefix', async () => {
    configureTreeAndFiles({ 'README.md': README_WITH_INSTALL, 'docs/other.md': 'plain usage notes without headings' });
    let answerCalls = 0;
    respondByPrompt({
      answer: () => {
        answerCalls += 1;
        return answerCalls <= 2 ? 'Not found in the files read: install steps' : CITED_ANSWER;
      },
    });
    const events: ChatToolEventInput[] = [];

    const result = await runEvidenceDrivenRepositoryChatTurn(turnInput('How do I install this project?', {
      onToolEvent: (event) => events.push(event),
    }));

    expect(result.content).toContain('npx example install');
    expect(turnMetricsEvent(events)).toMatchObject({ fastPath: false });
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

  it('answers from evidence read this turn when the gate output is invalid and the budget runs out', async () => {
    configureTreeAndFiles({ 'README.md': README_WITH_INSTALL });
    respondByPrompt({
      plan: JSON.stringify({
        rationale: 'Read the install section.',
        targets: [{ path: 'README.md', sections: ['Install'], purpose: 'installation steps', scope: 'documentation' }],
      }),
      gate: '{}',
      answer: () => CITED_ANSWER,
    });
    const events: ChatToolEventInput[] = [];

    const result = await runEvidenceDrivenRepositoryChatTurn(turnInput('How do I install this project?', {
      fastPath: false,
      agentBudget: { maxTurns: 1, maxToolCalls: 12, maxReadFiles: 8, maxCodeReads: 3, maxNoProgressRounds: 2, maxDurationMs: 90_000 },
      onToolEvent: (event) => events.push(event),
    }));

    expect(result.content).toContain('npx example install');
    expect(result.content).not.toContain('insufficient');
    expect(mocks.generateChatText.mock.calls.at(-1)?.[0]?.user).toContain('Unmet answer requirements');
    expect(turnMetricsEvent(events)).toMatchObject({ fastPath: false, endReason: 'turn_budget', rounds: 1 });
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

  it('uses the understanding standalone question for follow-up retrieval', async () => {
    configureTreeAndFiles({ 'README.md': README_WITH_INSTALL });
    respondByPrompt({
      understanding: JSON.stringify({
        standalone_question: 'How do I install this project on Windows?',
        intent: 'installation',
        explicit_requirements: ['Windows installation steps'],
        initial_targets: ['README.md'],
        target: 'Windows installation',
      }),
      plan: JSON.stringify({
        rationale: 'Read the install section.',
        targets: [{ path: 'README.md', sections: ['Install'], purpose: 'Windows installation steps', scope: 'documentation' }],
      }),
      gate: JSON.stringify({
        sufficient: true,
        confidence: 0.95,
        reason: 'The install section answers the question.',
        requirements: [{
          requirement_id: 'explicit-1',
          requirement: 'Windows installation steps',
          status: 'verified',
          evidence: [INSTALL_SECTION_REFERENCE],
        }],
        next_action: 'answer',
      }),
      answer: () => CITED_ANSWER,
    });
    const messages = [
      { id: 'm1', sessionId: session.id, role: 'user' as const, content: 'How do I install this project?', status: 'complete' as const, evidenceIds: [], createdAt: '2026-08-26T00:00:01.000Z' },
      { id: 'm2', sessionId: session.id, role: 'assistant' as const, content: `Run the installer. \`${INSTALL_SECTION_REFERENCE}\``, status: 'complete' as const, evidenceIds: [], createdAt: '2026-08-26T00:00:02.000Z' },
      { id: 'm3', sessionId: session.id, role: 'user' as const, content: 'What about Windows?', status: 'complete' as const, evidenceIds: [], createdAt: '2026-08-26T00:00:03.000Z' },
    ];

    await runEvidenceDrivenRepositoryChatTurn(turnInput('What about Windows?', { messages }));

    const planCall = mocks.generateChatText.mock.calls.find((call) => String(call[0]?.system).includes('retrieval planner'));
    expect(planCall?.[0]?.user).toContain('Question: How do I install this project on Windows?');
  });

  it('answers from prior evidence before planning when the follow-up is already covered', async () => {
    configureTreeAndFiles({ 'README.md': README_WITH_INSTALL });
    mocks.getRepositoryTree.mockRejectedValue(new Error('tree unavailable'));
    respondByPrompt({
      understanding: JSON.stringify({
        standalone_question: 'How do I install this project?',
        intent: 'installation',
        explicit_requirements: ['installation steps'],
        initial_targets: ['README.md'],
        target: 'installation',
      }),
      gate: JSON.stringify({
        sufficient: true,
        confidence: 0.95,
        reason: 'Prior evidence already covers the follow-up.',
        requirements: [{
          requirement_id: 'explicit-1',
          requirement: 'installation steps',
          status: 'verified',
          evidence: [INSTALL_SECTION_REFERENCE],
        }],
        next_action: 'answer',
      }),
      answer: () => CITED_ANSWER,
    });
    const messages = [
      { id: 'm1', sessionId: session.id, role: 'user' as const, content: 'How do I install this project?', status: 'complete' as const, evidenceIds: [installEvidence.id], createdAt: '2026-08-26T00:00:01.000Z' },
      { id: 'm2', sessionId: session.id, role: 'assistant' as const, content: `Run the installer. \`${INSTALL_SECTION_REFERENCE}\``, status: 'complete' as const, evidenceIds: [installEvidence.id], createdAt: '2026-08-26T00:00:02.000Z' },
      { id: 'm3', sessionId: session.id, role: 'user' as const, content: 'Can you repeat that?', status: 'complete' as const, evidenceIds: [], createdAt: '2026-08-26T00:00:03.000Z' },
    ];
    const events: ChatToolEventInput[] = [];

    const result = await runEvidenceDrivenRepositoryChatTurn(turnInput('Can you repeat that?', {
      messages,
      priorEvidence: [installEvidence],
      onToolEvent: (event) => events.push(event),
    }));

    expect(mocks.generateChatText).toHaveBeenCalledTimes(3);
    expect(mocks.getRepositoryTree).not.toHaveBeenCalled();
    expect(mocks.getRepositoryFile).not.toHaveBeenCalled();
    expect(result.content).toContain('npx example install');
    expect(turnMetricsEvent(events)).toMatchObject({ endReason: 'prior_evidence', rounds: 0 });
  });

  it('does not answer from prior evidence that the follow-up gate did not verify', async () => {
    configureTreeAndFiles({});
    respondByPrompt({
      understanding: JSON.stringify({
        standalone_question: 'How do I configure the widget?',
        intent: 'configuration',
        explicit_requirements: ['configuration steps'],
        initial_targets: [],
        target: 'widget configuration',
      }),
      gate: JSON.stringify({
        sufficient: false,
        confidence: 0.9,
        reason: 'The installation evidence does not cover configuration.',
        requirements: [{
          requirement_id: 'explicit-1',
          requirement: 'configuration steps',
          status: 'missing',
          evidence: [],
        }],
        next_action: 'stop',
      }),
      answer: () => CITED_ANSWER,
    });
    const messages = [
      { id: 'm1', sessionId: session.id, role: 'user' as const, content: 'How do I install this project?', status: 'complete' as const, evidenceIds: [installEvidence.id], createdAt: '2026-08-26T00:00:01.000Z' },
      { id: 'm2', sessionId: session.id, role: 'assistant' as const, content: CITED_ANSWER, status: 'complete' as const, evidenceIds: [installEvidence.id], createdAt: '2026-08-26T00:00:02.000Z' },
      { id: 'm3', sessionId: session.id, role: 'user' as const, content: 'What about configuration?', status: 'complete' as const, evidenceIds: [], createdAt: '2026-08-26T00:00:03.000Z' },
    ];

    const result = await runEvidenceDrivenRepositoryChatTurn(turnInput('What about configuration?', {
      messages,
      priorEvidence: [installEvidence],
    }));

    expect(result.content).not.toContain('npx example install');
  });

  it('fetches release metadata before answering a latest-version follow-up from prior evidence', async () => {
    configureTreeAndFiles({});
    mocks.getRepositoryReleases.mockResolvedValue(RELEASES);
    respondByPrompt({
      understanding: JSON.stringify({
        standalone_question: 'What is the latest release?',
        intent: 'feature_overview',
        explicit_requirements: ['latest release'],
        initial_targets: [],
        target: 'latest release',
      }),
      gate: JSON.stringify({
        sufficient: true,
        confidence: 0.95,
        reason: 'The release evidence covers the question.',
        requirements: [{
          requirement_id: 'explicit-1',
          requirement: 'latest release',
          status: 'verified',
          evidence: ['/release-v2.0.0.md - 1-4'],
        }],
        next_action: 'answer',
      }),
      answer: () => 'The latest release adds a desktop build. `/release-v2.0.0.md - 1-4`',
    });
    const messages = [
      { id: 'm1', sessionId: session.id, role: 'user' as const, content: 'What changed before?', status: 'complete' as const, evidenceIds: [installEvidence.id], createdAt: '2026-08-26T00:00:01.000Z' },
      { id: 'm2', sessionId: session.id, role: 'assistant' as const, content: CITED_ANSWER, status: 'complete' as const, evidenceIds: [installEvidence.id], createdAt: '2026-08-26T00:00:02.000Z' },
      { id: 'm3', sessionId: session.id, role: 'user' as const, content: 'What is the latest release?', status: 'complete' as const, evidenceIds: [], createdAt: '2026-08-26T00:00:03.000Z' },
    ];

    const result = await runEvidenceDrivenRepositoryChatTurn(turnInput('What is the latest release?', {
      messages,
      priorEvidence: [installEvidence],
    }));

    expect(mocks.getRepositoryReleases).toHaveBeenCalledTimes(1);
    expect(result.content).toContain('/release-v2.0.0.md - 1-4');
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

  it('keeps a 70%-covered answer and drops the unverified tail', async () => {
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

    // 一次原回答 + 两次“未核验段落补引用”的修复尝试；仍不干净时只保留已核验部分。
    expect(callModelWithRetry).toHaveBeenCalledTimes(3);
    expect(content).toContain('Version 7 is documented.');
    expect(content).not.toContain('Unverified or missing information');
    expect(content).not.toContain('Version 10 is documented.');
  });

  it('drops the unverified tail from a 70%-covered creative answer', async () => {
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
    expect(content).not.toContain('Unverified or missing information');
    expect(content).not.toContain('Version 10 is documented.');
  });

  it('repairs a demoted answer by adding the missing exact references', async () => {
    const demoted = `Version 1 is documented. \`${INSTALL_SECTION_REFERENCE}\`\n\nVersion 2 is documented.`;
    const repaired = `Version 1 is documented. \`${INSTALL_SECTION_REFERENCE}\`\n\nVersion 2 is documented. \`${INSTALL_SECTION_REFERENCE}\``;
    const callModelWithRetry = vi.fn()
      .mockResolvedValueOnce(demoted)
      .mockResolvedValueOnce(JSON.stringify({ answer: repaired }));

    const content = await synthesizeVerifiedAnswer(
      {} as never,
      turnInput('How do I install this project?'),
      [installEvidence],
      1,
      2000,
      callModelWithRetry,
    );

    expect(callModelWithRetry).toHaveBeenCalledTimes(2);
    expect(callModelWithRetry.mock.calls[1]?.[6]).toContain('PREVIOUS OUTPUT');
    expect(callModelWithRetry.mock.calls[1]?.[12]).toBe('internal-json');
    expect(content).toContain('Version 2 is documented.');
    expect(content).toContain('Version 1 is documented.');
    expect(content).not.toContain('Unverified or missing information');
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
