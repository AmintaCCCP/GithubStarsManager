import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRepository: vi.fn(),
  getRepositories: vi.fn(),
  getRepoEvidence: vi.fn(),
  getStats: vi.fn(),
  getVectorAvailability: vi.fn(),
  listCategories: vi.fn(),
  loadAllRepositories: vi.fn(),
  searchRepos: vi.fn(),
  vectorSearch: vi.fn(),
  findSimilarRepositories: vi.fn(),
}));

vi.mock('../../src/mcp/provider.js', () => mocks);

const { registerMcpTools } = await import('../../src/mcp/tools.js');

function captureRegistrations(vectorAvailable = true) {
  mocks.getVectorAvailability.mockReturnValue(
    vectorAvailable ? { available: true } : { available: false, reason: 'disabled' }
  );
  const registrations: Array<{
    name: string;
    config: { inputSchema?: Record<string, unknown> };
    handler: (args: Record<string, unknown>) => Promise<unknown>;
  }> = [];
  const server = {
    registerTool(name: string, config: { inputSchema?: Record<string, unknown> }, handler: (args: Record<string, unknown>) => Promise<unknown>) {
      registrations.push({ name, config, handler });
    },
  };
  registerMcpTools(server as never);
  return registrations;
}

describe('MCP tool registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadAllRepositories.mockReturnValue([]);
    mocks.getVectorAvailability.mockReturnValue({ available: true });
  });

  it('lists ten tools when vector search is available and eight otherwise', () => {
    expect(captureRegistrations(true).map((tool) => tool.name)).toEqual([
      'gsm_status',
      'gsm_search_repos',
      'gsm_get_repo',
      'gsm_get_repos',
      'gsm_get_repo_evidence',
      'gsm_list_categories',
      'gsm_list_repos_by_category',
      'gsm_stats',
      'gsm_find_similar_repos',
      'gsm_vector_search',
    ]);
    expect(captureRegistrations(false).map((tool) => tool.name)).toEqual([
      'gsm_status',
      'gsm_search_repos',
      'gsm_get_repo',
      'gsm_get_repos',
      'gsm_get_repo_evidence',
      'gsm_list_categories',
      'gsm_list_repos_by_category',
      'gsm_stats',
    ]);
  });

  it('exposes the approved input properties for discovery and vector tools', () => {
    const tools = new Map(captureRegistrations(true).map((tool) => [tool.name, tool]));
    expect(Object.keys(tools.get('gsm_search_repos')?.config.inputSchema ?? {})).toEqual([
      'query',
      'languages',
      'tags',
      'platforms',
      'licenses',
      'category',
      'minStars',
      'maxStars',
      'isAnalyzed',
      'isSubscribed',
      'sortBy',
      'sortOrder',
      'limit',
      'offset',
    ]);
    expect(Object.keys(tools.get('gsm_get_repos')?.config.inputSchema ?? {})).toEqual(['idsOrFullNames']);
    expect(Object.keys(tools.get('gsm_get_repo_evidence')?.config.inputSchema ?? {})).toEqual(['idOrFullName']);
    expect(Object.keys(tools.get('gsm_find_similar_repos')?.config.inputSchema ?? {})).toEqual([
      'idOrFullName',
      'topK',
      'threshold',
    ]);
    expect(Object.keys(tools.get('gsm_vector_search')?.config.inputSchema ?? {})).toEqual([
      'query',
      'topK',
      'threshold',
      'languages',
      'tags',
      'platforms',
      'licenses',
      'category',
      'minStars',
      'maxStars',
      'isAnalyzed',
      'isSubscribed',
    ]);
    expect(Object.keys(tools.get('gsm_list_repos_by_category')?.config.inputSchema ?? {})).toEqual([
      'category',
      'limit',
      'offset',
      'sortBy',
      'sortOrder',
    ]);

    const getReposSchema = tools.get('gsm_get_repos')?.config.inputSchema as Record<
      string,
      { safeParse: (value: unknown) => { success: boolean } }
    >;
    expect(getReposSchema.idsOrFullNames.safeParse(['acme/alpha']).success).toBe(true);
    expect(
      getReposSchema.idsOrFullNames.safeParse(
        Array.from({ length: 51 }, (_, index) => `acme/repo-${index}`)
      ).success
    ).toBe(false);
    expect(getReposSchema.idsOrFullNames.safeParse(['']).success).toBe(false);
  });

  it('accurately describes both vector tools when vector search is unavailable', async () => {
    mocks.getVectorAvailability.mockReturnValue({ available: false, reason: 'disabled' });
    const status = captureRegistrations(false).find((tool) => tool.name === 'gsm_status');
    const result = await status!.handler({});
    const payload = JSON.parse(
      (result as { content: Array<{ text: string }> }).content[0].text
    ) as { toolsNote: string };

    expect(payload.toolsNote).toBe(
      'gsm_find_similar_repos and gsm_vector_search are not listed until vector search is configured and enabled'
    );
  });

  it('routes the three new handlers without mutating the provider inputs', async () => {
    mocks.getRepositories.mockReturnValue({ requested: 1 });
    mocks.getRepoEvidence.mockReturnValue({ evidence: {} });
    mocks.findSimilarRepositories.mockResolvedValue({ available: true, matches: [] });
    const tools = new Map(captureRegistrations(true).map((tool) => [tool.name, tool]));

    await tools.get('gsm_get_repos')!.handler({ idsOrFullNames: ['acme/alpha'] });
    await tools.get('gsm_get_repo_evidence')!.handler({ idOrFullName: 'acme/alpha' });
    await tools.get('gsm_find_similar_repos')!.handler({
      idOrFullName: 'acme/alpha',
      topK: 3,
      threshold: 0.5,
    });
    await tools.get('gsm_vector_search')!.handler({
      query: 'retrieval',
      languages: ['Rust'],
      isAnalyzed: true,
    });

    expect(mocks.getRepositories).toHaveBeenCalledWith(['acme/alpha']);
    expect(mocks.getRepoEvidence).toHaveBeenCalledWith('acme/alpha');
    expect(mocks.findSimilarRepositories).toHaveBeenCalledWith('acme/alpha', { topK: 3, threshold: 0.5 });
    expect(mocks.vectorSearch).toHaveBeenCalledWith('retrieval', {
      topK: undefined,
      threshold: undefined,
      languages: ['Rust'],
      tags: undefined,
      platforms: undefined,
      licenses: undefined,
      category: undefined,
      minStars: undefined,
      maxStars: undefined,
      isAnalyzed: true,
      isSubscribed: undefined,
    });
  });
});
