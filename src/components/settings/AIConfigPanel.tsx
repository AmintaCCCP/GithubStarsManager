
import { TranslateFn } from '../../i18n/useT';
import { Textarea } from '../ui/textarea';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Bot, Plus, Edit3, Trash2, Save, X, TestTube, RefreshCw, MessageSquare, Eye, EyeOff, AlertCircle, Languages } from 'lucide-react';
import { AIConfig, AIApiType, AIReasoningEffort, MiMoPlan, TranslationEngine } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { useAIConfigActions } from '../../features/settings/hooks/useAIConfigActions';
import { buildFinalApiUrl } from '../../utils/apiUrlBuilder';
import { SliderInput } from '../ui/SliderInput';
import { useDialog } from '../../hooks/useDialog';
import { isToolCallCapableApiType } from '../../constants/aiCapabilities';

interface AIConfigPanelProps {
  t: TranslateFn;
}

type AIFormState = {
  name: string;
  apiType: AIApiType;
  baseUrl: string;
  apiKey: string;
  model: string;
  customPrompt: string;
  useCustomPrompt: boolean;
  concurrency: number;
  reasoningEffort: '' | AIReasoningEffort;
  mimoPlan: MiMoPlan;
  supportsToolCalls: boolean;
};

/** 能力判定唯一来源为 aiService，避免 UI 勾选项与运行时判定漂移。 */
const isToolCallCapable = (apiType: AIApiType): boolean => isToolCallCapableApiType(apiType);

const MIMO_PLAN_ENDPOINTS: Record<MiMoPlan, string> = {
  api: 'https://api.xiaomimimo.com/v1',
  'token-plan': 'https://token-plan-cn.xiaomimimo.com/v1',
};

const DEFAULT_API_ENDPOINTS: Record<AIApiType, string> = {
  openai: 'https://api.openai.com/v1',
  'openai-responses': 'https://api.openai.com/v1',
  claude: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  deepseek: 'https://api.deepseek.com',
  mimo: MIMO_PLAN_ENDPOINTS.api,
  'openai-compatible': '',
};

function getEndpointPlaceholder(apiType: AIApiType, mimoPlan: MiMoPlan): string {
  switch (apiType) {
    case 'openai':
    case 'openai-responses':
      return 'https://api.openai.com/v1';
    case 'claude':
      return 'https://api.anthropic.com/v1';
    case 'deepseek':
      return 'https://api.deepseek.com';
    case 'mimo':
      return MIMO_PLAN_ENDPOINTS[mimoPlan];
    case 'openai-compatible':
      return 'https://integrate.api.nvidia.com/v1/chat/completions';
    default:
      return 'https://generativelanguage.googleapis.com/v1beta';
  }
}

function getEndpointHelpText(apiType: AIApiType, t: TranslateFn): string {
  switch (apiType) {
    case 'openai-compatible':
      return t('aIConfigPanel.enter-the-full-api-endpoint-url-including-the-co');
    case 'gemini':
      return t('aIConfigPanel.only-include-the-version-prefix-v1beta-the-path');
    case 'deepseek':
      return t('aIConfigPanel.only-include-the-domain-e-g-https-api-deepseek-c');
    case 'mimo':
      return t('aIConfigPanel.only-include-up-to-v1-e-g-https-api-xiaomimimo-c');
    default:
      return t('aIConfigPanel.only-include-the-version-prefix-e-g-v1-or-v1beta');
  }
}

export const AIConfigPanel: React.FC<AIConfigPanelProps> = ({ t }) => {
  const {
    aiConfigs,
    activeAIConfig,
    language,
    translationEngine,
    repositoryChatSettings,
    setTranslationEngine,
    setRepositoryChatSettings,
    addAIConfig,
    updateAIConfig,
    deleteAIConfig,
    setActiveAIConfig,
    setCurrentView,
  } = useAppStore(useShallow((state) => ({
    aiConfigs: state.aiConfigs,
    activeAIConfig: state.activeAIConfig,
    language: state.language,
    translationEngine: state.translationEngine,
    repositoryChatSettings: state.repositoryChatSettings,
    setTranslationEngine: state.setTranslationEngine,
    setRepositoryChatSettings: state.setRepositoryChatSettings,
    addAIConfig: state.addAIConfig,
    updateAIConfig: state.updateAIConfig,
    deleteAIConfig: state.deleteAIConfig,
    setActiveAIConfig: state.setActiveAIConfig,
    setCurrentView: state.setCurrentView,
  })));

  const { toast, confirm } = useDialog();
  const { testingId, testingForm, testConfig, testDraft } = useAIConfigActions({ t });

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCustomPrompt, setShowCustomPrompt] = useState(false);
  const [showDefaultPrompt, setShowDefaultPrompt] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const notificationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (notificationTimerRef.current) {
        clearTimeout(notificationTimerRef.current);
      }
    };
  }, []);

  const showNotification = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    if (notificationTimerRef.current) {
      clearTimeout(notificationTimerRef.current);
    }
    setNotification({ type, message });
    notificationTimerRef.current = setTimeout(() => setNotification(null), 3000);
  }, []);

  const [form, setForm] = useState<AIFormState>({
    name: '',
    apiType: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: '',
    customPrompt: '',
    useCustomPrompt: false,
    concurrency: 1,
    reasoningEffort: '',
    mimoPlan: 'api',
    supportsToolCalls: false,
  });

  // Auto-fill baseUrl when API type changes
  const prevApiTypeRef = useRef<AIApiType>('openai');
  useEffect(() => {
    if (form.apiType !== prevApiTypeRef.current) {
      const nextDefault = DEFAULT_API_ENDPOINTS[form.apiType];
      const prevDefault = DEFAULT_API_ENDPOINTS[prevApiTypeRef.current];
      if (nextDefault) {
        if (form.baseUrl === '' || form.baseUrl === prevDefault) {
          setForm(prev => ({ ...prev, baseUrl: nextDefault }));
        }
      } else if (form.baseUrl === prevDefault) {
        // Clear baseUrl when switching to a type with no default (e.g., openai-compatible)
        setForm(prev => ({ ...prev, baseUrl: '' }));
      }
      prevApiTypeRef.current = form.apiType;
    }
  }, [form.apiType, form.baseUrl]);

  // Auto-fill baseUrl when MiMo plan changes
  const prevMimoPlanRef = useRef<MiMoPlan>('api');
  useEffect(() => {
    if (form.apiType === 'mimo' && form.mimoPlan !== prevMimoPlanRef.current) {
      const prevEndpoint = MIMO_PLAN_ENDPOINTS[prevMimoPlanRef.current];
      if (form.baseUrl === '' || form.baseUrl === prevEndpoint) {
        setForm(prev => ({ ...prev, baseUrl: MIMO_PLAN_ENDPOINTS[form.mimoPlan] }));
      }
      prevMimoPlanRef.current = form.mimoPlan;
    }
  }, [form.apiType, form.baseUrl, form.mimoPlan]);

  const resetForm = () => {
    setForm({
      name: '',
      apiType: 'openai',
      baseUrl: DEFAULT_API_ENDPOINTS.openai,
      apiKey: '',
      model: '',
      customPrompt: '',
      useCustomPrompt: false,
      concurrency: 1,
      reasoningEffort: '',
      mimoPlan: 'api',
      supportsToolCalls: false,
    });
    setShowForm(false);
    setEditingId(null);
    setShowCustomPrompt(false);
    setShowDefaultPrompt(false);
    prevApiTypeRef.current = 'openai';
    prevMimoPlanRef.current = 'api';
  };

  const handleSave = () => {
    if (!form.name || !form.baseUrl || !form.apiKey || !form.model) {
      toast(t('aIConfigPanel.please-fill-in-all-required-fields'), 'error');
      return;
    }

    if (editingId) {
      const existingConfig = aiConfigs.find(c => c.id === editingId);
      if (existingConfig) {
        const updates: Partial<AIConfig> = {
          name: form.name,
          apiType: form.apiType,
          baseUrl: form.baseUrl.replace(/\/$/, ''),
          apiKey: form.apiKey,
          model: form.model,
          customPrompt: form.customPrompt || undefined,
          useCustomPrompt: form.useCustomPrompt,
          concurrency: form.concurrency,
          reasoningEffort: form.reasoningEffort || undefined,
          mimoPlan: form.apiType === 'mimo' ? form.mimoPlan : undefined,
          supportsToolCalls: form.supportsToolCalls && isToolCallCapable(form.apiType) ? true : undefined,
          isActive: existingConfig.isActive,
        };
        updateAIConfig(editingId, updates);
      }
    } else {
      const config: AIConfig = {
        id: Date.now().toString(),
        name: form.name,
        apiType: form.apiType,
        baseUrl: form.baseUrl.replace(/\/$/, ''),
        apiKey: form.apiKey,
        model: form.model,
        isActive: false,
        customPrompt: form.customPrompt || undefined,
        useCustomPrompt: form.useCustomPrompt,
        concurrency: form.concurrency,
        reasoningEffort: form.reasoningEffort || undefined,
        mimoPlan: form.apiType === 'mimo' ? form.mimoPlan : undefined,
        supportsToolCalls: form.supportsToolCalls && isToolCallCapable(form.apiType) ? true : undefined,
      };
      addAIConfig(config);
      if (!activeAIConfig) setActiveAIConfig(config.id);
      resetForm();
      if (sessionStorage.getItem('gsm:repository-chat-return')) {
        setCurrentView('repositories');
      }
      return;
    }

    resetForm();
  };

  const handleEdit = (config: AIConfig) => {
    // Sync ref to prevent auto-fill effect from overwriting loaded config
    prevApiTypeRef.current = config.apiType || 'openai';
    prevMimoPlanRef.current = config.mimoPlan || 'api';
    setForm({
      name: config.name,
      apiType: config.apiType || 'openai',
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      customPrompt: config.customPrompt || '',
      useCustomPrompt: config.useCustomPrompt || false,
      concurrency: config.concurrency || 1,
      reasoningEffort: config.reasoningEffort || '',
      mimoPlan: config.mimoPlan || 'api',
      supportsToolCalls: config.supportsToolCalls || false,
    });
    setEditingId(config.id);
    setShowForm(true);
    setShowCustomPrompt(config.useCustomPrompt || false);
  };

  const handleTest = (config: AIConfig) => testConfig(config);

  const handleTestForm = async () => {
    if (!form.baseUrl || !form.apiKey || !form.model) {
      toast(t('aIConfigPanel.please-fill-in-api-endpoint-api-key-and-model-na'), 'error');
      return;
    }
    await testDraft({
      id: '' as string,
      name: form.name || 'Test',
      apiType: form.apiType,
      baseUrl: form.baseUrl.replace(/\/$/, ''),
      apiKey: form.apiKey,
      model: form.model,
      isActive: false,
      customPrompt: form.customPrompt || undefined,
      useCustomPrompt: form.useCustomPrompt,
      concurrency: form.concurrency,
      reasoningEffort: form.reasoningEffort || undefined,
    });
  };

  const defaultPrompt = useMemo(() => {
    if (language === 'zh') {
      return `请分析以下GitHub仓库信息，并只输出合法JSON对象。不要输出思考过程、Markdown、代码块标记、解释或任何额外文本。

要求：
- summary：中文概述，说明仓库的主要功能和用途，不超过50字。
  禁止出现“我们被要求”“只输出JSON”“根据仓库信息”“summary/tags/platforms”等提示词复述。
- tags：3-5个中文应用类型标签，请优先从提供的分类中选择。
{CATEGORIES_INFO}
- platforms：只能从 ["mac","windows","linux","ios","android","docker","web","cli"] 中选择；无法判断则为 []。

输出格式：
{
  "summary": "中文概述",
  "tags": ["标签1", "标签2", "标签3"],
  "platforms": ["web", "cli"]
}

平台线索：
Dockerfile/docker-compose=docker；CLI/命令行/终端=cli；浏览器/前端/API=web；iOS/Swift/Xcode=ios；Android/Kotlin/Gradle=android；macOS/Homebrew=mac；Windows/.exe/MSI=windows；Linux/systemd/apt=linux。

仓库信息：
{REPO_INFO}`;
    } else if (language === 'en') {
      return `Please analyze the following GitHub repository information and only output a valid JSON object. Do not output thinking process, Markdown, code block markers, explanations, or any extra text.

Requirements:
- summary: A concise English overview explaining the main functionality and purpose, no more than 50 words.
  Do not include prompt restatements such as "asked to", "only output JSON", "based on repository information", or "summary/tags/platforms".
- tags: 3-5 English application type tags, please prioritize from the provided categories.
{CATEGORIES_INFO}
- platforms: Must only choose from ["mac","windows","linux","ios","android","docker","web","cli"]; use [] if unable to determine.

Output format:
{
  "summary": "English overview",
  "tags": ["tag1", "tag2", "tag3"],
  "platforms": ["web", "cli"]
}

Platform hints:
Dockerfile/docker-compose=docker; CLI/command-line/terminal=cli; browser/frontend/API=web; iOS/Swift/Xcode=ios; Android/Kotlin/Gradle=android; macOS/Homebrew=mac; Windows/.exe/MSI=windows; Linux/systemd/apt=linux.

Repository information:
{REPO_INFO}`;
    }

    return `Please analyze the following GitHub repository information and only output a valid JSON object. Do not output thinking process, Markdown, code block markers, explanations, or any extra text.

Requirements:
- summary: A concise overview explaining the main functionality and purpose, no more than 50 words.
  Do not include prompt restatements such as "asked to", "only output JSON", "based on repository information", or "summary/tags/platforms".
- tags: 3-5 application type tags, please prioritize from the provided categories.
{CATEGORIES_INFO}
- platforms: Must only choose from ["mac","windows","linux","ios","android","docker","web","cli"]; use [] if unable to determine.

Output format:
{
  "summary": "overview",
  "tags": ["tag1", "tag2", "tag3"],
  "platforms": ["web", "cli"]
}

Platform hints:
Dockerfile/docker-compose=docker; CLI/command-line/terminal=cli; browser/frontend/API=web; iOS/Swift/Xcode=ios; Android/Kotlin/Gradle=android; macOS/Homebrew=mac; Windows/.exe/MSI=windows; Linux/systemd/apt=linux.

Repository information:
{REPO_INFO}`;
  }, [language]);

  const isCustomPromptModified = useMemo(() => {
    return form.customPrompt.trim() !== '' && form.customPrompt !== defaultPrompt;
  }, [form.customPrompt, defaultPrompt]);

  const isCustomPromptSameAsDefault = useMemo(() => {
    return form.customPrompt === defaultPrompt;
  }, [form.customPrompt, defaultPrompt]);

  const handleUseCustomPromptChange = useCallback((checked: boolean) => {
    setForm(prev => {
      const newCustomPrompt = checked && prev.customPrompt.trim() === '' 
        ? defaultPrompt 
        : prev.customPrompt;
      return { 
        ...prev, 
        useCustomPrompt: checked,
        customPrompt: newCustomPrompt
      };
    });
    
    if (checked) {
      setShowCustomPrompt(true);
      setShowDefaultPrompt(false);
      if (form.customPrompt.trim() === '') {
        showNotification('info', t('aIConfigPanel.default-prompt-auto-filled-you-can-modify-it'));
      }
    } else {
      setShowCustomPrompt(false);
    }
  }, [defaultPrompt, form.customPrompt, showNotification, t]);

  const handleToggleDefaultPrompt = useCallback(() => {
    if (showCustomPrompt) {
      showNotification('info', t('aIConfigPanel.please-close-the-custom-prompt-editor-first'));
      return;
    }
    setShowDefaultPrompt(prev => !prev);
  }, [showCustomPrompt, showNotification, t]);

  const handleRestoreDefaultPrompt = useCallback(async () => {
    if (isCustomPromptSameAsDefault) {
      showNotification('info', t('aIConfigPanel.current-prompt-is-already-the-default'));
      return;
    }

    if (isCustomPromptModified) {
      const confirmed = await confirm(
        t('aIConfigPanel.restore-default-prompt'),
        t('aIConfigPanel.this-will-overwrite-your-current-changes'),
        { type: 'warning' }
      );
      if (!confirmed) return;
    }

    setForm(prev => ({ ...prev, customPrompt: defaultPrompt }));
    showNotification('success', t('aIConfigPanel.default-prompt-restored'));
  }, [defaultPrompt, isCustomPromptModified, isCustomPromptSameAsDefault, showNotification, t, confirm]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Bot className="w-6 h-6 text-muted-foreground dark:text-muted-foreground " />
          <h3 className="text-lg font-semibold text-foreground dark:text-foreground">
            {t('aIConfigPanel.ai-service-configuration')}
          </h3>
        </div>
        <Button
          onClick={() => setShowForm(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-primary text-primary-foreground dark:bg-primary dark:text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>{t('aIConfigPanel.add-ai-config')}</span>
        </Button>
      </div>

      {showForm && (
        <div className="p-4 bg-background dark:bg-muted/40 rounded-lg border border-border dark:border-border">
          <h4 className="font-medium text-foreground dark:text-foreground mb-4">
            {editingId ? t('aIConfigPanel.edit-ai-configuration') : t('aIConfigPanel.add-ai-configuration')}
          </h4>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label htmlFor="ai-config-name" className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1">
                {t('aIConfigPanel.configuration-name')} *
              </label>
              <Input
                id="ai-config-name"
                type="text"
                value={form.name}
                onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 border border-border dark:border-border rounded-lg bg-card dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent focus:outline-none"
                placeholder={t('aIConfigPanel.e-g-openai-gpt-4')}
              />
            </div>

            <div>
              <label id="ai-api-type-label" className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1">
                {t('aIConfigPanel.api-format')} *
              </label>
              <Select value={form.apiType} onValueChange={(value) => setForm(prev => ({ ...prev, apiType: value as AIApiType }))}>
                <SelectTrigger aria-labelledby="ai-api-type-label" className="h-10 w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="openai">OpenAI (Chat Completions)</SelectItem><SelectItem value="openai-responses">OpenAI (Responses)</SelectItem><SelectItem value="claude">Claude</SelectItem><SelectItem value="gemini">Gemini</SelectItem><SelectItem value="deepseek">DeepSeek</SelectItem><SelectItem value="mimo">Xiaomi MiMo</SelectItem><SelectItem value="openai-compatible">OpenAI Compatible (Custom Endpoint)</SelectItem></SelectContent>
              </Select>
            </div>

            {form.apiType === 'mimo' && (
              <div>
                <label id="ai-mimo-plan-label" className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1">
                  {t('aIConfigPanel.mimo-channel')} *
                </label>
                <Select value={form.mimoPlan} onValueChange={(value) => setForm(prev => ({ ...prev, mimoPlan: value as MiMoPlan }))}>
                  <SelectTrigger aria-labelledby="ai-mimo-plan-label" className="h-10 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="api">{t('aIConfigPanel.api-pay-as-you-go')}</SelectItem><SelectItem value="token-plan">{t('aIConfigPanel.token-plan-subscription')}</SelectItem></SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-1">
                  {form.mimoPlan === 'api'
                    ? t('aIConfigPanel.api-key-starts-with-sk-endpoint-api-xiaomimimo-c')
                    : t('aIConfigPanel.api-key-starts-with-tp-endpoint-token-plan-cn-xi')}
                </p>
              </div>
            )}
            
            <div>
              <label htmlFor="ai-base-url" className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1">
                {t('aIConfigPanel.api-endpoint')} *
              </label>
              <Input
                id="ai-base-url"
                type="url"
                value={form.baseUrl}
                onChange={(e) => setForm(prev => ({ ...prev, baseUrl: e.target.value }))}
                className="w-full px-3 py-2 border border-border dark:border-border rounded-lg bg-card dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent focus:outline-none"
                placeholder={getEndpointPlaceholder(form.apiType, form.mimoPlan)}
              />
              <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-1">
                {getEndpointHelpText(form.apiType, t)}
              </p>
              {form.baseUrl && (
                <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-1">
                  {t('aIConfigPanel.final-request-url')}
                  <span className="font-mono break-all">
                    {buildFinalApiUrl(form.baseUrl, form.apiType)}
                  </span>
                </p>
              )}
            </div>
            
            <div>
              <label htmlFor="ai-api-key" className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1">
                {t('aIConfigPanel.api-key')} *
              </label>
              <Input
                id="ai-api-key"
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm(prev => ({ ...prev, apiKey: e.target.value }))}
                className="w-full px-3 py-2 border border-border dark:border-border rounded-lg bg-card dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent focus:outline-none"
                placeholder={t('aIConfigPanel.enter-api-key')}
              />
            </div>
            
            <div>
              <label htmlFor="ai-model-name" className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1">
                {t('aIConfigPanel.model-name')} *
              </label>
              <Input
                id="ai-model-name"
                type="text"
                value={form.model}
                onChange={(e) => setForm(prev => ({ ...prev, model: e.target.value }))}
                className="w-full px-3 py-2 border border-border dark:border-border rounded-lg bg-card dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent focus:outline-none"
                placeholder="gpt-4"
              />
            </div>
            
            <div>
              <label id="ai-concurrency-label" className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1">
                {t('aIConfigPanel.concurrency')}
              </label>
              <SliderInput
                value={form.concurrency}
                label={t('aIConfigPanel.concurrency')}
                onChange={(v) => setForm(prev => ({ ...prev, concurrency: v }))}
                min={1}
                max={10}
                showMarks={false}
              />
              <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-1">
                {t('aIConfigPanel.number-of-repositories-to-analyze-simultaneously')}
              </p>
            </div>

            <div>
              <label id="ai-reasoning-effort-label" className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1">
                {t('aIConfigPanel.reasoning-effort')}
              </label>
              <Select value={form.reasoningEffort || 'default'} onValueChange={(value) => setForm(prev => ({ ...prev, reasoningEffort: value === 'default' ? '' : value as AIReasoningEffort }))}>
                <SelectTrigger aria-labelledby="ai-reasoning-effort-label" className="h-10 w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="default">{t('aIConfigPanel.default-do-not-send')}</SelectItem><SelectItem value="none">{t('aIConfigPanel.none-no-reasoning')}</SelectItem><SelectItem value="low">{t('aIConfigPanel.low-quick-response')}</SelectItem><SelectItem value="medium">{t('aIConfigPanel.medium-balanced')}</SelectItem><SelectItem value="high">{t('aIConfigPanel.high-deep-reasoning')}</SelectItem><SelectItem value="xhigh">{t('aIConfigPanel.xhigh-deepest-reasoning')}</SelectItem></SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-1">
                {t('aIConfigPanel.only-applies-to-openai-compatible-apis-leave-emp')}
              </p>
            </div>

            {isToolCallCapable(form.apiType) && (
              <div>
                <label className="flex items-start gap-2 text-sm text-foreground">
                  <Checkbox checked={form.supportsToolCalls} onCheckedChange={(checked) => setForm(prev => ({ ...prev, supportsToolCalls: checked === true }))} />
                  <span>
                    {t('aIConfigPanel.supports-tool-calling-function-calling')}
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {t('aIConfigPanel.lets-repository-chat-use-the-experimental-tool-l')}
                    </span>
                  </span>
                </label>
              </div>
            )}
          </div>

          <div className="mb-4">
            {notification && (
              <div
                role={notification.type === 'error' ? 'alert' : 'status'}
                className={`mb-3 flex items-center space-x-2 rounded-lg p-3 ${
                  notification.type === 'success'
                    ? 'bg-status-green/10 text-status-green dark:bg-status-green/10'
                    : notification.type === 'error'
                      ? 'bg-destructive/10 text-destructive dark:bg-destructive/10'
                      : 'bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground'
                }`}
              >
                {notification.type === 'error' && <AlertCircle className="h-4 w-4" />}
                <span className="text-sm">{notification.message}</span>
              </div>
            )}

            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="ai-use-custom-prompt"
                    aria-labelledby="ai-use-custom-prompt-label"
                    checked={form.useCustomPrompt}
                    onCheckedChange={(checked) => handleUseCustomPromptChange(checked === true)}
                  />
                  <span
                    id="ai-use-custom-prompt-label"
                    className="cursor-pointer text-left text-sm font-medium text-foreground dark:text-muted-foreground"
                    onClick={() => handleUseCustomPromptChange(!form.useCustomPrompt)}
                  >
                    {t('aIConfigPanel.use-custom-prompt')}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleToggleDefaultPrompt}
                  disabled={showCustomPrompt}
                  className={`flex items-center space-x-1 text-sm ${
                    showCustomPrompt
                      ? 'text-muted-foreground cursor-not-allowed'
                      : 'text-muted-foreground hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground'
                  }`}
                >
                  {showDefaultPrompt ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  <span>{showDefaultPrompt ? t('aIConfigPanel.hide-default-prompt') : t('aIConfigPanel.view-default-prompt')}</span>
                </Button>
              </div>
              {form.useCustomPrompt && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleRestoreDefaultPrompt}
                  className="text-sm text-muted-foreground hover:text-muted-foreground dark:text-muted-foreground dark:hover:text-muted-foreground"
                >
                  {t('aIConfigPanel.restore-default-prompt-2')}
                </Button>
              )}
            </div>
            
            {showDefaultPrompt && !showCustomPrompt && (
              <div className="mb-3">
                <label className="block text-xs font-medium text-muted-foreground dark:text-muted-foreground mb-1">
                  {t('aIConfigPanel.default-prompt-read-only')}
                </label>
                <pre className="w-full px-3 py-2 border border-border dark:border-border rounded-lg bg-background dark:bg-card text-foreground dark:text-muted-foreground font-mono text-xs whitespace-pre-wrap overflow-auto max-h-64">
                  {defaultPrompt}
                </pre>
              </div>
            )}
            
            {showCustomPrompt && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="ai-custom-prompt" className="block text-xs font-medium text-muted-foreground dark:text-muted-foreground">
                    {t('aIConfigPanel.custom-prompt')}
                    {isCustomPromptModified && (
                      <span className="ml-2 text-muted-foreground dark:text-muted-foreground ">
                        ({t('aIConfigPanel.modified')})
                      </span>
                    )}
                    {isCustomPromptSameAsDefault && (
                      <span className="ml-2 text-muted-foreground dark:text-muted-foreground">
                        ({t('aIConfigPanel.default')})
                      </span>
                    )}
                  </label>
                  <span className="text-xs text-muted-foreground dark:text-muted-foreground/70">
                    {form.customPrompt.length} {t('aIConfigPanel.characters')}
                  </span>
                </div>
                <Textarea
                  id="ai-custom-prompt"
                  value={form.customPrompt}
                  onChange={(e) => setForm(prev => ({ ...prev, customPrompt: e.target.value }))}
                  rows={10}
                  className="w-full px-3 py-2 border border-border dark:border-border rounded-lg bg-card dark:bg-card text-foreground dark:text-foreground font-mono text-sm focus:ring-2 focus:ring-ring focus:border-transparent"
                  placeholder={t('aIConfigPanel.enter-custom-prompt-here')}
                />
              </div>
            )}
          </div>

          <div className="flex space-x-3">
            <Button
              onClick={handleSave}
              className="flex items-center space-x-2 px-4 py-2 bg-primary text-primary-foreground dark:bg-primary dark:text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              <Save className="w-4 h-4" />
              <span>{t('aIConfigPanel.save')}</span>
            </Button>
            <Button
              onClick={handleTestForm}
              disabled={testingForm}
              className="flex items-center space-x-2 px-4 py-2 bg-primary text-primary-foreground dark:bg-primary dark:text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {testingForm ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <TestTube className="w-4 h-4" />
              )}
              <span>{t('aIConfigPanel.test-connection')}</span>
            </Button>
            <Button
              onClick={resetForm}
              className="flex items-center space-x-2 px-4 py-2 bg-muted hover:bg-accent dark:bg-muted/40 dark:hover:bg-accent text-foreground dark:text-foreground rounded-lg border border-border dark:border-border transition-colors"
            >
              <X className="w-4 h-4" />
              <span>{t('aIConfigPanel.cancel')}</span>
            </Button>
          </div>
        </div>
      )}

      <h4 id="active-ai-config-heading" className="mb-3 text-sm font-medium text-foreground">
        {t('aIConfigPanel.active-ai-configuration')}
      </h4>
      <RadioGroup aria-labelledby="active-ai-config-heading" value={activeAIConfig || ''} onValueChange={setActiveAIConfig} className="space-y-3">
        {aiConfigs.map(config => (
          <div
            key={config.id}
            className={`p-4 rounded-lg border transition-colors ${
              config.id === activeAIConfig
                ? 'border-border bg-accent/50 dark:border-border/[0.12] dark:bg-accent/60'
                : 'border-border dark:border-border hover:border-border dark:hover:border-border-strong'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <RadioGroupItem
                  value={config.id}
                  id={`active-ai-${config.id}`}
                  aria-label={config.name || t('aIConfigPanel.ai-configuration')}
                />
                <div>
                  <h4 className="font-medium text-foreground dark:text-foreground flex items-center">
                    {config.name}
                    {config.useCustomPrompt && (
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground">
                        <MessageSquare className="w-3 h-3 mr-1" />
                        {t('aIConfigPanel.custom-prompt')}
                      </span>
                    )}
                  </h4>
                  <p className="text-sm text-muted-foreground dark:text-muted-foreground">
                    {(config.apiType || 'openai').toUpperCase()} • {config.baseUrl} • {config.model} • {t('aIConfigPanel.concurrency')}: {config.concurrency || 1}
                    {config.reasoningEffort ? ` • reasoning: ${config.reasoningEffort}` : ''}
                  </p>
                  {(config.apiKeyStatus === 'decrypt_failed' || config.apiKeyStatus === 'empty') && (
                    <p className="mt-1 text-sm text-muted-foreground dark:text-muted-foreground ">
                      {t('aIConfigPanel.the-stored-api-key-could-not-be-decrypted-or-is')}
                    </p>
                  )}
                </div>
              </div>
              
              <div className="flex items-center space-x-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleTest(config)}
                  disabled={testingId === config.id}
                  className="h-9 w-9 rounded-lg bg-muted p-0 text-foreground dark:bg-accent dark:text-foreground hover:bg-accent dark:hover:bg-card/[0.12] border border-transparent dark:border-border transition-colors disabled:opacity-50"
                  title={t('aIConfigPanel.test-connection')}
                >
                  {testingId === config.id ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <TestTube className="w-4 h-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleEdit(config)}
                  className="h-9 w-9 rounded-lg bg-muted p-0 text-foreground dark:bg-accent dark:text-foreground hover:bg-accent dark:hover:bg-card/[0.12] border border-transparent dark:border-border transition-colors"
                  title={t('aIConfigPanel.edit')}
                >
                  <Edit3 className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={async () => {
                    const confirmed = await confirm(
                      t('aIConfigPanel.delete-ai-configuration'),
                      t('aIConfigPanel.this-action-cannot-be-undone'),
                      { type: 'danger', confirmText: t('aIConfigPanel.delete') }
                    );
                    if (confirmed) {
                      if (config.id) {
                        if (repositoryChatSettings.chatConfigId === config.id) setRepositoryChatSettings({ chatConfigId: null });
                        deleteAIConfig(config.id);
                      } else {
                        toast(t('aIConfigPanel.delete-failed-invalid-config-id'), 'error');
                      }
                    }
                  }}
                  className="h-9 w-9 rounded-lg bg-muted p-0 text-foreground dark:bg-accent dark:text-foreground hover:bg-accent dark:hover:bg-card/[0.12] border border-transparent dark:border-border transition-colors"
                  title={t('aIConfigPanel.delete')}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </RadioGroup>
        {aiConfigs.length === 0 && (
          <div className="text-center py-8 text-muted-foreground dark:text-muted-foreground">
            <Bot className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>{t('aIConfigPanel.no-ai-services-configured-yet')}</p>
            <p className="text-sm">{t('aIConfigPanel.click-the-button-above-to-add-ai-configuration')}</p>
          </div>
        )}

      <section className="mt-6 rounded-lg border border-border bg-background p-4 dark:border-border dark:bg-muted/40" aria-labelledby="repository-chat-settings-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 id="repository-chat-settings-heading" className="text-sm font-medium text-foreground">{t('aIConfigPanel.repository-chat')}</h4>
            <p className="mt-1 text-xs text-muted-foreground">{t('aIConfigPanel.reads-pinned-source-on-demand-and-keeps-local-co')}</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox checked={repositoryChatSettings.enabled} onCheckedChange={(checked) => setRepositoryChatSettings({ enabled: checked === true })} />
            {t('aIConfigPanel.enable-repository-chat')}
          </label>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label id="repository-chat-model-label" className="mb-1 block text-sm font-medium text-foreground">{t('aIConfigPanel.chat-model')}</label>
            <Select value={repositoryChatSettings.chatConfigId ?? '__active__'} onValueChange={(value) => setRepositoryChatSettings({ chatConfigId: value === '__active__' ? null : value })}>
              <SelectTrigger aria-labelledby="repository-chat-model-label" className="h-10 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__active__">{t('aIConfigPanel.use-active-ai-configuration')}</SelectItem>
                {aiConfigs.map((config) => <SelectItem key={config.id} value={config.id}>{config.name} · {config.model}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">{t('aIConfigPanel.only-the-configuration-id-is-saved-no-api-key-ba')}</p>
          </div>
          <div>
            <label htmlFor="repository-chat-retention-days" className="mb-1 block text-sm font-medium text-foreground">{t('aIConfigPanel.retain-local-conversations-days')}</label>
            <Input id="repository-chat-retention-days" type="number" min={1} max={365} value={repositoryChatSettings.retainSessionDays} onChange={(event) => {
              const parsed = Number(event.target.value);
              setRepositoryChatSettings({ retainSessionDays: Number.isFinite(parsed) ? Math.min(365, Math.max(1, parsed)) : 90 });
            }} />
            <p className="mt-1 text-xs text-muted-foreground">{t('aIConfigPanel.deleting-an-individual-conversation-always-takes')}</p>
          </div>
        </div>
        <details className="mt-4 rounded-md border border-border px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-foreground">{t('aIConfigPanel.advanced-settings')}<span className="ml-2 text-xs font-normal text-muted-foreground">{t('aIConfigPanel.used-by-the-chat-window-when-task-depth-is-defau')}</span></summary>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <label className="flex items-start gap-2 text-sm text-foreground"><Checkbox checked={repositoryChatSettings.enableWebTools} onCheckedChange={(checked) => setRepositoryChatSettings({ enableWebTools: checked === true })} /><span>{t('aIConfigPanel.external-web-search-and-fetch')}<span className="mt-1 block text-xs text-muted-foreground">{t('aIConfigPanel.disabled-by-default-the-current-version-does-not')}</span></span></label>
            <label className="flex items-start gap-2 text-sm text-foreground"><Checkbox checked={repositoryChatSettings.enableAgentToolLoop} onCheckedChange={(checked) => setRepositoryChatSettings({ enableAgentToolLoop: checked === true })} /><span>{t('aIConfigPanel.tool-loop-mode-experimental')}<span className="mt-1 block text-xs text-muted-foreground">{t('aIConfigPanel.evidence-gathering-is-driven-by-native-function')}</span></span></label>
            <div>
              <label id="repository-chat-streaming-label" className="mb-1 block text-sm font-medium text-foreground">{t('aIConfigPanel.streaming-answers')}</label>
              <Select value={repositoryChatSettings.streamingMode} onValueChange={(value) => setRepositoryChatSettings({ streamingMode: value === 'off' ? 'off' : 'auto' })}>
                <SelectTrigger aria-labelledby="repository-chat-streaming-label" className="h-10 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{t('aIConfigPanel.auto-falls-back-to-full-response-when-unsupporte')}</SelectItem>
                  <SelectItem value="off">{t('aIConfigPanel.off')}</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">{t('aIConfigPanel.applies-to-the-final-answer-only-retrieval-still')}</p>
            </div>
            <div>
              <label htmlFor="repository-chat-tool-limit" className="mb-1 block text-sm font-medium text-foreground">{t('aIConfigPanel.maximum-tool-calls-per-turn')}</label>
              <Input id="repository-chat-tool-limit" type="number" min={1} max={48} value={repositoryChatSettings.agentBudget.maxToolCalls} onChange={(event) => {
                const parsed = Number(event.target.value);
                const maxToolCalls = Number.isFinite(parsed) ? Math.min(48, Math.max(1, Math.trunc(parsed))) : 20;
                setRepositoryChatSettings({ maxToolsPerTurn: maxToolCalls, agentBudget: { ...repositoryChatSettings.agentBudget, maxToolCalls } });
              }} />
              <p className="mt-1 text-xs text-muted-foreground">{t('aIConfigPanel.limits-all-read-only-tool-calls-to-prevent-unbou')}</p>
            </div>
            <div>
              <label htmlFor="repository-chat-turn-limit" className="mb-1 block text-sm font-medium text-foreground">{t('aIConfigPanel.maximum-evidence-rounds')}</label>
              <Input id="repository-chat-turn-limit" type="number" min={1} max={8} value={repositoryChatSettings.agentBudget.maxTurns} onChange={(event) => {
                const parsed = Number(event.target.value);
                const maxTurns = Number.isFinite(parsed) ? Math.min(8, Math.max(1, Math.trunc(parsed))) : 4;
                setRepositoryChatSettings({ agentBudget: { ...repositoryChatSettings.agentBudget, maxTurns } });
              }} />
            </div>
            <div>
              <label htmlFor="repository-chat-no-progress-limit" className="mb-1 block text-sm font-medium text-foreground">{t('aIConfigPanel.maximum-consecutive-no-progress-rounds')}</label>
              <Input id="repository-chat-no-progress-limit" type="number" min={1} max={4} value={repositoryChatSettings.agentBudget.maxNoProgressRounds} onChange={(event) => {
                const parsed = Number(event.target.value);
                const maxNoProgressRounds = Number.isFinite(parsed) ? Math.min(4, Math.max(1, Math.trunc(parsed))) : 2;
                setRepositoryChatSettings({ agentBudget: { ...repositoryChatSettings.agentBudget, maxNoProgressRounds } });
              }} />
              <p className="mt-1 text-xs text-muted-foreground">{t('aIConfigPanel.stops-repeated-retrieval-after-consecutive-round')}</p>
            </div>
            <div>
              <label htmlFor="repository-chat-read-limit" className="mb-1 block text-sm font-medium text-foreground">{t('aIConfigPanel.maximum-files-read')}</label>
              <Input id="repository-chat-read-limit" type="number" min={1} max={16} value={repositoryChatSettings.agentBudget.maxReadFiles} onChange={(event) => {
                const parsed = Number(event.target.value);
                const maxReadFiles = Number.isFinite(parsed) ? Math.min(16, Math.max(1, Math.trunc(parsed))) : 6;
                setRepositoryChatSettings({ agentBudget: { ...repositoryChatSettings.agentBudget, maxReadFiles, maxCodeReads: Math.min(repositoryChatSettings.agentBudget.maxCodeReads, maxReadFiles) } });
              }} />
            </div>
            <div>
              <label htmlFor="repository-chat-code-read-limit" className="mb-1 block text-sm font-medium text-foreground">{t('aIConfigPanel.maximum-code-files-read')}</label>
              <Input id="repository-chat-code-read-limit" type="number" min={0} max={12} value={repositoryChatSettings.agentBudget.maxCodeReads} onChange={(event) => {
                const parsed = Number(event.target.value);
                const maxCodeReads = Number.isFinite(parsed) ? Math.min(repositoryChatSettings.agentBudget.maxReadFiles, Math.min(12, Math.max(0, Math.trunc(parsed)))) : 3;
                setRepositoryChatSettings({ agentBudget: { ...repositoryChatSettings.agentBudget, maxCodeReads } });
              }} />
              <p className="mt-1 text-xs text-muted-foreground">{t('aIConfigPanel.code-is-read-only-when-documentation-evidence-is')}</p>
            </div>
            <div>
              <label htmlFor="repository-chat-duration-limit" className="mb-1 block text-sm font-medium text-foreground">{t('aIConfigPanel.maximum-execution-time-seconds')}</label>
              <Input id="repository-chat-duration-limit" type="number" min={15} max={300} value={Math.round(repositoryChatSettings.agentBudget.maxDurationMs / 1000)} onChange={(event) => {
                const parsed = Number(event.target.value);
                const maxDurationMs = (Number.isFinite(parsed) ? Math.min(300, Math.max(15, Math.trunc(parsed))) : 90) * 1000;
                setRepositoryChatSettings({ agentBudget: { ...repositoryChatSettings.agentBudget, maxDurationMs } });
              }} />
            </div>
          </div>
        </details>
      </section>

      <div className="mt-6 p-4 bg-background dark:bg-muted/40 rounded-lg border border-border dark:border-border">
        <div className="flex items-center space-x-2 mb-3">
          <Languages className="w-4 h-4 text-muted-foreground dark:text-muted-foreground" />
          <h4 className="text-sm font-medium text-foreground dark:text-foreground">
            {t('aIConfigPanel.translation-engine')}
          </h4>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label id="translation-engine-label" className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1">
              {t('aIConfigPanel.engine-used-for-readme-document-translation')}
            </label>
            <Select value={translationEngine} onValueChange={(value) => setTranslationEngine(value as TranslationEngine)}>
              <SelectTrigger aria-labelledby="translation-engine-label" className="h-10 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="microsoft">{t('aIConfigPanel.microsoft-translate-free')}</SelectItem>
                <SelectItem value="google">{t('aIConfigPanel.google-translate-free')}</SelectItem>
                <SelectItem value="ai">{t('aIConfigPanel.ai-translation-uses-the-active-ai-configuration')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground dark:text-muted-foreground self-end pb-1">
            {translationEngine === 'ai'
              ? t('aIConfigPanel.ai-translation-usually-has-higher-quality-but-is')
              : translationEngine === 'google'
                ? t('aIConfigPanel.free-google-endpoint-no-configuration-needed-may')
                : t('aIConfigPanel.free-microsoft-edge-endpoint-no-configuration-ne')}
          </p>
        </div>
      </div>
    </div>
  );
};
