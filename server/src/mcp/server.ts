import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMcpTools } from './tools.js';
import { MCP_SERVER_VERSION } from './version.js';

export async function createMcpServer(): Promise<McpServer> {
  const server = new McpServer({
    name: 'github-stars-manager',
    version: MCP_SERVER_VERSION,
  });
  await registerMcpTools(server);
  return server;
}
