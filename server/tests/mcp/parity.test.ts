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
const electronModule = await import('../../../electron/mcpLocalServer.js');
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
});
