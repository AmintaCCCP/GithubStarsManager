import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIConfig, Repository } from '../../src/types';
import type { RepositoryChatMessage, RepositoryChatSession, RepositoryChatToolEvent } from '../../src/types/repositoryChat';

const mocks = vi.hoisted(() => ({
  generateChatTextDetailed: vi.fn(),
  getRepositoryTree: vi.fn(),
  getRepositoryFile: vi.fn(),
  getRepositoryMarkdownEvidenceFile: vi.fn(),
  getRepositoryReleases: vi.fn(),
  searchRepositoryIssues: vi.fn(),
  getRepositoryIssueComments: vi.fn(),
}));

vi.mock('../../src/services/aiService', () => ({
  AIService: class {
    generateChatTextDetailed = mocks.generateChatTextDetailed;
    generateChatText = vi.fn();
    generateChatTextStream = vi.fn();
    generateWithTools = vi.fn();
  },
  isAIStreamUnsupportedError: (error: unknown): boolean => error instanceof Error && error.name === 'AIStreamUnsupportedError',
  supportsChatToolCalls: (): boolean => true,
}));

vi.mock('../../src/services/githubApiFactory', () => ({
  createGitHubApiService: () => ({
    getRepositoryTree: mocks.getRepositoryTree,
    getRepositoryFile: mocks.getRepositoryFile,
    getRepositoryMarkdownEvidenceFile: mocks.getRepositoryMarkdownEvidenceFile,
    getRepositoryReleases: mocks.getRepositoryReleases,
    searchRepositoryIssues: mocks.searchRepositoryIssues,
    getRepositoryIssueComments: mocks.getRepositoryIssueComments,
  }),
}));

import { runEvidenceDrivenRepositoryChatTurn } from '../../src/services/chat/loop';
import { evaluateAnswer, malformedCitations } from './harness';

interface Fixture {
  repo: string;
  sha: string;
  question: string;
  language: 'zh' | 'en';
  tree: string[];
  files: Record<string, string>;
  responses: {
    understanding?: string;
    plan?: string;
    gate?: string;
    answer: string;
  };
  expect: {
    mustInclude: string[];
    readPaths: string[];
    fastPath: boolean;
    maxLlmCalls?: number;
    minRounds?: number;
  };
}

const loadFixture = (name: string): Fixture => JSON.parse(
  readFileSync(resolve(process.cwd(), `tests/repository-chat-eval/fixtures/${name}.json`), 'utf8'),
) as Fixture;

const repositoryFor = (fullName: string): Repository => {
  const [owner, name] = fullName.split('/');
  return {
    id: 1,
    name,
    full_name: fullName,
    description: null,
    html_url: `https://github.com/${fullName}`,
    stargazers_count: 0,
    forks_count: 0,
    forks: 0,
    language: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    pushed_at: '2026-01-01T00:00:00.000Z',
    owner: { login: owner, avatar_url: `https://github.com/${owner}.png` },
    topics: [],
  };
};

const aiConfig: AIConfig = {
  id: 'eval-fixture',
  name: 'eval-fixture',
  apiType: 'openai-compatible',
  baseUrl: 'https://example.com/v1',
  apiKey: 'test-key',
  model: 'fixture-model',
  isActive: true,
};

const runFixture = async (fixture: Fixture) => {
  const repository = repositoryFor(fixture.repo);
  const session: RepositoryChatSession = {
    id: 'fixture-session',
    repoId: repository.id,
    repoFullName: repository.full_name,
    sourceRefSha: fixture.sha,
    title: 'fixture',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const messages: RepositoryChatMessage[] = [{
    id: 'fixture-user',
    sessionId: session.id,
    role: 'user',
    content: fixture.question,
    status: 'complete',
    evidenceIds: [],
    createdAt: '2026-01-01T00:00:01.000Z',
  }];
  const events: RepositoryChatToolEvent[] = [];

  mocks.getRepositoryTree.mockResolvedValue({
    ref: fixture.sha,
    truncated: false,
    entries: fixture.tree.map((path) => ({ path, type: 'blob' })),
  });
  mocks.getRepositoryFile.mockImplementation(async (_owner: string, _repo: string, path: string) => ({
    path,
    ref: fixture.sha,
    sha: `file-${path}`,
    size: fixture.files[path]?.length ?? 0,
    content: fixture.files[path],
  }));
  mocks.getRepositoryMarkdownEvidenceFile.mockImplementation((...args: unknown[]) => mocks.getRepositoryFile(...args));
  mocks.getRepositoryReleases.mockResolvedValue([]);
  mocks.searchRepositoryIssues.mockResolvedValue([]);
  mocks.getRepositoryIssueComments.mockResolvedValue([]);
  mocks.generateChatTextDetailed.mockImplementation(async ({ system }: { system?: string }) => {
    const prompt = system ?? '';
    const text = prompt.includes('Query Understanding')
      ? fixture.responses.understanding
      : prompt.includes('retrieval planner')
        ? fixture.responses.plan
        : prompt.includes('Evidence Gate')
          ? fixture.responses.gate
          : fixture.responses.answer;
    return { text: text ?? '', finishReason: 'stop' };
  });

  const result = await runEvidenceDrivenRepositoryChatTurn({
    repository,
    session,
    messages,
    question: fixture.question,
    githubToken: 'github-token',
    aiConfig,
    language: fixture.language,
    maxToolsPerTurn: 12,
    onToolEvent: (event) => events.push(event),
  });

  return { result, events };
};

const metricsOf = (events: RepositoryChatToolEvent[]) => {
  const detail = events.filter((event) => event.toolName === 'turn_metrics').at(-1)?.detail;
  return detail ? JSON.parse(detail) as { fastPath: boolean; llmCalls: number; rounds: number } : null;
};

describe('repository chat fixture eval', () => {
  it('does not treat hyphenated paths as malformed citation ranges', () => {
    expect(malformedCitations('See `/packages/engine/ADR-20260828-obtain-output.md - 1-68`.')).toEqual([]);
    expect(malformedCitations('See `/a.md - 1-24` and `/README.md - 1` .')).toEqual([]);
    expect(malformedCitations('See `/README.md - 1-以24`.')).toHaveLength(1);
    expect(malformedCitations('See `/README.md - 1-24abc`.')).toHaveLength(1);
    expect(malformedCitations('See `/README.md - 1-24-extra`.')).toHaveLength(1);
    expect(malformedCitations('See `/README.md - 1-24-3`.')).toHaveLength(1);
    expect(malformedCitations('See `/README.md - 1-24 extra`.')).toHaveLength(1);
    expect(malformedCitations('See `/a.md - 1 - 24`.')).toEqual([]);
  });

  it('checks forbidden patterns outside call syntax only', () => {
    const base = { id: 'x', repo: 'a/b', question: 'q', language: 'en' as const, mustNotMatch: ['\\(\\s*\\)', 'download the binary'] };

    expect(evaluateAnswer(base, 'Call `start()` first.')).toEqual([]);
    expect(evaluateAnswer(base, 'It erases with `#clearDisplay()` (or moves the cursor).')).toEqual([]);
    expect(evaluateAnswer(base, 'Then run `download the binary` in the shell.')).toContain('unexpected /download the binary/');
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('answers an install question through the README fast path', async () => {
    const fixture = loadFixture('install-fast-path');
    const { result, events } = await runFixture(fixture);

    for (const keyword of fixture.expect.mustInclude) expect(result.content).toContain(keyword);
    expect(mocks.getRepositoryFile.mock.calls.map((call) => call[2])).toEqual(fixture.expect.readPaths);
    expect(metricsOf(events)).toMatchObject({
      fastPath: fixture.expect.fastPath,
      llmCalls: fixture.expect.maxLlmCalls,
      rounds: 0,
    });
  });

  it('runs the full evidence loop when the answer must rule out a missing artifact', async () => {
    const fixture = loadFixture('missing-answer-full-loop');
    const { result, events } = await runFixture(fixture);

    for (const keyword of fixture.expect.mustInclude) expect(result.content).toContain(keyword);
    expect(mocks.getRepositoryFile.mock.calls.map((call) => call[2])).toEqual(fixture.expect.readPaths);
    const metrics = metricsOf(events);
    expect(metrics?.fastPath).toBe(fixture.expect.fastPath);
    expect(metrics?.rounds).toBeGreaterThanOrEqual(fixture.expect.minRounds ?? 1);
  });
});
