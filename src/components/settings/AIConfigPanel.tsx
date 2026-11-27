
import { TranslateFn } from '../../i18n/useT';
import { i18n } from '../../i18n';
import { Textarea } from '../ui/textarea';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Bot, Plus, Edit3, Trash2, Save, X, Plug, RefreshCw, MessageSquare, Eye, EyeOff, AlertCircle, Languages } from 'lucide-react';
import { AIConfig, AIApiType, AIReasoningEffort, MiMoPlan, TranslationEngine } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { useAIConfigActions } from '../../features/settings/hooks/useAIConfigActions';
import { buildFinalApiUrl } from '../../utils/apiUrlBuilder';
import { SliderInput } from '../ui/SliderInput';
import { useDialog } from '../../hooks/useDialog';
import { isToolCallCapableApiType } from '../../constants/aiCapabilities';
import { Modal } from '../Modal';
import type { RepositoryChatTaskDepth } from '../../types/repositoryChat';

import { cn } from '../../lib/utils';
import {
  SettingsCard,
  SettingsDivider,
  SettingsNotice,
  SettingsPageStack,
  SettingsRow,
  SettingsSection,
} from './SettingsPrimitives';

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
    autoTranslateRepoDescription,
    repositoryChatSettings,
    setTranslationEngine,
    setAutoTranslateRepoDescription,
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
    autoTranslateRepoDescription: state.autoTranslateRepoDescription,
    repositoryChatSettings: state.repositoryChatSettings,
    setTranslationEngine: state.setTranslationEngine,
    setAutoTranslateRepoDescription: state.setAutoTranslateRepoDescription,
    setRepositoryChatSettings: state.setRepositoryChatSettings,
    addAIConfig: state.addAIConfig,
    updateAIConfig: state.updateAIConfig,
    deleteAIConfig: state.deleteAIConfig,
    setActiveAIConfig: state.setActiveAIConfig,
    setCurrentView: state.setCurrentView,
  })));

  const { toast, confirm } = useDialog();
  const tChat = i18n.getFixedT(language, 'chat');
  const { testingId, testingForm, testConfig, testDraft } = useAIConfigActions();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // 弹窗没有 DialogTrigger，Radix 会把焦点丢到 body；关闭时还给打开它的按钮。
  const openerRef = useRef<HTMLElement | null>(null);
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

  const handleClose = () => {
    const opener = openerRef.current;
    if (opener?.isConnected) opener.focus();
    resetForm();
  };

  const handleCloseAutoFocus = (event: Event) => {
    // 打开按钮已不在文档中时保留 Radix 默认行为，再清空表单。
    if (openerRef.current?.isConnected) event.preventDefault();
    handleClose();
  };

  const handleEdit = (config: AIConfig, opener: HTMLElement) => {
    openerRef.current = opener;
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
    <SettingsPageStack>
      <Modal
        isOpen={showForm}
        onClose={handleClose}
        onCloseAutoFocus={handleCloseAutoFocus}
        title={editingId ? t('aIConfigPanel.edit-ai-configuration') : t('aIConfigPanel.add-ai-configuration')}
        maxWidth="max-w-3xl"
        scrollable
        footer={(
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="md" onClick={resetForm}>
              <X className="size-4" />
              <span>{t('aIConfigPanel.cancel')}</span>
            </Button>
            <Button type="button" variant="outline" size="md" onClick={handleTestForm} disabled={testingForm}>
              {testingForm ? (
                <RefreshCw className="size-4 animate-spin" />
              ) : (
                <Plug className="size-4" />
              )}
              <span>{t('aIConfigPanel.test-connection')}</span>
            </Button>
            <Button type="button" variant="primary" size="md" onClick={handleSave}>
              <Save className="size-4" />
              <span>{t('aIConfigPanel.save')}</span>
            </Button>
          </div>
        )}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="ai-config-name" className="mb-1.5 block text-label font-medium text-foreground">
              {t('aIConfigPanel.configuration-name')} *
            </label>
            <Input
              id="ai-config-name"
              type="text"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder={t('aIConfigPanel.e-g-openai-gpt-4')}
            />
          </div>

          <div>
            <label id="ai-api-type-label" className="mb-1.5 block text-label font-medium text-foreground">
              {t('aIConfigPanel.api-format')} *
            </label>
            <Select value={form.apiType} onValueChange={(value) => setForm((prev) => ({ ...prev, apiType: value as AIApiType }))}>
              <SelectTrigger aria-labelledby="ai-api-type-label" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI (Chat Completions)</SelectItem>
                <SelectItem value="openai-responses">OpenAI (Responses)</SelectItem>
                <SelectItem value="claude">Claude</SelectItem>
                <SelectItem value="gemini">Gemini</SelectItem>
                <SelectItem value="deepseek">DeepSeek</SelectItem>
                <SelectItem value="mimo">Xiaomi MiMo</SelectItem>
                <SelectItem value="openai-compatible">OpenAI Compatible (Custom Endpoint)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.apiType === 'mimo' && (
            <div>
              <label id="ai-mimo-plan-label" className="mb-1.5 block text-label font-medium text-foreground">
                {t('aIConfigPanel.mimo-channel')} *
              </label>
              <Select value={form.mimoPlan} onValueChange={(value) => setForm((prev) => ({ ...prev, mimoPlan: value as MiMoPlan }))}>
                <SelectTrigger aria-labelledby="ai-mimo-plan-label" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="api">{t('aIConfigPanel.api-pay-as-you-go')}</SelectItem>
                  <SelectItem value="token-plan">{t('aIConfigPanel.token-plan-subscription')}</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1.5 text-label-sm text-secondary">
                {form.mimoPlan === 'api'
                  ? t('aIConfigPanel.api-key-starts-with-sk-endpoint-api-xiaomimimo-c')
                  : t('aIConfigPanel.api-key-starts-with-tp-endpoint-token-plan-cn-xi')}
              </p>
            </div>
          )}

          <div>
            <label htmlFor="ai-base-url" className="mb-1.5 block text-label font-medium text-foreground">
              {t('aIConfigPanel.api-endpoint')} *
            </label>
            <Input
              id="ai-base-url"
              type="url"
              value={form.baseUrl}
              onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
              placeholder={getEndpointPlaceholder(form.apiType, form.mimoPlan)}
            />
            <p className="mt-1.5 text-label-sm text-secondary">
              {getEndpointHelpText(form.apiType, t)}
            </p>
            {form.baseUrl && (
              <p className="mt-1 text-label-sm text-tertiary">
                {t('aIConfigPanel.final-request-url')}
                <span className="font-mono break-all text-secondary">
                  {buildFinalApiUrl(form.baseUrl, form.apiType)}
                </span>
              </p>
            )}
          </div>

          <div>
            <label htmlFor="ai-api-key" className="mb-1.5 block text-label font-medium text-foreground">
              {t('aIConfigPanel.api-key')} *
            </label>
            <Input
              id="ai-api-key"
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm((prev) => ({ ...prev, apiKey: e.target.value }))}
              placeholder={t('aIConfigPanel.enter-api-key')}
            />
          </div>

          <div>
            <label htmlFor="ai-model-name" className="mb-1.5 block text-label font-medium text-foreground">
              {t('aIConfigPanel.model-name')} *
            </label>
            <Input
              id="ai-model-name"
              type="text"
              value={form.model}
              onChange={(e) => setForm((prev) => ({ ...prev, model: e.target.value }))}
              placeholder="gpt-4"
            />
          </div>

          <div>
            <label id="ai-concurrency-label" className="mb-1.5 block text-label font-medium text-foreground">
              {t('aIConfigPanel.concurrency')}
            </label>
            <SliderInput
              value={form.concurrency}
              label={t('aIConfigPanel.concurrency')}
              onChange={(v) => setForm((prev) => ({ ...prev, concurrency: v }))}
              min={1}
              max={10}
              showMarks={false}
            />
            <p className="mt-1.5 text-label-sm text-secondary">
              {t('aIConfigPanel.number-of-repositories-to-analyze-simultaneously')}
            </p>
          </div>

          <div>
            <label id="ai-reasoning-effort-label" className="mb-1.5 block text-label font-medium text-foreground">
              {t('aIConfigPanel.reasoning-effort')}
            </label>
            <Select value={form.reasoningEffort || 'default'} onValueChange={(value) => setForm((prev) => ({ ...prev, reasoningEffort: value === 'default' ? '' : value as AIReasoningEffort }))}>
              <SelectTrigger aria-labelledby="ai-reasoning-effort-label" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="default">{t('aIConfigPanel.default-do-not-send')}</SelectItem>
                <SelectItem value="none">{t('aIConfigPanel.none-no-reasoning')}</SelectItem>
                <SelectItem value="low">{t('aIConfigPanel.low-quick-response')}</SelectItem>
                <SelectItem value="medium">{t('aIConfigPanel.medium-balanced')}</SelectItem>
                <SelectItem value="high">{t('aIConfigPanel.high-deep-reasoning')}</SelectItem>
                <SelectItem value="xhigh">{t('aIConfigPanel.xhigh-deepest-reasoning')}</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-1.5 text-label-sm text-secondary">
              {t('aIConfigPanel.only-applies-to-openai-compatible-apis-leave-emp')}
            </p>
          </div>

          {isToolCallCapable(form.apiType) && (
            <div className="md:col-span-2">
              <label htmlFor="ai-config-supports-tool-calls" className="flex cursor-pointer items-start gap-2.5 text-label text-foreground">
                <Checkbox id="ai-config-supports-tool-calls" checked={form.supportsToolCalls} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, supportsToolCalls: checked === true }))} className="mt-0.5" />
                <span>
                  <span className="font-medium">{t('aIConfigPanel.supports-tool-calling-function-calling')}</span>
                  <span className="mt-0.5 block text-label-sm text-secondary">
                    {t('aIConfigPanel.lets-repository-chat-use-the-experimental-tool-l')}
                  </span>
                </span>
              </label>
            </div>
          )}
        </div>

        <div className="mt-5 space-y-3 border-t border-subtle pt-4">
          {notification && (
            <SettingsNotice
              role={notification.type === 'error' ? 'alert' : 'status'}
              tone={notification.type === 'success' ? 'success' : notification.type === 'error' ? 'destructive' : 'neutral'}
              icon={notification.type === 'error' ? <AlertCircle /> : undefined}
            >
              {notification.message}
            </SettingsNotice>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="ai-use-custom-prompt"
                  aria-labelledby="ai-use-custom-prompt-label"
                  checked={form.useCustomPrompt}
                  onCheckedChange={(checked) => handleUseCustomPromptChange(checked === true)}
                />
                <span
                  id="ai-use-custom-prompt-label"
                  className="cursor-pointer text-label font-medium text-foreground"
                  onClick={() => handleUseCustomPromptChange(!form.useCustomPrompt)}
                >
                  {t('aIConfigPanel.use-custom-prompt')}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleToggleDefaultPrompt}
                disabled={showCustomPrompt}
                className="text-secondary"
              >
                {showDefaultPrompt ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                <span>{showDefaultPrompt ? t('aIConfigPanel.hide-default-prompt') : t('aIConfigPanel.view-default-prompt')}</span>
              </Button>
            </div>
            {form.useCustomPrompt && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleRestoreDefaultPrompt}
                className="text-secondary"
              >
                {t('aIConfigPanel.restore-default-prompt-2')}
              </Button>
            )}
          </div>

          {showDefaultPrompt && !showCustomPrompt && (
            <div>
              <label className="mb-1.5 block text-label-sm font-medium text-tertiary">
                {t('aIConfigPanel.default-prompt-read-only')}
              </label>
              <pre className="max-h-64 w-full overflow-auto whitespace-pre-wrap rounded-md bg-sunken px-3 py-2.5 font-mono text-mono-ui text-secondary shadow-elev-0">
                {defaultPrompt}
              </pre>
            </div>
          )}

          {showCustomPrompt && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="ai-custom-prompt" className="block text-label-sm font-medium text-secondary">
                  {t('aIConfigPanel.custom-prompt')}
                  {isCustomPromptModified && (
                    <span className="ml-1.5 text-tertiary">
                      ({t('aIConfigPanel.modified')})
                    </span>
                  )}
                  {isCustomPromptSameAsDefault && (
                    <span className="ml-1.5 text-tertiary">
                      ({t('aIConfigPanel.default')})
                    </span>
                  )}
                </label>
                <span className="text-label-sm text-tertiary tabular-nums">
                  {form.customPrompt.length} {t('aIConfigPanel.characters')}
                </span>
              </div>
              <Textarea
                id="ai-custom-prompt"
                value={form.customPrompt}
                onChange={(e) => setForm((prev) => ({ ...prev, customPrompt: e.target.value }))}
                rows={10}
                className="font-mono text-mono-ui"
                placeholder={t('aIConfigPanel.enter-custom-prompt-here')}
              />
            </div>
          )}
        </div>
      </Modal>

      <SettingsSection
        title={t('aIConfigPanel.active-ai-configuration')}
        titleId="active-ai-config-heading"
        actions={(
          <div className="flex items-center gap-2">
            {showForm && (
              <Button type="button" variant="outline" size="sm" onClick={resetForm}>
                <X className="size-3.5" />
                <span>{t('aIConfigPanel.cancel')}</span>
              </Button>
            )}
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={(event) => {
                openerRef.current = event.currentTarget;
                resetForm();
                setShowForm(true);
              }}
            >
              <Plus className="size-3.5" />
              <span>{t('aIConfigPanel.add-ai-config')}</span>
            </Button>
          </div>
        )}
      >
        {aiConfigs.length === 0 ? (
          <SettingsCard className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
            <Bot className="size-10 text-tertiary stroke-[1.5]" aria-hidden="true" />
            <p className="text-label font-medium text-foreground">
              {t('aIConfigPanel.no-ai-services-configured-yet')}
            </p>
            <p className="max-w-sm text-label-sm text-secondary">
              {t('aIConfigPanel.click-the-button-above-to-add-ai-configuration')}
            </p>
          </SettingsCard>
        ) : (
          <SettingsCard>
            <RadioGroup
              aria-labelledby="active-ai-config-heading"
              value={activeAIConfig || ''}
              onValueChange={setActiveAIConfig}
              className="gap-0"
            >
              {aiConfigs.map((config, index) => {
                const isSelected = config.id === activeAIConfig;
                return (
                  <React.Fragment key={config.id}>
                    {index > 0 && <SettingsDivider />}
                    <div
                      className={cn(
                        'flex min-h-14 items-center justify-between gap-4 px-3.5 py-2.5 transition-[background-color] duration-micro ease-out-subtle hover:bg-fill-hover hover:duration-instant',
                        isSelected && 'bg-fill-selected/50',
                      )}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <RadioGroupItem
                          value={config.id}
                          id={`active-ai-${config.id}`}
                          aria-label={config.name || t('aIConfigPanel.ai-configuration')}
                        />
                        <div className="min-w-0 flex-1">
                          <h4 className="flex flex-wrap items-center gap-2 text-label font-medium text-foreground">
                            <span className="truncate">{config.name}</span>
                            {config.useCustomPrompt && (
                              <span className="inline-flex items-center gap-1 rounded-xs bg-fill-hover px-1.5 py-0.5 text-caption text-secondary">
                                <MessageSquare className="size-3" />
                                {t('aIConfigPanel.custom-prompt')}
                              </span>
                            )}
                          </h4>
                          <p className="mt-px truncate text-label-sm text-secondary">
                            {(config.apiType || 'openai').toUpperCase()} • {config.baseUrl} • {config.model} • {t('aIConfigPanel.concurrency')}: {config.concurrency || 1}
                            {config.reasoningEffort ? ` • reasoning: ${config.reasoningEffort}` : ''}
                          </p>
                          {(config.apiKeyStatus === 'decrypt_failed' || config.apiKeyStatus === 'empty') && (
                            <p className="mt-1 text-label-sm text-warning">
                              {t('aIConfigPanel.the-stored-api-key-could-not-be-decrypted-or-is')}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleTest(config)}
                          disabled={testingId === config.id}
                          title={t('aIConfigPanel.test-connection')}
                          aria-label={t('aIConfigPanel.test-connection')}
                        >
                          {testingId === config.id ? (
                            <RefreshCw className="size-4 animate-spin text-secondary" />
                          ) : (
                            <Plug className="size-4 text-secondary" />
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={(event) => handleEdit(config, event.currentTarget)}
                          title={t('aIConfigPanel.edit')}
                          aria-label={t('aIConfigPanel.edit')}
                        >
                          <Edit3 className="size-4 text-secondary" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={async () => {
                            const confirmed = await confirm(
                              t('aIConfigPanel.delete-ai-configuration'),
                              t('aIConfigPanel.this-action-cannot-be-undone'),
                              { type: 'danger', confirmText: t('aIConfigPanel.delete') },
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
                          title={t('aIConfigPanel.delete')}
                          aria-label={t('aIConfigPanel.delete')}
                          className="text-destructive hover:bg-destructive-tint hover:text-destructive"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
            </RadioGroup>
          </SettingsCard>
        )}
      </SettingsSection>

      <SettingsSection
        title={t('aIConfigPanel.repository-chat')}
        titleId="repository-chat-settings-heading"
        description={t('aIConfigPanel.reads-pinned-source-on-demand-and-keeps-local-co')}
      >
        <SettingsCard>
          <SettingsRow
            icon={<MessageSquare />}
            title={t('aIConfigPanel.enable-repository-chat')}
          >
            <Checkbox
              id="repository-chat-enabled"
              aria-label={t('aIConfigPanel.enable-repository-chat')}
              checked={repositoryChatSettings.enabled}
              onCheckedChange={(checked) => setRepositoryChatSettings({ enabled: checked === true })}
            />
          </SettingsRow>
          <SettingsDivider />
          <div className="grid gap-4 px-3.5 py-3.5 md:grid-cols-2">
            <div>
              <label id="repository-chat-model-label" className="mb-1.5 block text-label font-medium text-foreground">
                {t('aIConfigPanel.chat-model')}
              </label>
              <Select value={repositoryChatSettings.chatConfigId ?? '__active__'} onValueChange={(value) => setRepositoryChatSettings({ chatConfigId: value === '__active__' ? null : value })}>
                <SelectTrigger aria-labelledby="repository-chat-model-label" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__active__">{t('aIConfigPanel.use-active-ai-configuration')}</SelectItem>
                  {aiConfigs.map((config) => <SelectItem key={config.id} value={config.id}>{config.name} · {config.model}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="mt-1.5 text-label-sm text-secondary">{t('aIConfigPanel.only-the-configuration-id-is-saved-no-api-key-ba')}</p>
            </div>
            <div>
              <label htmlFor="repository-chat-retention-days" className="mb-1.5 block text-label font-medium text-foreground">
                {t('aIConfigPanel.retain-local-conversations-days')}
              </label>
              <Input
                id="repository-chat-retention-days"
                type="number"
                min={1}
                max={365}
                value={repositoryChatSettings.retainSessionDays}
                onChange={(event) => {
                  const parsed = Number(event.target.value);
                  setRepositoryChatSettings({ retainSessionDays: Number.isFinite(parsed) ? Math.min(365, Math.max(1, parsed)) : 90 });
                }}
              />
              <p className="mt-1.5 text-label-sm text-secondary">{t('aIConfigPanel.deleting-an-individual-conversation-always-takes')}</p>
            </div>
            <div>
              <label id="repository-chat-task-depth-label" className="mb-1.5 block text-label font-medium text-foreground">
                {tChat('repositoryChatSheet.task-depth')}
              </label>
              <Select value={repositoryChatSettings.taskDepth} onValueChange={(value) => setRepositoryChatSettings({ taskDepth: value as RepositoryChatTaskDepth })}>
                <SelectTrigger aria-labelledby="repository-chat-task-depth-label" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="quick">{tChat('repositoryChatSheet.depth-quick')}</SelectItem>
                  <SelectItem value="default">{tChat('repositoryChatSheet.depth-default')}</SelectItem>
                  <SelectItem value="deep">{tChat('repositoryChatSheet.depth-deep')}</SelectItem>
                  <SelectItem value="unlimited">{tChat('repositoryChatSheet.depth-unlimited')}</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1.5 text-label-sm text-secondary">{tChat('repositoryChatSheet.task-depth-controls-retrieval-rounds-and-read-sc')}</p>
            </div>
          </div>
          <SettingsDivider />
          <details className="px-3.5 py-3">
            <summary className="cursor-pointer text-label font-medium text-foreground">
              {t('aIConfigPanel.advanced-settings')}
              <span className="ml-2 text-label-sm font-normal text-secondary">
                {t('aIConfigPanel.used-by-the-chat-window-when-task-depth-is-defau')}
              </span>
            </summary>
            <div className="mt-3.5 grid gap-4 md:grid-cols-2">
              <label htmlFor="repository-chat-web-tools" className="flex cursor-pointer items-start gap-2.5 text-label text-foreground">
                <Checkbox id="repository-chat-web-tools" checked={repositoryChatSettings.enableWebTools} onCheckedChange={(checked) => setRepositoryChatSettings({ enableWebTools: checked === true })} className="mt-0.5" />
                <span>
                  <span className="font-medium">{t('aIConfigPanel.external-web-search-and-fetch')}</span>
                  <span className="mt-0.5 block text-label-sm text-secondary">{t('aIConfigPanel.disabled-by-default-the-current-version-does-not')}</span>
                </span>
              </label>
              <label htmlFor="repository-chat-agent-loop" className="flex cursor-pointer items-start gap-2.5 text-label text-foreground">
                <Checkbox id="repository-chat-agent-loop" checked={repositoryChatSettings.enableAgentToolLoop} onCheckedChange={(checked) => setRepositoryChatSettings({ enableAgentToolLoop: checked === true })} className="mt-0.5" />
                <span>
                  <span className="font-medium">{t('aIConfigPanel.tool-loop-mode-experimental')}</span>
                  <span className="mt-0.5 block text-label-sm text-secondary">{t('aIConfigPanel.evidence-gathering-is-driven-by-native-function')}</span>
                </span>
              </label>
              <label htmlFor="repository-chat-fast-path" className="flex cursor-pointer items-start gap-2.5 text-label text-foreground">
                <Checkbox id="repository-chat-fast-path" checked={repositoryChatSettings.fastPath} onCheckedChange={(checked) => setRepositoryChatSettings({ fastPath: checked === true })} className="mt-0.5" />
                <span>
                  <span className="font-medium">{t('aIConfigPanel.readme-fast-path')}</span>
                  <span className="mt-0.5 block text-label-sm text-secondary">{t('aIConfigPanel.for-simple-usage-overview-or-deployment-questions-ans')}</span>
                </span>
              </label>
              <div>
                <label id="repository-chat-streaming-label" className="mb-1.5 block text-label font-medium text-foreground">{t('aIConfigPanel.streaming-answers')}</label>
                <Select value={repositoryChatSettings.streamingMode} onValueChange={(value) => setRepositoryChatSettings({ streamingMode: value === 'off' ? 'off' : 'auto' })}>
                  <SelectTrigger aria-labelledby="repository-chat-streaming-label" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{t('aIConfigPanel.auto-falls-back-to-full-response-when-unsupporte')}</SelectItem>
                    <SelectItem value="off">{t('aIConfigPanel.off')}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="mt-1.5 text-label-sm text-secondary">{t('aIConfigPanel.applies-to-the-final-answer-only-retrieval-still')}</p>
              </div>
              <div>
                <label htmlFor="repository-chat-tool-limit" className="mb-1.5 block text-label font-medium text-foreground">{t('aIConfigPanel.maximum-tool-calls-per-turn')}</label>
                <Input
                  id="repository-chat-tool-limit"
                  type="number"
                  min={1}
                  max={48}
                  value={repositoryChatSettings.agentBudget.maxToolCalls}
                  onChange={(event) => {
                    const parsed = Number(event.target.value);
                    const maxToolCalls = Number.isFinite(parsed) ? Math.min(48, Math.max(1, Math.trunc(parsed))) : 20;
                    setRepositoryChatSettings({ maxToolsPerTurn: maxToolCalls, agentBudget: { ...repositoryChatSettings.agentBudget, maxToolCalls } });
                  }}
                />
                <p className="mt-1.5 text-label-sm text-secondary">{t('aIConfigPanel.limits-all-read-only-tool-calls-to-prevent-unbou')}</p>
              </div>
              <div>
                <label htmlFor="repository-chat-turn-limit" className="mb-1.5 block text-label font-medium text-foreground">{t('aIConfigPanel.maximum-evidence-rounds')}</label>
                <Input
                  id="repository-chat-turn-limit"
                  type="number"
                  min={1}
                  max={8}
                  value={repositoryChatSettings.agentBudget.maxTurns}
                  onChange={(event) => {
                    const parsed = Number(event.target.value);
                    const maxTurns = Number.isFinite(parsed) ? Math.min(8, Math.max(1, Math.trunc(parsed))) : 4;
                    setRepositoryChatSettings({ agentBudget: { ...repositoryChatSettings.agentBudget, maxTurns } });
                  }}
                />
              </div>
              <div>
                <label htmlFor="repository-chat-no-progress-limit" className="mb-1.5 block text-label font-medium text-foreground">{t('aIConfigPanel.maximum-consecutive-no-progress-rounds')}</label>
                <Input
                  id="repository-chat-no-progress-limit"
                  type="number"
                  min={1}
                  max={4}
                  value={repositoryChatSettings.agentBudget.maxNoProgressRounds}
                  onChange={(event) => {
                    const parsed = Number(event.target.value);
                    const maxNoProgressRounds = Number.isFinite(parsed) ? Math.min(4, Math.max(1, Math.trunc(parsed))) : 2;
                    setRepositoryChatSettings({ agentBudget: { ...repositoryChatSettings.agentBudget, maxNoProgressRounds } });
                  }}
                />
                <p className="mt-1.5 text-label-sm text-secondary">{t('aIConfigPanel.stops-repeated-retrieval-after-consecutive-round')}</p>
              </div>
              <div>
                <label htmlFor="repository-chat-read-limit" className="mb-1.5 block text-label font-medium text-foreground">{t('aIConfigPanel.maximum-files-read')}</label>
                <Input
                  id="repository-chat-read-limit"
                  type="number"
                  min={1}
                  max={16}
                  value={repositoryChatSettings.agentBudget.maxReadFiles}
                  onChange={(event) => {
                    const parsed = Number(event.target.value);
                    const maxReadFiles = Number.isFinite(parsed) ? Math.min(16, Math.max(1, Math.trunc(parsed))) : 6;
                    setRepositoryChatSettings({ agentBudget: { ...repositoryChatSettings.agentBudget, maxReadFiles, maxCodeReads: Math.min(repositoryChatSettings.agentBudget.maxCodeReads, maxReadFiles) } });
                  }}
                />
              </div>
              <div>
                <label htmlFor="repository-chat-code-read-limit" className="mb-1.5 block text-label font-medium text-foreground">{t('aIConfigPanel.maximum-code-files-read')}</label>
                <Input
                  id="repository-chat-code-read-limit"
                  type="number"
                  min={0}
                  max={12}
                  value={repositoryChatSettings.agentBudget.maxCodeReads}
                  onChange={(event) => {
                    const parsed = Number(event.target.value);
                    const maxCodeReads = Number.isFinite(parsed) ? Math.min(repositoryChatSettings.agentBudget.maxReadFiles, Math.min(12, Math.max(0, Math.trunc(parsed)))) : 3;
                    setRepositoryChatSettings({ agentBudget: { ...repositoryChatSettings.agentBudget, maxCodeReads } });
                  }}
                />
                <p className="mt-1.5 text-label-sm text-secondary">{t('aIConfigPanel.code-is-read-only-when-documentation-evidence-is')}</p>
              </div>
              <div>
                <label htmlFor="repository-chat-duration-limit" className="mb-1.5 block text-label font-medium text-foreground">{t('aIConfigPanel.maximum-execution-time-seconds')}</label>
                <Input
                  id="repository-chat-duration-limit"
                  type="number"
                  min={15}
                  max={300}
                  value={Math.round(repositoryChatSettings.agentBudget.maxDurationMs / 1000)}
                  onChange={(event) => {
                    const parsed = Number(event.target.value);
                    const maxDurationMs = (Number.isFinite(parsed) ? Math.min(300, Math.max(15, Math.trunc(parsed))) : 90) * 1000;
                    setRepositoryChatSettings({ agentBudget: { ...repositoryChatSettings.agentBudget, maxDurationMs } });
                  }}
                />
              </div>
            </div>
          </details>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('aIConfigPanel.translation-engine')}>
        <SettingsCard>
          <div className="px-3.5 py-3">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label id="translation-engine-label" className="mb-1.5 flex items-center gap-2 text-label font-medium text-foreground">
                  <Languages className="size-4 text-tertiary" aria-hidden="true" />
                  <span>{t('aIConfigPanel.engine-used-for-readme-document-translation')}</span>
                </label>
                <Select value={translationEngine} onValueChange={(value) => setTranslationEngine(value as TranslationEngine)}>
                  <SelectTrigger aria-labelledby="translation-engine-label" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="microsoft">{t('aIConfigPanel.microsoft-translate-free')}</SelectItem>
                    <SelectItem value="google">{t('aIConfigPanel.google-translate-free')}</SelectItem>
                    <SelectItem value="ai">{t('aIConfigPanel.ai-translation-uses-the-active-ai-configuration')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="self-end pb-1 text-label-sm text-secondary">
                {translationEngine === 'ai'
                  ? t('aIConfigPanel.ai-translation-usually-has-higher-quality-but-is')
                  : translationEngine === 'google'
                    ? t('aIConfigPanel.free-google-endpoint-no-configuration-needed-may')
                    : t('aIConfigPanel.free-microsoft-edge-endpoint-no-configuration-ne')}
              </p>
            </div>
          </div>
          <SettingsDivider />
          <SettingsRow
            title={(
              <label htmlFor="auto-translate-repo-descriptions" className="cursor-pointer">
                {t('aIConfigPanel.auto-translate-repo-descriptions')}
              </label>
            )}
            description={t('aIConfigPanel.when-enabled-card-repository-description')}
          >
            <Checkbox
              id="auto-translate-repo-descriptions"
              checked={autoTranslateRepoDescription}
              onCheckedChange={(checked) => setAutoTranslateRepoDescription(checked === true)}
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </SettingsPageStack>
  );
};
