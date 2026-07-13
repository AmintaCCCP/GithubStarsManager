import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpDataProvider } from './types.js';

function json(content: unknown) {
  return {
    content: [{ type: 'text' as const, text: typeof content === 'string' ? content : JSON.stringify(content, null, 2) }],
  };
}

export function registerMcpTools(server: McpServer, provider: McpDataProvider, vectorEnabled: boolean): void {
  server.registerTool(
    'search_repositories',
    {
      description:
        'Search the user\'s starred GitHub repositories stored and curated by GitHub Stars Manager. Supports keyword query plus filters by tags, languages, categories, star range and AI-analyzed status. Returns a list of repository summaries.',
      inputSchema: {
        query: z.string().optional().describe('Free-text query matched against name, description, topics, tags and notes'),
        tags: z.array(z.string()).optional().describe('Filter by any of these tags (custom tags, AI tags or topics)'),
        languages: z.array(z.string()).optional().describe('Filter by programming language'),
        categories: z.array(z.string()).optional().describe('Filter by custom category name'),
        minStars: z.number().optional().describe('Minimum star count'),
        maxStars: z.number().optional().describe('Maximum star count'),
        isAnalyzed: z.boolean().optional().describe('Only include AI-analyzed repositories when true'),
        sortBy: z.enum(['stars', 'updated', 'name', 'starred']).optional(),
        sortOrder: z.enum(['desc', 'asc']).optional(),
        limit: z.number().optional().describe('Max results (1-200, default 50)'),
      },
    },
    async (args) => {
      const repos = await provider.listRepositories({
        query: args.query,
        tags: args.tags,
        languages: args.languages,
        categories: args.categories,
        minStars: args.minStars,
        maxStars: args.maxStars,
        isAnalyzed: args.isAnalyzed,
        sortBy: args.sortBy,
        sortOrder: args.sortOrder,
        limit: args.limit,
      });
      return json(repos);
    }
  );

  server.registerTool(
    'get_repository',
    {
      description:
        'Get the full detail of a single starred repository by its full_name (owner/repo), including description, AI summary, custom tags, platforms, category and notes.',
      inputSchema: { fullName: z.string().describe('Repository full_name, e.g. "owner/repo"') },
    },
    async (args) => {
      const repo = await provider.getRepository(args.fullName);
      if (!repo) return json({ error: `Repository not found: ${args.fullName}` });
      return json(repo);
    }
  );

  server.registerTool(
    'get_repository_comments',
    {
      description:
        'Get the user-authored notes / custom description / comments attached to a starred repository by full_name. Useful when the user wants to recall what they wrote about a repo.',
      inputSchema: { fullName: z.string().describe('Repository full_name, e.g. "owner/repo"') },
    },
    async (args) => {
      const comments = await provider.getRepositoryComments(args.fullName);
      if (!comments) return json({ error: `Repository not found: ${args.fullName}` });
      return json(comments);
    }
  );

  server.registerTool(
    'list_categories',
    {
      description: 'List all categories (predefined and custom) with the number of starred repositories in each.',
      inputSchema: {},
    },
    async () => {
      return json(await provider.listCategories());
    }
  );

  server.registerTool(
    'list_tags',
    {
      description: 'List the most used tags (custom tags, AI tags and topics) across starred repositories with counts.',
      inputSchema: {},
    },
    async () => {
      return json(await provider.listTags());
    }
  );

  server.registerTool(
    'list_releases',
    {
      description:
        'List recent releases of starred repositories, optionally filtered by publish date (ISO string, inclusive).',
      inputSchema: {
        since: z.string().optional().describe('Only releases published at or after this ISO datetime'),
        limit: z.number().optional().describe('Max results (1-200, default 50)'),
      },
    },
    async (args) => {
      return json(await provider.listReleases(args.since ?? null, args.limit ?? 50));
    }
  );

  server.registerTool(
    'get_stats',
    {
      description:
        'Get aggregate statistics of the user\'s starred repositories: total count, analyzed count, breakdown by language and category, and top tags.',
      inputSchema: {},
    },
    async () => {
      return json(await provider.getStats());
    }
  );

  if (vectorEnabled) {
    server.registerTool(
      'semantic_search_repositories',
      {
        description:
          'Semantic / natural-language search over starred repositories using the configured vector index. Returns repositories ranked by embedding similarity to the query.',
        inputSchema: {
          query: z.string().describe('Natural-language query, e.g. "a lightweight Rust CLI for PDF merging"'),
          topK: z.number().optional().describe('Number of results (default 10)'),
        },
      },
      async (args) => {
        const results = await provider.semanticSearch(args.query, args.topK ?? 10);
        return json(results);
      }
    );
  }
}
