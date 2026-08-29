import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIConfig, Repository } from '../types';
import type { RepositoryChatSession, RepositoryChatToolEvent } from '../types/repositoryChat';

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
  agentBudget: { maxTurns: 4, maxToolCalls: 12, maxReadFiles: 8, maxCodeReads: 3, maxNoProgressRounds: 2, maxDurationMs: 90_000 },
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

const target = (path: string, sections: string[], purpose: string, scope: 'documentation' | 'code' | 'meta' = 'documentation') => ({ path, sections, purpose, scope });
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

const answer = (text: string, source: string, heading = 'Verified answer') => `## ${heading}\n\n${text} \`${source}\``;

const notFoundAnswer = (text: string, source: string) => `## Unverified or missing information\n\n${text} \`${source}\``;

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

  it('uses LLM semantic concepts to make differently named retrieval documentation a viable target', async () => {
    configureTreeAndFiles({
      'README.md': README,
      'docs/retrieval-options.md': '# Embedding configuration\n\nSet `searchTopK` and the similarity threshold for semantic retrieval.',
      'docs/changelog.md': '# Changelog\n\nRelease notes.',
    });
    mocks.generateChatText
      .mockResolvedValueOnce(understanding({
        intent: 'usage',
        entities: ['vector retrieval'],
        search_concepts: ['semantic search', 'embedding', 'similarity', 'topK'],
        likely_document_topics: ['embedding configuration', 'retrieval options'],
        expected_answer: ['how to configure vector retrieval'],
        target: 'vector retrieval configuration',
      }))
      .mockImplementationOnce(async ({ user }: { user: string }) => {
        expect(user).toContain('Semantic concepts: semantic search, embedding, similarity, topK');
        expect(user).toContain('Likely document topics: embedding configuration, retrieval options');
        expect(user).toContain('docs/retrieval-options.md');
        return plan(target('docs/retrieval-options.md', ['Embedding configuration'], 'vector retrieval configuration'));
      })
      .mockResolvedValueOnce(gate({
        sufficient: true,
        requirements: [requirement('how to configure vector retrieval', 'verified', ['/docs/retrieval-options.md - 1-3'])],
        nextAction: 'answer',
      }))
      .mockResolvedValueOnce(answer('Configure the retrieval result count and similarity threshold.', '/docs/retrieval-options.md - 1-3', 'Vector retrieval'));

    const result = await runRepositoryChatTurn(turnInput('How do I use the vector search feature?'));

    expect(readPaths()).toEqual(['README.md', 'docs/retrieval-options.md']);
    expect(result.content).toContain('/docs/retrieval-options.md - 1-3');
  });

  it('stops after the configured consecutive no-progress rounds while preserving the insufficient-evidence outcome', async () => {
    // 代码候选为空时，无进展停止语义保持不变（有代码预算时会先自动升级读代码）。
    configureTreeAndFiles({
      'README.md': README,
      'docs/configuration.md': '# Environment\n\nUse APP_PORT for local configuration.',
    });
    mocks.generateChatText
      .mockResolvedValueOnce(understanding({ expected_answer: ['missing feature documentation'], target: 'missing feature' }))
      .mockResolvedValueOnce(plan(target('README.md', ['Not a real heading'], 'find missing feature documentation')))
      .mockResolvedValueOnce(gate({
        sufficient: false,
        requirements: [requirement('missing feature documentation', 'missing')],
        nextAction: 'retrieve_more',
        recommendedTargets: [target('README.md', ['Not a real heading'], 'recheck missing feature documentation')],
      }))
      .mockResolvedValueOnce(plan(target('README.md', ['Not a real heading'], 'recheck missing feature documentation')))
      .mockResolvedValueOnce(gate({
        sufficient: false,
        requirements: [requirement('missing feature documentation', 'missing')],
        nextAction: 'retrieve_more',
      }));

    const result = await runRepositoryChatTurn({
      ...turnInput('Where is the missing feature documented?'),
      agentBudget: { maxTurns: 4, maxToolCalls: 12, maxReadFiles: 8, maxCodeReads: 3, maxNoProgressRounds: 2, maxDurationMs: 90_000 },
    });

    expect(readPaths()).toEqual(['README.md']);
    expect(mocks.generateChatText).toHaveBeenCalledTimes(5);
    expect(result.content).toContain('2 consecutive rounds');
  });

  it('honors the configured maximum evidence rounds before starting another retrieval plan', async () => {
    mocks.generateChatText
      .mockResolvedValueOnce(understanding())
      .mockResolvedValueOnce(plan(target('README.md', ['Overview'], 'project overview')))
      .mockResolvedValueOnce(gate({
        sufficient: false,
        requirements: [requirement('project overview', 'missing')],
        nextAction: 'retrieve_more',
      }));

    const result = await runRepositoryChatTurn({
      ...turnInput(),
      agentBudget: { maxTurns: 1, maxToolCalls: 12, maxReadFiles: 8, maxCodeReads: 3, maxNoProgressRounds: 2, maxDurationMs: 90_000 },
    });

    expect(readPaths()).toEqual(['README.md']);
    expect(mocks.generateChatText).toHaveBeenCalledTimes(3);
    expect(result.content).toContain('insufficient');
  });

  it('honors a configured tool-call budget before issuing an additional repository file read', async () => {
    mocks.generateChatText
      .mockResolvedValueOnce(understanding())
      .mockResolvedValueOnce(plan(target('README.md', ['Overview'], 'project overview')))
      .mockResolvedValueOnce(gate({
        sufficient: false,
        requirements: [requirement('project overview', 'missing')],
        nextAction: 'retrieve_more',
      }));
    const events: RepositoryChatToolEvent[] = [];

    const result = await runRepositoryChatTurn({
      ...turnInput(),
      agentBudget: { maxTurns: 4, maxToolCalls: 1, maxReadFiles: 8, maxCodeReads: 3, maxNoProgressRounds: 1, maxDurationMs: 90_000 },
      onToolEvent: (event) => events.push(event as RepositoryChatToolEvent),
    });

    expect(readPaths()).toEqual([]);
    expect(events.some((event) => event.status === 'error' && event.detail?.includes('tool or read budget'))).toBe(true);
    expect(result.content).toContain('insufficient');
  });

  it('answers vector-search usage after its explicit steps are evidenced and ignores optional tuning invented by the gate', async () => {
    configureTreeAndFiles({
      'README.md': [
        '# Example Project',
        '',
        '## Vector search',
        'Open Search, choose AI vector search, and enter a natural-language query.',
        '',
        '## Advanced tuning',
        'Tune threshold and topK only when refining search results.',
      ].join('\n'),
    });
    const vectorUsageRef = '/README.md - 3-5';
    mocks.generateChatText
      .mockResolvedValueOnce(understanding({
        intent: 'usage',
        explicit_requirements: ['how to use vector search'],
        necessary_requirements: ['the basic vector-search steps'],
        optional_enrichment: ['threshold and topK tuning', 'MCP connection details', 'source implementation'],
        target: 'vector-search usage',
      }))
      .mockResolvedValueOnce(plan(target('README.md', ['Vector search'], 'basic vector-search steps')))
      .mockResolvedValueOnce(gate({
        sufficient: false,
        requirements: [
          requirement('how to use vector search', 'verified', [vectorUsageRef]),
          requirement('the basic vector-search steps', 'verified', [vectorUsageRef]),
          requirement('threshold and topK tuning', 'missing'),
        ],
        missing: ['threshold and topK tuning', 'MCP connection details'],
        nextAction: 'retrieve_more',
        recommendedTargets: [target('README.md', ['Advanced tuning'], 'threshold and topK tuning')],
      }))
      .mockResolvedValueOnce(answer('Open Search, select AI vector search, then enter a natural-language query.', vectorUsageRef, 'Using vector search'));

    const result = await runRepositoryChatTurn(turnInput('How do I use vector search in this project?'));

    expect(readPaths()).toEqual(['README.md']);
    expect(mocks.generateChatText).toHaveBeenCalledTimes(4);
    expect(result.content).toContain(vectorUsageRef);
    expect(result.content).not.toContain('insufficient');
  });

  it('answers installation and first run without pursuing an optional quick-validation method', async () => {
    const installationRef = installRef;
    const startRef = quickStartRef;
    mocks.generateChatText
      .mockResolvedValueOnce(understanding({
        intent: 'installation',
        explicit_requirements: ['how to install and start using the project'],
        necessary_requirements: ['installation command', 'first-run command'],
        optional_enrichment: ['quick validation method', 'all environment variables', 'troubleshooting'],
        target: 'installation and first run',
      }))
      .mockResolvedValueOnce(plan(
        target('README.md', ['Installation'], 'installation command'),
        target('README.md', ['Quick Start'], 'first-run command'),
      ))
      .mockResolvedValueOnce(gate({
        sufficient: false,
        requirements: [
          requirement('how to install and start using the project', 'verified', [installationRef, startRef]),
          requirement('installation command', 'verified', [installationRef]),
          requirement('first-run command', 'verified', [startRef]),
          requirement('quick validation method', 'missing'),
        ],
        missing: ['quick validation method'],
        nextAction: 'retrieve_more',
        recommendedTargets: [target('docs/configuration.md', ['Environment'], 'quick validation method')],
      }))
      .mockResolvedValueOnce(answer('Install dependencies, then create the environment file and run the development command.', startRef, 'Getting started'));

    const result = await runRepositoryChatTurn(turnInput('How do I install and get started with this project?'));

    expect(readPaths()).toEqual(['README.md']);
    expect(mocks.generateChatText).toHaveBeenCalledTimes(4);
    expect(result.content).toContain(startRef);
  });

  it('treats threshold and topK configuration as blocking only when the user explicitly asks for them', async () => {
    configureTreeAndFiles({
      'README.md': '# Example Project\n\n## Vector search\n\nUse AI vector search from the Search view.',
      'docs/vector-search.md': '# Configuration\n\nSet `searchThreshold` and `searchTopK` in vector search settings.',
      'src/vector.ts': 'export const internalVectorImplementation = true;',
    });
    const overviewRef = '/README.md - 3-4';
    const configurationRef = '/docs/vector-search.md - 1-3';
    mocks.generateChatText
      .mockResolvedValueOnce(understanding({
        intent: 'configuration',
        explicit_requirements: ['how to configure vector-search threshold and topK'],
        necessary_requirements: [],
        optional_enrichment: ['internal vector-search implementation'],
        target: 'vector-search threshold and topK configuration',
      }))
      .mockResolvedValueOnce(plan(target('README.md', ['Vector search'], 'locate vector-search documentation')))
      .mockResolvedValueOnce(gate({
        sufficient: false,
        requirements: [requirement('how to configure vector-search threshold and topK', 'missing')],
        nextAction: 'retrieve_more',
        recommendedTargets: [target('docs/vector-search.md', ['Configuration'], 'threshold and topK configuration')],
      }))
      .mockResolvedValueOnce(plan(target('docs/vector-search.md', ['Configuration'], 'threshold and topK configuration')))
      .mockResolvedValueOnce(gate({
        sufficient: true,
        requirements: [requirement('how to configure vector-search threshold and topK', 'verified', [configurationRef])],
        nextAction: 'answer',
      }))
      .mockResolvedValueOnce(answer('Set searchThreshold and searchTopK in vector search settings.', configurationRef, 'Vector search configuration'));

    const result = await runRepositoryChatTurn(turnInput('How are vector-search threshold and topK configured?'));

    expect(readPaths()).toEqual(['README.md', 'docs/vector-search.md']);
    expect(readPaths()).not.toContain('src/vector.ts');
    expect(result.content).toContain(configurationRef);
    expect(result.content).not.toContain(overviewRef);
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
      }))
      .mockResolvedValueOnce(notFoundAnswer('Automatic Kubernetes deployment was not confirmed in the files read.', overviewRef));

    const result = await runRepositoryChatTurn(turnInput('Does this project support automatic Kubernetes deployment?'));

    expect(result.content).toContain('Automatic Kubernetes deployment was not confirmed');
    expect(result.content).toContain(overviewRef);
    expect(result.content).not.toContain('insufficient');
    expect(mocks.generateChatText).toHaveBeenCalledTimes(4);
  });

  it('repairs invalid synthesis once without re-running retrieval', async () => {
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

  it('streams the final answer incrementally and returns the source-verified text', async () => {
    mocks.generateChatText
      .mockResolvedValueOnce(understanding())
      .mockResolvedValueOnce(plan(target('README.md', ['Overview'], 'project overview')))
      .mockResolvedValueOnce(gate({ sufficient: true, requirements: [requirement('project overview', 'verified', [overviewRef])], nextAction: 'answer' }));
    mocks.generateChatTextStream.mockImplementation(async ({ onChunk }: { onChunk: (delta: string) => void }) => {
      onChunk('## Overview\n\nA documented ');
      onChunk(`example project. \`${overviewRef}\``);
      return `## Overview\n\nA documented example project. \`${overviewRef}\``;
    });
    const chunks: string[] = [];

    const result = await runRepositoryChatTurn({
      ...turnInput(),
      streaming: true,
      onAnswerChunk: (fullText) => chunks.push(fullText),
    });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe('## Overview\n\nA documented ');
    expect(result.content).toContain(overviewRef);
    expect(mocks.generateChatText).toHaveBeenCalledTimes(3);
    expect(mocks.generateChatTextStream).toHaveBeenCalledTimes(1);
  });

  it('falls back to a blocking answer when the stream fails before completing', async () => {
    mocks.generateChatText
      .mockResolvedValueOnce(understanding())
      .mockResolvedValueOnce(plan(target('README.md', ['Overview'], 'project overview')))
      .mockResolvedValueOnce(gate({ sufficient: true, requirements: [requirement('project overview', 'verified', [overviewRef])], nextAction: 'answer' }))
      .mockResolvedValueOnce(answer('The project is a documented example for repository research.', overviewRef, 'Overview'));
    const streamFailure = Object.assign(new Error('Streaming is not supported on this transport'), { name: 'AIStreamUnsupportedError' });
    mocks.generateChatTextStream.mockRejectedValue(streamFailure);
    const chunks: string[] = [];

    const result = await runRepositoryChatTurn({
      ...turnInput(),
      streaming: true,
      onAnswerChunk: (fullText) => chunks.push(fullText),
    });

    expect(result.content).toContain(overviewRef);
    expect(result.content).not.toContain('insufficient');
    expect(chunks[chunks.length - 1]).toBe('');
    expect(mocks.generateChatText).toHaveBeenCalledTimes(4);
  });

  it('automatically escalates to code reads when documentation stalls', async () => {
    const codeRef = '/src/engine.ts - 1';
    const events: RepositoryChatToolEvent[] = [];
    mocks.generateChatText
      .mockResolvedValueOnce(understanding({ expected_answer: ['implementation detail'], target: 'proxy switching implementation' }))
      .mockResolvedValueOnce(plan(target('README.md', ['Not a real heading'], 'find implementation detail')))
      .mockResolvedValueOnce(gate({
        sufficient: false,
        requirements: [requirement('implementation detail', 'missing')],
        nextAction: 'retrieve_more',
      }))
      .mockResolvedValueOnce(plan(target('src/engine.ts', ['switchProxy'], 'implementation detail', 'code')))
      .mockResolvedValueOnce(gate({
        sufficient: true,
        requirements: [requirement('implementation detail', 'verified', [codeRef])],
        nextAction: 'answer',
      }))
      .mockResolvedValueOnce(answer('The implementation exports the proxy-switching function.', codeRef, 'Implementation'));

    const result = await runRepositoryChatTurn({ ...turnInput('How is proxy switching implemented?'), onToolEvent: (event) => events.push(event as RepositoryChatToolEvent) });

    // 文档停滞一轮后自动解锁代码取证，第二轮读到代码并完成回答。
    expect(events.some((event) => event.toolName === 'escalate_to_code')).toBe(true);
    expect(readPaths()).toEqual(['README.md', 'src/engine.ts']);
    expect(result.content).toContain(codeRef);
  });

  it('canonicalizes sub-range citations that fall inside an evidence window', async () => {
    mocks.generateChatText
      .mockResolvedValueOnce(understanding())
      .mockResolvedValueOnce(plan(target('README.md', ['Overview'], 'project overview')))
      .mockResolvedValueOnce(gate({ sufficient: true, requirements: [requirement('project overview', 'verified', [overviewRef])], nextAction: 'answer' }))
      .mockResolvedValueOnce(answer('A documented example for repository research.', '/README.md - 3-4', 'Overview'));

    const result = await runRepositoryChatTurn(turnInput());

    // 引用 3-4 落在证据窗口 3-5 内：视为有效引用并保留实际引用的行号。
    expect(result.content).toContain('`/README.md - 3-4`');
    expect(result.content).not.toContain('已验证来源');
  });

  it('reads documentation first even when the question intent is code', async () => {
    const events: RepositoryChatToolEvent[] = [];
    const codeRef = '/src/engine.ts - 1';
    mocks.generateChatText
      .mockResolvedValueOnce(understanding({ intent: 'code_analysis', information_scope: 'code', expected_answer: ['implementation detail'], initial_targets: ['src/engine.ts'], target: 'proxy switching implementation' }))
      .mockResolvedValueOnce(plan(target('src/engine.ts', ['switchProxy'], 'implementation detail', 'code')))
      .mockResolvedValueOnce(gate({
        sufficient: false,
        requirements: [requirement('implementation detail', 'missing')],
        nextAction: 'retrieve_more',
      }))
      .mockResolvedValueOnce(plan(target('src/engine.ts', ['switchProxy'], 'implementation detail', 'code')))
      .mockResolvedValueOnce(gate({
        sufficient: true,
        requirements: [requirement('implementation detail', 'verified', [codeRef])],
        nextAction: 'answer',
      }))
      .mockResolvedValueOnce(answer('The implementation exports the proxy-switching function.', codeRef, 'Implementation'));

    const result = await runRepositoryChatTurn({ ...turnInput('How is proxy switching implemented?'), onToolEvent: (event) => events.push(event as RepositoryChatToolEvent) });

    // 即使意图是 code，首轮大纲仍先读 README/docs；第 2 轮才解锁代码读取。
    expect(readPaths()[0]).toBe('README.md');
    expect(readPaths()).toContain('src/engine.ts');
    expect(events.some((event) => event.toolName === 'escalate_to_code')).toBe(true);
    expect(result.content).toContain(codeRef);
  });

  it('canonicalizes bare root-file citations like /README.md - 35-44', async () => {
    mocks.generateChatText
      .mockResolvedValueOnce(understanding())
      .mockResolvedValueOnce(plan(target('README.md', ['Overview'], 'project overview')))
      .mockResolvedValueOnce(gate({ sufficient: true, requirements: [requirement('project overview', 'verified', [overviewRef])], nextAction: 'answer' }))
      .mockResolvedValueOnce('## Overview\n\nA documented example for repository research. /README.md - 3-4');

    const result = await runRepositoryChatTurn(turnInput());

    // 根目录文件的裸引用（无反引号、无目录段）同样要规范化为精确引用，
    // 否则正确回答会被 digest 替换。
    expect(result.content).toContain('`/README.md - 3-4`');
    expect(result.content).not.toContain('Verified sources');
    expect(result.content).not.toContain('insufficient');
  });

  it('keeps round 1 documentation-first even when the plan proposes code targets', async () => {
    const events: RepositoryChatToolEvent[] = [];
    mocks.generateChatText
      .mockResolvedValueOnce(understanding())
      .mockResolvedValueOnce(plan(
        target('src/engine.ts', ['switchProxy'], 'implementation detail', 'code'),
        target('README.md', ['Overview'], 'project overview'),
      ))
      .mockResolvedValueOnce(gate({ sufficient: true, requirements: [requirement('project overview', 'verified', [overviewRef])], nextAction: 'answer' }))
      .mockResolvedValueOnce(answer('The project is a documented example for repository research.', overviewRef, 'Overview'));

    const result = await runRepositoryChatTurn({ ...turnInput(), onToolEvent: (event) => events.push(event as RepositoryChatToolEvent) });

    // 第 1 轮的 code 目标被拒绝（文档优先），README 章节照常读取，无代码解锁。
    expect(readPaths()).toEqual(['README.md']);
    expect(events.some((event) => event.toolName === 'escalate_to_code')).toBe(false);
    expect(result.content).toContain(overviewRef);
  });

  it('canonicalizes citations with slash-prefix and em-dash variants', async () => {
    mocks.generateChatText
      .mockResolvedValueOnce(understanding())
      .mockResolvedValueOnce(plan(target('README.md', ['Overview'], 'project overview')))
      .mockResolvedValueOnce(gate({ sufficient: true, requirements: [requirement('project overview', 'verified', [overviewRef])], nextAction: 'answer' }))
      .mockResolvedValueOnce('## Overview\n\nA documented example / /README.md — 3-4`` for repository research.');

    const result = await runRepositoryChatTurn(turnInput());

    // `/ /README.md — 3-4``` `（斜杠+空格、全角破折号、多余闭合反引号）规范化为
    // 精确路径 + 保留实际引用行号。
    expect(result.content).toContain('`/README.md - 3-4`');
    expect(result.content).not.toContain('/ /README.md');
    expect(result.content).not.toContain('``');
  });

  it('maps footnote-style citations onto verified sources instead of discarding the answer', async () => {
    mocks.generateChatText
      .mockResolvedValueOnce(understanding())
      .mockResolvedValueOnce(plan(target('README.md', ['Overview'], 'project overview')))
      .mockResolvedValueOnce(gate({ sufficient: true, requirements: [requirement('project overview', 'verified', [overviewRef])], nextAction: 'answer' }));
    mocks.generateChatTextStream.mockImplementation(async ({ onChunk }: { onChunk: (delta: string) => void }) => {
      const body = [
        '## Overview',
        '',
        'A documented example project for repository research[^E1].',
        '',
        '[^E1]: /README.md - 3-4',
      ].join('\n');
      onChunk(body);
      return body;
    });
    const chunks: string[] = [];

    const result = await runRepositoryChatTurn({
      ...turnInput(),
      streaming: true,
      onAnswerChunk: (fullText) => chunks.push(fullText),
    });

    expect(result.content).toContain('A documented example project for repository research');
    expect(result.content).toContain('`/README.md - 3-4`');
    expect(result.content).not.toContain('[^E1]');
    expect(result.content).not.toContain('已验证来源');
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('demotes uncited sections instead of discarding the whole answer', async () => {
    mocks.generateChatText
      .mockResolvedValueOnce(understanding())
      .mockResolvedValueOnce(plan(target('README.md', ['Overview'], 'project overview')))
      .mockResolvedValueOnce(gate({ sufficient: true, requirements: [requirement('project overview', 'verified', [overviewRef])], nextAction: 'answer' }));
    mocks.generateChatText
      .mockResolvedValueOnce([
        '## Overview',
        '',
        `A documented example for repository research. \`${overviewRef}\``,
        '',
        '## Extra notes',
        '',
        'Uncited prose without any reference.',
      ].join('\n'));

    const result = await runRepositoryChatTurn(turnInput());

    // 剪枝降级：有引用的小节保留，未引用段落显式移入“未证实”区块而不是丢弃。
    expect(result.content).toContain('A documented example for repository research.');
    expect(result.content).toContain(overviewRef);
    expect(result.content).toContain('Uncited prose without any reference.');
    expect(result.content).toContain('Unverified or missing information');
    expect(result.content).not.toContain('Verified sources');
    expect(result.content).not.toContain('insufficient');
  });

  it('applies the quick task-depth preset with its tighter no-progress budget', async () => {
    mocks.generateChatText
      .mockResolvedValueOnce(understanding({ expected_answer: ['missing feature documentation'], target: 'missing feature' }))
      .mockResolvedValueOnce(plan(target('README.md', ['Not a real heading'], 'find missing feature documentation')))
      .mockResolvedValueOnce(gate({
        sufficient: false,
        requirements: [requirement('missing feature documentation', 'missing')],
        nextAction: 'retrieve_more',
      }));

    const result = await runRepositoryChatTurn({ ...turnInput('Where is the missing feature documented?'), taskDepth: 'quick' });

    // quick 档 maxNoProgressRounds=1：第 1 轮无进展即停止（默认档会继续到第 2 轮，共 5 次调用）。
    expect(mocks.generateChatText).toHaveBeenCalledTimes(3);
    expect(result.content).toContain('insufficient');
  });

  it('lets the unlimited task-depth preset exceed the default budget clamps', async () => {
    configureTreeAndFiles({
      'README.md': README,
      'docs/configuration.md': '# Environment\n\nUse APP_PORT for local configuration.',
    });
    mocks.generateChatText
      .mockResolvedValueOnce(understanding({ expected_answer: ['missing feature documentation'], target: 'missing feature' }));
    // 按 plan → gate 交替注册 5 轮；unlimited 档 maxNoProgressRounds=4，应执行满 4 轮（默认档 2 轮即停）。
    for (let round = 0; round < 5; round += 1) {
      mocks.generateChatText.mockResolvedValueOnce(plan(target('README.md', ['Not a real heading'], 'recheck missing feature documentation')));
      mocks.generateChatText.mockResolvedValueOnce(gate({
        sufficient: false,
        requirements: [requirement('missing feature documentation', 'missing')],
        nextAction: 'retrieve_more',
      }));
    }

    const result = await runRepositoryChatTurn({ ...turnInput('Where is the missing feature documented?'), taskDepth: 'unlimited' });

    expect(mocks.generateChatText).toHaveBeenCalledTimes(9);
    expect(result.content).toContain('insufficient');
  });
});

describe('runRepositoryChatTurn meta sources (releases / issues)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 清掉排队的 once 响应（前面用例可能注册多于消耗），避免溢出到本组。
    mocks.generateChatText.mockReset();
    mocks.generateChatTextStream.mockReset();
    mocks.generateWithTools.mockReset();
    configureTreeAndFiles({
      'README.md': README,
      'docs/configuration.md': '# Environment\n\nUse APP_PORT for local configuration.',
    });
  });

  const releasesPayload = [
    {
      id: 1,
      tag_name: 'v1.0.0',
      name: 'First release',
      body: 'Adds a dashboard and an API gateway.',
      published_at: '2026-07-01T00:00:00.000Z',
      html_url: 'https://github.com/owner/example/releases/tag/v1.0.0',
      prerelease: false,
      assets: [
        { id: 11, name: 'app-macos.dmg', size: 1024, download_count: 5, browser_download_url: 'https://example.com/app-macos.dmg', content_type: 'application/x-apple-diskimage', created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z' },
        { id: 12, name: 'app-win.exe', size: 2048, download_count: 7, browser_download_url: 'https://example.com/app-win.exe', content_type: 'application/octet-stream', created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z' },
      ],
    },
  ];
  const releaseRef = '/release-v1.0.0.md - 1-2';

  it('auto-escalates to recent releases when documentation stalls on a recent-updates question', async () => {
    const events: RepositoryChatToolEvent[] = [];
    mocks.getRepositoryReleases.mockResolvedValue(releasesPayload);
    mocks.generateChatText
      .mockResolvedValueOnce(understanding({ entities: ['recent releases'], expected_answer: ['recent release notes'], target: 'recent updates' }))
      .mockResolvedValueOnce(plan(target('README.md', ['Overview'], 'recent release notes')))
      .mockResolvedValueOnce(gate({
        sufficient: false,
        requirements: [requirement('recent release notes', 'missing')],
        nextAction: 'retrieve_more',
      }))
      .mockResolvedValueOnce(plan(target('README.md', ['Overview'], 'recheck recent release notes')))
      .mockResolvedValueOnce(gate({
        sufficient: true,
        requirements: [requirement('recent release notes', 'verified', [releaseRef])],
        nextAction: 'answer',
      }))
      .mockResolvedValueOnce(answer('The latest release v1.0.0 adds a dashboard and an API gateway with macOS and Windows builds.', releaseRef, 'Recent updates'));

    const result = await runRepositoryChatTurn({ ...turnInput('这个仓库最近更新了什么？'), onToolEvent: (event) => events.push(event as RepositoryChatToolEvent) });

    // 第 1 轮只读文档；文档停滞 + meta 意图触发安全网，第 2 轮读取 Release。
    expect(readPaths()[0]).toBe('README.md');
    expect(mocks.getRepositoryReleases).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.toolName === 'escalate_to_meta')).toBe(true);
    expect(events.some((event) => event.toolName === 'read_releases' && event.status === 'success')).toBe(true);
    expect(result.content).toContain(releaseRef);
  });

  it('cites platform-tagged release evidence when asked which build packages are provided', async () => {
    mocks.getRepositoryReleases.mockResolvedValue(releasesPayload);
    mocks.generateChatText
      .mockResolvedValueOnce(understanding({ expected_answer: ['platform build packages'], target: 'build packages' }))
      .mockResolvedValueOnce(plan(target('README.md', ['Not a real heading'], 'find platform build packages')))
      .mockResolvedValueOnce(gate({
        sufficient: false,
        requirements: [requirement('platform build packages', 'missing')],
        nextAction: 'retrieve_more',
      }))
      .mockResolvedValueOnce(plan(target('README.md', ['Not a real heading'], 'recheck platform build packages')))
      .mockResolvedValueOnce(gate({
        sufficient: true,
        requirements: [requirement('platform build packages', 'verified', [releaseRef])],
        nextAction: 'answer',
      }))
      .mockResolvedValueOnce(answer('The repository publishes macOS disk images and Windows executables as release assets.', releaseRef, 'Build packages'));

    const result = await runRepositoryChatTurn(turnInput('Which platform build packages does this repository provide?'));

    expect(result.content).toContain(releaseRef);
    expect(mocks.getRepositoryReleases).toHaveBeenCalledTimes(1);
  });

  it('answers troubleshooting with searched issue evidence including comment excerpts', async () => {
    const issueRef = '/issue-42.md - 1-3';
    mocks.searchRepositoryIssues.mockResolvedValue([
      {
        number: 42,
        title: 'App crashes on start',
        state: 'closed' as const,
        html_url: 'https://github.com/owner/example/issues/42',
        body: 'Crash fixed by setting APP_PORT explicitly.',
        comments: 2,
        updated_at: '2026-06-01T00:00:00.000Z',
        labels: ['bug'],
      },
    ]);
    mocks.getRepositoryIssueComments.mockResolvedValue([
      { user: 'alice', createdAt: '2026-06-02T00:00:00.000Z', body: 'Fixed in v1.0.0; set APP_PORT before starting.' },
    ]);
    mocks.generateChatText
      .mockResolvedValueOnce(understanding({ intent: 'troubleshooting', information_scope: 'both', entities: ['startup crash'], search_concepts: ['crash', 'startup'], expected_answer: ['how to fix the startup crash'], target: 'startup crash fix' }))
      .mockResolvedValueOnce(plan(target('README.md', ['Not a real heading'], 'find startup crash fix')))
      .mockResolvedValueOnce(gate({
        sufficient: false,
        requirements: [requirement('how to fix the startup crash', 'missing')],
        nextAction: 'retrieve_more',
      }))
      .mockResolvedValueOnce(plan(target('README.md', ['Not a real heading'], 'recheck startup crash fix')))
      .mockResolvedValueOnce(gate({
        sufficient: true,
        requirements: [requirement('how to fix the startup crash', 'verified', [issueRef])],
        nextAction: 'answer',
      }))
      .mockResolvedValueOnce(answer('Issue #42 fixed the startup crash by setting APP_PORT explicitly.', issueRef, 'Troubleshooting'));

    const result = await runRepositoryChatTurn(turnInput('I hit a crash on startup — how do I fix it?'));

    expect(mocks.searchRepositoryIssues).toHaveBeenCalledTimes(1);
    expect(mocks.getRepositoryIssueComments).toHaveBeenCalledTimes(1);
    const searchKeywords = mocks.searchRepositoryIssues.mock.calls[0][2] as string[];
    expect(searchKeywords).toContain('startup crash');
    expect(result.content).toContain(issueRef);
  });

  it('reports an empty release history as citable evidence instead of failing', async () => {
    mocks.getRepositoryReleases.mockResolvedValue([]);
    mocks.generateChatText
      .mockResolvedValueOnce(understanding({ entities: ['releases'], expected_answer: ['recent release notes'], target: 'recent updates' }))
      .mockResolvedValueOnce(plan(target('README.md', ['Not a real heading'], 'find recent release notes')))
      .mockResolvedValueOnce(gate({
        sufficient: false,
        requirements: [requirement('recent release notes', 'missing')],
        nextAction: 'retrieve_more',
      }))
      .mockResolvedValueOnce(plan(target('README.md', ['Not a real heading'], 'recheck recent release notes')))
      .mockResolvedValueOnce(gate({
        sufficient: true,
        requirements: [requirement('recent release notes', 'verified', ['/releases-empty.md - 1-2'])],
        nextAction: 'answer',
      }))
      .mockResolvedValueOnce(answer('The repository has no published releases yet, so no release notes exist.', '/releases-empty.md - 1-2', 'Releases'));

    const result = await runRepositoryChatTurn(turnInput('这个仓库最近更新了什么？'));

    expect(result.content).toContain('/releases-empty.md - 1-2');
  });

  it('keeps round 1 documentation-only even when the planner proposes meta targets', async () => {
    const events: RepositoryChatToolEvent[] = [];
    mocks.generateChatText
      .mockResolvedValueOnce(understanding({ entities: ['releases'], expected_answer: ['recent release notes'], target: 'recent updates' }))
      .mockResolvedValueOnce(plan(
        target('@meta/releases', [], 'recent release notes', 'meta'),
        target('README.md', ['Overview'], 'project overview'),
      ))
      .mockResolvedValueOnce(gate({ sufficient: true, requirements: [requirement('recent release notes', 'verified', [overviewRef])], nextAction: 'answer' }))
      .mockResolvedValueOnce(answer('The README overview documents the project scope.', overviewRef, 'Overview'));

    const result = await runRepositoryChatTurn({ ...turnInput('这个仓库最近更新了什么？'), onToolEvent: (event) => events.push(event as RepositoryChatToolEvent) });

    // README 优先是硬规则：第 1 轮的 meta 目标被拒绝，回退到文档读取。
    expect(mocks.getRepositoryReleases).not.toHaveBeenCalled();
    expect(events.some((event) => event.toolName === 'escalate_to_meta')).toBe(false);
    expect(readPaths()).toEqual(['README.md']);
    expect(result.content).toContain(overviewRef);
  });

  it('falls back to the orchestrated loop when the endpoint rejects native tool calling', async () => {
    mocks.generateWithTools.mockRejectedValue(Object.assign(new Error('tools not supported'), { name: 'AIToolCallUnsupportedError' }));
    mocks.generateChatText
      .mockResolvedValueOnce(understanding())
      .mockResolvedValueOnce(plan(target('README.md', ['Overview'], 'project overview')))
      .mockResolvedValueOnce(gate({ sufficient: true, requirements: [requirement('project overview', 'verified', [overviewRef])], nextAction: 'answer' }))
      .mockResolvedValueOnce(answer('The project is a documented example for repository research.', overviewRef, 'Overview'));

    const result = await runRepositoryChatTurn({ ...turnInput(), enableAgentToolLoop: true });

    expect(mocks.generateWithTools).toHaveBeenCalledTimes(1);
    expect(mocks.generateChatText).toHaveBeenCalledTimes(4);
    expect(result.content).toContain(overviewRef);
  });
});
