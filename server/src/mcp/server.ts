import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMcpTools } from './tools.js';
import type { McpDataProvider } from './types.js';

export const MCP_SERVER_NAME = 'github-stars-manager';
export const MCP_SERVER_VERSION = '0.7.0';

export function createMcpServer(provider: McpDataProvider, vectorEnabled: boolean): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { capabilities: { tools: {} } }
  );
  registerMcpTools(server, provider, vectorEnabled);
  return server;
}
