import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { AIConfig, Repository } from '../types';
import type { RepositoryChatSession, RepositoryChatToolEvent } from '../types/repositoryChat';

const mocks = vi.hoisted(() => ({
  generateChatText: vi.fn(),
  getRepositoryTree: vi.fn(),
  getRepositoryFile: vi.fn(),
  getRepositoryMarkdownEvidenceFile: vi.fn(),
  vectorWrites: {
    indexAllRepos: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    cleanup: vi.fn(),
  },
}));

vi.mock('./aiService', () => ({
  AIService: class {
    generateChatText = mocks.generateChatText;
  },
}));

vi.mock('./githubApiFactory', () => ({
  createGitHubApiService: () => ({
    getRepositoryTree: mocks.getRepositoryTree,
    getRepositoryFile: mocks.getRepositoryFile,
    getRepositoryMarkdownEvidenceFile: mocks.getRepositoryMarkdownEvidenceFile,
  }),
}));

vi.mock('./vectorSearchService', () => ({
  indexAllRepos: mocks.vectorWrites.indexAllRepos,
  VectorSearchService: class {
    upsert = mocks.vectorWrites.upsert;
    delete = mocks.vectorWrites.delete;
    cleanup = mocks.vectorWrites.cleanup;
  },
}));

import { runRepositoryChatTurn } from './repositoryChatService';

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
  apiType: 'claude',
  baseUrl: 'https://example.com/v1',
  apiKey: 'test-key',
  model: 'test-model',
  isActive: true,
};

const turnInput = (question = 'What does this project do?') => ({
  repository,
  session,
  messages: [],
  question,
  githubToken: 'github-token',
  aiConfig,
  language: 'en' as const,
  maxToolsPerTurn: 8,
  agentBudget: {
    maxTurns: 4,
    maxToolCalls: 8,
    maxReadFiles: 6,
    maxCodeReads: 3,
    maxDurationMs: 90_000,
  },
});

const understanding = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  intent: 'overview',
  target: 'project purpose',
  initial_scope: 'documentation',
  ...overrides,
});

const gate = (sufficient: boolean, reason = sufficient ? 'The retrieved file directly answers the question.' : 'More evidence is needed.', nextAction?: 'continue_docs' | 'continue_code' | 'escalate_to_code' | 'stop') => JSON.stringify({
  sufficient,
  reason,
  missing: sufficient ? [] : ['additional repository details'],
  ...(nextAction ? { next_action: nextAction } : {}),
});

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

const readPaths = () => mocks.getRepositoryFile.mock.calls.map((call: unknown[]) => call[2]);

describe('runRepositoryChatTurn evidence-driven loop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureTreeAndFiles({
      'README.md': '# Example\n\nThis repository is a documented example project.',
      'docs/usage.md': '# Usage\n\nInstall with `npm install` and start with `npm run dev`.',
      'src/App.tsx': 'export const App = () => <main>implementation detail</main>;',
    });
  });

  it('uses the fast documentation-first path for a simple README question', async () => {
    mocks.generateChatText
      .mockResolvedValueOnce(understanding())
      .mockResolvedValueOnce(gate(true))
      .mockResolvedValueOnce('This project is a documented example project. `/README.md - 1-3`');
    const events: RepositoryChatToolEvent[] = [];

    const result = await runRepositoryChatTurn({ ...turnInput(), onToolEvent: (event) => events.push(event as RepositoryChatToolEvent) });

    expect(readPaths()).toEqual(['README.md']);
    expect(mocks.generateChatText).toHaveBeenCalledTimes(3);
    expect(result.content).toContain('`/README.md - 1-3`');
    expect(events.map((event) => [event.stage, event.round])).toEqual(expect.arrayContaining([
      ['understanding', undefined],
      ['retrieval', 1],
      ['verification', 1],
      ['answer', 1],
    ]));
  });

  it('treats insufficient evidence as a routing signal and continues through documentation', async () => {
    mocks.generateChatText
      .mockResolvedValueOnce(understanding({ target: 'installation and startup' }))
      .mockResolvedValueOnce(gate(false, 'README only describes the project purpose.', 'continue_docs'))
      .mockResolvedValueOnce(gate(true, 'The usage document contains the requested installation steps.'))
      .mockResolvedValueOnce('Install with `npm install` and start with `npm run dev`. `/docs/usage.md - 1-3`');

    const result = await runRepositoryChatTurn(turnInput('How do I install and start this project?'));

    expect(readPaths()).toEqual(['README.md', 'docs/usage.md']);
    expect(mocks.generateChatText).toHaveBeenCalledTimes(4);
    expect(result.content).toContain('`/docs/usage.md - 1-3`');
  });

  it('uses Evidence Check rather than intent alone to escalate to minimal code', async () => {
    mocks.generateChatText
      .mockResolvedValueOnce(understanding({ intent: 'implementation', initial_scope: 'implementation' }))
      .mockResolvedValueOnce(gate(false, 'The documentation does not describe the implementation.', 'escalate_to_code'))
      .mockResolvedValueOnce(gate(true, 'The implementation file answers the question.'))
      .mockResolvedValueOnce('The implementation renders the documented detail. `/src/App.tsx - 1`');

    const result = await runRepositoryChatTurn(turnInput('How is the implementation structured?'));

    expect(readPaths()).toEqual(['README.md', 'src/App.tsx']);
    expect(result.content).toContain('`/src/App.tsx - 1`');
  });

  it('does not synthesize when Evidence Check has no reliable next direction', async () => {
    configureTreeAndFiles({ 'README.md': '# Example\n\nOnly a project title.' });
    mocks.generateChatText
      .mockResolvedValueOnce(understanding())
      .mockResolvedValueOnce(gate(false, 'The repository has no answer for this question.', 'stop'));

    const result = await runRepositoryChatTurn(turnInput('Which database migration strategy does this project use?'));

    expect(mocks.generateChatText).toHaveBeenCalledTimes(2);
    expect(result.content).toContain('available evidence is insufficient');
  });

  it('performs one lightweight citation repair only when the final answer lacks a valid source', async () => {
    mocks.generateChatText
      .mockResolvedValueOnce(understanding())
      .mockResolvedValueOnce(gate(true))
      .mockResolvedValueOnce('This project is a documented example project.')
      .mockResolvedValueOnce('This project is a documented example project. `/README.md - 1-3`');

    const result = await runRepositoryChatTurn(turnInput());

    expect(mocks.generateChatText).toHaveBeenCalledTimes(4);
    expect(readPaths()).toEqual(['README.md']);
    expect(result.content).toContain('`/README.md - 1-3`');
  });

  it('removes an uncited factual section instead of returning an unsupported claim', async () => {
    mocks.generateChatText
      .mockResolvedValueOnce(understanding())
      .mockResolvedValueOnce(gate(true))
      .mockResolvedValueOnce('The project is documented. `/README.md - 1-3`\n\nIt guarantees an uncited production deployment workflow.');

    const result = await runRepositoryChatTurn(turnInput());

    expect(mocks.generateChatText).toHaveBeenCalledTimes(3);
    expect(result.content).toContain('`/README.md - 1-3`');
    expect(result.content).not.toContain('uncited production deployment');
  });

  it('normalizes a readable source reference without triggering an extra synthesis call', async () => {
    mocks.generateChatText
      .mockResolvedValueOnce(understanding())
      .mockResolvedValueOnce(gate(true))
      .mockResolvedValueOnce('This project is a documented example project. `README.md - 1-3`');

    const result = await runRepositoryChatTurn(turnInput());

    expect(mocks.generateChatText).toHaveBeenCalledTimes(3);
    expect(result.content).toContain('`/README.md - 1-3`');
  });

  it('retries a transient final-answer error without restarting retrieval', async () => {
    mocks.generateChatText
      .mockResolvedValueOnce(understanding())
      .mockResolvedValueOnce(gate(true))
      .mockRejectedValueOnce(new Error('503 upstream temporarily unavailable'))
      .mockResolvedValueOnce('This project is a documented example project. `/README.md - 1-3`');

    const result = await runRepositoryChatTurn(turnInput());

    expect(mocks.getRepositoryTree).toHaveBeenCalledTimes(1);
    expect(readPaths()).toEqual(['README.md']);
    expect(mocks.generateChatText).toHaveBeenCalledTimes(4);
    expect(result.content).toContain('`/README.md - 1-3`');
  });

  it('propagates cancellation raised after Evidence Check and before synthesis', async () => {
    const controller = new AbortController();
    mocks.generateChatText
      .mockResolvedValueOnce(understanding())
      .mockResolvedValueOnce(gate(true));

    const turn = runRepositoryChatTurn({
      ...turnInput(),
      signal: controller.signal,
      onToolEvent: (event) => {
        if (event.toolName === 'evidence_gate' && event.status === 'success') {
          controller.abort(new DOMException('Cancelled before synthesis.', 'AbortError'));
        }
      },
    });

    await expect(turn).rejects.toThrow('Cancelled before synthesis.');
    expect(mocks.generateChatText).toHaveBeenCalledTimes(2);
  });

  it('never writes to the legacy vector index during a repository-chat turn', async () => {
    mocks.generateChatText
      .mockResolvedValueOnce(understanding())
      .mockResolvedValueOnce(gate(true))
      .mockResolvedValueOnce('This project is a documented example project. `/README.md - 1-3`');

    await runRepositoryChatTurn(turnInput());

    expect(mocks.vectorWrites.indexAllRepos).not.toHaveBeenCalled();
    expect(mocks.vectorWrites.upsert).not.toHaveBeenCalled();
    expect(mocks.vectorWrites.delete).not.toHaveBeenCalled();
    expect(mocks.vectorWrites.cleanup).not.toHaveBeenCalled();
  });
});
