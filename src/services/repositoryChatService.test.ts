import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  AIService: class { generateChatText = mocks.generateChatText; },
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
  maxToolsPerTurn: 12,
  agentBudget: { maxTurns: 4, maxToolCalls: 12, maxReadFiles: 8, maxCodeReads: 3, maxDurationMs: 90_000 },
});

const README = [
  '# Example Project',
  '',
  '## Overview',
  'A documented example project for repository research.',
  '',
  '## Features',
  'It provides a dashboard and an API gateway.',
  '',
  '## Installation',
  'Install dependencies with `pnpm install`.',
  '',
  '## Quick Start',
  'Create `.env` from `.env.example` and set `APP_PORT`.',
  '',
  '## Usage',
  'Start with `pnpm dev` and open the dashboard at the configured local URL.',
  '',
  '## Supported Models',
  'The project supports Engine-A and Engine-B providers.',
].join('\n');

const understanding = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  intent: 'general',
  entities: [],
  information_scope: 'documentation',
  expected_answer: ['project overview'],
  initial_targets: ['README.md'],
  target: 'project overview',
  ...overrides,
});

const target = (path: string, sections: string[], purpose: string, scope: 'documentation' | 'code' = 'documentation') => ({ path, sections, purpose, scope });
const plan = (...targets: ReturnType<typeof target>[]) => JSON.stringify({ rationale: 'Read sections that close the current answer gaps.', targets });
const requirement = (name: string, status: 'verified' | 'missing' | 'not_applicable', evidence: string[] = []) => ({ requirement: name, status, evidence });
const gate = (options: {
  sufficient: boolean;
  requirements: ReturnType<typeof requirement>[];
  missing?: string[];
  nextAction?: 'retrieve_more' | 'expand_scope' | 'read_code' | 'answer' | 'stop';
  recommendedTargets?: ReturnType<typeof target>[];
  reason?: string;
}) => JSON.stringify({
  sufficient: options.sufficient,
  confidence: options.sufficient ? 0.95 : 0.45,
  reason: options.reason ?? (options.sufficient ? 'Every answer requirement is supported by repository evidence.' : 'More repository evidence is required.'),
  requirements: options.requirements,
  missing: options.missing ?? options.requirements.filter((item) => item.status === 'missing').map((item) => item.requirement),
  next_action: options.nextAction ?? (options.sufficient ? 'answer' : 'retrieve_more'),
  recommended_targets: options.recommendedTargets ?? [],
});

const answer = (text: string, source: string, heading = 'Verified answer') => JSON.stringify({
  items: [{ heading, text, sources: [source] }],
  not_found: [],
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

const overviewRef = '/README.md - 3-5';
const featuresRef = '/README.md - 6-8';
const installRef = '/README.md - 9-11';
const quickStartRef = '/README.md - 12-14';
const usageRef = '/README.md - 15-17';
const modelsRef = '/README.md - 18-19';

describe('runRepositoryChatTurn progressive evidence loop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureTreeAndFiles({
      'README.md': README,
      'docs/configuration.md': '# Environment\n\nUse APP_PORT for local configuration.',
      'src/engine.ts': 'export const switchProxy = () => "implementation detail";',
    });
  });

  it('answers a simple overview after one planned README section and one evidence evaluation', async () => {
    mocks.generateChatText
      .mockResolvedValueOnce(understanding())
      .mockResolvedValueOnce(plan(target('README.md', ['Overview'], 'project overview')))
      .mockResolvedValueOnce(gate({ sufficient: true, requirements: [requirement('project overview', 'verified', [overviewRef])], nextAction: 'answer' }))
      .mockResolvedValueOnce(answer('The project is a documented example for repository research.', overviewRef, 'Overview'));
    const events: RepositoryChatToolEvent[] = [];

    const result = await runRepositoryChatTurn({ ...turnInput(), onToolEvent: (event) => events.push(event as RepositoryChatToolEvent) });

    expect(readPaths()).toEqual(['README.md']);
    expect(mocks.generateChatText).toHaveBeenCalledTimes(4);
    expect(result.content).toContain(overviewRef);
    expect(events.some((event) => event.paramSummary.includes('README.md · Overview'))).toBe(true);
  });

  it('keeps reading relevant README sections until installation, setup, startup and usage are all verified', async () => {
    mocks.generateChatText
      .mockResolvedValueOnce(understanding({ intent: 'installation', expected_answer: ['installation', 'initialization and configuration', 'startup', 'usage entry point'], target: 'installation and getting started' }))
      .mockResolvedValueOnce(plan(target('README.md', ['Installation'], 'installation dependencies')))
      .mockResolvedValueOnce(gate({
        sufficient: false,
        requirements: [requirement('installation', 'verified', [installRef]), requirement('initialization and configuration', 'missing'), requirement('startup', 'missing'), requirement('usage entry point', 'missing')],
        missing: ['initialization and configuration', 'startup', 'usage entry point'],
        nextAction: 'retrieve_more',
        recommendedTargets: [target('README.md', ['Quick Start', 'Usage'], 'complete setup, startup and usage')],
      }))
      .mockResolvedValueOnce(plan(target('README.md', ['Quick Start', 'Usage'], 'complete setup, startup and usage')))
      .mockResolvedValueOnce(gate({
        sufficient: true,
        requirements: [requirement('installation', 'verified', [installRef]), requirement('initialization and configuration', 'verified', [quickStartRef]), requirement('startup', 'verified', [usageRef]), requirement('usage entry point', 'verified', [usageRef])],
        nextAction: 'answer',
      }))
      .mockResolvedValueOnce(answer('Install dependencies, create the environment file, then start the dashboard.', usageRef, 'Getting started'));

    const result = await runRepositoryChatTurn(turnInput('How do I install and get started with this project?'));

    expect(readPaths()).toEqual(['README.md']);
    expect(result.content).toContain(usageRef);
    expect(mocks.generateChatText).toHaveBeenCalledTimes(6);
  });

  it('uses the feature section rather than treating a generic README preface as a feature answer', async () => {
    mocks.generateChatText
      .mockResolvedValueOnce(understanding({ intent: 'feature_overview', expected_answer: ['core features'], target: 'core features' }))
      .mockResolvedValueOnce(plan(target('README.md', ['Features'], 'core features')))
      .mockResolvedValueOnce(gate({ sufficient: true, requirements: [requirement('core features', 'verified', [featuresRef])], nextAction: 'answer' }))
      .mockResolvedValueOnce(answer('It provides a dashboard and an API gateway.', featuresRef, 'Core features'));

    const result = await runRepositoryChatTurn(turnInput('What features does this project have?'));

    expect(result.content).toContain(featuresRef);
    expect(result.content).not.toContain(overviewRef);
  });

  it('continues to the provider section before answering a supported-models question', async () => {
    mocks.generateChatText
      .mockResolvedValueOnce(understanding({ intent: 'general', entities: ['models'], expected_answer: ['supported models and providers'], target: 'supported models' }))
      .mockResolvedValueOnce(plan(target('README.md', ['Supported Models'], 'supported model providers')))
      .mockResolvedValueOnce(gate({ sufficient: true, requirements: [requirement('supported models and providers', 'verified', [modelsRef])], nextAction: 'answer' }))
      .mockResolvedValueOnce(answer('The repository documents Engine-A and Engine-B providers.', modelsRef, 'Supported models'));

    const result = await runRepositoryChatTurn(turnInput('Which models does this project support?'));

    expect(result.content).toContain(modelsRef);
  });

  it('escalates from documentation to code only when the LLM evidence analysis requests implementation details', async () => {
    const codeRef = '/src/engine.ts - 1';
    mocks.generateChatText
      .mockResolvedValueOnce(understanding({ intent: 'code_analysis', information_scope: 'both', expected_answer: ['documented behavior', 'implementation detail'], target: 'proxy switching implementation' }))
      .mockResolvedValueOnce(plan(target('README.md', ['Overview'], 'documented behavior')))
      .mockResolvedValueOnce(gate({
        sufficient: false,
        requirements: [requirement('documented behavior', 'verified', [overviewRef]), requirement('implementation detail', 'missing')],
        nextAction: 'read_code',
        recommendedTargets: [target('src/engine.ts', ['switchProxy'], 'implementation detail', 'code')],
      }))
      .mockResolvedValueOnce(plan(target('src/engine.ts', ['switchProxy'], 'implementation detail', 'code')))
      .mockResolvedValueOnce(gate({
        sufficient: true,
        requirements: [requirement('documented behavior', 'verified', [overviewRef]), requirement('implementation detail', 'verified', [codeRef])],
        nextAction: 'answer',
      }))
      .mockResolvedValueOnce(answer('The implementation exports the proxy-switching function.', codeRef, 'Implementation'));

    const result = await runRepositoryChatTurn(turnInput('How is proxy switching implemented?'));

    expect(readPaths()).toEqual(['README.md', 'src/engine.ts']);
    expect(result.content).toContain(codeRef);
  });

  it('clearly reports missing repository evidence instead of making up an unsupported capability', async () => {
    mocks.generateChatText
      .mockResolvedValueOnce(understanding({ expected_answer: ['Kubernetes automatic deployment'], target: 'Kubernetes automatic deployment' }))
      .mockResolvedValueOnce(plan(target('README.md', ['Overview'], 'deployment documentation')))
      .mockResolvedValueOnce(gate({
        sufficient: false,
        requirements: [requirement('Kubernetes automatic deployment', 'missing')],
        missing: ['Kubernetes automatic deployment'],
        nextAction: 'stop',
        reason: 'No Kubernetes deployment source was found in the repository.',
      }));

    const result = await runRepositoryChatTurn(turnInput('Does this project support automatic Kubernetes deployment?'));

    expect(result.content).toContain('insufficient');
    expect(mocks.generateChatText).toHaveBeenCalledTimes(3);
  });

  it('repairs invalid structured synthesis once without re-running retrieval', async () => {
    mocks.generateChatText
      .mockResolvedValueOnce(understanding())
      .mockResolvedValueOnce(plan(target('README.md', ['Overview'], 'project overview')))
      .mockResolvedValueOnce(gate({ sufficient: true, requirements: [requirement('project overview', 'verified', [overviewRef])], nextAction: 'answer' }))
      .mockResolvedValueOnce('not valid JSON')
      .mockResolvedValueOnce(answer('The project is documented for repository research.', overviewRef));

    const result = await runRepositoryChatTurn(turnInput());

    expect(readPaths()).toEqual(['README.md']);
    expect(mocks.generateChatText).toHaveBeenCalledTimes(5);
    expect(result.content).toContain(overviewRef);
  });

  it('propagates cancellation after evidence evaluation before final synthesis', async () => {
    const controller = new AbortController();
    mocks.generateChatText
      .mockResolvedValueOnce(understanding())
      .mockResolvedValueOnce(plan(target('README.md', ['Overview'], 'project overview')))
      .mockResolvedValueOnce(gate({ sufficient: true, requirements: [requirement('project overview', 'verified', [overviewRef])], nextAction: 'answer' }));

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
    expect(mocks.generateChatText).toHaveBeenCalledTimes(3);
  });

  it('never writes repository-chat evidence into the legacy vector index', async () => {
    mocks.generateChatText
      .mockResolvedValueOnce(understanding())
      .mockResolvedValueOnce(plan(target('README.md', ['Overview'], 'project overview')))
      .mockResolvedValueOnce(gate({ sufficient: true, requirements: [requirement('project overview', 'verified', [overviewRef])], nextAction: 'answer' }))
      .mockResolvedValueOnce(answer('The project is documented for repository research.', overviewRef));

    await runRepositoryChatTurn(turnInput());

    expect(mocks.vectorWrites.indexAllRepos).not.toHaveBeenCalled();
    expect(mocks.vectorWrites.upsert).not.toHaveBeenCalled();
    expect(mocks.vectorWrites.delete).not.toHaveBeenCalled();
    expect(mocks.vectorWrites.cleanup).not.toHaveBeenCalled();
  });
});
