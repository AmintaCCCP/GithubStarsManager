import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIConfig, Repository } from '../types';
import type { RepositoryChatSession } from '../types/repositoryChat';

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

vi.mock('./aiService', () => ({
  AIService: class {
    generateChatText = mocks.generateChatText;
    generateChatTextStream = mocks.generateChatTextStream;
    generateWithTools = mocks.generateWithTools;
  },
  isAIStreamUnsupportedError: (error: unknown): boolean => error instanceof Error && error.name === 'AIStreamUnsupportedError',
  isAIToolCallUnsupportedError: (error: unknown): boolean => error instanceof Error && error.name === 'AIToolCallUnsupportedError',
  supportsChatToolCalls: (): boolean => true,
}));

vi.mock('./githubApiFactory', () => ({
  createGitHubApiService: () => ({
    getRepositoryTree: mocks.getRepositoryTree,
    getRepositoryFile: mocks.getRepositoryFile,
    getRepositoryMarkdownEvidenceFile: mocks.getRepositoryMarkdownEvidenceFile,
    getRepositoryReleases: mocks.getRepositoryReleases,
    searchRepositoryIssues: mocks.searchRepositoryIssues,
    getRepositoryIssueComments: mocks.getRepositoryIssueComments,
  }),
}));

import { runToolLoopRepositoryChatTurn } from './agentToolLoop';

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

const turnInput = (question: string) => ({
  repository,
  session,
  messages: [],
  question,
  githubToken: 'github-token',
  aiConfig,
  language: 'en' as const,
  maxToolsPerTurn: 12,
  agentBudget: { maxTurns: 6, maxToolCalls: 12, maxReadFiles: 8, maxCodeReads: 3, maxNoProgressRounds: 2, maxDurationMs: 90_000 },
});

const README = [
  '# Example Project',
  '',
  '## Overview',
  'A documented example project for repository research.',
].join('\n');

const toolCall = (id: string, name: string, args: Record<string, unknown> = {}) => ({ id, name, arguments: JSON.stringify(args) });
const modelTurn = (toolCalls: ReturnType<typeof toolCall>[]) => ({ content: '', toolCalls });

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

const releasesPayload = [
  {
    id: 1,
    tag_name: 'v1.0.0',
    name: 'First release',
    body: 'Adds a dashboard.',
    published_at: '2026-07-01T00:00:00.000Z',
    html_url: 'https://github.com/owner/example/releases/tag/v1.0.0',
    prerelease: false,
    assets: [
      { id: 11, name: 'app-macos.dmg', size: 1024, download_count: 5, browser_download_url: 'https://example.com/a.dmg', content_type: 'application/x-apple-diskimage', created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z' },
    ],
  },
];

describe('runToolLoopRepositoryChatTurn (native function-calling loop)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks 不清 Once 队列：显式 reset，防止用例间响应串味。
    mocks.generateWithTools.mockReset();
    mocks.generateChatText.mockReset();
    mocks.generateChatTextStream.mockReset();
    configureTreeAndFiles({
      'README.md': README,
      'src/engine.ts': 'export const switchProxy = () => "implementation detail";',
    });
  });

  it('gathers documentation then release evidence and synthesizes a cited answer', async () => {
    mocks.getRepositoryReleases.mockResolvedValue(releasesPayload);
    mocks.generateWithTools
      .mockResolvedValueOnce(modelTurn([toolCall('c1', 'read_documentation', { path: 'README.md' })]))
      .mockResolvedValueOnce(modelTurn([toolCall('c2', 'read_recent_releases')]))
      .mockResolvedValueOnce(modelTurn([toolCall('c3', 'ready_to_answer', { missing: [] })]));
    mocks.generateChatText.mockResolvedValueOnce(
      '## Updates\n\nThe first release adds a dashboard. `/README.md - 1-4`\n\nAssets ship for macOS. `/release-v1.0.0.md - 1-3`',
    );

    const result = await runToolLoopRepositoryChatTurn(turnInput('What changed recently?'));

    expect(mocks.generateWithTools).toHaveBeenCalledTimes(3);
    expect(mocks.getRepositoryReleases).toHaveBeenCalledTimes(1);
    expect(result.content).toContain('/README.md - 1-4');
    expect(result.content).toContain('/release-v1.0.0.md - 1-3');
    expect(result.evidences.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects non-documentation reads before documentation evidence exists (README-first, enforced in code)', async () => {
    mocks.generateWithTools
      .mockResolvedValueOnce(modelTurn([toolCall('c1', 'read_recent_releases')]))
      .mockImplementationOnce(async ({ messages }: { messages: Array<{ role: string; content?: unknown }> }) => {
        const last = messages[messages.length - 1] as { role: string; content: string };
        expect(last.role).toBe('tool');
        expect(last.content).toContain('Rejected: call read_documentation');
        return modelTurn([toolCall('c2', 'read_documentation', { path: 'README.md' })]);
      })
      .mockResolvedValueOnce(modelTurn([toolCall('c3', 'ready_to_answer', {})]));
    mocks.generateChatText.mockResolvedValueOnce('## Overview\n\nA documented example project. `/README.md - 1-4`');

    const result = await runToolLoopRepositoryChatTurn(turnInput('What is this project?'));

    // 被拒绝的那一轮不得触发任何 Release 读取。
    expect(mocks.getRepositoryReleases).not.toHaveBeenCalled();
    expect(result.content).toContain('/README.md - 1-4');
  });

  it('returns the insufficient-evidence response when the model never gathers evidence', async () => {
    mocks.generateWithTools
      .mockResolvedValueOnce(modelTurn([toolCall('c1', 'read_documentation', { path: 'docs/missing.md' })]))
      .mockResolvedValueOnce(modelTurn([toolCall('c2', 'ready_to_answer', { missing: ['everything'] })]));

    const result = await runToolLoopRepositoryChatTurn(turnInput('What does this project do?'));

    expect(result.evidences).toHaveLength(0);
    expect(result.content).toContain('insufficient');
  });
});
