import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMcpTools } from './tools.js';
import { MCP_SERVER_VERSION } from './version.js';

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'github-stars-manager',
    version: MCP_SERVER_VERSION,
  });
  registerMcpTools(server);
  return server;
}
