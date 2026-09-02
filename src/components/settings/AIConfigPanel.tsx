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
import { AIService } from '../../services/aiService';

interface AIConfigPanelProps {
  t: (zh: string, en: string) => string;
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

function getEndpointHelpText(apiType: AIApiType, t: (zh: string, en: string) => string): string {
  switch (apiType) {
    case 'openai-compatible':
      return t('填写完整的API调用地址，包含完整路径', 'Enter the full API endpoint URL including the complete path');
    case 'gemini':
      return t('只填到 v1beta 即可，路径会自动生成', 'Only include the version prefix v1beta, the path will be generated automatically');
    case 'deepseek':
      return t('填写到域名即可（如 https://api.deepseek.com），路径会自动生成', 'Only include the domain (e.g. https://api.deepseek.com), the path will be generated automatically');
    case 'mimo':
      return t('填写到 /v1 即可（如 https://api.xiaomimimo.com/v1），路径会自动生成', 'Only include up to /v1 (e.g. https://api.xiaomimimo.com/v1), the path will be generated automatically');
    default:
      return t('只填到版本号即可（如 .../v1 或 .../v1beta），不要包含 /chat/completions、/responses、/messages', 'Only include the version prefix (e.g. .../v1 or .../v1beta). Do not include /chat/completions, /responses, or /messages.');
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
  const [showApiKey, setShowApiKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
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
      toast(t('请填写所有必填字段', 'Please fill in all required fields'), 'error');
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
      toast(t('请先填写API端点、API密钥和模型名称', 'Please fill in API Endpoint, API Key and Model Name first'), 'error');
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

  const handleFetchModels = useCallback(async () => {
    if (!form.baseUrl || !form.apiKey) {
      toast(t('请先填写API端点和API密钥', 'Please fill in API Endpoint and API Key first'), 'error');
      return;
    }
    setLoadingModels(true);
    try {
      const service = new AIService({
        id: editingId || '',
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
      }, language);
      const result = await service.fetchModels();
      setModels(result);
      if (result.length === 0) {
        toast(t('未获取到模型列表，请检查端点是否支持模型列表接口', 'No models returned. Check that the endpoint supports a model list API.'), 'error');
      } else {
        toast(t(`获取到 ${result.length} 个模型`, `Fetched ${result.length} models`), 'success');
      }
    } catch (error) {
      console.error('Fetch models failed:', error);
      toast(t('获取模型失败，请检查配置', 'Failed to fetch models. Check your configuration.'), 'error');
    } finally {
      setLoadingModels(false);
    }
  }, [editingId, form, language, t, toast]);

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
    } else {
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
        showNotification('info', t('已自动填充默认提示词，您可以进行修改', 'Default prompt auto-filled, you can modify it'));
      }
    } else {
      setShowCustomPrompt(false);
    }
  }, [defaultPrompt, form.customPrompt, showNotification, t]);

  const handleToggleDefaultPrompt = useCallback(() => {
    if (showCustomPrompt) {
      showNotification('info', t('请先关闭自定义提示词编辑区域', 'Please close the custom prompt editor first'));
      return;
    }
    setShowDefaultPrompt(prev => !prev);
  }, [showCustomPrompt, showNotification, t]);

  const handleRestoreDefaultPrompt = useCallback(async () => {
    if (isCustomPromptSameAsDefault) {
      showNotification('info', t('当前提示词已是默认值', 'Current prompt is already the default'));
      return;
    }

    if (isCustomPromptModified) {
      const confirmed = await confirm(
        t('确定要恢复默认提示词吗？', 'Restore Default Prompt?'),
        t('这将覆盖您当前的修改。', 'This will overwrite your current changes.'),
        { type: 'warning' }
      );
      if (!confirmed) return;
    }

    setForm(prev => ({ ...prev, customPrompt: defaultPrompt }));
    showNotification('success', t('已恢复默认提示词', 'Default prompt restored'));
  }, [defaultPrompt, isCustomPromptModified, isCustomPromptSameAsDefault, showNotification, t, confirm]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Bot className="w-6 h-6 text-muted-foreground dark:text-muted-foreground " />
          <h3 className="text-lg font-semibold text-foreground dark:text-foreground">
            {t('AI服务配置', 'AI Service Configuration')}
          </h3>
        </div>
        <Button
          onClick={() => setShowForm(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-primary text-primary-foreground dark:bg-primary dark:text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>{t('添加AI配置', 'Add AI Config')}</span>
        </Button>
      </div>

      {showForm && (
        <div className="p-4 bg-background dark:bg-muted/40 rounded-lg border border-border dark:border-border">
          <h4 className="font-medium text-foreground dark:text-foreground mb-4">
            {editingId ? t('编辑AI配置', 'Edit AI Configuration') : t('添加AI配置', 'Add AI Configuration')}
          </h4>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label htmlFor="ai-config-name" className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1">
                {t('配置名称', 'Configuration Name')} *
              </label>
              <Input
                id="ai-config-name"
                type="text"
                value={form.name}
                onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 border border-border dark:border-border rounded-lg bg-card dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent focus:outline-none"
                placeholder={t('例如: OpenAI GPT-4', 'e.g., OpenAI GPT-4')}
              />
            </div>

            <div>
              <label id="ai-api-type-label" className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1">
                {t('接口格式', 'API Format')} *
              </label>
              <Select value={form.apiType} onValueChange={(value) => setForm(prev => ({ ...prev, apiType: value as AIApiType }))}>
                <SelectTrigger aria-labelledby="ai-api-type-label" className="h-10 w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="openai">OpenAI (Chat Completions)</SelectItem><SelectItem value="openai-responses">OpenAI (Responses)</SelectItem><SelectItem value="claude">Claude</SelectItem><SelectItem value="gemini">Gemini</SelectItem><SelectItem value="deepseek">DeepSeek</SelectItem><SelectItem value="mimo">Xiaomi MiMo</SelectItem><SelectItem value="openai-compatible">OpenAI Compatible (Custom Endpoint)</SelectItem></SelectContent>
              </Select>
            </div>

            {form.apiType === 'mimo' && (
              <div>
                <label id="ai-mimo-plan-label" className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1">
                  {t('MiMo 渠道', 'MiMo Channel')} *
                </label>
                <Select value={form.mimoPlan} onValueChange={(value) => setForm(prev => ({ ...prev, mimoPlan: value as MiMoPlan }))}>
                  <SelectTrigger aria-labelledby="ai-mimo-plan-label" className="h-10 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="api">{t('API（按量付费）', 'API (Pay-as-you-go)')}</SelectItem><SelectItem value="token-plan">{t('Token Plan（订阅制）', 'Token Plan (Subscription)')}</SelectItem></SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-1">
                  {form.mimoPlan === 'api'
                    ? t('API Key 以 sk- 开头，端点 api.xiaomimimo.com', 'API Key starts with sk-, endpoint api.xiaomimimo.com')
                    : t('API Key 以 tp- 开头，端点 token-plan-cn.xiaomimimo.com', 'API Key starts with tp-, endpoint token-plan-cn.xiaomimimo.com')}
                </p>
              </div>
            )}
            
            <div>
              <label htmlFor="ai-base-url" className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1">
                {t('API端点', 'API Endpoint')} *
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
                  {t('最终请求地址: ', 'Final request URL: ')}
                  <span className="font-mono break-all">
                    {buildFinalApiUrl(form.baseUrl, form.apiType)}
                  </span>
                </p>
              )}
            </div>
            
            <div>
              <label htmlFor="ai-api-key" className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1">
                {t('API密钥', 'API Key')} *
              </label>
              <div className="relative">
                <Input
                  id="ai-api-key"
                  type={showApiKey ? 'text' : 'password'}
                  value={form.apiKey}
                  onChange={(e) => setForm(prev => ({ ...prev, apiKey: e.target.value }))}
                  className="w-full px-3 py-2 pr-10 border border-border dark:border-border rounded-lg bg-card dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent focus:outline-none"
                  placeholder={t('输入API密钥', 'Enter API key')}
                  autoComplete="off"
                />
                <button
                  type="button"
                  aria-label={showApiKey ? t('隐藏API密钥', 'Hide API key') : t('显示API密钥', 'Show API key')}
                  title={showApiKey ? t('隐藏API密钥', 'Hide API key') : t('显示API密钥', 'Show API key')}
                  onClick={() => setShowApiKey(prev => !prev)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground transition-colors"
                >
                  {showApiKey ? (
                    <EyeOff className="h-[18px] w-[18px]" />
                  ) : (
                    <Eye className="h-[18px] w-[18px]" />
                  )}
                </button>
              </div>
            </div>
            
            <div>
              <label htmlFor="ai-model-name" className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1">
                {t('模型名称', 'Model Name')} *
              </label>
              <div className="flex items-center gap-2">
                <Select
                  value={form.model || '__custom__'}
                  onValueChange={(value) => {
                    if (value !== '__custom__') {
                      setForm(prev => ({ ...prev, model: value }));
                    }
                  }}
                >
                  <SelectTrigger
                    id="ai-model-name"
                    aria-label={t('选择模型', 'Select model')}
                    className="w-full h-10 border border-border dark:border-border rounded-lg bg-card dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent focus:outline-none"
                  >
                    <SelectValue placeholder={t('选择或输入模型名称', 'Select or type a model name')} />
                  </SelectTrigger>
                  <SelectContent>
                    {models.length === 0 && (
                      <SelectItem value="__custom__" disabled>
                        {t('暂无模型，请点击“获取模型”或手动输入', 'No models yet. Click "Get Models" or type manually')}
                      </SelectItem>
                    )}
                    {models.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  onClick={handleFetchModels}
                  disabled={loadingModels}
                  className="flex items-center gap-1.5 px-3 py-2 h-10 whitespace-nowrap bg-primary text-primary-foreground dark:bg-primary dark:text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                  title={t('获取模型', 'Get Models')}
                >
                  {loadingModels ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  <span>{t('获取模型', 'Get Models')}</span>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-1">
                {t('点击“获取模型”从服务端拉取可用模型；也可直接输入自定义模型名称', 'Click "Get Models" to fetch available models, or type a custom model name')}
              </p>
            </div>
            
            <div>
              <label id="ai-concurrency-label" className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1">
                {t('并发数', 'Concurrency')}
              </label>
              <SliderInput
                value={form.concurrency}
                label={t('并发数', 'Concurrency')}
                onChange={(v) => setForm(prev => ({ ...prev, concurrency: v }))}
                min={1}
                max={10}
                showMarks={false}
              />
              <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-1">
                {t('同时进行AI分析的仓库数量 (1-10)', 'Number of repositories to analyze simultaneously (1-10)')}
              </p>
            </div>

            <div>
              <label id="ai-reasoning-effort-label" className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1">
                {t('推理强度', 'Reasoning Effort')}
              </label>
              <Select value={form.reasoningEffort || 'default'} onValueChange={(value) => setForm(prev => ({ ...prev, reasoningEffort: value === 'default' ? '' : value as AIReasoningEffort }))}>
                <SelectTrigger aria-labelledby="ai-reasoning-effort-label" className="h-10 w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="default">{t('默认 / 不传', 'Default / Do not send')}</SelectItem><SelectItem value="none">{t('none — 不推理', 'none — No reasoning')}</SelectItem><SelectItem value="low">{t('low — 快速响应', 'low — Quick response')}</SelectItem><SelectItem value="medium">{t('medium — 均衡模式', 'medium — Balanced')}</SelectItem><SelectItem value="high">{t('high — 深度推理', 'high — Deep reasoning')}</SelectItem><SelectItem value="xhigh">{t('xhigh — 最深推理', 'xhigh — Deepest reasoning')}</SelectItem></SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-1">
                {t(
                  '仅对 OpenAI 兼容接口生效。留空时保持旧模式兼容，不额外传 reasoning。',
                  'Only applies to OpenAI-compatible APIs. Leave empty to preserve legacy behavior and omit reasoning.'
                )}
              </p>
            </div>

            {isToolCallCapable(form.apiType) && (
              <div>
                <label className="flex items-start gap-2 text-sm text-foreground">
                  <Checkbox checked={form.supportsToolCalls} onCheckedChange={(checked) => setForm(prev => ({ ...prev, supportsToolCalls: checked === true }))} />
                  <span>
                    {t('支持工具调用（Function Calling）', 'Supports tool calling (function calling)')}
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {t('勾选后仓库问答可对该模型启用实验性的工具循环模式；端点实际不支持时会自动回退。', 'Lets repository chat use the experimental tool-loop mode with this model; falls back automatically if the endpoint rejects tools.')}
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
                    {t('使用自定义提示词', 'Use Custom Prompt')}
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
                  <span>{showDefaultPrompt ? t('隐藏默认提示词', 'Hide Default Prompt') : t('查看默认提示词', 'View Default Prompt')}</span>
                </Button>
              </div>
              {form.useCustomPrompt && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleRestoreDefaultPrompt}
                  className="text-sm text-muted-foreground hover:text-muted-foreground dark:text-muted-foreground dark:hover:text-muted-foreground"
                >
                  {t('恢复默认提示词', 'Restore Default Prompt')}
                </Button>
              )}
            </div>
            
            {showDefaultPrompt && !showCustomPrompt && (
              <div className="mb-3">
                <label className="block text-xs font-medium text-muted-foreground dark:text-muted-foreground mb-1">
                  {t('默认提示词（只读）', 'Default Prompt (Read-only)')}
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
                    {t('自定义提示词', 'Custom Prompt')}
                    {isCustomPromptModified && (
                      <span className="ml-2 text-muted-foreground dark:text-muted-foreground ">
                        ({t('已修改', 'Modified')})
                      </span>
                    )}
                    {isCustomPromptSameAsDefault && (
                      <span className="ml-2 text-muted-foreground dark:text-muted-foreground">
                        ({t('默认值', 'Default')})
                      </span>
                    )}
                  </label>
                  <span className="text-xs text-muted-foreground dark:text-muted-foreground/70">
                    {form.customPrompt.length} {t('字符', 'characters')}
                  </span>
                </div>
                <Textarea
                  id="ai-custom-prompt"
                  value={form.customPrompt}
                  onChange={(e) => setForm(prev => ({ ...prev, customPrompt: e.target.value }))}
                  rows={10}
                  className="w-full px-3 py-2 border border-border dark:border-border rounded-lg bg-card dark:bg-card text-foreground dark:text-foreground font-mono text-sm focus:ring-2 focus:ring-ring focus:border-transparent"
                  placeholder={t('在此输入自定义提示词...', 'Enter custom prompt here...')}
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
              <span>{t('保存', 'Save')}</span>
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
              <span>{t('测试连接', 'Test Connection')}</span>
            </Button>
            <Button
              onClick={resetForm}
              className="flex items-center space-x-2 px-4 py-2 bg-muted hover:bg-accent dark:bg-muted/40 dark:hover:bg-accent text-foreground dark:text-foreground rounded-lg border border-border dark:border-border transition-colors"
            >
              <X className="w-4 h-4" />
              <span>{t('取消', 'Cancel')}</span>
            </Button>
          </div>
        </div>
      )}

      <h4 id="active-ai-config-heading" className="mb-3 text-sm font-medium text-foreground">
        {t('当前 AI 配置', 'Active AI configuration')}
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
                  aria-label={config.name || t('AI配置', 'AI configuration')}
                />
                <div>
                  <h4 className="font-medium text-foreground dark:text-foreground flex items-center">
                    {config.name}
                    {config.useCustomPrompt && (
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground">
                        <MessageSquare className="w-3 h-3 mr-1" />
                        {t('自定义提示词', 'Custom Prompt')}
                      </span>
                    )}
                  </h4>
                  <p className="text-sm text-muted-foreground dark:text-muted-foreground">
                    {(config.apiType || 'openai').toUpperCase()} • {config.baseUrl} • {config.model} • {t('并发数', 'Concurrency')}: {config.concurrency || 1}
                    {config.reasoningEffort ? ` • reasoning: ${config.reasoningEffort}` : ''}
                  </p>
                  {(config.apiKeyStatus === 'decrypt_failed' || config.apiKeyStatus === 'empty') && (
                    <p className="mt-1 text-sm text-muted-foreground dark:text-muted-foreground ">
                      {t(
                        '存储的 API Key 无法解密或为空，请重新输入并保存该配置。',
                        'The stored API key could not be decrypted or is empty. Please re-enter and save this configuration.'
                      )}
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
                  title={t('测试连接', 'Test Connection')}
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
                  title={t('编辑', 'Edit')}
                >
                  <Edit3 className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={async () => {
                    const confirmed = await confirm(
                      t('确定要删除这个AI配置吗？', 'Delete AI Configuration?'),
                      t('此操作无法撤销。', 'This action cannot be undone.'),
                      { type: 'danger', confirmText: t('删除', 'Delete') }
                    );
                    if (confirmed) {
                      if (config.id) {
                        if (repositoryChatSettings.chatConfigId === config.id) setRepositoryChatSettings({ chatConfigId: null });
                        deleteAIConfig(config.id);
                      } else {
                        toast(t('删除失败：配置ID无效', 'Delete failed: Invalid config ID'), 'error');
                      }
                    }
                  }}
                  className="h-9 w-9 rounded-lg bg-muted p-0 text-foreground dark:bg-accent dark:text-foreground hover:bg-accent dark:hover:bg-card/[0.12] border border-transparent dark:border-border transition-colors"
                  title={t('删除', 'Delete')}
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
            <p>{t('还没有配置AI服务', 'No AI services configured yet')}</p>
            <p className="text-sm">{t('点击上方按钮添加AI配置', 'Click the button above to add AI configuration')}</p>
          </div>
        )}

      <section className="mt-6 rounded-lg border border-border bg-background p-4 dark:border-border dark:bg-muted/40" aria-labelledby="repository-chat-settings-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 id="repository-chat-settings-heading" className="text-sm font-medium text-foreground">{t('仓库问答', 'Repository chat')}</h4>
            <p className="mt-1 text-xs text-muted-foreground">{t('按需读取固定版本源码并保留本机对话；不会更新或重建既有向量索引。', 'Reads pinned source on demand and keeps local conversations; it never updates or rebuilds the existing vector index.')}</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox checked={repositoryChatSettings.enabled} onCheckedChange={(checked) => setRepositoryChatSettings({ enabled: checked === true })} />
            {t('启用仓库问答', 'Enable repository chat')}
          </label>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label id="repository-chat-model-label" className="mb-1 block text-sm font-medium text-foreground">{t('问答模型', 'Chat model')}</label>
            <Select value={repositoryChatSettings.chatConfigId ?? '__active__'} onValueChange={(value) => setRepositoryChatSettings({ chatConfigId: value === '__active__' ? null : value })}>
              <SelectTrigger aria-labelledby="repository-chat-model-label" className="h-10 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__active__">{t('跟随当前 AI 配置', 'Use active AI configuration')}</SelectItem>
                {aiConfigs.map((config) => <SelectItem key={config.id} value={config.id}>{config.name} · {config.model}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">{t('仅保存配置 ID，不会复制 API Key、Base URL 或模型凭据。', 'Only the configuration ID is saved; no API key, base URL, or credential is copied.')}</p>
          </div>
          <div>
            <label htmlFor="repository-chat-retention-days" className="mb-1 block text-sm font-medium text-foreground">{t('保留本机会话（天）', 'Retain local conversations (days)')}</label>
            <Input id="repository-chat-retention-days" type="number" min={1} max={365} value={repositoryChatSettings.retainSessionDays} onChange={(event) => {
              const parsed = Number(event.target.value);
              setRepositoryChatSettings({ retainSessionDays: Number.isFinite(parsed) ? Math.min(365, Math.max(1, parsed)) : 90 });
            }} />
            <p className="mt-1 text-xs text-muted-foreground">{t('删除单个会话始终立即生效。', 'Deleting an individual conversation always takes effect immediately.')}</p>
          </div>
        </div>
        <details className="mt-4 rounded-md border border-border px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-foreground">{t('高级设置', 'Advanced settings')}<span className="ml-2 text-xs font-normal text-muted-foreground">{t('聊天窗口任务深度选“默认”时使用这些参数', 'Used by the chat window when task depth is “Default”')}</span></summary>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <label className="flex items-start gap-2 text-sm text-foreground"><Checkbox checked={repositoryChatSettings.enableWebTools} onCheckedChange={(checked) => setRepositoryChatSettings({ enableWebTools: checked === true })} /><span>{t('外部网页搜索与抓取', 'External web search and fetch')}<span className="mt-1 block text-xs text-muted-foreground">{t('默认关闭；当前版本不会将其暴露为工具。', 'Disabled by default; the current version does not expose it as a tool.')}</span></span></label>
            <label className="flex items-start gap-2 text-sm text-foreground"><Checkbox checked={repositoryChatSettings.enableAgentToolLoop} onCheckedChange={(checked) => setRepositoryChatSettings({ enableAgentToolLoop: checked === true })} /><span>{t('工具循环模式（实验性）', 'Tool-loop mode (experimental)')}<span className="mt-1 block text-xs text-muted-foreground">{t('取证改由模型原生 function calling 驱动；仅对勾选了“支持工具调用”的问答模型生效，不支持时自动回退。', 'Evidence gathering is driven by native function calling; applies only to chat models marked as supporting tool calling, with automatic fallback otherwise.')}</span></span></label>
            <div>
              <label id="repository-chat-streaming-label" className="mb-1 block text-sm font-medium text-foreground">{t('流式回答', 'Streaming answers')}</label>
              <Select value={repositoryChatSettings.streamingMode} onValueChange={(value) => setRepositoryChatSettings({ streamingMode: value === 'off' ? 'off' : 'auto' })}>
                <SelectTrigger aria-labelledby="repository-chat-streaming-label" className="h-10 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{t('自动（不支持时降级为整段返回）', 'Auto (falls back to full response when unsupported)')}</SelectItem>
                  <SelectItem value="off">{t('关闭', 'Off')}</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">{t('仅对最终回答生效，取证过程仍按步骤进行；走后端代理时自动降级为整段返回。', 'Applies to the final answer only; retrieval still runs step by step. Falls back to a full response when the backend proxy is used.')}</p>
            </div>
            <div>
              <label htmlFor="repository-chat-tool-limit" className="mb-1 block text-sm font-medium text-foreground">{t('单轮工具调用上限', 'Maximum tool calls per turn')}</label>
              <Input id="repository-chat-tool-limit" type="number" min={1} max={48} value={repositoryChatSettings.agentBudget.maxToolCalls} onChange={(event) => {
                const parsed = Number(event.target.value);
                const maxToolCalls = Number.isFinite(parsed) ? Math.min(48, Math.max(1, Math.trunc(parsed))) : 20;
                setRepositoryChatSettings({ maxToolsPerTurn: maxToolCalls, agentBudget: { ...repositoryChatSettings.agentBudget, maxToolCalls } });
              }} />
              <p className="mt-1 text-xs text-muted-foreground">{t('限制只读工具总调用次数，防止无边界检索。', 'Limits all read-only tool calls to prevent unbounded retrieval.')}</p>
            </div>
            <div>
              <label htmlFor="repository-chat-turn-limit" className="mb-1 block text-sm font-medium text-foreground">{t('最大取证轮数', 'Maximum evidence rounds')}</label>
              <Input id="repository-chat-turn-limit" type="number" min={1} max={8} value={repositoryChatSettings.agentBudget.maxTurns} onChange={(event) => {
                const parsed = Number(event.target.value);
                const maxTurns = Number.isFinite(parsed) ? Math.min(8, Math.max(1, Math.trunc(parsed))) : 4;
                setRepositoryChatSettings({ agentBudget: { ...repositoryChatSettings.agentBudget, maxTurns } });
              }} />
            </div>
            <div>
              <label htmlFor="repository-chat-no-progress-limit" className="mb-1 block text-sm font-medium text-foreground">{t('连续无进展轮次上限', 'Maximum consecutive no-progress rounds')}</label>
              <Input id="repository-chat-no-progress-limit" type="number" min={1} max={4} value={repositoryChatSettings.agentBudget.maxNoProgressRounds} onChange={(event) => {
                const parsed = Number(event.target.value);
                const maxNoProgressRounds = Number.isFinite(parsed) ? Math.min(4, Math.max(1, Math.trunc(parsed))) : 2;
                setRepositoryChatSettings({ agentBudget: { ...repositoryChatSettings.agentBudget, maxNoProgressRounds } });
              }} />
              <p className="mt-1 text-xs text-muted-foreground">{t('连续轮次未取得新的可引用来源时停止，避免重复读取。标准值为 2。', 'Stops repeated retrieval after consecutive rounds without new citable sources. Standard: 2.')}</p>
            </div>
            <div>
              <label htmlFor="repository-chat-read-limit" className="mb-1 block text-sm font-medium text-foreground">{t('最大文件读取数', 'Maximum files read')}</label>
              <Input id="repository-chat-read-limit" type="number" min={1} max={16} value={repositoryChatSettings.agentBudget.maxReadFiles} onChange={(event) => {
                const parsed = Number(event.target.value);
                const maxReadFiles = Number.isFinite(parsed) ? Math.min(16, Math.max(1, Math.trunc(parsed))) : 6;
                setRepositoryChatSettings({ agentBudget: { ...repositoryChatSettings.agentBudget, maxReadFiles, maxCodeReads: Math.min(repositoryChatSettings.agentBudget.maxCodeReads, maxReadFiles) } });
              }} />
            </div>
            <div>
              <label htmlFor="repository-chat-code-read-limit" className="mb-1 block text-sm font-medium text-foreground">{t('最大代码文件读取数', 'Maximum code files read')}</label>
              <Input id="repository-chat-code-read-limit" type="number" min={0} max={12} value={repositoryChatSettings.agentBudget.maxCodeReads} onChange={(event) => {
                const parsed = Number(event.target.value);
                const maxCodeReads = Number.isFinite(parsed) ? Math.min(repositoryChatSettings.agentBudget.maxReadFiles, Math.min(12, Math.max(0, Math.trunc(parsed)))) : 3;
                setRepositoryChatSettings({ agentBudget: { ...repositoryChatSettings.agentBudget, maxCodeReads } });
              }} />
              <p className="mt-1 text-xs text-muted-foreground">{t('代码只会在文档证据不足且 Evidence Gate 明确要求时读取。', 'Code is read only when documentation evidence is insufficient and the Evidence Gate requests it.')}</p>
            </div>
            <div>
              <label htmlFor="repository-chat-duration-limit" className="mb-1 block text-sm font-medium text-foreground">{t('最长执行时间（秒）', 'Maximum execution time (seconds)')}</label>
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
            {t('翻译引擎', 'Translation Engine')}
          </h4>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label id="translation-engine-label" className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1">
              {t('README 文档翻译使用的引擎', 'Engine used for README document translation')}
            </label>
            <Select value={translationEngine} onValueChange={(value) => setTranslationEngine(value as TranslationEngine)}>
              <SelectTrigger aria-labelledby="translation-engine-label" className="h-10 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="microsoft">{t('微软翻译（免费）', 'Microsoft Translate (Free)')}</SelectItem>
                <SelectItem value="google">{t('Google 翻译（免费）', 'Google Translate (Free)')}</SelectItem>
                <SelectItem value="ai">{t('AI 翻译（使用当前激活的 AI 配置）', 'AI Translation (uses the active AI configuration)')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground dark:text-muted-foreground self-end pb-1">
            {translationEngine === 'ai'
              ? t(
                  'AI 翻译质量通常更高，但速度较慢且消耗 API 额度，将使用上方当前激活的 AI 配置。',
                  'AI translation usually has higher quality, but is slower and consumes API quota. It uses the active AI configuration above.'
                )
              : translationEngine === 'google'
                ? t(
                    'Google 免费接口，无需配置；部分地区可能无法直连。',
                    'Free Google endpoint, no configuration needed; may be unreachable in some regions.'
                  )
                : t(
                    '微软 Edge 免费接口，无需配置，直连速度快。',
                    'Free Microsoft Edge endpoint, no configuration needed, fast direct connection.'
                  )}
          </p>
        </div>
      </div>
    </div>
  );
};
