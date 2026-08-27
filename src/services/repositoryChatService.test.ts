import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIConfig, Repository } from '../types';
import type { RepositoryChatSession } from '../types/repositoryChat';

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
  code_need: 'not_needed',
  expected_evidence: ['project purpose'],
  ...overrides,
});

const plan = (...paths: string[]) => JSON.stringify({ paths });
const gate = (decision: string, reason = 'Evidence is sufficient.') => JSON.stringify({ decision, reason, missing_evidence: [] });

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

describe('runRepositoryChatTurn evidence-driven loop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureTreeAndFiles({
      'README.md': '# Example\n\nThis repository is a documented example project.',
      'docs/usage.md': '# Usage\n\nRun the documented setup.',
      'src/App.tsx': 'export const App = () => <main>implementation detail</main>;',
    });
  });

  it('starts documentation-first and stops without reading code when the Evidence Gate is sufficient', async () => {
    mocks.generateChatText
      .mockResolvedValueOnce(understanding())
      .mockResolvedValueOnce(plan('README.md'))
      .mockResolvedValueOnce(gate('sufficient', 'README directly answers the purpose.'))
      .mockResolvedValueOnce('The project is a documented example project. `/README.md - 1-3`');
    const events: Array<{ toolName: string; stage?: string; status: string; detail?: string }> = [];

    const result = await runRepositoryChatTurn({
      ...turnInput(),
      onToolEvent: (event) => events.push(event),
    });

    expect(mocks.getRepositoryFile).toHaveBeenCalledWith('owner', 'example', 'README.md', session.sourceRefSha, undefined);
    expect(mocks.getRepositoryFile).not.toHaveBeenCalledWith('owner', 'example', 'src/App.tsx', session.sourceRefSha, undefined);
    expect(result.content).toContain('`/README.md - 1-3`');
    expect(result.evidences).toHaveLength(1);
    expect(result.evidences[0]).toMatchObject({ path: 'README.md', refSha: session.sourceRefSha, lineStart: 1, lineEnd: 3 });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolName: 'understand_query', stage: 'understanding', status: 'success' }),
      expect.objectContaining({ toolName: 'plan_research', stage: 'planning', status: 'success' }),
      expect.objectContaining({ toolName: 'evidence_gate', stage: 'verification', status: 'success' }),
      expect.objectContaining({ toolName: 'synthesize_answer', stage: 'answer', status: 'success' }),
    ]));
    expect(events.find((event) => event.toolName === 'understand_query')?.detail).toMatch(/Intent affects only initial file ranking/i);
  });

  it('uses the Evidence Gate rather than intent keywords to escalate from documentation to minimal code', async () => {
    mocks.generateChatText
      .mockResolvedValueOnce(understanding({ intent: 'implementation', code_need: 'required', expected_evidence: ['implementation detail'] }))
      .mockResolvedValueOnce(plan('README.md'))
      .mockResolvedValueOnce(gate('escalate_to_code', 'The README does not describe the implementation.'))
      .mockResolvedValueOnce(plan('src/App.tsx'))
      .mockResolvedValueOnce(gate('sufficient', 'The implementation file provides the required detail.'))
      .mockResolvedValueOnce('The implementation renders the documented detail. `/src/App.tsx - 1`');
    const events: Array<{ toolName: string; stage?: string; status: string; detail?: string }> = [];

    const result = await runRepositoryChatTurn({
      ...turnInput('How is the implementation structured?'),
      onToolEvent: (event) => events.push(event),
    });

    expect(mocks.getRepositoryFile).toHaveBeenCalledWith('owner', 'example', 'README.md', session.sourceRefSha, undefined);
    expect(mocks.getRepositoryFile).toHaveBeenCalledWith('owner', 'example', 'src/App.tsx', session.sourceRefSha, undefined);
    expect(mocks.getRepositoryFile).not.toHaveBeenCalledWith('owner', 'example', 'docs/usage.md', session.sourceRefSha, undefined);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolName: 'escalate_to_code', stage: 'escalation', status: 'success' }),
      expect.objectContaining({ toolName: 'replan_research', stage: 'replanning', status: 'success' }),
    ]));
    expect(result.content).toContain('`/src/App.tsx - 1`');
  });

  it('enforces file-read budgets while retaining acquired evidence for synthesis', async () => {
    mocks.generateChatText
      .mockResolvedValueOnce(understanding())
      .mockResolvedValueOnce(plan('README.md'))
      .mockResolvedValueOnce(gate('continue_docs', 'More documentation could be read.'))
      .mockResolvedValueOnce(gate('sufficient', 'The retained README evidence is enough.'))
      .mockResolvedValueOnce('The project is documented. `/README.md - 1-3`');

    const result = await runRepositoryChatTurn({
      ...turnInput(),
      agentBudget: { ...turnInput().agentBudget, maxReadFiles: 1, maxTurns: 3 },
    });

    expect(mocks.getRepositoryFile).toHaveBeenCalledTimes(1);
    expect(mocks.getRepositoryFile).toHaveBeenCalledWith('owner', 'example', 'README.md', session.sourceRefSha, undefined);
    expect(result.content).toContain('`/README.md - 1-3`');
  });

  it('treats a tool error as replanning input instead of blindly retrying the same file', async () => {
    mocks.getRepositoryFile.mockImplementation(async (_owner: string, _repo: string, path: string) => {
      if (path === 'README.md') throw new Error('404 file not found');
      return { path, ref: session.sourceRefSha, sha: `file-${path}`, size: 34, content: '# Usage\n\nThe fallback document answers it.' };
    });
    mocks.generateChatText
      .mockResolvedValueOnce(understanding())
      .mockResolvedValueOnce(plan('README.md'))
      .mockResolvedValueOnce(gate('continue_docs', 'The first file could not be read; inspect another document.'))
      .mockResolvedValueOnce(plan('docs/usage.md'))
      .mockResolvedValueOnce(gate('sufficient', 'The usage document answers the question.'))
      .mockResolvedValueOnce('The fallback document answers it. `/docs/usage.md - 1-3`');

    const result = await runRepositoryChatTurn(turnInput('How do I use this project?'));

    const readPaths = mocks.getRepositoryFile.mock.calls.map((call: unknown[]) => call[2]);
    expect(readPaths).toEqual(['README.md', 'docs/usage.md']);
    expect(result.content).toContain('`/docs/usage.md - 1-3`');
  });

  it('retries only the final synthesis after a transient model failure and never restarts retrieval', async () => {
    mocks.generateChatText
      .mockResolvedValueOnce(understanding())
      .mockResolvedValueOnce(plan('README.md'))
      .mockResolvedValueOnce(gate('sufficient'))
      .mockRejectedValueOnce(new Error('503 upstream temporarily unavailable'))
      .mockResolvedValueOnce('The project is a documented example project. `/README.md - 1-3`');

    const result = await runRepositoryChatTurn(turnInput());

    expect(mocks.getRepositoryTree).toHaveBeenCalledTimes(1);
    expect(mocks.getRepositoryFile).toHaveBeenCalledTimes(1);
    expect(mocks.generateChatText).toHaveBeenCalledTimes(5);
    expect(result.content).toContain('`/README.md - 1-3`');
  });

  it('never writes to the legacy vector index during a repository-chat turn', async () => {
    mocks.generateChatText
      .mockResolvedValueOnce(understanding())
      .mockResolvedValueOnce(plan('README.md'))
      .mockResolvedValueOnce(gate('sufficient'))
      .mockResolvedValueOnce('The project is a documented example project. `/README.md - 1-3`');

    await runRepositoryChatTurn(turnInput());

    expect(mocks.vectorWrites.indexAllRepos).not.toHaveBeenCalled();
    expect(mocks.vectorWrites.upsert).not.toHaveBeenCalled();
    expect(mocks.vectorWrites.delete).not.toHaveBeenCalled();
    expect(mocks.vectorWrites.cleanup).not.toHaveBeenCalled();
  });
});
