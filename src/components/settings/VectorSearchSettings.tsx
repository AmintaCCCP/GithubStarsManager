
import { TranslateFn } from '../../i18n/useT';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Alert, AlertDescription } from '../ui/alert';
import { Switch } from '../ui/switch';
import { NumberInput } from '../ui/NumberInput';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
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
  Database,
  Clock,
  SlidersHorizontal,
} from 'lucide-react';
import {
  SettingsCard,
  SettingsDivider,
  SettingsNotice,
  SettingsPageStack,
  SettingsRow,
  SettingsSection,
} from './SettingsPrimitives';
import type { EmbeddingApiType } from '../../types';
import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  EMBEDDING_API_TYPES,
  embeddingApiTypeLabelKey,
} from '../../constants/embeddingApiTypes';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { SliderInput } from '../ui/SliderInput';
import { useDialog } from '../../hooks/useDialog';
import { useVectorSearchActions } from '../../features/settings/hooks/useVectorSearchActions';
import { findConflictingVectorProfile } from '../../services/profileStorage';

interface VectorSearchSettingsProps {
  t: TranslateFn;
}

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
  const [formDimensions, setFormDimensions] = useState(
    activeConfig?.dimensions || DEFAULT_EMBEDDING_DIMENSIONS.openai,
  );
  const [formDimensionsInput, setFormDimensionsInput] = useState(
    String(activeConfig?.dimensions || DEFAULT_EMBEDDING_DIMENSIONS.openai),
  );
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
    if (formWorkerUrl.trim()) {
      const conflict = findConflictingVectorProfile(formWorkerUrl);
      if (conflict) {
        toast(
          t('vectorSearchSettings.worker-url-conflict', {
            account: conflict.login || conflict.id,
          }),
          'error',
        );
        return;
      }
    }
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
  const hasWorkerUrlConflict = Boolean(formWorkerUrl.trim() && findConflictingVectorProfile(formWorkerUrl));
  const isConfigComplete = !!(activeConfig && formBaseUrl && formModel && (formApiType === 'ollama' || formApiKey) && formWorkerUrl && formAuthToken && !hasWorkerUrlConflict);

  return (
    <SettingsPageStack>
      <SettingsSection
        title={t('vectorSearchSettings.vector-semantic-search')}
        description={t('vectorSearchSettings.semantic-search-powered-by-cloudflare-vectorize')}
      >
        <SettingsCard>
          <SettingsRow
            icon={<Search />}
            title={t('vectorSearchSettings.enable-vector-search')}
            description={t('vectorSearchSettings.when-enabled-ai-search-will-use-vector-retrieval')}
          >
            <Switch
              checked={vectorSearchConfig.enabled}
              onCheckedChange={(enabled) => setVectorSearchConfig({ enabled })}
              aria-label={t('vectorSearchSettings.enable-vector-search')}
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('vectorSearchSettings.index-management')}>
        <SettingsCard>
          <div className="flex flex-wrap items-center gap-2 px-3.5 py-3">
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={handleRebuildIndex}
              disabled={isIndexing || !isConfigComplete}
            >
              {isIndexing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              <span>{t('vectorSearchSettings.rebuild-vector-index')}</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={handleIncrementalIndex}
              disabled={isIndexing || !isConfigComplete || incrementalTargetCount === 0}
            >
              {isIndexing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              <span>{t('vectorSearchSettings.incremental-index')}</span>
              {incrementalTargetCount > 0 && (
                <Badge variant="secondary" className="ml-0.5 tabular-nums">{incrementalTargetCount}</Badge>
              )}
            </Button>
            {isIndexing && (
              <Button
                type="button"
                variant="danger-solid"
                size="md"
                onClick={handleAbortIndexing}
              >
                <Square className="size-4" />
                <span>{t('vectorSearchSettings.abort')}</span>
              </Button>
            )}
          </div>

          {isIndexing && phaseTotal > 0 && (
            <>
              <SettingsDivider />
              <div className="space-y-2 px-3.5 py-3">
                <div className="flex justify-between text-label-sm text-secondary">
                  <span>
                    {phase === 'readme' && t('vectorSearchSettings.fetching-readme')}
                    {phase === 'embedding' && t('vectorSearchSettings.generating-embeddings')}
                    {phase === 'uploading' && t('vectorSearchSettings.uploading-vectors')}
                    {!phase && t('vectorSearchSettings.preparing')}
                  </span>
                  <span className="tabular-nums text-tertiary">
                    {phaseDone}/{phaseTotal} ({Math.round((phaseDone / phaseTotal) * 100)}%)
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-fill-hover">
                  <div
                    className="h-full w-full origin-left bg-accent-solid transition-transform duration-200"
                    style={{ transform: `scaleX(${phaseDone / phaseTotal})` }}
                  />
                </div>
              </div>
            </>
          )}
        </SettingsCard>

        {indexResult && (
          <Alert variant={indexResult.errors > 0 && indexResult.indexed === 0 ? 'destructive' : 'default'}>
            <AlertDescription>
              {t('vectorSearchSettings.indexing-complete')}: {indexResult.indexed} {t('vectorSearchSettings.indexed')}, {indexResult.skipped} {t('vectorSearchSettings.skipped')}, {indexResult.errors} {t('vectorSearchSettings.errors')}
              {indexResult.error && <div className="mt-1 text-label-sm">{indexResult.error}</div>}
            </AlertDescription>
          </Alert>
        )}
      </SettingsSection>

      <SettingsSection title={t('vectorSearchSettings.embedding-model-configuration')}>
        <SettingsCard className="space-y-4 p-3.5">
          <div>
            <h4 id="embedding-model-source-label" className="mb-2 block text-label font-medium text-foreground">
              {t('vectorSearchSettings.model-source')}
            </h4>
            <div role="group" aria-labelledby="embedding-model-source-label" className="flex flex-wrap gap-1.5">
              {EMBEDDING_API_TYPES.map((apiType) => {
                const isSelected = formApiType === apiType;
                return (
                  <Button
                    key={apiType}
                    type="button"
                    variant={isSelected ? 'primary' : 'outline'}
                    size="sm"
                    onClick={() => {
                      const dimensions = DEFAULT_EMBEDDING_DIMENSIONS[apiType];
                      setFormApiType(apiType);
                      setFormDimensions(dimensions);
                      setFormDimensionsInput(String(dimensions));
                    }}
                    aria-pressed={isSelected}
                  >
                    {t(embeddingApiTypeLabelKey(apiType))}
                  </Button>
                );
              })}
            </div>
          </div>

          <div>
            <label htmlFor="embedding-api-url" className="mb-1.5 block text-label font-medium text-foreground">
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
            />
          </div>

          <div>
            <label htmlFor="embedding-api-key" className="mb-1.5 block text-label font-medium text-foreground">
              {t('vectorSearchSettings.api-key')}
            </label>
            <div className="relative">
              <Input
                id="embedding-api-key"
                type={showApiKey ? 'text' : 'password'}
                value={formApiKey}
                onChange={(e) => setFormApiKey(e.target.value)}
                placeholder={formApiType === 'ollama' ? t('vectorSearchSettings.optional') : 'sk-xxx'}
                className="pr-9"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={showApiKey ? t('vectorSearchSettings.hide-api-key') : t('vectorSearchSettings.show-api-key')}
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-secondary"
              >
                {showApiKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </Button>
            </div>
            {formApiType === 'ollama' && (
              <p className="mt-1.5 text-label-sm text-secondary">
                {t('vectorSearchSettings.ollama-local-models-can-leave-this-empty')}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="embedding-model" className="mb-1.5 block text-label font-medium text-foreground">
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
            />
          </div>

          <div>
            <label htmlFor="embedding-dimensions" className="mb-1.5 block text-label font-medium text-foreground">
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
                  const dimensions = parsed !== null && parsed > 0 ? parsed : DEFAULT_EMBEDDING_DIMENSIONS[formApiType];
                  setFormDimensions(dimensions);
                  setFormDimensionsInput(String(dimensions));
                }}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => {
                  const dim = DEFAULT_EMBEDDING_DIMENSIONS[formApiType];
                  setFormDimensions(dim);
                  setFormDimensionsInput(String(dim));
                  dimensionsInputRef.current?.focus();
                  dimensionsInputRef.current?.select();
                }}
              >
                {t('vectorSearchSettings.auto-detect')}
              </Button>
            </div>
            <SettingsNotice tone="neutral" className="mt-2.5">
              {t('vectorSearchSettings.must-match-vectorize-index-dimensions')}
            </SettingsNotice>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={handleTestEmbedding}
              disabled={testingEmbedding || !formBaseUrl || !formModel}
            >
              {testingEmbedding ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
              <span>{t('vectorSearchSettings.test-embedding-connection')}</span>
            </Button>
            <Button
              type="button"
              onClick={handleSaveEmbeddingConfig}
              variant={embeddingSaved ? 'primary' : 'outline'}
              size="md"
            >
              {embeddingSaved ? `✓ ${t('vectorSearchSettings.saved')}` : t('vectorSearchSettings.save-config')}
            </Button>
          </div>

          {embeddingTestResult && (
            <Alert variant={embeddingTestResult.success ? 'default' : 'destructive'}>
              {embeddingTestResult.success ? <CheckCircle className="size-4" aria-hidden="true" /> : <XCircle className="size-4" aria-hidden="true" />}
              <AlertDescription>
                {embeddingTestResult.success
                  ? t('vectorSearchSettings.connection-successful-dimensions', { dimensions: embeddingTestResult.dimensions })
                  : t('vectorSearchSettings.connection-failed-detail', { error: embeddingTestResult.error })}
              </AlertDescription>
            </Alert>
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('vectorSearchSettings.cloudflare-vectorize-connection')}>
        <SettingsCard className="space-y-4 p-3.5">
          <div>
            <label htmlFor="vectorize-worker-url" className="mb-1.5 block text-label font-medium text-foreground">
              {t('vectorSearchSettings.worker-url')}
            </label>
            <Input
              id="vectorize-worker-url"
              type="text"
              value={formWorkerUrl}
              onChange={(e) => setFormWorkerUrl(e.target.value)}
              placeholder="https://github-stars-vectorize.your-name.workers.dev"
            />
          </div>

          <div>
            <label htmlFor="vectorize-auth-token" className="mb-1.5 block text-label font-medium text-foreground">
              {t('vectorSearchSettings.auth-token')}
            </label>
            <div className="relative">
              <Input
                id="vectorize-auth-token"
                type={showAuthToken ? 'text' : 'password'}
                value={formAuthToken}
                onChange={(e) => setFormAuthToken(e.target.value)}
                placeholder={t('vectorSearchSettings.worker-authentication-token')}
                className="pr-9"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={showAuthToken ? t('vectorSearchSettings.hide-auth-token') : t('vectorSearchSettings.show-auth-token')}
                onClick={() => setShowAuthToken(!showAuthToken)}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-secondary"
              >
                {showAuthToken ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </Button>
            </div>
          </div>

          <div>
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={handleTestWorker}
              disabled={testingWorker || !formWorkerUrl}
            >
              {testingWorker ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
              <span>{t('vectorSearchSettings.test-worker-connection')}</span>
            </Button>
          </div>

          {workerTestResult && (
            <Alert variant={workerTestResult.success ? 'default' : 'destructive'}>
              {workerTestResult.success ? <CheckCircle className="size-4" aria-hidden="true" /> : <XCircle className="size-4" aria-hidden="true" />}
              <AlertDescription>
                {workerTestResult.success
                  ? t('vectorSearchSettings.connection-successful-vectors', { vectorCount: workerTestResult.vectorCount, dimensions: workerTestResult.dimensions })
                  : t('vectorSearchSettings.connection-failed-detail', { error: workerTestResult.error })}
              </AlertDescription>
            </Alert>
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('vectorSearchSettings.status')}>
        <SettingsCard>
          <SettingsRow
            icon={vectorSearchStatus?.connected
              ? <CheckCircle className="text-status-green" />
              : <XCircle className="text-tertiary" />}
            title={vectorSearchStatus?.connected
              ? t('vectorSearchSettings.worker-connected')
              : t('vectorSearchSettings.worker-not-connected')}
          />
          {activeConfig && (
            <>
              <SettingsDivider />
              <SettingsRow
                icon={<CheckCircle className="text-status-green" />}
                title={t('vectorSearchSettings.embedding-model')}
              >
                <span className="font-mono text-mono-ui text-secondary">{activeConfig.model}</span>
              </SettingsRow>
            </>
          )}
          {vectorSearchStatus?.vectorCount !== undefined && (
            <>
              <SettingsDivider />
              <SettingsRow
                icon={<Database />}
                title={t('vectorSearchSettings.indexed-vectors')}
              >
                <span className="text-label font-medium text-foreground tabular-nums">
                  {vectorSearchStatus.vectorCount.toLocaleString()}
                </span>
              </SettingsRow>
            </>
          )}
          {vectorSearchStatus?.dimensions !== undefined && (
            <>
              <SettingsDivider />
              <SettingsRow
                icon={<SlidersHorizontal />}
                title={t('vectorSearchSettings.vector-dimensions-2')}
              >
                <span className="text-label font-medium text-foreground tabular-nums">
                  {vectorSearchStatus.dimensions.toLocaleString()}
                </span>
              </SettingsRow>
            </>
          )}
          {vectorSearchStatus?.lastSyncAt && (
            <>
              <SettingsDivider />
              <SettingsRow
                icon={<Clock />}
                title={t('vectorSearchSettings.last-sync')}
              >
                <span className="text-label-sm text-secondary tabular-nums">
                  {new Date(vectorSearchStatus.lastSyncAt).toLocaleString()}
                </span>
              </SettingsRow>
            </>
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('vectorSearchSettings.index-content')}>
        <SettingsCard className="space-y-4 p-3.5">
          <div className="space-y-2">
            <h4 id="embedding-index-content-label" className="block text-label font-medium text-foreground">
              {t('vectorSearchSettings.index-content')}
            </h4>
            <div role="group" aria-labelledby="embedding-index-content-label" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setFormIndexMode('description')}
                aria-pressed={formIndexMode === 'description'}
                className={`flex flex-col items-start rounded-md p-3 text-left transition-[background-color,box-shadow] duration-micro ease-out-subtle hover:duration-instant ${
                  formIndexMode === 'description'
                    ? 'bg-fill-selected shadow-elev-0 ring-1 ring-primary/40'
                    : 'bg-sunken/60 shadow-elev-0 hover:bg-fill-hover'
                }`}
              >
                <span className="block text-label font-medium text-foreground">
                  {t('vectorSearchSettings.description')}
                </span>
                <span className="mt-0.5 block text-label-sm text-secondary">
                  {t('vectorSearchSettings.fast-lower-precision')}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setFormIndexMode('readme')}
                aria-pressed={formIndexMode === 'readme'}
                className={`flex flex-col items-start rounded-md p-3 text-left transition-[background-color,box-shadow] duration-micro ease-out-subtle hover:duration-instant ${
                  formIndexMode === 'readme'
                    ? 'bg-fill-selected shadow-elev-0 ring-1 ring-primary/40'
                    : 'bg-sunken/60 shadow-elev-0 hover:bg-fill-hover'
                }`}
              >
                <span className="block text-label font-medium text-foreground">
                  {t('vectorSearchSettings.readme-content')}
                </span>
                <span className="mt-0.5 block text-label-sm text-secondary">
                  {t('vectorSearchSettings.high-precision-slower')}
                </span>
              </button>
            </div>
          </div>

          {formIndexMode === 'readme' && (
            <div className="space-y-1.5">
              <label htmlFor="readme-max-characters" className="block text-label font-medium text-foreground">
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
                className="w-full"
              />
              <p className="text-label-sm text-secondary">
                {t('vectorSearchSettings.recommended-4000-8000-longer-higher-precision-bu')}
              </p>
            </div>
          )}

          <div>
            <Button
              type="button"
              onClick={handleSaveWorkerConfig}
              variant={workerSaved ? 'primary' : 'outline'}
              size="md"
            >
              {workerSaved ? `✓ ${t('vectorSearchSettings.saved')}` : t('vectorSearchSettings.save-index-config')}
            </Button>
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('vectorSearchSettings.search-parameters')}>
        <SettingsCard>
          <div className="space-y-4 p-3.5">
            <div className="space-y-1.5">
              <div className="text-label font-medium text-foreground">
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
              <p className="text-label-sm text-secondary">
                {t('vectorSearchSettings.higher-stricter-fewer-but-more-precise-results-l')}
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="search-topk" className="block text-label font-medium text-foreground">
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
                className="w-full"
              />
              <p className="text-label-sm text-secondary">
                {t('vectorSearchSettings.max-results-from-vector-search-more-wider-recall')}
              </p>
            </div>
          </div>

          <SettingsDivider />
          <SettingsRow
            title={t('vectorSearchSettings.hyde-query-preprocessing')}
            description={t('vectorSearchSettings.ai-generates-ideal-repo-description-before-searc')}
          >
            <Switch
              checked={formEnableHyDE}
              onCheckedChange={setFormEnableHyDE}
              aria-label={t('vectorSearchSettings.hyde-query-preprocessing')}
            />
          </SettingsRow>
          <SettingsDivider />
          <SettingsRow
            title={t('vectorSearchSettings.llm-semantic-reranking')}
            description={t('vectorSearchSettings.llm-reranks-vector-results-by-semantic-relevance')}
          >
            <Switch
              checked={formEnableReranking}
              onCheckedChange={setFormEnableReranking}
              aria-label={t('vectorSearchSettings.llm-semantic-reranking')}
            />
          </SettingsRow>
          <SettingsDivider />
          <div className="px-3.5 py-3">
            <Button
              type="button"
              onClick={handleSaveWorkerConfig}
              variant={workerSaved ? 'primary' : 'outline'}
              size="md"
            >
              {workerSaved ? `✓ ${t('vectorSearchSettings.saved')}` : t('vectorSearchSettings.save-search-parameters')}
            </Button>
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t('vectorSearchSettings.delete-index')}
        description={t('vectorSearchSettings.if-you-changed-the-embedding-model-different-dim')}
      >
        <SettingsCard className="space-y-3 p-3.5">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={async () => {
                const cmd = 'npx wrangler vectorize delete github-stars';
                try {
                  await navigator.clipboard.writeText(cmd);
                } catch (error) {
                  console.warn('Failed to copy delete command:', error);
                  toast(t('vectorSearchSettings.failed-to-copy-delete-command'), 'error');
                }
              }}
            >
              {t('vectorSearchSettings.copy-delete-command')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={async () => {
                const cmd = `npx wrangler vectorize create github-stars --dimensions=${formDimensions} --metric=cosine`;
                try {
                  await navigator.clipboard.writeText(cmd);
                } catch (error) {
                  console.warn('Failed to copy create command:', error);
                  toast(t('vectorSearchSettings.failed-to-copy-create-command'), 'error');
                }
              }}
            >
              {t('vectorSearchSettings.copy-create-command')}
            </Button>
          </div>
          <p className="text-label-sm text-secondary">
            {t('vectorSearchSettings.run-these-commands-in-the-cloudflare-worker-dire')}
          </p>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('vectorSearchSettings.deploy-guide')}>
        <SettingsCard>
          <div className="flex items-center justify-between px-3.5 py-2.5">
            <span className="text-label font-medium text-foreground">
              {t('vectorSearchSettings.deploy-guide')}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowDeployGuide(!showDeployGuide)}
              aria-expanded={showDeployGuide}
              aria-controls="vector-deploy-guide"
              aria-label={t('vectorSearchSettings.toggle-deploy-guide')}
            >
              {showDeployGuide
                ? <ChevronDown className="size-4 text-secondary" />
                : <ChevronRight className="size-4 text-secondary" />}
            </Button>
          </div>

          <div id="vector-deploy-guide" hidden={!showDeployGuide} className="space-y-4 border-t border-subtle px-3.5 py-3.5 text-label-sm text-secondary">
            <Tabs defaultValue="one-click" className="w-full">
              <TabsList className="mb-3 grid w-full grid-cols-2">
                <TabsTrigger value="one-click">
                  {t('vectorSearchSettings.deploy-tab-one-click')}
                </TabsTrigger>
                <TabsTrigger value="manual">
                  {t('vectorSearchSettings.deploy-tab-manual')}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="one-click" className="space-y-3">
                <div className="space-y-3 rounded-md bg-sunken p-3.5 shadow-elev-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-label font-medium text-foreground">
                      {t('vectorSearchSettings.one-click-deployment-recommended')}
                    </span>
                    <Button
                      type="button"
                      onClick={async () => {
                        const cmd = 'npm run deploy:vector';
                        try {
                          await navigator.clipboard.writeText(cmd);
                          toast(t('vectorSearchSettings.copied'), 'info');
                        } catch (error) {
                          console.warn('Failed to copy deploy command:', error);
                        }
                      }}
                      size="sm"
                      variant="outline"
                    >
                      {t('vectorSearchSettings.copy-one-click-deploy-cmd')}
                    </Button>
                  </div>
                  <p className="leading-[18px] text-secondary">
                    {t('vectorSearchSettings.one-click-deploy-desc')}
                  </p>
                  <div className="select-all rounded-sm bg-paper px-3 py-2 font-mono text-mono-ui text-foreground shadow-elev-0">
                    npm run deploy:vector {/* i18n-allow-literal */}
                  </div>
                  <div className="space-y-1 border-t border-subtle pt-2.5 text-label-sm text-secondary">
                    <p className="font-medium text-foreground">{t('vectorSearchSettings.one-click-platforms-tip')}</p>
                    <p>• {t('vectorSearchSettings.platform-mac-linux')}</p>
                    <p>• {t('vectorSearchSettings.platform-windows')}</p>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="manual" className="space-y-3">
                <div className="rounded-md bg-sunken p-3.5 shadow-elev-0">
                  <p className="mb-2 text-label font-medium text-foreground">
                    {t('vectorSearchSettings.initial-deployment')}
                  </p>
                  <ol className="list-inside list-decimal space-y-1.5">
                    <li>
                      <code className="rounded-xs bg-fill-hover px-1.5 py-0.5 font-mono text-mono-ui text-foreground">npm install -g wrangler</code>
                      {t('vectorSearchSettings.then')}
                      <code className="rounded-xs bg-fill-hover px-1.5 py-0.5 font-mono text-mono-ui text-foreground">wrangler login</code>
                    </li>
                    <li>
                      <code className="rounded-xs bg-fill-hover px-1.5 py-0.5 font-mono text-mono-ui text-foreground">
                        {`npx wrangler vectorize create github-stars --dimensions=${formDimensions} --metric=cosine`} {/* i18n-allow-literal */}
                      </code>
                    </li>
                    <li>
                      <code className="rounded-xs bg-fill-hover px-1.5 py-0.5 font-mono text-mono-ui text-foreground">cd cloudflare-worker && npm install</code>
                    </li>
                    <li>
                      <code className="rounded-xs bg-fill-hover px-1.5 py-0.5 font-mono text-mono-ui text-foreground">wrangler secret put AUTH_TOKEN</code> {/* i18n-allow-literal */}
                    </li>
                    <li>
                      <code className="rounded-xs bg-fill-hover px-1.5 py-0.5 font-mono text-mono-ui text-foreground">npm run deploy</code> {/* i18n-allow-literal */}
                    </li>
                  </ol>
                </div>

                <div className="rounded-md bg-sunken p-3.5 shadow-elev-0">
                  <p className="mb-2 text-label font-medium text-foreground">
                    {t('vectorSearchSettings.redeploy-after-code-changes')}
                  </p>
                  <ol className="list-inside list-decimal space-y-1.5">
                    <li>
                      <code className="rounded-xs bg-fill-hover px-1.5 py-0.5 font-mono text-mono-ui text-foreground">cd cloudflare-worker</code>
                    </li>
                    <li>
                      <code className="rounded-xs bg-fill-hover px-1.5 py-0.5 font-mono text-mono-ui text-foreground">npm run deploy</code> {/* i18n-allow-literal */}
                      {t('vectorSearchSettings.if-dependencies-changed-run')}
                      <code className="rounded-xs bg-fill-hover px-1.5 py-0.5 font-mono text-mono-ui text-foreground">npm install</code>
                      {t('vectorSearchSettings.text')}
                    </li>
                  </ol>
                  <p className="mt-2 text-label-sm text-secondary">
                    {t('vectorSearchSettings.note-redeployment-does-not-require-recreating-th')}
                  </p>
                </div>
              </TabsContent>
            </Tabs>

            <SettingsNotice tone="warning">
              <p className="font-medium text-foreground">
                {t('vectorSearchSettings.must-rebuild-index-after-changing-embedding-mode')}
              </p>
              <p className="mt-0.5 text-secondary">
                {t('vectorSearchSettings.different-models-produce-vectors-with-different')}
              </p>
            </SettingsNotice>

            <p className="text-label-sm text-secondary">
              {t('vectorSearchSettings.for-detailed-instructions-see')}{' '}
              <a
                href="https://github.com/AmintaCCCP/GithubStarsManager/blob/main/cloudflare-worker/README.md"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-text underline-offset-4 hover:underline"
              >
                cloudflare-worker/README.md
              </a>
            </p>
          </div>
        </SettingsCard>
      </SettingsSection>
    </SettingsPageStack>
  );
};
