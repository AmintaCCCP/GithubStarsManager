import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMcpTools } from './tools.js';

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'github-stars-manager',
    version: '0.7.0',
  });
  registerMcpTools(server);
  return server;
}
