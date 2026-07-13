import type Database from 'better-sqlite3';
import axios from 'axios';
import { decrypt } from '../services/crypto.js';
import { config } from '../config.js';
import type {
  McpDataProvider,
  McpListFilter,
  McpRepoSummary,
  McpRepoDetail,
  McpRepoComment,
  McpReleaseSummary,
  McpStat,
} from './types.js';

function parseJsonArray(value: unknown): string[] {
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
  } catch {
    return [];
  }
}

function mapSummary(row: Record<string, unknown>): McpRepoSummary {
  return {
    fullName: String(row.full_name ?? ''),
    name: String(row.name ?? ''),
    description: (row.description as string) ?? null,
    htmlUrl: String(row.html_url ?? ''),
    stars: Number(row.stargazers_count ?? 0),
    language: (row.language as string) ?? null,
    topics: parseJsonArray(row.topics),
    customTags: parseJsonArray(row.custom_tags),
    aiTags: parseJsonArray(row.ai_tags),
    platforms: parseJsonArray(row.ai_platforms),
    category: (row.custom_category as string) ?? null,
    updatedAt: (row.updated_at as string) ?? null,
    analyzed: !!row.analyzed_at,
  };
}

export class SqliteMcpProvider implements McpDataProvider {
  constructor(private readonly db: Database.Database) {}

  private readVectorConfig(): { enabled: boolean; workerUrl: string; authToken: string; embeddingConfigId: string } | null {
    const row = this.db
      .prepare('SELECT * FROM vector_search_configs WHERE id = ?')
      .get('default') as Record<string, unknown> | undefined;
    if (!row) return null;
    let authToken = '';
    if (row.auth_token_encrypted) {
      try {
        authToken = decrypt(row.auth_token_encrypted as string, config.encryptionKey);
      } catch {
        authToken = '';
      }
    }
    return {
      enabled: !!row.enabled,
      workerUrl: (row.worker_url as string) ?? '',
      authToken,
      embeddingConfigId: (row.embedding_config_id as string) ?? '',
    };
  }

  async isVectorSearchEnabled(): Promise<boolean> {
    const v = this.readVectorConfig();
    return !!v && v.enabled && !!v.workerUrl && !!v.embeddingConfigId;
  }

  listRepositories(filter: McpListFilter): Promise<McpRepoSummary[]> {
    const where: string[] = [];
    const params: unknown[] = [];

    if (filter.query && filter.query.trim()) {
      const q = `%${filter.query.trim()}%`;
      where.push(
        '(full_name LIKE ? OR description LIKE ? OR topics LIKE ? OR custom_tags LIKE ? OR custom_description LIKE ? OR ai_summary LIKE ?)'
      );
      params.push(q, q, q, q, q, q);
    }
    if (filter.languages && filter.languages.length) {
      where.push(`language IN (${filter.languages.map(() => '?').join(',')})`);
      params.push(...filter.languages);
    }
    if (filter.categories && filter.categories.length) {
      where.push(`custom_category IN (${filter.categories.map(() => '?').join(',')})`);
      params.push(...filter.categories);
    }
    if (typeof filter.minStars === 'number') {
      where.push('stargazers_count >= ?');
      params.push(filter.minStars);
    }
    if (typeof filter.maxStars === 'number') {
      where.push('stargazers_count <= ?');
      params.push(filter.maxStars);
    }
    if (filter.isAnalyzed !== undefined) {
      where.push(filter.isAnalyzed ? 'analyzed_at IS NOT NULL' : 'analyzed_at IS NULL');
    }

    const sql = `
      SELECT * FROM repositories
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${
        filter.sortBy === 'name'
          ? 'full_name'
          : filter.sortBy === 'starred'
            ? 'starred_at'
            : filter.sortBy === 'updated'
              ? 'updated_at'
              : 'stargazers_count'
      } ${filter.sortOrder === 'asc' ? 'ASC' : 'DESC'}
      LIMIT ? OFFSET ?
    `;
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const offset = Math.max(filter.offset ?? 0, 0);
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    let results = rows.map(mapSummary);

    if (filter.tags && filter.tags.length) {
      const tags = filter.tags.map((t) => t.toLowerCase());
      results = results.filter((r) =>
        [...r.customTags, ...r.aiTags, ...r.topics].some((t) => tags.includes(t.toLowerCase()))
      );
    }
    return Promise.resolve(results);
  }

  getRepository(fullName: string): Promise<McpRepoDetail | null> {
    const row = this.db
      .prepare('SELECT * FROM repositories WHERE full_name = ?')
      .get(fullName) as Record<string, unknown> | undefined;
    if (!row) return Promise.resolve(null);
    const summary = mapSummary(row);
    return Promise.resolve({
      ...summary,
      customDescription: (row.custom_description as string) ?? null,
      aiSummary: (row.ai_summary as string) ?? null,
      notes: (row.custom_description as string) ?? null,
      readmeSnippet: null,
      starredAt: (row.starred_at as string) ?? null,
      vectorIndexedAt: null,
    });
  }

  getRepositoryComments(fullName: string): Promise<McpRepoComment | null> {
    const row = this.db
      .prepare('SELECT full_name, custom_description FROM repositories WHERE full_name = ?')
      .get(fullName) as Record<string, unknown> | undefined;
    if (!row) return Promise.resolve(null);
    return Promise.resolve({
      fullName: String(row.full_name ?? ''),
      customDescription: (row.custom_description as string) ?? null,
      notes: (row.custom_description as string) ?? null,
    });
  }

  async semanticSearch(query: string, topK: number): Promise<Array<{ fullName: string; score: number }>> {
    const v = this.readVectorConfig();
    if (!v || !v.enabled || !v.workerUrl || !v.embeddingConfigId) {
      return [];
    }
    const embRow = this.db
      .prepare('SELECT * FROM embedding_configs WHERE id = ?')
      .get(v.embeddingConfigId) as Record<string, unknown> | undefined;
    if (!embRow) return [];

    const apiKey = embRow.api_key_encrypted ? decrypt(embRow.api_key_encrypted as string, config.encryptionKey) : '';
    const baseUrl = (embRow.base_url as string) ?? '';
    const model = (embRow.model as string) ?? '';
    const apiType = (embRow.api_type as string) ?? 'openai';

    const vector = await this.embedQuery(apiType, baseUrl, apiKey, model, query);
    if (!vector) return [];

    try {
      const res = await axios.post(
        `${v.workerUrl.replace(/\/+$/, '')}/query`,
        { vector, topK: Math.min(topK, 50), threshold: 0.3 },
        { headers: { Authorization: `Bearer ${v.authToken}`, 'Content-Type': 'application/json' }, timeout: 15000 }
      );
      const matches = (res.data?.matches ?? []) as Array<{ id?: string; metadata?: { full_name?: string }; score?: number }>;
      return matches
        .map((m) => ({
          fullName: (m.metadata?.full_name ?? m.id ?? '') as string,
          score: typeof m.score === 'number' ? m.score : 0,
        }))
        .filter((m) => !!m.fullName);
    } catch {
      return [];
    }
  }

  private async embedQuery(
    apiType: string,
    baseUrl: string,
    apiKey: string,
    model: string,
    text: string
  ): Promise<number[] | null> {
    try {
      if (apiType === 'ollama') {
        const res = await axios.post(
          `${baseUrl.replace(/\/+$/, '')}/api/embed`,
          { model, input: text },
          { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
        );
        return (res.data?.embeddings?.[0] as number[]) ?? null;
      }
      if (apiType === 'gemini') {
        const res = await axios.post(
          `${baseUrl.replace(/\/+$/, '')}/v1beta/models/${model}:batchEmbedContents?key=${apiKey}`,
          { requests: [{ model: `models/${model}`, content: { parts: [{ text }] } }] },
          { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
        );
        return (res.data?.embeddings?.[0]?.values as number[]) ?? null;
      }
      // openai / openai-compatible / siliconflow / cohere
      const url =
        apiType === 'cohere'
          ? `${baseUrl.replace(/\/+$/, '')}/v1/embed`
          : `${baseUrl.replace(/\/+$/, '')}/v1/embeddings`;
      const res = await axios.post(
        url,
        apiType === 'cohere' ? { model, texts: [text], input_type: 'search_query' } : { input: [text], model },
        { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 15000 }
      );
      if (apiType === 'cohere') return (res.data?.embeddings?.[0]?.values as number[]) ?? null;
      return (res.data?.data?.[0]?.embedding as number[]) ?? null;
    } catch {
      return null;
    }
  }

  listCategories(): Promise<Array<{ id: string; name: string; count: number }>> {
    const predefined = this.db.prepare('SELECT id, name FROM categories').all() as Array<{ id: string; name: string }>;
    const counts = this.db
      .prepare("SELECT custom_category, COUNT(*) AS c FROM repositories WHERE custom_category IS NOT NULL AND custom_category != '' GROUP BY custom_category")
      .all() as Array<{ custom_category: string; c: number }>;
    const countMap = new Map(counts.map((c) => [c.custom_category, c.c]));
    const result = predefined.map((p) => ({ id: p.id, name: p.name, count: countMap.get(p.name) ?? 0 }));
    for (const c of counts) {
      if (!predefined.some((p) => p.name === c.custom_category)) {
        result.push({ id: c.custom_category, name: c.custom_category, count: c.c });
      }
    }
    return Promise.resolve(result);
  }

  listTags(): Promise<Array<{ tag: string; count: number }>> {
    const rows = this.db
      .prepare('SELECT custom_tags, ai_tags, topics FROM repositories')
      .all() as Array<{ custom_tags: string; ai_tags: string; topics: string }>;
    const tally = new Map<string, number>();
    for (const row of rows) {
      for (const tag of [...parseJsonArray(row.custom_tags), ...parseJsonArray(row.ai_tags), ...parseJsonArray(row.topics)]) {
        if (!tag) continue;
        tally.set(tag, (tally.get(tag) ?? 0) + 1);
      }
    }
    const result = [...tally.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 100);
    return Promise.resolve(result);
  }

  listReleases(since: string | null, limit: number): Promise<McpReleaseSummary[]> {
    const sql = `
      SELECT repo_full_name, repo_name, tag_name, name, published_at, html_url, prerelease, is_read
      FROM releases
      ${since ? 'WHERE published_at >= ?' : ''}
      ORDER BY published_at DESC
      LIMIT ?
    `;
    const params = since ? [since, Math.min(Math.max(limit, 1), 200)] : [Math.min(Math.max(limit, 1), 200)];
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return Promise.resolve(
      rows.map((r) => ({
        repoFullName: String(r.repo_full_name ?? ''),
        repoName: String(r.repo_name ?? ''),
        tagName: String(r.tag_name ?? ''),
        name: (r.name as string) ?? null,
        publishedAt: (r.published_at as string) ?? null,
        htmlUrl: String(r.html_url ?? ''),
        prerelease: !!r.prerelease,
        isRead: !!r.is_read,
      }))
    );
  }

  getStats(): Promise<McpStat> {
    const total = (this.db.prepare('SELECT COUNT(*) AS c FROM repositories').get() as { c: number }).c;
    const analyzed = (
      this.db.prepare("SELECT COUNT(*) AS c FROM repositories WHERE analyzed_at IS NOT NULL").get() as { c: number }
    ).c;

    const langs = this.db
      .prepare("SELECT language, COUNT(*) AS c FROM repositories WHERE language IS NOT NULL GROUP BY language")
      .all() as Array<{ language: string; c: number }>;
    const byLanguage: Record<string, number> = {};
    for (const l of langs) byLanguage[l.language] = l.c;

    const cats = this.db
      .prepare("SELECT custom_category, COUNT(*) AS c FROM repositories WHERE custom_category IS NOT NULL AND custom_category != '' GROUP BY custom_category")
      .all() as Array<{ custom_category: string; c: number }>;
    const byCategory: Record<string, number> = {};
    for (const c of cats) byCategory[c.custom_category] = c.c;

    const tags = this.db
      .prepare('SELECT custom_tags, ai_tags, topics FROM repositories')
      .all() as Array<{ custom_tags: string; ai_tags: string; topics: string }>;
    const tally = new Map<string, number>();
    for (const row of tags) {
      for (const tag of [...parseJsonArray(row.custom_tags), ...parseJsonArray(row.ai_tags), ...parseJsonArray(row.topics)]) {
        if (!tag) continue;
        tally.set(tag, (tally.get(tag) ?? 0) + 1);
      }
    }
    const topTags = [...tally.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    return Promise.resolve({ totalRepositories: total, analyzedCount: analyzed, byLanguage, byCategory, topTags });
  }
}
