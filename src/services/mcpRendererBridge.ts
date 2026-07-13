import { useAppStore } from '../store/useAppStore';
import { isElectron } from './electronProxy';
import { EmbeddingClient, VectorSearchService } from './vectorSearchService';

interface McpSnapshotRepo {
  fullName: string;
  name: string;
  description: string | null;
  htmlUrl: string;
  stars: number;
  language: string | null;
  topics: string[];
  customTags: string[];
  aiTags: string[];
  platforms: string[];
  category: string | null;
  updatedAt: string | null;
  analyzed: boolean;
  customDescription: string | null;
  aiSummary: string | null;
  starredAt: string | null;
}

interface McpSnapshot {
  repositories: McpSnapshotRepo[];
  releases: Array<{
    repoFullName: string;
    repoName: string;
    tagName: string;
    name: string | null;
    publishedAt: string | null;
    htmlUrl: string;
    prerelease: boolean;
    isRead: boolean;
  }>;
  categories: Array<{ id: string; name: string; count: number }>;
  vectorEnabled: boolean;
}

function parseArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function buildSnapshot(): McpSnapshot {
  const state = useAppStore.getState();
  const repos = state.repositories.map((r) => ({
    fullName: r.full_name,
    name: r.name,
    description: r.description ?? null,
    htmlUrl: r.html_url,
    stars: r.stargazers_count ?? 0,
    language: r.language ?? null,
    topics: parseArray(r.topics),
    customTags: parseArray(r.custom_tags),
    aiTags: parseArray(r.ai_tags),
    platforms: parseArray(r.ai_platforms),
    category: r.custom_category ?? null,
    updatedAt: r.updated_at ?? null,
    analyzed: !!r.analyzed_at,
    customDescription: r.custom_description ?? null,
    aiSummary: r.ai_summary ?? null,
    starredAt: r.starred_at ?? null,
  }));

  const predefined = (state.customCategories ?? []).map((c) => ({ id: c.id, name: c.name, count: 0 }));
  const countMap = new Map<string, number>();
  for (const r of repos) {
    if (r.category) countMap.set(r.category, (countMap.get(r.category) ?? 0) + 1);
  }
  const categories = predefined.map((p) => ({ ...p, count: countMap.get(p.name) ?? 0 }));
  for (const [name, count] of countMap) {
    if (!predefined.some((p) => p.name === name)) {
      categories.push({ id: name, name, count });
    }
  }

  return {
    repositories: repos,
    releases: state.releases.map((rel) => ({
      repoFullName: rel.repository?.full_name ?? '',
      repoName: rel.repository?.name ?? '',
      tagName: rel.tag_name ?? '',
      name: rel.name ?? null,
      publishedAt: rel.published_at ?? null,
      htmlUrl: rel.html_url ?? '',
      prerelease: !!rel.prerelease,
      isRead: !!rel.is_read,
    })),
    categories,
    vectorEnabled: !!(
      state.vectorSearchConfig.enabled &&
      state.vectorSearchConfig.workerUrl &&
      state.vectorSearchConfig.embeddingConfigId
    ),
  };
}

/**
 * Electron 专用：将收藏数据以快照形式推送给主进程内置的 MCP 服务，
 * 并暴露语义搜索委托（由渲染进程复用已有向量索引能力）。
 * 纯前端 / 后端模式下此函数为空操作。
 */
export function initMcpRendererBridge(): void {
  if (!isElectron()) return;

  (window as unknown as Record<string, unknown>).__gsmMcpSemanticSearch = async (
    query: string,
    topK = 10
  ): Promise<Array<{ fullName: string; score: number }>> => {
    const state = useAppStore.getState();
    const vs = state.vectorSearchConfig;
    if (!vs.enabled || !vs.workerUrl || !vs.embeddingConfigId) return [];
    const emb = state.embeddingConfigs.find((c) => c.id === vs.embeddingConfigId);
    if (!emb) return [];
    try {
      const client = new EmbeddingClient(emb);
      const svc = new VectorSearchService(vs);
      const vectors = await client.embed([query], 'query');
      if (!vectors || vectors.length === 0) return [];
      const matches = await svc.query(vectors[0], { topK, threshold: 0.3 });
      return matches
        .map((m) => ({
          fullName: String((m.metadata as { full_name?: string })?.full_name ?? m.id ?? ''),
          score: typeof m.score === 'number' ? m.score : 0,
        }))
        .filter((m) => !!m.fullName);
    } catch {
      return [];
    }
  };

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const push = () => {
    const state = useAppStore.getState();
    if (!state.mcpConfig.enabled) return;
    window.electronAPI?.pushMcpSnapshot?.(buildSnapshot());
  };

  // 启动时若已启用 MCP，则恢复主进程的 MCP 服务并推送初始快照
  const initial = useAppStore.getState();
  if (initial.mcpConfig.enabled && initial.mcpConfig.token) {
    window.electronAPI?.startMcp?.({ port: initial.mcpConfig.port || 18789, token: initial.mcpConfig.token });
    window.electronAPI?.pushMcpSnapshot?.(buildSnapshot());
  }

  useAppStore.subscribe((state, prev) => {
    if (state.mcpConfig.enabled && (!prev.mcpConfig.enabled || state.mcpConfig.token !== prev.mcpConfig.token)) {
      // 刚启用或令牌变更，立即推送一次
      window.electronAPI?.startMcp?.({ port: state.mcpConfig.port || 18789, token: state.mcpConfig.token });
      window.electronAPI?.pushMcpSnapshot?.(buildSnapshot());
      return;
    }
    if (!state.mcpConfig.enabled) return;
    // Only schedule a (debounced) snapshot push when data the snapshot actually
    // depends on changed. Plain UI state changes (e.g. selection, loading flags)
    // reuse the same references, so we skip the expensive rebuild.
    const relevantChanged =
      state.repositories !== prev.repositories ||
      state.releases !== prev.releases ||
      state.customCategories !== prev.customCategories ||
      state.vectorSearchConfig !== prev.vectorSearchConfig ||
      state.mcpConfig !== prev.mcpConfig;
    if (!relevantChanged) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(push, 2000);
  });
}
