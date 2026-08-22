import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import React, { useState, useCallback } from 'react';
import {
  Search,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle,
  XCircle,
  RefreshCw,
  Square,
  ChevronDown,
  ChevronRight,
  Zap,
} from 'lucide-react';
import {
  LEGACY_EMBEDDING_FORMAT_VERSION,
  isKnownEmbeddingFormatVersion,
  useAppStore,
} from '../../store/useAppStore';
import {
  EmbeddingClient,
  VectorSearchService,
  indexAllRepos,
  needsReindex,
  EMBEDDING_FORMAT_VERSION,
} from '../../services/vectorSearchService';
import { GitHubApiService } from '../../services/githubApi';
import type { EmbeddingApiType, EmbeddingConfig } from '../../types';
import { normalizeLicense } from '../../utils/licenseFilter';
import { SliderInput } from '../ui/SliderInput';
import { useDialog } from '../../hooks/useDialog';

interface VectorSearchSettingsProps {
  t: (zh: string, en: string) => string;
}

const EMBEDDING_API_TYPES: { value: EmbeddingApiType; label: string; labelEn: string }[] = [
  { value: 'openai', label: 'OpenAI', labelEn: 'OpenAI' },
  { value: 'openai-compatible', label: 'OpenAI 兼容端点', labelEn: 'OpenAI Compatible' },
  { value: 'siliconflow', label: '硅基流动', labelEn: 'SiliconFlow' },
  { value: 'gemini', label: 'Gemini', labelEn: 'Gemini' },
  { value: 'cohere', label: 'Cohere', labelEn: 'Cohere' },
  { value: 'ollama', label: 'Ollama (本地)', labelEn: 'Ollama (Local)' },
];

const DEFAULT_DIMENSIONS: Record<EmbeddingApiType, number> = {
  openai: 1536,
  'openai-compatible': 1536,
  siliconflow: 1024,
  gemini: 768,
  cohere: 1024,
  ollama: 768,
};

export const VectorSearchSettings: React.FC<VectorSearchSettingsProps> = ({ t }) => {
  const {
    embeddingConfigs,
    activeEmbeddingConfig,
    vectorSearchConfig,
    vectorSearchStatus,
    vectorIndexingState,
    addEmbeddingConfig,
    updateEmbeddingConfig,
    setActiveEmbeddingConfig,
    setVectorSearchConfig,
    setVectorSearchStatus,
    setVectorIndexingState,
    repositories,
    githubToken,
    updateRepositoriesMetadata,
  } = useAppStore();
  const { toast } = useDialog();

  // Local form state for embedding config
  const activeConfig = embeddingConfigs.find((c) => c.id === activeEmbeddingConfig);
  const [formApiType, setFormApiType] = useState<EmbeddingApiType>(activeConfig?.apiType || 'openai');
  const [formBaseUrl, setFormBaseUrl] = useState(activeConfig?.baseUrl || '');
  const [formApiKey, setFormApiKey] = useState(activeConfig?.apiKey || '');
  const [formModel, setFormModel] = useState(activeConfig?.model || '');
  const [formDimensions, setFormDimensions] = useState(activeConfig?.dimensions || 1536);
  const [formDimensionsInput, setFormDimensionsInput] = useState(String(activeConfig?.dimensions || 1536));
  const dimensionsInputRef = React.useRef<HTMLInputElement>(null);
  const [showApiKey, setShowApiKey] = useState(false);

  // Worker form state
  const [formWorkerUrl, setFormWorkerUrl] = useState(vectorSearchConfig.workerUrl || '');
  const [formAuthToken, setFormAuthToken] = useState(vectorSearchConfig.authToken || '');
  const [showAuthToken, setShowAuthToken] = useState(false);

  // Index mode state
  const [formIndexMode, setFormIndexMode] = useState<'description' | 'readme'>(vectorSearchConfig.indexMode || 'readme');
  const [formReadmeMaxChars, setFormReadmeMaxChars] = useState(vectorSearchConfig.readmeMaxChars || 6000);
  const [formReadmeMaxCharsInput, setFormReadmeMaxCharsInput] = useState(String(vectorSearchConfig.readmeMaxChars || 6000));

  // Search parameters state
  const [formSearchThreshold, setFormSearchThreshold] = useState(vectorSearchConfig.searchThreshold ?? 0.35);
  const [formSearchTopK, setFormSearchTopK] = useState(vectorSearchConfig.searchTopK ?? 30);
  const [formSearchTopKInput, setFormSearchTopKInput] = useState(String(vectorSearchConfig.searchTopK ?? 30));
  const [formEnableHyDE, setFormEnableHyDE] = useState(vectorSearchConfig.enableHyDE ?? true);
  const [formEnableReranking, setFormEnableReranking] = useState(vectorSearchConfig.enableReranking ?? true);

  // Test state
  const [testingEmbedding, setTestingEmbedding] = useState(false);
  const [embeddingTestResult, setEmbeddingTestResult] = useState<{ success: boolean; dimensions: number; error?: string } | null>(null);
  const [testingWorker, setTestingWorker] = useState(false);
  const [workerTestResult, setWorkerTestResult] = useState<{ success: boolean; vectorCount: number; dimensions: number; error?: string } | null>(null);

  // Save feedback
  const [embeddingSaved, setEmbeddingSaved] = useState(false);
  const [workerSaved, setWorkerSaved] = useState(false);

  // Indexing state (from store, persists across navigation)
  const { isIndexing, phase, phaseDone, phaseTotal, result: indexResult } = vectorIndexingState;
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // Deploy guide
  const [showDeployGuide, setShowDeployGuide] = useState(false);

  // Sync form state when active config changes
  React.useEffect(() => {
    if (activeConfig) {
      setFormApiType(activeConfig.apiType);
      setFormBaseUrl(activeConfig.baseUrl);
      setFormApiKey(activeConfig.apiKey);
      setFormModel(activeConfig.model);
      setFormDimensions(activeConfig.dimensions);
      setFormDimensionsInput(String(activeConfig.dimensions));
    }
  }, [activeConfig]);

  // Sync worker form state
  React.useEffect(() => {
    setFormWorkerUrl(vectorSearchConfig.workerUrl);
    setFormAuthToken(vectorSearchConfig.authToken);
  }, [vectorSearchConfig.workerUrl, vectorSearchConfig.authToken]);

  const handleSaveEmbeddingConfig = useCallback(() => {
    const configData: Omit<EmbeddingConfig, 'id' | 'isActive' | 'apiKeyStatus'> = {
      name: `${formApiType} Embedding`,
      apiType: formApiType,
      baseUrl: formBaseUrl,
      apiKey: formApiKey,
      model: formModel,
      dimensions: formDimensions,
    };

    if (activeConfig) {
      updateEmbeddingConfig(activeConfig.id, configData);
    } else {
      const id = `emb_${Date.now()}`;
      addEmbeddingConfig({
        ...configData,
        id,
        isActive: true,
      });
      setActiveEmbeddingConfig(id);
    }
    setEmbeddingSaved(true);
    setTimeout(() => setEmbeddingSaved(false), 2000);
  }, [activeConfig, formApiType, formBaseUrl, formApiKey, formModel, formDimensions, addEmbeddingConfig, updateEmbeddingConfig, setActiveEmbeddingConfig]);

  const handleSaveWorkerConfig = useCallback(() => {
    setVectorSearchConfig({
      workerUrl: formWorkerUrl,
      authToken: formAuthToken,
      embeddingConfigId: activeEmbeddingConfig || '',
      indexMode: formIndexMode,
      readmeMaxChars: formReadmeMaxChars,
      searchThreshold: formSearchThreshold,
      searchTopK: formSearchTopK,
      enableHyDE: formEnableHyDE,
      enableReranking: formEnableReranking,
    });
    setWorkerSaved(true);
    setTimeout(() => setWorkerSaved(false), 2000);
  }, [formWorkerUrl, formAuthToken, formIndexMode, formReadmeMaxChars, formSearchThreshold, formSearchTopK, formEnableHyDE, formEnableReranking, activeEmbeddingConfig, setVectorSearchConfig]);

  const handleTestEmbedding = useCallback(async () => {
    setTestingEmbedding(true);
    setEmbeddingTestResult(null);
    try {
      const client = new EmbeddingClient({
        id: 'test',
        name: 'test',
        apiType: formApiType,
        baseUrl: formBaseUrl,
        apiKey: formApiKey,
        model: formModel,
        dimensions: formDimensions,
        isActive: true,
      });
      const result = await client.testConnection();
      setEmbeddingTestResult(result);
    } catch (err) {
      setEmbeddingTestResult({
        success: false,
        dimensions: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTestingEmbedding(false);
    }
  }, [formApiType, formBaseUrl, formApiKey, formModel, formDimensions]);

  const handleTestWorker = useCallback(async () => {
    setTestingWorker(true);
    setWorkerTestResult(null);
    try {
      const service = new VectorSearchService({
        workerUrl: formWorkerUrl,
        authToken: formAuthToken,
      });
      const result = await service.testConnection();
      setWorkerTestResult(result);
      // 同步更新 store 中的状态，让状态区域实时反映
      if (result.success) {
        setVectorSearchStatus({
          connected: true,
          vectorCount: result.vectorCount,
          dimensions: result.dimensions,
        });
      }
    } catch (err) {
      setWorkerTestResult({
        success: false,
        vectorCount: 0,
        dimensions: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTestingWorker(false);
    }
  }, [formWorkerUrl, formAuthToken, setVectorSearchStatus]);

  // 未索引数量（已分析、未失败、未向量索引或内容已更新）。仅计算内容/license 维度，
  // 不含格式版本升级——后者由 incrementalTargetCount 在 formatVersionNeedsReindex 时另行叠加。
  const unindexedCount = repositories.filter((r) => {
    if (!r.analyzed_at || r.analysis_failed) return false;
    return needsReindex(r, false);
  }).length;
  const indexableCount = repositories.filter((r) => r.analyzed_at && !r.analysis_failed).length;

  // 嵌入文本格式版本升级时，即使无内容更新也需要触发增量索引来重建所有向量
  const storedEmbeddingFormatVersion = isKnownEmbeddingFormatVersion(vectorSearchConfig.embeddingFormatVersion)
    ? vectorSearchConfig.embeddingFormatVersion
    : LEGACY_EMBEDDING_FORMAT_VERSION;
  const formatVersionNeedsReindex = storedEmbeddingFormatVersion < EMBEDDING_FORMAT_VERSION;
  const incrementalTargetCount = formatVersionNeedsReindex ? indexableCount : unindexedCount;

  const createClients = useCallback(() => {
    if (!activeConfig) return null;
    const embeddingClient = new EmbeddingClient({
      ...activeConfig,
      apiType: formApiType,
      baseUrl: formBaseUrl,
      apiKey: formApiKey,
      model: formModel,
      dimensions: formDimensions,
    });
    const vectorService = new VectorSearchService({
      workerUrl: formWorkerUrl,
      authToken: formAuthToken,
    });
    // 复用单个 GitHubApiService 实例，保留 rate-limit state
    const githubApi = githubToken ? new GitHubApiService(githubToken) : null;
    const readmeFetcher = githubApi
      ? (owner: string, repo: string, signal?: AbortSignal) =>
          githubApi.getRepositoryReadme(owner, repo, signal)
      : undefined;
    return { embeddingClient, vectorService, readmeFetcher };
  }, [activeConfig, formApiType, formBaseUrl, formApiKey, formModel, formDimensions, formWorkerUrl, formAuthToken, githubToken]);

  const handleRebuildIndex = useCallback(async () => {
    const clients = createClients();
    if (!clients) return;

    const controller = new AbortController();
    setAbortController(controller);
    setVectorIndexingState({ isIndexing: true, phase: null, phaseDone: 0, phaseTotal: 0, result: null });

    try {
      // 每次点击时读取最新的 repositories，避免闭包捕获过期数据
      const currentRepos = useAppStore.getState().repositories;
      const now = new Date().toISOString();
      // 按 id 取 license，用于在 stamp vector_indexed_at 的同时记录本次采用的
      // 归一化 license（向量增量谓词据此判断 license 变更触发重索引）。
      const licenseById = new Map(currentRepos.map(r => [r.id, r.license ?? null]));
      const stampRepo = (id: number) => ({
        id,
        patch: { vector_indexed_at: now, vector_indexed_license: normalizeLicense(licenseById.get(id) ?? null) },
      });

      // 1. 清除所有 vector_indexed_at（包括之前失败/不可索引的 repo 的残留值）
      //    用 updateRepositoriesMetadata 避免重置当前过滤的 searchResults
      //    同步清除 vector_indexed_license，使 license 指纹与 stamp 同进退。
      updateRepositoriesMetadata(
        currentRepos.filter(r => r.vector_indexed_at).map(r => ({
          id: r.id,
          patch: { vector_indexed_at: undefined, vector_indexed_license: undefined },
        }))
      );

      // 2. 全量索引，逐批确认后立即 stamp（中断不丢失已确认进度）
      const stampedRepoIds: number[] = [];
      const result = await indexAllRepos(currentRepos, clients.embeddingClient, clients.vectorService, {
        onProgress: (progress) => setVectorIndexingState({
          phase: progress.phase,
          phaseDone: progress.done,
          phaseTotal: progress.total,
        }),
        signal: controller.signal,
        readmeFetcher: clients.readmeFetcher,
        indexMode: formIndexMode,
        readmeMaxChars: formReadmeMaxChars,
        incremental: false,
        onRepoIndexed: (repoId) => {
          stampedRepoIds.push(repoId);
          // 批量 stamp：每 32 个（一个 batch）刷新一次，减少 UI 刷新频率
          if (stampedRepoIds.length % 32 === 0) {
            const batch = stampedRepoIds.splice(0, stampedRepoIds.length);
            updateRepositoriesMetadata(batch.map(stampRepo));
          }
        },
      });

      // stamp 剩余未刷新的
      if (stampedRepoIds.length > 0) {
        updateRepositoriesMetadata(stampedRepoIds.map(stampRepo));
      }

      // 3. cleanup：全量重建后只保留本次成功重建的向量
      try {
        await clients.vectorService.cleanup(result.indexedRepoIds.map(String), controller.signal);
      } catch (cleanupErr) {
        console.warn('Vector cleanup failed after rebuild:', cleanupErr);
        throw cleanupErr;
      }

      setVectorIndexingState({ result, isIndexing: false, phase: null });
      setVectorSearchStatus({
        connected: true,
        vectorCount: result.indexed,
        dimensions: formDimensions,
        lastSyncAt: new Date().toISOString(),
      });
      // 索引成功后更新格式版本号，避免下次增量索引重复触发全量重建
      setVectorSearchConfig({ embeddingFormatVersion: EMBEDDING_FORMAT_VERSION });
    } catch (err) {
      if (err instanceof Error && err.message === 'Aborted') {
        setVectorIndexingState({ isIndexing: false, phase: null, result: null });
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        const currentRepos = useAppStore.getState().repositories;
        const indexableCount = currentRepos.filter((r) => r.analyzed_at && !r.analysis_failed).length;
        setVectorIndexingState({ isIndexing: false, phase: null, result: { indexed: 0, skipped: currentRepos.length - indexableCount, errors: indexableCount, error: msg } });
      }
    } finally {
      setAbortController(null);
    }
  }, [createClients, formIndexMode, formReadmeMaxChars, formDimensions, updateRepositoriesMetadata, setVectorSearchStatus, setVectorIndexingState, setVectorSearchConfig]);

  const handleIncrementalIndex = useCallback(async () => {
    const clients = createClients();
    if (!clients) return;

    const controller = new AbortController();
    setAbortController(controller);
    setVectorIndexingState({ isIndexing: true, phase: null, phaseDone: 0, phaseTotal: 0, result: null });
    let currentEmbeddingFormatVersion = LEGACY_EMBEDDING_FORMAT_VERSION;

    try {
      // 每次点击时读取最新的 repositories / vectorSearchConfig，避免闭包捕获过期数据
      const currentState = useAppStore.getState();
      const currentRepos = currentState.repositories;
      currentEmbeddingFormatVersion = isKnownEmbeddingFormatVersion(currentState.vectorSearchConfig.embeddingFormatVersion)
        ? currentState.vectorSearchConfig.embeddingFormatVersion
        : LEGACY_EMBEDDING_FORMAT_VERSION;

      // 记录索引前无 vector_indexed_at 的 repo，用于精确计算新增数量
      const newlyIndexedRepoIds = new Set(
        currentRepos.filter(r => !r.vector_indexed_at).map(r => r.id)
      );

      const now = new Date().toISOString();
      // 与全量重建一致：stamp 时同步记录本次索引采用的归一化 license，
      // 供增量谓词下次判断 license 是否变化。
      const licenseById = new Map(currentRepos.map(r => [r.id, r.license ?? null]));
      const stampRepo = (id: number) => ({
        id,
        patch: { vector_indexed_at: now, vector_indexed_license: normalizeLicense(licenseById.get(id) ?? null) },
      });
      const stampedRepoIds: number[] = [];
      const result = await indexAllRepos(currentRepos, clients.embeddingClient, clients.vectorService, {
        onProgress: (progress) => setVectorIndexingState({
          phase: progress.phase,
          phaseDone: progress.done,
          phaseTotal: progress.total,
        }),
        signal: controller.signal,
        readmeFetcher: clients.readmeFetcher,
        indexMode: formIndexMode,
        readmeMaxChars: formReadmeMaxChars,
        incremental: true,
        formatVersion: currentEmbeddingFormatVersion,
        currentFormatVersion: EMBEDDING_FORMAT_VERSION,
        onRepoIndexed: (repoId) => {
          stampedRepoIds.push(repoId);
          if (stampedRepoIds.length % 32 === 0) {
            const batch = stampedRepoIds.splice(0, stampedRepoIds.length);
            updateRepositoriesMetadata(batch.map(stampRepo));
          }
        },
      });

      // stamp 剩余未刷新的
      if (stampedRepoIds.length > 0) {
        updateRepositoriesMetadata(stampedRepoIds.map(stampRepo));
      }

      setVectorIndexingState({ result, isIndexing: false, phase: null });
      // 只计算本次新增索引的 repo（之前无 vector_indexed_at），不包含重新索引的
      // 用可选链避免 vectorSearchStatus 为 undefined 时抛错（旧版本持久化状态或未测试连接）
      const newlyIndexedCount = result.indexedRepoIds.filter(id => newlyIndexedRepoIds.has(id)).length;
      const prevCount = useAppStore.getState().vectorSearchStatus?.vectorCount ?? 0;
      try {
        setVectorSearchStatus({
          connected: true,
          vectorCount: prevCount + newlyIndexedCount,
          dimensions: formDimensions,
          lastSyncAt: new Date().toISOString(),
        });
      } catch (statusErr) {
        // 状态更新失败不应回滚已成功的索引结果
        console.warn('Failed to update vector search status:', statusErr);
      }
      // 索引成功后更新格式版本号，避免下次增量索引重复触发全量重建
      setVectorSearchConfig({ embeddingFormatVersion: EMBEDDING_FORMAT_VERSION });
    } catch (err) {
      if (err instanceof Error && err.message === 'Aborted') {
        setVectorIndexingState({ isIndexing: false, phase: null, result: null });
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        const currentRepos = useAppStore.getState().repositories;
        // 与 indexAllRepos 增量谓词保持一致（含格式版本升级判定），避免计数漂移。
        const formatVersionChanged = currentEmbeddingFormatVersion < EMBEDDING_FORMAT_VERSION;
        const attemptedCount = currentRepos.filter((r) => {
          if (!r.analyzed_at || r.analysis_failed) return false;
          return needsReindex(r, formatVersionChanged);
        }).length;
        const skippedCount = currentRepos.length - attemptedCount;
        setVectorIndexingState({
          isIndexing: false,
          phase: null,
          result: { indexed: 0, skipped: skippedCount, errors: attemptedCount, error: msg },
        });
      }
    } finally {
      setAbortController(null);
    }
  }, [createClients, formIndexMode, formReadmeMaxChars, formDimensions, updateRepositoriesMetadata, setVectorSearchStatus, setVectorIndexingState, setVectorSearchConfig]);

  const handleAbortIndexing = useCallback(() => {
    abortController?.abort();
  }, [abortController]);

  const isConfigComplete = !!(
    activeConfig &&
    formBaseUrl &&
    formModel &&
    (formApiType === 'ollama' || formApiKey) &&
    formWorkerUrl &&
    formAuthToken
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-purple-500/10 dark:bg-purple-500/20 flex items-center justify-center">
          <Search className="w-5 h-5 text-purple-500" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground dark:text-foreground">
            {t('向量语义搜索', 'Vector Semantic Search')}
          </h2>
          <p className="text-sm text-muted-foreground dark:text-muted-foreground">
            {t(
              '基于 Cloudflare Vectorize 的语义搜索，能理解自然语言意图，找到语义相关而非仅关键词匹配的仓库。',
              'Semantic search powered by Cloudflare Vectorize. Understands natural language intent to find semantically related repositories.'
            )}
          </p>
        </div>
      </div>

      {/* Toggle */}
      <div className="flex items-center justify-between p-4 bg-accent/50 dark:bg-card/50 rounded-lg">
        <div>
          <div className="font-medium text-foreground dark:text-foreground">
            {t('启用向量搜索', 'Enable Vector Search')}
          </div>
          <div className="text-sm text-muted-foreground dark:text-muted-foreground">
            {t('启用后，AI 搜索将优先走向量检索，失败时自动回退', 'When enabled, AI search will use vector retrieval first, with automatic fallback on failure')}
          </div>
        </div>
        <Switch
          checked={vectorSearchConfig.enabled}
          onCheckedChange={(enabled) => setVectorSearchConfig({ enabled })}
          aria-label={t('启用向量搜索', 'Enable Vector Search')}
        />
      </div>

      {/* Section 1: Embedding Model Config */}
      <div className="border border-border rounded-lg p-4 space-y-4">
        <h3 className="font-medium text-foreground dark:text-foreground flex items-center gap-2">
          <span className="text-xs bg-accent dark:bg-muted px-2 py-0.5 rounded">①</span>
          {t('Embedding 模型配置', 'Embedding Model Configuration')}
        </h3>

        {/* API Type */}
        <div>
          <h4 id="embedding-model-source-label" className="mb-1.5 block text-sm font-medium text-muted-foreground dark:text-muted-foreground">
            {t('模型来源', 'Model Source')}
          </h4>
          <div role="group" aria-labelledby="embedding-model-source-label" className="flex flex-wrap gap-2">
            {EMBEDDING_API_TYPES.map((type) => (
              <Button
                key={type.value}
                onClick={() => {
                  const dimensions = DEFAULT_DIMENSIONS[type.value];
                  setFormApiType(type.value);
                  setFormDimensions(dimensions);
                  setFormDimensionsInput(String(dimensions));
                }}
                aria-pressed={formApiType === type.value}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  formApiType === type.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted dark:bg-card text-muted-foreground dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent'
                }`}
              >
                {t(type.label, type.labelEn)}
              </Button>
            ))}
          </div>
        </div>

        {/* Base URL */}
        <div>
          <label htmlFor="embedding-api-url" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground mb-1.5">
            {t('API 地址', 'API URL')}
          </label>
          <Input
            id="embedding-api-url"
            type="text"
            value={formBaseUrl}
            onChange={(e) => setFormBaseUrl(e.target.value)}
            placeholder={
              formApiType === 'openai'
                ? 'https://api.openai.com'
                : formApiType === 'siliconflow'
                ? 'https://api.siliconflow.cn'
                : formApiType === 'gemini'
                ? 'https://generativelanguage.googleapis.com'
                : formApiType === 'cohere'
                ? 'https://api.cohere.com'
                : formApiType === 'ollama'
                ? 'http://localhost:11434'
                : 'https://api.example.com/v1/embeddings'
            }
            className="w-full px-3 py-2 text-sm border border-input rounded-md bg-card dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent"
          />
        </div>

        {/* API Key */}
        <div>
          <label htmlFor="embedding-api-key" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground mb-1.5">
            API Key
          </label>
          <div className="relative">
            <Input
              id="embedding-api-key"
              type={showApiKey ? 'text' : 'password'}
              value={formApiKey}
              onChange={(e) => setFormApiKey(e.target.value)}
              placeholder={formApiType === 'ollama' ? t('可留空', 'Optional') : 'sk-xxx'}
              className="w-full px-3 py-2 pr-10 text-sm border border-input rounded-md bg-card dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent"
            />
            <Button
              type="button"
              variant="ghost"
              aria-label={showApiKey ? t('隐藏 API Key', 'Hide API key') : t('显示 API Key', 'Show API key')}
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-2 top-1/2 h-8 w-8 -translate-y-1/2 p-0 text-muted-foreground hover:text-muted-foreground dark:hover:text-muted-foreground"
            >
              {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </Button>
          </div>
          {formApiType === 'ollama' && (
            <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-1">
              {t('Ollama 本地模型可留空', 'Ollama local models can leave this empty')}
            </p>
          )}
        </div>

        {/* Model Name */}
        <div>
          <label htmlFor="embedding-model" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground mb-1.5">
            {t('模型名称', 'Model Name')}
          </label>
          <Input
            id="embedding-model"
            type="text"
            value={formModel}
            onChange={(e) => setFormModel(e.target.value)}
            placeholder={
              formApiType === 'openai'
                ? 'text-embedding-3-small'
                : formApiType === 'siliconflow'
                ? 'BAAI/bge-large-zh-v1.5'
                : formApiType === 'ollama'
                ? 'nomic-embed-text'
                : 'model-name'
            }
            className="w-full px-3 py-2 text-sm border border-input rounded-md bg-card dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent"
          />
        </div>

        {/* Dimensions */}
        <div>
          <label htmlFor="embedding-dimensions" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground mb-1.5">
            {t('向量维度', 'Vector Dimensions')}
          </label>
          <div className="flex gap-2">
            <Input
              id="embedding-dimensions"
              ref={dimensionsInputRef}
              type="number"
              value={formDimensionsInput}
              onChange={(e) => setFormDimensionsInput(e.target.value)}
              onBlur={() => {
                const parsed = Number(formDimensionsInput);
                const dimensions = Number.isInteger(parsed) && parsed > 0
                  ? parsed
                  : DEFAULT_DIMENSIONS[formApiType];
                setFormDimensions(dimensions);
                setFormDimensionsInput(String(dimensions));
              }}
              className="flex-1 px-3 py-2 text-sm border border-input rounded-md bg-card dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent"
            />
            <Button
              onClick={() => {
                const dim = DEFAULT_DIMENSIONS[formApiType];
                setFormDimensions(dim);
                setFormDimensionsInput(String(dim));
                // 临时高亮显示已设置的维度
                dimensionsInputRef.current?.focus();
                dimensionsInputRef.current?.select();
              }}
              className="px-3 py-2 text-sm bg-muted dark:bg-card text-muted-foreground dark:text-muted-foreground rounded-md hover:bg-accent dark:hover:bg-accent"
            >
              {t('自动检测', 'Auto Detect')}
            </Button>
          </div>
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
            ⚠ {t('必须与 Vectorize 索引维度一致', 'Must match Vectorize index dimensions')}
          </p>
        </div>

        {/* Test & Save */}
        <div className="flex gap-2">
          <Button
            onClick={handleTestEmbedding}
            disabled={testingEmbedding || !formBaseUrl || !formModel}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {testingEmbedding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {t('测试 Embedding 连接', 'Test Embedding Connection')}
          </Button>
          <Button
            onClick={handleSaveEmbeddingConfig}
            className={`px-4 py-2 text-sm rounded-md transition-colors ${
              embeddingSaved
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-accent dark:bg-muted text-muted-foreground dark:text-muted-foreground hover:bg-muted dark:hover:bg-accent'
            }`}
          >
            {embeddingSaved ? `✓ ${t('已保存', 'Saved')}` : t('保存配置', 'Save Config')}
          </Button>
        </div>

        {/* Test Result */}
        {embeddingTestResult && (
          <div
            className={`flex items-center gap-2 p-3 rounded-md text-sm ${
              embeddingTestResult.success
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
            }`}
          >
            {embeddingTestResult.success ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {embeddingTestResult.success
              ? `${t('连接成功', 'Connection successful')} — ${t('维度', 'Dimensions')}: ${embeddingTestResult.dimensions}`
              : `${t('连接失败', 'Connection failed')}: ${embeddingTestResult.error}`}
          </div>
        )}
      </div>

      {/* Section 2: Cloudflare Vectorize Connection */}
      <div className="border border-border rounded-lg p-4 space-y-4">
        <h3 className="font-medium text-foreground dark:text-foreground flex items-center gap-2">
          <span className="text-xs bg-accent dark:bg-muted px-2 py-0.5 rounded">②</span>
          {t('Cloudflare Vectorize 连接', 'Cloudflare Vectorize Connection')}
        </h3>

        {/* Worker URL */}
        <div>
          <label htmlFor="vectorize-worker-url" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground mb-1.5">
            {t('Worker 地址', 'Worker URL')}
          </label>
          <Input
            id="vectorize-worker-url"
            type="text"
            value={formWorkerUrl}
            onChange={(e) => setFormWorkerUrl(e.target.value)}
            placeholder="https://github-stars-vectorize.your-name.workers.dev"
            className="w-full px-3 py-2 text-sm border border-input rounded-md bg-card dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent"
          />
        </div>

        {/* Auth Token */}
        <div>
          <label htmlFor="vectorize-auth-token" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground mb-1.5">
            {t('认证 Token', 'Auth Token')}
          </label>
          <div className="relative">
            <Input
              id="vectorize-auth-token"
              type={showAuthToken ? 'text' : 'password'}
              value={formAuthToken}
              onChange={(e) => setFormAuthToken(e.target.value)}
              placeholder={t('Worker 认证令牌', 'Worker authentication token')}
              className="w-full px-3 py-2 pr-10 text-sm border border-input rounded-md bg-card dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent"
            />
            <Button
              type="button"
              variant="ghost"
              aria-label={showAuthToken ? t('隐藏认证 Token', 'Hide auth token') : t('显示认证 Token', 'Show auth token')}
              onClick={() => setShowAuthToken(!showAuthToken)}
              className="absolute right-2 top-1/2 h-8 w-8 -translate-y-1/2 p-0 text-muted-foreground hover:text-muted-foreground dark:hover:text-muted-foreground"
            >
              {showAuthToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {/* Test */}
        <div className="flex gap-2">
          <Button
            onClick={handleTestWorker}
            disabled={testingWorker || !formWorkerUrl}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {testingWorker ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {t('测试 Worker 连接', 'Test Worker Connection')}
          </Button>
        </div>

        {/* Test Result */}
        {workerTestResult && (
          <div
            className={`flex items-center gap-2 p-3 rounded-md text-sm ${
              workerTestResult.success
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
            }`}
          >
            {workerTestResult.success ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {workerTestResult.success
              ? `${t('连接成功', 'Connection successful')} — ${t('向量数', 'Vectors')}: ${workerTestResult.vectorCount}, ${t('维度', 'Dimensions')}: ${workerTestResult.dimensions}`
              : `${t('连接失败', 'Connection failed')}: ${workerTestResult.error}`}
          </div>
        )}
      </div>

      {/* Section 3: Status */}
      <div className="border border-border rounded-lg p-4 space-y-3">
        <h3 className="font-medium text-foreground dark:text-foreground flex items-center gap-2">
          <span className="text-xs bg-accent dark:bg-muted px-2 py-0.5 rounded">③</span>
          {t('状态', 'Status')}
        </h3>

        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            {vectorSearchStatus?.connected ? (
              <CheckCircle className="w-4 h-4 text-green-500" />
            ) : (
              <XCircle className="w-4 h-4 text-muted-foreground" />
            )}
            <span className="text-muted-foreground dark:text-muted-foreground">
              {vectorSearchStatus?.connected
                ? t('Worker 已连接', 'Worker connected')
                : t('Worker 未连接', 'Worker not connected')}
            </span>
          </div>

          {activeConfig && (
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span className="text-muted-foreground dark:text-muted-foreground">
                {t('Embedding 模型', 'Embedding model')}: {activeConfig.model}
              </span>
            </div>
          )}

          {vectorSearchStatus?.vectorCount !== undefined && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">📊</span>
              <span className="text-muted-foreground dark:text-muted-foreground">
                {t('索引向量数', 'Indexed vectors')}: {vectorSearchStatus.vectorCount.toLocaleString()}
              </span>
            </div>
          )}

          {vectorSearchStatus?.dimensions !== undefined && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">📐</span>
              <span className="text-muted-foreground dark:text-muted-foreground">
                {t('向量维度', 'Vector dimensions')}: {vectorSearchStatus.dimensions.toLocaleString()}
              </span>
            </div>
          )}

          {vectorSearchStatus?.lastSyncAt && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">🕐</span>
              <span className="text-muted-foreground dark:text-muted-foreground">
                {t('最后同步', 'Last sync')}: {new Date(vectorSearchStatus.lastSyncAt).toLocaleString()}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Section 4: Actions */}
      <div className="border border-border rounded-lg p-4 space-y-4">
        <h3 className="font-medium text-foreground dark:text-foreground flex items-center gap-2">
          <span className="text-xs bg-accent dark:bg-muted px-2 py-0.5 rounded">④</span>
          {t('索引管理', 'Index Management')}
        </h3>

        {/* 索引内容选择 */}
        <div className="space-y-2">
          <h4 id="embedding-index-content-label" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground">
            {t('索引内容', 'Index Content')}
          </h4>
          <div role="group" aria-labelledby="embedding-index-content-label" className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              onClick={() => setFormIndexMode('description')}
              aria-pressed={formIndexMode === 'description'}
              className={`h-auto flex-col items-start whitespace-normal p-3 text-left text-sm rounded-lg border transition-colors ${
                formIndexMode === 'description'
                  ? 'border-primary bg-primary/5 dark:bg-primary/10'
                  : 'border-border hover:border-input'
              }`}
            >
              <div className="font-medium text-foreground dark:text-foreground">
                {t('仓库描述', 'Description')}
              </div>
              <div className="text-xs text-muted-foreground dark:text-muted-foreground mt-1">
                {t('⚡ 速度快，精度较低', '⚡ Fast, lower precision')}
              </div>
            </Button>
            <Button
              variant="outline"
              onClick={() => setFormIndexMode('readme')}
              aria-pressed={formIndexMode === 'readme'}
              className={`h-auto flex-col items-start whitespace-normal p-3 text-left text-sm rounded-lg border transition-colors ${
                formIndexMode === 'readme'
                  ? 'border-primary bg-primary/5 dark:bg-primary/10'
                  : 'border-border hover:border-input'
              }`}
            >
              <div className="font-medium text-foreground dark:text-foreground">
                {t('README 内容', 'README Content')}
              </div>
              <div className="text-xs text-muted-foreground dark:text-muted-foreground mt-1">
                {t('🎯 精度高，速度较慢', '🎯 High precision, slower')}
              </div>
            </Button>
          </div>
        </div>

        {/* README 字符数设置 */}
        {formIndexMode === 'readme' && (
          <div className="space-y-1">
            <label htmlFor="readme-max-characters" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground">
              {t('README 截取字符数', 'README Max Characters')}
            </label>
            <Input
              id="readme-max-characters"
              type="number"
              value={formReadmeMaxCharsInput}
              onChange={(e) => setFormReadmeMaxCharsInput(e.target.value)}
              onBlur={() => {
                const raw = formReadmeMaxCharsInput.trim();
                const parsed = Number(raw);
                const maxChars = raw !== '' && Number.isInteger(parsed)
                  ? Math.min(20000, Math.max(500, parsed))
                  : 6000;
                setFormReadmeMaxChars(maxChars);
                setFormReadmeMaxCharsInput(String(maxChars));
              }}
              min={500}
              max={20000}
              step={1000}
              className="w-full px-3 py-2 text-sm border border-input rounded-md bg-card dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent"
            />
            <p className="text-xs text-muted-foreground dark:text-muted-foreground">
              {t('建议 4000-8000，越长精度越高但索引越慢', 'Recommended 4000-8000. Longer = higher precision but slower indexing')}
            </p>
          </div>
        )}

        {/* 保存索引配置 */}
        <Button
          onClick={handleSaveWorkerConfig}
          className={`px-4 py-2 text-sm rounded-lg transition-colors ${
            workerSaved
              ? 'bg-green-600 text-white hover:bg-green-700'
              : 'bg-accent dark:bg-muted text-muted-foreground dark:text-muted-foreground hover:bg-muted dark:hover:bg-accent'
          }`}
        >
          {workerSaved ? `✓ ${t('已保存', 'Saved')}` : t('保存索引配置', 'Save Index Config')}
        </Button>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={handleRebuildIndex}
            disabled={isIndexing || !isConfigComplete}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isIndexing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {t('重建向量索引', 'Rebuild Vector Index')}
          </Button>
          <Button
            onClick={handleIncrementalIndex}
            disabled={isIndexing || !isConfigComplete || incrementalTargetCount === 0}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-accent dark:bg-muted text-muted-foreground dark:text-muted-foreground rounded-lg hover:bg-muted dark:hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isIndexing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {t('增量索引', 'Incremental Index')}
            {incrementalTargetCount > 0 && (
              <span className="ml-1 px-2 py-0.5 text-xs bg-primary text-primary-foreground rounded-full">
                {incrementalTargetCount}
              </span>
            )}
          </Button>
          {isIndexing && (
            <Button
              onClick={handleAbortIndexing}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600"
            >
              <Square className="w-4 h-4" />
              {t('中止', 'Abort')}
            </Button>
          )}
        </div>

        {/* Progress */}
        {isIndexing && phaseTotal > 0 && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-muted-foreground dark:text-muted-foreground">
              <span>
                {phase === 'readme' && `📖 ${t('获取 README', 'Fetching README')}`}
                {phase === 'embedding' && `🧠 ${t('生成向量', 'Generating embeddings')}`}
                {phase === 'uploading' && `☁️ ${t('上传向量', 'Uploading vectors')}`}
                {!phase && `⏳ ${t('准备中', 'Preparing')}`}
              </span>
              <span>
                {phaseDone}/{phaseTotal} ({Math.round((phaseDone / phaseTotal) * 100)}%)
              </span>
            </div>
            <div className="w-full bg-accent dark:bg-muted rounded-full h-2">
              <div
                className="bg-primary h-2 rounded-full transition-all"
                style={{ width: `${(phaseDone / phaseTotal) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Result */}
        {indexResult && (
          <div className={`p-3 rounded-md text-sm ${
            indexResult.errors > 0 && indexResult.indexed === 0
              ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
              : 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
          }`}>
            {t('索引完成', 'Indexing complete')}: {indexResult.indexed} {t('已索引', 'indexed')}, {indexResult.skipped} {t('跳过', 'skipped')}, {indexResult.errors} {t('失败', 'errors')}
            {indexResult.error && (
              <div className="mt-1 text-xs opacity-80">{indexResult.error}</div>
            )}
          </div>
        )}
      </div>

      {/* Section 5: Search Parameters */}
      <div className="border border-border rounded-lg p-4 space-y-4">
        <h3 className="font-medium text-foreground dark:text-foreground flex items-center gap-2">
          <span className="text-xs bg-accent dark:bg-muted px-2 py-0.5 rounded">⑤</span>
          {t('搜索参数', 'Search Parameters')}
        </h3>

        {/* Similarity Threshold */}
        <div className="space-y-1">
          <div className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground">
            {t('相似度阈值', 'Similarity Threshold')}
          </div>
          <SliderInput
            value={formSearchThreshold}
            onChange={setFormSearchThreshold}
            min={0.1}
            max={0.8}
            step={0.05}
            label={t('相似度阈值', 'Similarity Threshold')}
            formatValue={(value) => value.toFixed(2)}
            showMarks={false}
          />
          <p className="text-xs text-muted-foreground dark:text-muted-foreground">
            {t('越高越严格，结果越少但更精确；越低越宽松，召回更多但可能有噪音', 'Higher = stricter, fewer but more precise results; Lower = more recall but may include noise')}
          </p>
        </div>

        {/* Top K */}
        <div className="space-y-1">
          <label htmlFor="search-topk" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground">
            {t('返回结果数 (Top K)', 'Results Count (Top K)')}
          </label>
          <Input
            id="search-topk"
            type="number"
            value={formSearchTopKInput}
            onChange={(e) => setFormSearchTopKInput(e.target.value)}
            onBlur={() => {
              const raw = formSearchTopKInput.trim();
              const parsed = Number(raw);
              const topK = raw !== '' && Number.isInteger(parsed)
                ? Math.min(50, Math.max(5, parsed))
                : 30;
              setFormSearchTopK(topK);
              setFormSearchTopKInput(String(topK));
            }}
            min={5}
            max={50}
            className="w-full px-3 py-2 text-sm border border-input rounded-md bg-card dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent"
          />
          <p className="text-xs text-muted-foreground dark:text-muted-foreground">
            {t('向量检索返回的最大结果数，越多召回越广但 LLM 重排序成本越高', 'Max results from vector search. More = wider recall but higher LLM reranking cost')}
          </p>
        </div>

        {/* HyDE Toggle */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-muted-foreground dark:text-muted-foreground">
              {t('HyDE 查询预处理', 'HyDE Query Preprocessing')}
            </div>
            <p className="text-xs text-muted-foreground dark:text-muted-foreground">
              {t('让 AI 生成理想仓库描述再搜索，提升短查询和中文查询的召回率', 'AI generates ideal repo description before searching, improves recall for short/Chinese queries')}
            </p>
          </div>
          <Switch
            checked={formEnableHyDE}
            onCheckedChange={setFormEnableHyDE}
            aria-label={t('HyDE 查询预处理', 'HyDE Query Preprocessing')}
          />
        </div>

        {/* Reranking Toggle */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-muted-foreground dark:text-muted-foreground">
              {t('LLM 语义重排序', 'LLM Semantic Reranking')}
            </div>
            <p className="text-xs text-muted-foreground dark:text-muted-foreground">
              {t('用 LLM 对向量搜索结果做语义排序，显著提升排序质量', 'LLM reranks vector results by semantic relevance, significantly improves ranking quality')}
            </p>
          </div>
          <Switch
            checked={formEnableReranking}
            onCheckedChange={setFormEnableReranking}
            aria-label={t('LLM 语义重排序', 'LLM Semantic Reranking')}
          />
        </div>

        {/* Save */}
        <Button
          onClick={handleSaveWorkerConfig}
          className={`px-4 py-2 text-sm rounded-lg transition-colors ${
            workerSaved
              ? 'bg-green-600 text-white hover:bg-green-700'
              : 'bg-accent dark:bg-muted text-muted-foreground dark:text-muted-foreground hover:bg-muted dark:hover:bg-accent'
          }`}
        >
          {workerSaved ? `✓ ${t('已保存', 'Saved')}` : t('保存搜索参数', 'Save Search Parameters')}
        </Button>
      </div>

      {/* Section 6: Delete Index */}
      <div className="border border-border rounded-lg p-4 space-y-3">
        <h3 className="font-medium text-foreground dark:text-foreground flex items-center gap-2">
          <span className="text-xs bg-accent dark:bg-muted px-2 py-0.5 rounded">⑥</span>
          {t('删除索引', 'Delete Index')}
        </h3>
        <p className="text-sm text-muted-foreground dark:text-muted-foreground">
          {t(
            '如果更换了 Embedding 模型（维度不同），需要删除旧索引后重新创建。',
            'If you changed the Embedding model (different dimensions), you need to delete the old index and recreate it.'
          )}
        </p>
        <div className="flex gap-2">
          <Button
            onClick={async () => {
              const cmd = 'npx wrangler vectorize delete github-stars';
              try {
                await navigator.clipboard.writeText(cmd);
              } catch (error) {
                console.warn('Failed to copy delete command:', error);
                toast(t('复制删除命令失败', 'Failed to copy delete command'), 'error');
              }
            }}
            className="px-4 py-2 text-sm bg-accent dark:bg-muted text-muted-foreground dark:text-muted-foreground rounded-md hover:bg-muted dark:hover:bg-accent"
          >
            {t('复制删除命令', 'Copy Delete Command')}
          </Button>
          <Button
            onClick={async () => {
              const cmd = `npx wrangler vectorize create github-stars --dimensions=${formDimensions} --metric=cosine`;
              try {
                await navigator.clipboard.writeText(cmd);
              } catch (error) {
                console.warn('Failed to copy create command:', error);
                toast(t('复制创建命令失败', 'Failed to copy create command'), 'error');
              }
            }}
            className="px-4 py-2 text-sm bg-accent dark:bg-muted text-muted-foreground dark:text-muted-foreground rounded-md hover:bg-muted dark:hover:bg-accent"
          >
            {t('复制创建命令', 'Copy Create Command')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground dark:text-muted-foreground">
          {t('在 cloudflare-worker 目录下执行以上命令，然后点击上方「重建向量索引」', 'Run these commands in the cloudflare-worker directory, then click "Rebuild Vector Index" above')}
        </p>
      </div>

      {/* Section 7: Deploy Guide */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between p-4">
          <h3 className="font-medium text-foreground dark:text-foreground flex items-center gap-2">
            <span className="text-xs bg-accent dark:bg-muted px-2 py-0.5 rounded">⑦</span>
            {t('部署指南', 'Deploy Guide')}
          </h3>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setShowDeployGuide(!showDeployGuide)}
            aria-expanded={showDeployGuide}
            aria-controls="vector-deploy-guide"
            aria-label={t('切换部署指南', 'Toggle deploy guide')}
            className="h-8 w-8 p-0"
          >
            {showDeployGuide ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          </Button>
        </div>

        <div id="vector-deploy-guide" hidden={!showDeployGuide} className="px-4 pb-4 text-sm text-muted-foreground dark:text-muted-foreground space-y-4">
            {/* 首次部署 */}
            <div className="p-3 bg-accent/50 dark:bg-card/50 rounded-md">
              <p className="font-medium text-foreground dark:text-foreground mb-2">
                {t('首次部署', 'Initial Deployment')}
              </p>
              <ol className="list-decimal list-inside space-y-1.5">
                <li>
                  <code className="bg-accent dark:bg-muted px-1.5 py-0.5 rounded text-xs">npm install -g wrangler</code>
                  {t(' 然后 ', ' then ')}
                  <code className="bg-accent dark:bg-muted px-1.5 py-0.5 rounded text-xs">wrangler login</code>
                </li>
                <li>
                  <code className="bg-accent dark:bg-muted px-1.5 py-0.5 rounded text-xs">
                    npx wrangler vectorize create github-stars --dimensions={formDimensions} --metric=cosine
                  </code>
                </li>
                <li>
                  <code className="bg-accent dark:bg-muted px-1.5 py-0.5 rounded text-xs">cd cloudflare-worker && npm install</code>
                </li>
                <li>
                  <code className="bg-accent dark:bg-muted px-1.5 py-0.5 rounded text-xs">wrangler secret put AUTH_TOKEN</code>
                </li>
                <li>
                  <code className="bg-accent dark:bg-muted px-1.5 py-0.5 rounded text-xs">npm run deploy</code>
                </li>
              </ol>
            </div>

            {/* 更新部署 */}
            <div className="p-3 bg-accent/50 dark:bg-card/50 rounded-md">
              <p className="font-medium text-foreground dark:text-foreground mb-2">
                {t('更新部署（代码变更后）', 'Redeploy (after code changes)')}
              </p>
              <ol className="list-decimal list-inside space-y-1.5">
                <li>
                  <code className="bg-accent dark:bg-muted px-1.5 py-0.5 rounded text-xs">cd cloudflare-worker</code>
                </li>
                <li>
                  <code className="bg-accent dark:bg-muted px-1.5 py-0.5 rounded text-xs">npm run deploy</code>
                  {t('（如果依赖有变更，先执行 ', ' (if dependencies changed, run ')}
                  <code className="bg-accent dark:bg-muted px-1.5 py-0.5 rounded text-xs">npm install</code>
                  {t('）', ')')}
                </li>
              </ol>
              <p className="mt-2 text-xs text-muted-foreground">
                {t('注意：更新部署不需要重新创建 Vectorize 索引，已有向量数据不受影响。', 'Note: Redeployment does not require recreating the Vectorize index. Existing vector data is preserved.')}
              </p>
            </div>

            {/* 模型变更警告 */}
            <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md">
              <p className="font-medium text-amber-800 dark:text-amber-200 mb-1">
                ⚠️ {t('更换 Embedding 模型后必须重建索引', 'Must rebuild index after changing Embedding model')}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {t(
                  '不同模型生成的向量维度不同，混用会导致查询失败。更换模型后需要：① 删除旧索引并创建新索引（维度需匹配） ② 点击下方「重建向量索引」',
                  'Different models produce vectors with different dimensions. After changing model: ① Delete old index and create new one (dimensions must match) ② Click "Rebuild Vector Index" below'
                )}
              </p>
            </div>

            <p className="text-xs text-muted-foreground dark:text-muted-foreground">
              {t('详细部署指南请参考', 'For detailed instructions, see')}{' '}
              <a
                href="https://github.com/AmintaCCCP/GithubStarsManager/blob/main/cloudflare-worker/README.md"
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-500 hover:underline"
              >
                cloudflare-worker/README.md
              </a>
            </p>
        </div>
      </div>
    </div>
  );
};
