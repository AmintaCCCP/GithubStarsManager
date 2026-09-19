
import { TranslateFn } from '../../i18n/useT';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Alert, AlertDescription } from '../ui/alert';
import { Switch } from '../ui/switch';
import { NumberInput } from '../ui/NumberInput';
import React, { useState } from 'react';
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
import type { EmbeddingApiType } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { SliderInput } from '../ui/SliderInput';
import { useDialog } from '../../hooks/useDialog';
import { useVectorSearchActions } from '../../features/settings/hooks/useVectorSearchActions';

interface VectorSearchSettingsProps {
  t: TranslateFn;
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
    embeddingConfigs, activeEmbeddingConfig, vectorSearchConfig, vectorSearchStatus,
    vectorIndexingState, addEmbeddingConfig, updateEmbeddingConfig,
    setActiveEmbeddingConfig, setVectorSearchConfig,
  } = useAppStore(useShallow((state) => ({
    embeddingConfigs: state.embeddingConfigs,
    activeEmbeddingConfig: state.activeEmbeddingConfig,
    vectorSearchConfig: state.vectorSearchConfig,
    vectorSearchStatus: state.vectorSearchStatus,
    vectorIndexingState: state.vectorIndexingState,
    addEmbeddingConfig: state.addEmbeddingConfig,
    updateEmbeddingConfig: state.updateEmbeddingConfig,
    setActiveEmbeddingConfig: state.setActiveEmbeddingConfig,
    setVectorSearchConfig: state.setVectorSearchConfig,
  })));
  const { toast } = useDialog();
  const {
    testingEmbedding, embeddingTestResult, testingWorker, workerTestResult,
    incrementalTargetCount, testEmbedding, testWorker, rebuildIndex,
    incrementalIndex, abortIndexing,
  } = useVectorSearchActions();

  const activeConfig = embeddingConfigs.find((config) => config.id === activeEmbeddingConfig);
  const [formApiType, setFormApiType] = useState<EmbeddingApiType>(activeConfig?.apiType || 'openai');
  const [formBaseUrl, setFormBaseUrl] = useState(activeConfig?.baseUrl || '');
  const [formApiKey, setFormApiKey] = useState(activeConfig?.apiKey || '');
  const [formModel, setFormModel] = useState(activeConfig?.model || '');
  const [formDimensions, setFormDimensions] = useState(activeConfig?.dimensions || 1536);
  const [formDimensionsInput, setFormDimensionsInput] = useState(String(activeConfig?.dimensions || 1536));
  const dimensionsInputRef = React.useRef<HTMLInputElement>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [formWorkerUrl, setFormWorkerUrl] = useState(vectorSearchConfig.workerUrl || '');
  const [formAuthToken, setFormAuthToken] = useState(vectorSearchConfig.authToken || '');
  const [showAuthToken, setShowAuthToken] = useState(false);
  const [formIndexMode, setFormIndexMode] = useState<'description' | 'readme'>(vectorSearchConfig.indexMode || 'readme');
  const [formReadmeMaxChars, setFormReadmeMaxChars] = useState(vectorSearchConfig.readmeMaxChars || 6000);
  const [formReadmeMaxCharsInput, setFormReadmeMaxCharsInput] = useState(String(vectorSearchConfig.readmeMaxChars || 6000));
  const [formSearchThreshold, setFormSearchThreshold] = useState(vectorSearchConfig.searchThreshold ?? 0.35);
  const [formSearchTopK, setFormSearchTopK] = useState(vectorSearchConfig.searchTopK ?? 30);
  const [formSearchTopKInput, setFormSearchTopKInput] = useState(String(vectorSearchConfig.searchTopK ?? 30));
  const [formEnableHyDE, setFormEnableHyDE] = useState(vectorSearchConfig.enableHyDE ?? true);
  const [formEnableReranking, setFormEnableReranking] = useState(vectorSearchConfig.enableReranking ?? true);
  const [embeddingSaved, setEmbeddingSaved] = useState(false);
  const [workerSaved, setWorkerSaved] = useState(false);
  const [showDeployGuide, setShowDeployGuide] = useState(false);

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
  React.useEffect(() => {
    setFormWorkerUrl(vectorSearchConfig.workerUrl);
    setFormAuthToken(vectorSearchConfig.authToken);
  }, [vectorSearchConfig.workerUrl, vectorSearchConfig.authToken]);

  const handleSaveEmbeddingConfig = () => {
    const configData = { name: `${formApiType} Embedding`, apiType: formApiType, baseUrl: formBaseUrl, apiKey: formApiKey, model: formModel, dimensions: formDimensions };
    if (activeConfig) updateEmbeddingConfig(activeConfig.id, configData);
    else {
      const id = `emb_${Date.now()}`;
      addEmbeddingConfig({ ...configData, id, isActive: true });
      setActiveEmbeddingConfig(id);
    }
    setEmbeddingSaved(true);
    setTimeout(() => setEmbeddingSaved(false), 2000);
  };
  const handleSaveWorkerConfig = () => {
    setVectorSearchConfig({
      workerUrl: formWorkerUrl, authToken: formAuthToken, embeddingConfigId: activeEmbeddingConfig || '',
      indexMode: formIndexMode, readmeMaxChars: formReadmeMaxChars, searchThreshold: formSearchThreshold,
      searchTopK: formSearchTopK, enableHyDE: formEnableHyDE, enableReranking: formEnableReranking,
    });
    setWorkerSaved(true);
    setTimeout(() => setWorkerSaved(false), 2000);
  };
  const draft = () => ({ apiType: formApiType, baseUrl: formBaseUrl, apiKey: formApiKey, model: formModel, dimensions: formDimensions, workerUrl: formWorkerUrl, authToken: formAuthToken, indexMode: formIndexMode, readmeMaxChars: formReadmeMaxChars });
  const handleTestEmbedding = () => testEmbedding(draft());
  const handleTestWorker = () => testWorker({ workerUrl: formWorkerUrl, authToken: formAuthToken });
  const handleRebuildIndex = () => rebuildIndex(draft());
  const handleIncrementalIndex = () => incrementalIndex(draft());
  const handleAbortIndexing = () => abortIndexing();
  const { isIndexing, phase, phaseDone, phaseTotal, result: indexResult } = vectorIndexingState;
  const isConfigComplete = !!(activeConfig && formBaseUrl && formModel && (formApiType === 'ollama' || formApiKey) && formWorkerUrl && formAuthToken);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted text-foreground">
          <Search className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground dark:text-foreground">
            {t('vectorSearchSettings.vector-semantic-search')}
          </h2>
          <p className="text-sm text-muted-foreground dark:text-muted-foreground">
            {t('vectorSearchSettings.semantic-search-powered-by-cloudflare-vectorize')}
          </p>
        </div>
      </div>

      {/* Toggle */}
      <div className="flex items-center justify-between p-4 bg-accent/50 dark:bg-card/50 rounded-lg">
        <div>
          <div className="font-medium text-foreground dark:text-foreground">
            {t('vectorSearchSettings.enable-vector-search')}
          </div>
          <div className="text-sm text-muted-foreground dark:text-muted-foreground">
            {t('vectorSearchSettings.when-enabled-ai-search-will-use-vector-retrieval')}
          </div>
        </div>
        <Switch
          checked={vectorSearchConfig.enabled}
          onCheckedChange={(enabled) => setVectorSearchConfig({ enabled })}
          aria-label={t('vectorSearchSettings.enable-vector-search')}
        />
      </div>

      {/* Section 1: Embedding Model Config */}
      <div className="border border-border rounded-lg p-4 space-y-4">
        <h3 className="font-medium text-foreground dark:text-foreground flex items-center gap-2">
          <span className="text-xs bg-accent dark:bg-muted px-2 py-0.5 rounded">①</span>
          {t('vectorSearchSettings.embedding-model-configuration')}
        </h3>

        {/* API Type */}
        <div>
          <h4 id="embedding-model-source-label" className="mb-1.5 block text-sm font-medium text-muted-foreground dark:text-muted-foreground">
            {t('vectorSearchSettings.model-source')}
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
                {t(`vectorSearchSettings.api-type-${type.value}`)}
              </Button>
            ))}
          </div>
        </div>

        {/* Base URL */}
        <div>
          <label htmlFor="embedding-api-url" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground mb-1.5">
            {t('vectorSearchSettings.api-url')}
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
              placeholder={formApiType === 'ollama' ? t('vectorSearchSettings.optional') : 'sk-xxx'}
              className="w-full px-3 py-2 pr-10 text-sm border border-input rounded-md bg-card dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent"
            />
            <Button
              type="button"
              variant="ghost"
              aria-label={showApiKey ? t('vectorSearchSettings.hide-api-key') : t('vectorSearchSettings.show-api-key')}
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-2 top-1/2 h-8 w-8 -translate-y-1/2 p-0 text-muted-foreground hover:text-muted-foreground dark:hover:text-muted-foreground"
            >
              {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </Button>
          </div>
          {formApiType === 'ollama' && (
            <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-1">
              {t('vectorSearchSettings.ollama-local-models-can-leave-this-empty')}
            </p>
          )}
        </div>

        {/* Model Name */}
        <div>
          <label htmlFor="embedding-model" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground mb-1.5">
            {t('vectorSearchSettings.model-name')}
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
            {t('vectorSearchSettings.vector-dimensions')}
          </label>
          <div className="flex gap-2">
            <NumberInput
              id="embedding-dimensions"
              ref={dimensionsInputRef}
              min={1}
              draftValue={formDimensionsInput}
              onDraftChange={setFormDimensionsInput}
              onDraftCommit={(parsed) => {
                const dimensions = parsed !== null && parsed > 0 ? parsed : DEFAULT_DIMENSIONS[formApiType];
                setFormDimensions(dimensions);
                setFormDimensionsInput(String(dimensions));
              }}
              className="flex-1 text-sm"
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
              {t('vectorSearchSettings.auto-detect')}
            </Button>
          </div>
          <p className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
            {t('vectorSearchSettings.must-match-vectorize-index-dimensions')}
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
            {t('vectorSearchSettings.test-embedding-connection')}
          </Button>
          <Button
            onClick={handleSaveEmbeddingConfig}
            variant={embeddingSaved ? 'default' : 'outline'}
            className="h-9 px-4 text-sm"
          >
            {embeddingSaved ? `✓ ${t('vectorSearchSettings.saved')}` : t('vectorSearchSettings.save-config')}
          </Button>
        </div>

        {/* Test Result */}
        {embeddingTestResult && (
          <Alert variant={embeddingTestResult.success ? 'default' : 'destructive'}>
            {embeddingTestResult.success ? <CheckCircle className="h-4 w-4" aria-hidden="true" /> : <XCircle className="h-4 w-4" aria-hidden="true" />}
            <AlertDescription>
              {embeddingTestResult.success
                ? t('vectorSearchSettings.connection-successful-dimensions', { dimensions: embeddingTestResult.dimensions })
                : t('vectorSearchSettings.connection-failed-detail', { error: embeddingTestResult.error }) }
            </AlertDescription>
          </Alert>
        )}
      </div>

      {/* Section 2: Cloudflare Vectorize Connection */}
      <div className="border border-border rounded-lg p-4 space-y-4">
        <h3 className="font-medium text-foreground dark:text-foreground flex items-center gap-2">
          <span className="text-xs bg-accent dark:bg-muted px-2 py-0.5 rounded">②</span>
          {t('vectorSearchSettings.cloudflare-vectorize-connection')}
        </h3>

        {/* Worker URL */}
        <div>
          <label htmlFor="vectorize-worker-url" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground mb-1.5">
            {t('vectorSearchSettings.worker-url')}
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
            {t('vectorSearchSettings.auth-token')}
          </label>
          <div className="relative">
            <Input
              id="vectorize-auth-token"
              type={showAuthToken ? 'text' : 'password'}
              value={formAuthToken}
              onChange={(e) => setFormAuthToken(e.target.value)}
              placeholder={t('vectorSearchSettings.worker-authentication-token')}
              className="w-full px-3 py-2 pr-10 text-sm border border-input rounded-md bg-card dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent"
            />
            <Button
              type="button"
              variant="ghost"
              aria-label={showAuthToken ? t('vectorSearchSettings.hide-auth-token') : t('vectorSearchSettings.show-auth-token')}
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
            {t('vectorSearchSettings.test-worker-connection')}
          </Button>
        </div>

        {/* Test Result */}
        {workerTestResult && (
          <Alert variant={workerTestResult.success ? 'default' : 'destructive'}>
            {workerTestResult.success ? <CheckCircle className="h-4 w-4" aria-hidden="true" /> : <XCircle className="h-4 w-4" aria-hidden="true" />}
            <AlertDescription>
              {workerTestResult.success
                ? t('vectorSearchSettings.connection-successful-vectors', { vectorCount: workerTestResult.vectorCount, dimensions: workerTestResult.dimensions })
                : t('vectorSearchSettings.connection-failed-detail', { error: workerTestResult.error }) }
            </AlertDescription>
          </Alert>
        )}
      </div>

      {/* Section 3: Status */}
      <div className="border border-border rounded-lg p-4 space-y-3">
        <h3 className="font-medium text-foreground dark:text-foreground flex items-center gap-2">
          <span className="text-xs bg-accent dark:bg-muted px-2 py-0.5 rounded">③</span>
          {t('vectorSearchSettings.status')}
        </h3>

        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            {vectorSearchStatus?.connected ? (
              <CheckCircle className="h-4 w-4 text-foreground" aria-hidden="true" />
            ) : (
              <XCircle className="w-4 h-4 text-muted-foreground" />
            )}
            <span className="text-muted-foreground dark:text-muted-foreground">
              {vectorSearchStatus?.connected
                ? t('vectorSearchSettings.worker-connected')
                : t('vectorSearchSettings.worker-not-connected')}
            </span>
          </div>

          {activeConfig && (
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-foreground" aria-hidden="true" />
              <span className="text-muted-foreground dark:text-muted-foreground">
                {t('vectorSearchSettings.embedding-model')}: {activeConfig.model}
              </span>
            </div>
          )}

          {vectorSearchStatus?.vectorCount !== undefined && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">📊</span>
              <span className="text-muted-foreground dark:text-muted-foreground">
                {t('vectorSearchSettings.indexed-vectors')}: {vectorSearchStatus.vectorCount.toLocaleString()}
              </span>
            </div>
          )}

          {vectorSearchStatus?.dimensions !== undefined && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">📐</span>
              <span className="text-muted-foreground dark:text-muted-foreground">
                {t('vectorSearchSettings.vector-dimensions-2')}: {vectorSearchStatus.dimensions.toLocaleString()}
              </span>
            </div>
          )}

          {vectorSearchStatus?.lastSyncAt && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">🕐</span>
              <span className="text-muted-foreground dark:text-muted-foreground">
                {t('vectorSearchSettings.last-sync')}: {new Date(vectorSearchStatus.lastSyncAt).toLocaleString()}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Section 4: Actions */}
      <div className="border border-border rounded-lg p-4 space-y-4">
        <h3 className="font-medium text-foreground dark:text-foreground flex items-center gap-2">
          <span className="text-xs bg-accent dark:bg-muted px-2 py-0.5 rounded">④</span>
          {t('vectorSearchSettings.index-management')}
        </h3>

        {/* 索引内容选择 */}
        <div className="space-y-2">
          <h4 id="embedding-index-content-label" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground">
            {t('vectorSearchSettings.index-content')}
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
              <span className="block font-medium text-foreground dark:text-foreground">
                {t('vectorSearchSettings.description')}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground dark:text-muted-foreground">
                {t('vectorSearchSettings.fast-lower-precision')}
              </span>
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
              <span className="block font-medium text-foreground dark:text-foreground">
                {t('vectorSearchSettings.readme-content')}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground dark:text-muted-foreground">
                {t('vectorSearchSettings.high-precision-slower')}
              </span>
            </Button>
          </div>
        </div>

        {/* README 字符数设置 */}
        {formIndexMode === 'readme' && (
          <div className="space-y-1">
            <label htmlFor="readme-max-characters" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground">
              {t('vectorSearchSettings.readme-max-characters')}
            </label>
            <NumberInput
              id="readme-max-characters"
              min={500}
              max={20000}
              step={1000}
              draftValue={formReadmeMaxCharsInput}
              onDraftChange={setFormReadmeMaxCharsInput}
              onDraftCommit={(parsed) => {
                const maxChars = parsed !== null ? parsed : 6000;
                setFormReadmeMaxChars(maxChars);
                setFormReadmeMaxCharsInput(String(maxChars));
              }}
              className="w-full text-sm"
            />
            <p className="text-xs text-muted-foreground dark:text-muted-foreground">
              {t('vectorSearchSettings.recommended-4000-8000-longer-higher-precision-bu')}
            </p>
          </div>
        )}

        {/* 保存索引配置 */}
        <Button
          onClick={handleSaveWorkerConfig}
          variant={workerSaved ? 'default' : 'outline'}
          className="h-9 px-4 text-sm"
        >
          {workerSaved ? `✓ ${t('vectorSearchSettings.saved')}` : t('vectorSearchSettings.save-index-config')}
        </Button>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={handleRebuildIndex}
            disabled={isIndexing || !isConfigComplete}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isIndexing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {t('vectorSearchSettings.rebuild-vector-index')}
          </Button>
          <Button
            onClick={handleIncrementalIndex}
            disabled={isIndexing || !isConfigComplete || incrementalTargetCount === 0}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm text-accent-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isIndexing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {t('vectorSearchSettings.incremental-index')}
            {incrementalTargetCount > 0 && (
              <Badge className="ml-1">{incrementalTargetCount}</Badge>
            )}
          </Button>
          {isIndexing && (
            <Button
              onClick={handleAbortIndexing}
              variant="destructive"
              className="h-9 gap-2 px-4 text-sm"
            >
              <Square className="w-4 h-4" />
              {t('vectorSearchSettings.abort')}
            </Button>
          )}
        </div>

        {/* Progress */}
        {isIndexing && phaseTotal > 0 && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-muted-foreground dark:text-muted-foreground">
              <span>
                {phase === 'readme' && `📖 ${t('vectorSearchSettings.fetching-readme')}`}
                {phase === 'embedding' && `🧠 ${t('vectorSearchSettings.generating-embeddings')}`}
                {phase === 'uploading' && `☁️ ${t('vectorSearchSettings.uploading-vectors')}`}
                {!phase && `⏳ ${t('vectorSearchSettings.preparing')}`}
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
          <Alert variant={indexResult.errors > 0 && indexResult.indexed === 0 ? 'destructive' : 'default'}>
            <AlertDescription>
              {t('vectorSearchSettings.indexing-complete')}: {indexResult.indexed} {t('vectorSearchSettings.indexed')}, {indexResult.skipped} {t('vectorSearchSettings.skipped')}, {indexResult.errors} {t('vectorSearchSettings.errors')}
              {indexResult.error && <div className="mt-1 text-xs">{indexResult.error}</div>}
            </AlertDescription>
          </Alert>
        )}
      </div>

      {/* Section 5: Search Parameters */}
      <div className="border border-border rounded-lg p-4 space-y-4">
        <h3 className="font-medium text-foreground dark:text-foreground flex items-center gap-2">
          <span className="text-xs bg-accent dark:bg-muted px-2 py-0.5 rounded">⑤</span>
          {t('vectorSearchSettings.search-parameters')}
        </h3>

        {/* Similarity Threshold */}
        <div className="space-y-1">
          <div className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground">
            {t('vectorSearchSettings.similarity-threshold')}
          </div>
          <SliderInput
            value={formSearchThreshold}
            onChange={setFormSearchThreshold}
            min={0.1}
            max={0.8}
            step={0.05}
            label={t('vectorSearchSettings.similarity-threshold')}
            formatValue={(value) => value.toFixed(2)}
            showMarks={false}
          />
          <p className="text-xs text-muted-foreground dark:text-muted-foreground">
            {t('vectorSearchSettings.higher-stricter-fewer-but-more-precise-results-l')}
          </p>
        </div>

        {/* Top K */}
        <div className="space-y-1">
          <label htmlFor="search-topk" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground">
            {t('vectorSearchSettings.results-count-top-k')}
          </label>
          <NumberInput
            id="search-topk"
            min={5}
            max={50}
            draftValue={formSearchTopKInput}
            onDraftChange={setFormSearchTopKInput}
            onDraftCommit={(parsed) => {
              const topK = parsed !== null ? parsed : 30;
              setFormSearchTopK(topK);
              setFormSearchTopKInput(String(topK));
            }}
            className="w-full text-sm"
          />
          <p className="text-xs text-muted-foreground dark:text-muted-foreground">
            {t('vectorSearchSettings.max-results-from-vector-search-more-wider-recall')}
          </p>
        </div>

        {/* HyDE Toggle */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-muted-foreground dark:text-muted-foreground">
              {t('vectorSearchSettings.hyde-query-preprocessing')}
            </div>
            <p className="text-xs text-muted-foreground dark:text-muted-foreground">
              {t('vectorSearchSettings.ai-generates-ideal-repo-description-before-searc')}
            </p>
          </div>
          <Switch
            checked={formEnableHyDE}
            onCheckedChange={setFormEnableHyDE}
            aria-label={t('vectorSearchSettings.hyde-query-preprocessing')}
          />
        </div>

        {/* Reranking Toggle */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-muted-foreground dark:text-muted-foreground">
              {t('vectorSearchSettings.llm-semantic-reranking')}
            </div>
            <p className="text-xs text-muted-foreground dark:text-muted-foreground">
              {t('vectorSearchSettings.llm-reranks-vector-results-by-semantic-relevance')}
            </p>
          </div>
          <Switch
            checked={formEnableReranking}
            onCheckedChange={setFormEnableReranking}
            aria-label={t('vectorSearchSettings.llm-semantic-reranking')}
          />
        </div>

        {/* Save */}
        <Button
          onClick={handleSaveWorkerConfig}
          variant={workerSaved ? 'default' : 'outline'}
          className="h-9 px-4 text-sm"
        >
          {workerSaved ? `✓ ${t('vectorSearchSettings.saved')}` : t('vectorSearchSettings.save-search-parameters')}
        </Button>
      </div>

      {/* Section 6: Delete Index */}
      <div className="border border-border rounded-lg p-4 space-y-3">
        <h3 className="font-medium text-foreground dark:text-foreground flex items-center gap-2">
          <span className="text-xs bg-accent dark:bg-muted px-2 py-0.5 rounded">⑥</span>
          {t('vectorSearchSettings.delete-index')}
        </h3>
        <p className="text-sm text-muted-foreground dark:text-muted-foreground">
          {t('vectorSearchSettings.if-you-changed-the-embedding-model-different-dim')}
        </p>
        <div className="flex gap-2">
          <Button
            onClick={async () => {
              const cmd = 'npx wrangler vectorize delete github-stars';
              try {
                await navigator.clipboard.writeText(cmd);
              } catch (error) {
                console.warn('Failed to copy delete command:', error);
                toast(t('vectorSearchSettings.failed-to-copy-delete-command'), 'error');
              }
            }}
            className="rounded-md bg-accent px-4 py-2 text-sm text-accent-foreground hover:bg-muted hover:text-foreground"
          >
            {t('vectorSearchSettings.copy-delete-command')}
          </Button>
          <Button
            onClick={async () => {
              const cmd = `npx wrangler vectorize create github-stars --dimensions=${formDimensions} --metric=cosine`;
              try {
                await navigator.clipboard.writeText(cmd);
              } catch (error) {
                console.warn('Failed to copy create command:', error);
                toast(t('vectorSearchSettings.failed-to-copy-create-command'), 'error');
              }
            }}
            className="rounded-md bg-accent px-4 py-2 text-sm text-accent-foreground hover:bg-muted hover:text-foreground"
          >
            {t('vectorSearchSettings.copy-create-command')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground dark:text-muted-foreground">
          {t('vectorSearchSettings.run-these-commands-in-the-cloudflare-worker-dire')}
        </p>
      </div>

      {/* Section 7: Deploy Guide */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between p-4">
          <h3 className="font-medium text-foreground dark:text-foreground flex items-center gap-2">
            <span className="text-xs bg-accent dark:bg-muted px-2 py-0.5 rounded">⑦</span>
            {t('vectorSearchSettings.deploy-guide')}
          </h3>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setShowDeployGuide(!showDeployGuide)}
            aria-expanded={showDeployGuide}
            aria-controls="vector-deploy-guide"
            aria-label={t('vectorSearchSettings.toggle-deploy-guide')}
            className="h-8 w-8 p-0"
          >
            {showDeployGuide ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          </Button>
        </div>

        <div id="vector-deploy-guide" hidden={!showDeployGuide} className="px-4 pb-4 text-sm text-muted-foreground dark:text-muted-foreground space-y-4">
            {/* 首次部署 */}
            <div className="p-3 bg-accent/50 dark:bg-card/50 rounded-md">
              <p className="font-medium text-foreground dark:text-foreground mb-2">
                {t('vectorSearchSettings.initial-deployment')}
              </p>
              <ol className="list-decimal list-inside space-y-1.5">
                <li>
                  <code className="bg-accent dark:bg-muted px-1.5 py-0.5 rounded text-xs">npm install -g wrangler</code>
                  {t('vectorSearchSettings.then')}
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
                {t('vectorSearchSettings.redeploy-after-code-changes')}
              </p>
              <ol className="list-decimal list-inside space-y-1.5">
                <li>
                  <code className="bg-accent dark:bg-muted px-1.5 py-0.5 rounded text-xs">cd cloudflare-worker</code>
                </li>
                <li>
                  <code className="bg-accent dark:bg-muted px-1.5 py-0.5 rounded text-xs">npm run deploy</code>
                  {t('vectorSearchSettings.if-dependencies-changed-run')}
                  <code className="bg-accent dark:bg-muted px-1.5 py-0.5 rounded text-xs">npm install</code>
                  {t('vectorSearchSettings.text')}
                </li>
              </ol>
              <p className="mt-2 text-xs text-muted-foreground">
                {t('vectorSearchSettings.note-redeployment-does-not-require-recreating-th')}
              </p>
            </div>

            {/* 模型变更警告 */}
            <div className="rounded-lg border border-border bg-muted/40 p-4 text-muted-foreground">
              <p className="font-medium text-foreground">
                {t('vectorSearchSettings.must-rebuild-index-after-changing-embedding-mode')}
              </p>
              <p className="mt-1 text-xs">
                {t('vectorSearchSettings.different-models-produce-vectors-with-different')}
              </p>
            </div>

            <p className="text-xs text-muted-foreground dark:text-muted-foreground">
              {t('vectorSearchSettings.for-detailed-instructions-see')}{' '}
              <a
                href="https://github.com/AmintaCCCP/GithubStarsManager/blob/main/cloudflare-worker/README.md"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline-offset-4 hover:underline"
              >
                cloudflare-worker/README.md
              </a>
            </p>
        </div>
      </div>
    </div>
  );
};
