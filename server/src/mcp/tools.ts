import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  getRepository,
  getStats,
  getVectorAvailability,
  listCategories,
  loadAllRepositories,
  searchRepos,
  vectorSearch,
} from './provider.js';
import { projectRepoForAgent } from './repoSearch.js';

function textResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

export function registerMcpTools(server: McpServer): void {
  server.registerTool(
    'gsm_status',
    {
      description:
        'Get GithubStarsManager MCP status: repo count, vector availability, and version.',
    },
    async () => {
      const repos = loadAllRepositories();
      const vector = getVectorAvailability();
      return textResult({
        name: 'github-stars-manager',
        version: '0.7.0',
        mode: 'backend-sqlite',
        repositoryCount: repos.length,
        vector: {
          available: vector.available,
          reason: vector.reason,
          embeddingModel: vector.embeddingModel,
        },
        toolsNote: vector.available
          ? 'gsm_vector_search is available'
          : 'gsm_vector_search is not listed until vector search is configured and enabled',
      });
    }
  );

  server.registerTool(
    'gsm_search_repos',
    {
      description:
        'Keyword search over starred repositories including AI summaries/tags and custom fields. Supports filters and pagination.',
      inputSchema: {
        query: z.string().optional().describe('Keyword query (AND of words)'),
        languages: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
        platforms: z.array(z.string()).optional(),
        category: z.string().optional().describe('custom_category exact match'),
        minStars: z.number().optional(),
        maxStars: z.number().optional(),
        isAnalyzed: z.boolean().optional(),
        isSubscribed: z.boolean().optional(),
        sortBy: z.enum(['stars', 'updated', 'name', 'starred']).optional(),
        sortOrder: z.enum(['asc', 'desc']).optional(),
        limit: z.number().min(1).max(100).optional(),
        offset: z.number().min(0).optional(),
      },
    },
    async (args) => {
      const result = searchRepos({
        query: args.query,
        languages: args.languages,
        tags: args.tags,
        platforms: args.platforms,
        category: args.category,
        minStars: args.minStars,
        maxStars: args.maxStars,
        isAnalyzed: args.isAnalyzed,
        isSubscribed: args.isSubscribed,
        sortBy: args.sortBy,
        sortOrder: args.sortOrder,
        limit: args.limit,
        offset: args.offset,
      });
      return textResult(result);
    }
  );

  server.registerTool(
    'gsm_get_repo',
    {
      description:
        'Get one repository by numeric id or full_name (e.g. owner/repo). Returns processed AI fields.',
      inputSchema: {
        idOrFullName: z.string().describe('Repository id or full_name'),
      },
    },
    async (args) => {
      const repo = getRepository(args.idOrFullName);
      if (!repo) {
        return textResult({ error: 'not_found', idOrFullName: args.idOrFullName });
      }
      return textResult(projectRepoForAgent(repo, { summaryMaxChars: 2000 }));
    }
  );

  server.registerTool(
    'gsm_list_categories',
    {
      description: 'List custom categories stored in GithubStarsManager.',
    },
    async () => textResult({ categories: listCategories() })
  );

  server.registerTool(
    'gsm_list_repos_by_category',
    {
      description: 'List repositories in a custom_category with pagination.',
      inputSchema: {
        category: z.string().describe('custom_category value'),
        limit: z.number().min(1).max(100).optional(),
        offset: z.number().min(0).optional(),
        sortBy: z.enum(['stars', 'updated', 'name', 'starred']).optional(),
        sortOrder: z.enum(['asc', 'desc']).optional(),
      },
    },
    async (args) => {
      const result = searchRepos({
        category: args.category,
        limit: args.limit,
        offset: args.offset,
        sortBy: args.sortBy,
        sortOrder: args.sortOrder,
      });
      return textResult(result);
    }
  );

  server.registerTool(
    'gsm_stats',
    {
      description:
        'Aggregate stats over starred repositories (language, analysis, tags).',
    },
    async () => textResult(getStats())
  );

  // Only list vector tool when vector search is fully configured
  const vector = getVectorAvailability();
  if (vector.available) {
    server.registerTool(
      'gsm_vector_search',
      {
        description:
          'Semantic vector search over indexed stars (requires vector search configured in the app).',
        inputSchema: {
          query: z.string().min(1).describe('Natural language query'),
          topK: z.number().min(1).max(50).optional(),
          threshold: z.number().min(0).max(1).optional(),
        },
      },
      async (args) => {
        const result = await vectorSearch(args.query, {
          topK: args.topK,
          threshold: args.threshold,
        });
        return textResult(result);
      }
    );
  }
}
