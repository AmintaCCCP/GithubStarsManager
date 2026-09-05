import { describe, expect, it, vi } from 'vitest';

const providerMocks = vi.hoisted(() => ({
  getRepository: vi.fn(),
  getRepositories: vi.fn(),
  getRepoEvidence: vi.fn(),
  getStats: vi.fn(),
  getVectorAvailability: vi.fn(() => ({ available: true })),
  listCategories: vi.fn(),
  loadAllRepositories: vi.fn(() => []),
  searchRepos: vi.fn(),
  vectorSearch: vi.fn(),
  findSimilarRepositories: vi.fn(),
}));

vi.mock('../../src/mcp/provider.js', () => providerMocks);

const { registerMcpTools } = await import('../../src/mcp/tools.js');
const { searchRepositories: backendSearch } = await import('../../src/mcp/repoSearch.js');
const electronModule = await import('../../../electron/mcpLocalServer.js');
const electronDiscovery = await import('../../../electron/mcpDiscovery.js');
const getElectronTools =
  electronModule.getMcpToolDefinitions || electronModule.default.getMcpToolDefinitions;

function getBackendTools() {
  const registrations: Array<{ name: string; inputSchema?: Record<string, unknown> }> = [];
  registerMcpTools({
    registerTool(name: string, config: { inputSchema?: Record<string, unknown> }) {
      registrations.push({ name, inputSchema: config.inputSchema });
    },
  } as never);
  return registrations;
}

function contract(tool: { name: string; inputSchema?: Record<string, unknown> }) {
  return {
    name: tool.name,
    properties: Object.keys(tool.inputSchema || {}),
  };
}

describe('backend/Electron MCP parity', () => {
  it('keeps the same names and input property sets for vector-enabled MCP', () => {
    const backend = getBackendTools().map(contract);
    const electron = getElectronTools(true).map((tool: { name: string; inputSchema?: { properties?: Record<string, unknown> } }) => ({
      name: tool.name,
      properties: Object.keys(tool.inputSchema?.properties || {}),
    }));

    expect(electron).toEqual(backend);
  });

  it('keeps the same non-vector inventory when vector search is unavailable', () => {
    providerMocks.getVectorAvailability.mockReturnValue({ available: false, reason: 'disabled' });
    const backend = getBackendTools().map((tool) => tool.name);
    expect(getElectronTools(false).map((tool: { name: string }) => tool.name)).toEqual(backend);
  });

  it('orders tied repos identically by full_name on both ends', () => {
    const fixtures = [
      parityRepo({ id: 1, name: 'zeta', full_name: 'acme/zeta', stargazers_count: 100 }),
      parityRepo({ id: 2, name: 'alpha', full_name: 'acme/alpha', stargazers_count: 100 }),
      parityRepo({ id: 3, name: 'mid', full_name: 'acme/mid', stargazers_count: 100 }),
      parityRepo({ id: 4, name: 'solo', full_name: 'other/solo', stargazers_count: 5 }),
    ];
    // 输入顺序与预期输出相反，证明 tie-break 真正生效而非继承输入顺序
    const expected = [
      'acme/alpha',
      'acme/mid',
      'acme/zeta',
      'other/solo',
    ];
    const backend = backendSearch(fixtures, {});
    const electron = electronDiscovery.searchRepositories(fixtures, {});
    expect(backend.items.map((repo: { full_name: string }) => repo.full_name)).toEqual(expected);
    expect(electron.items.map((repo: { full_name: string }) => repo.full_name)).toEqual(
      backend.items.map((repo: { full_name: string }) => repo.full_name)
    );
  });

  it('clamps a zero limit identically on both ends', () => {
    const fixtures = [
      parityRepo({ id: 1, name: 'alpha', full_name: 'acme/alpha', stargazers_count: 100 }),
      parityRepo({ id: 2, name: 'beta', full_name: 'acme/beta', stargazers_count: 50 }),
    ];
    const backend = backendSearch(fixtures, { limit: 0 });
    const electron = electronDiscovery.searchRepositories(fixtures, { limit: 0 });
    expect(backend.items).toHaveLength(1);
    expect(electron.limit).toBe(1);
    expect(electron.items.map((repo: { full_name: string }) => repo.full_name)).toEqual(
      backend.items.map((repo: { full_name: string }) => repo.full_name)
    );
  });
});

function parityRepo(partial: {
  id: number;
  name: string;
  full_name: string;
  stargazers_count: number;
}): {
  id: number;
  name: string;
  full_name: string;
  description: null;
  html_url: string;
  stargazers_count: number;
  language: string;
  topics: string[];
} {
  return {
    description: null,
    html_url: `https://github.com/${partial.full_name}`,
    language: 'TS',
    topics: [],
    ...partial,
  };
}
