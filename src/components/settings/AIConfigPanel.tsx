import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Bot, Plus, Edit3, Trash2, Save, X, TestTube, RefreshCw, MessageSquare, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { AIConfig, AIApiType, AIReasoningEffort } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { AIService } from '../../services/aiService';
import { buildFinalApiUrl } from '../../utils/apiUrlBuilder';
import { SliderInput } from '../ui/SliderInput';

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
};

export const AIConfigPanel: React.FC<AIConfigPanelProps> = ({ t }) => {
  const {
    aiConfigs,
    activeAIConfig,
    language,
    addAIConfig,
    updateAIConfig,
    deleteAIConfig,
    setActiveAIConfig,
  } = useAppStore();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testingForm, setTestingForm] = useState(false);
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
    baseUrl: '',
    apiKey: '',
    model: '',
    customPrompt: '',
    useCustomPrompt: false,
    concurrency: 1,
    reasoningEffort: '',
  });

  const resetForm = () => {
    setForm({
      name: '',
      apiType: 'openai',
      baseUrl: '',
      apiKey: '',
      model: '',
      customPrompt: '',
      useCustomPrompt: false,
      concurrency: 1,
      reasoningEffort: '',
    });
    setShowForm(false);
    setEditingId(null);
    setShowCustomPrompt(false);
    setShowDefaultPrompt(false);
  };

  const handleSave = () => {
    if (!form.name || !form.baseUrl || !form.apiKey || !form.model) {
      alert(t('请填写所有必填字段', 'Please fill in all required fields'));
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
      };
      addAIConfig(config);
    }

    resetForm();
  };

  const handleEdit = (config: AIConfig) => {
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
    });
    setEditingId(config.id);
    setShowForm(true);
    setShowCustomPrompt(config.useCustomPrompt || false);
  };

  const handleTest = async (config: AIConfig) => {
    setTestingId(config.id);
    try {
      const aiService = new AIService(config, language);
      const isConnected = await aiService.testConnection();
      
      if (isConnected) {
        alert(t('AI服务连接成功！', 'AI service connection successful!'));
      } else {
        alert(t('AI服务连接失败，请检查配置。', 'AI service connection failed. Please check configuration.'));
      }
    } catch (error) {
      console.error('AI test failed:', error);
      alert(t('AI服务测试失败，请检查网络连接和配置。', 'AI service test failed. Please check network connection and configuration.'));
    } finally {
      setTestingId(null);
    }
  };

  const handleTestForm = async () => {
    if (!form.baseUrl || !form.apiKey || !form.model) {
      alert(t('请先填写API端点、API密钥和模型名称', 'Please fill in API Endpoint, API Key and Model Name first'));
      return;
    }

    setTestingForm(true);
    try {
      const tempConfig: AIConfig = {
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
      };

      const aiService = new AIService(tempConfig, language);
      const isConnected = await aiService.testConnection();
      
      if (isConnected) {
        alert(t('AI服务连接成功！', 'AI service connection successful!'));
      } else {
        alert(t('AI服务连接失败，请检查配置。', 'AI service connection failed. Please check configuration.'));
      }
    } catch (error) {
      console.error('AI test failed:', error);
      alert(t('AI服务测试失败，请检查网络连接和配置。', 'AI service test failed. Please check network connection and configuration.'));
    } finally {
      setTestingForm(false);
    }
  };

  const defaultPrompt = useMemo(() => {
    if (language === 'zh') {
      return `请分析这个GitHub仓库并提供：

1. 一个简洁的中文概述（不超过50字），说明这个仓库的主要功能和用途
2. 3-5个相关的应用类型标签（用中文，类似应用商店的分类，如：开发工具、Web应用、移动应用、数据库、AI工具等）
3. 支持的平台类型（从以下选择：mac、windows、linux、ios、android、docker、web、cli）

重要：请严格使用中文进行分析和回复，无论原始README是什么语言。

请以JSON格式回复：
{
  "summary": "你的中文概述",
  "tags": ["标签1", "标签2", "标签3", "标签4", "标签5"],
  "platforms": ["platform1", "platform2", "platform3"]
}

仓库信息：
{REPO_INFO}

重点关注实用性和准确的分类，帮助用户快速理解仓库的用途和支持的平台。`;
    } else {
      return `Please analyze this GitHub repository and provide:

1. A concise English overview (no more than 50 words) explaining the main functionality and purpose of this repository
2. 3-5 relevant application type tags (in English, similar to app store categories, such as: development tools, web apps, mobile apps, database, AI tools, etc.)
3. Supported platform types (choose from: mac, windows, linux, ios, android, docker, web, cli)

Important: Please strictly use English for analysis and response, regardless of the original README language.

Please reply in JSON format:
{
  "summary": "Your English overview",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "platforms": ["platform1", "platform2", "platform3"]
}

Repository information:
{REPO_INFO}

Focus on practicality and accurate categorization to help users quickly understand the repository's purpose and supported platforms.`;
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

  const handleRestoreDefaultPrompt = useCallback(() => {
    if (isCustomPromptSameAsDefault) {
      showNotification('info', t('当前提示词已是默认值', 'Current prompt is already the default'));
      return;
    }
    
    if (isCustomPromptModified) {
      const confirmed = window.confirm(
        t(
          '确定要恢复默认提示词吗？这将覆盖您当前的修改。',
          'Are you sure you want to restore the default prompt? This will overwrite your current changes.'
        )
      );
      if (!confirmed) return;
    }
    
    setForm(prev => ({ ...prev, customPrompt: defaultPrompt }));
    showNotification('success', t('已恢复默认提示词', 'Default prompt restored'));
  }, [defaultPrompt, isCustomPromptModified, isCustomPromptSameAsDefault, showNotification, t]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Bot className="w-6 h-6 text-gray-700 dark:text-text-secondary " />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-text-primary">
            {t('AI服务配置', 'AI Service Configuration')}
          </h3>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-brand-indigo text-white dark:bg-brand-indigo dark:text-white rounded-lg hover:bg-brand-hover transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>{t('添加AI配置', 'Add AI Config')}</span>
        </button>
      </div>

      {showForm && (
        <div className="p-4 bg-light-bg dark:bg-white/[0.04] rounded-lg border border-black/[0.06] dark:border-white/[0.04]">
          <h4 className="font-medium text-gray-900 dark:text-text-primary mb-4">
            {editingId ? t('编辑AI配置', 'Edit AI Configuration') : t('添加AI配置', 'Add AI Configuration')}
          </h4>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-900 dark:text-text-secondary mb-1">
                {t('配置名称', 'Configuration Name')} *
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 border border-black/[0.06] dark:border-white/[0.04] rounded-lg bg-white dark:bg-panel-dark text-gray-900 dark:text-text-primary"
                placeholder={t('例如: OpenAI GPT-4', 'e.g., OpenAI GPT-4')}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-900 dark:text-text-secondary mb-1">
                {t('接口格式', 'API Format')} *
              </label>
              <select
                value={form.apiType}
                onChange={(e) => setForm(prev => ({ ...prev, apiType: e.target.value as AIApiType }))}
                className="w-full px-3 py-2 border border-black/[0.06] dark:border-white/[0.04] rounded-lg bg-white dark:bg-panel-dark text-gray-900 dark:text-text-primary"
              >
                <option value="openai">OpenAI (Chat Completions)</option>
                <option value="openai-responses">OpenAI (Responses)</option>
                <option value="claude">Claude</option>
                <option value="gemini">Gemini</option>
                <option value="openai-compatible">OpenAI Compatible (Custom Endpoint)</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-900 dark:text-text-secondary mb-1">
                {t('API端点', 'API Endpoint')} *
              </label>
              <input
                type="url"
                value={form.baseUrl}
                onChange={(e) => setForm(prev => ({ ...prev, baseUrl: e.target.value }))}
                className="w-full px-3 py-2 border border-black/[0.06] dark:border-white/[0.04] rounded-lg bg-white dark:bg-panel-dark text-gray-900 dark:text-text-primary"
                placeholder={
                  form.apiType === 'openai' || form.apiType === 'openai-responses'
                    ? 'https://api.openai.com/v1'
                    : form.apiType === 'claude'
                      ? 'https://api.anthropic.com/v1'
                      : form.apiType === 'openai-compatible'
                        ? 'https://integrate.api.nvidia.com/v1/chat/completions'
                        : 'https://generativelanguage.googleapis.com/v1beta'
                }
              />
              <p className="text-xs text-gray-500 dark:text-text-tertiary mt-1">
                {form.apiType === 'openai-compatible'
                  ? t(
                      '填写完整的API调用地址，包含完整路径',
                      'Enter the full API endpoint URL including the complete path'
                    )
                  : t(
                      '只填到版本号即可（如 .../v1 或 .../v1beta），不要包含 /chat/completions、/responses、/messages 或 :generateContent',
                      'Only include the version prefix (e.g. .../v1 or .../v1beta). Do not include /chat/completions, /responses, /messages, or :generateContent.'
                    )}
              </p>
              {form.baseUrl && (
                <p className="text-xs text-brand-violet dark:text-brand-violet mt-1">
                  {t('最终请求地址: ', 'Final request URL: ')}
                  <span className="font-mono break-all">
                    {buildFinalApiUrl(form.baseUrl, form.apiType)}
                  </span>
                </p>
              )}
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-900 dark:text-text-secondary mb-1">
                {t('API密钥', 'API Key')} *
              </label>
              <input
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm(prev => ({ ...prev, apiKey: e.target.value }))}
                className="w-full px-3 py-2 border border-black/[0.06] dark:border-white/[0.04] rounded-lg bg-white dark:bg-panel-dark text-gray-900 dark:text-text-primary"
                placeholder={t('输入API密钥', 'Enter API key')}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-900 dark:text-text-secondary mb-1">
                {t('模型名称', 'Model Name')} *
              </label>
              <input
                type="text"
                value={form.model}
                onChange={(e) => setForm(prev => ({ ...prev, model: e.target.value }))}
                className="w-full px-3 py-2 border border-black/[0.06] dark:border-white/[0.04] rounded-lg bg-white dark:bg-panel-dark text-gray-900 dark:text-text-primary"
                placeholder="gpt-4"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-900 dark:text-text-secondary mb-1">
                {t('并发数', 'Concurrency')}
              </label>
              <SliderInput
                value={form.concurrency}
                onChange={(v) => setForm(prev => ({ ...prev, concurrency: v }))}
                min={1}
                max={10}
                marks={[1, 3, 5, 7, 10]}
              />
              <p className="text-xs text-gray-500 dark:text-text-tertiary mt-1">
                {t('同时进行AI分析的仓库数量 (1-10)', 'Number of repositories to analyze simultaneously (1-10)')}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-900 dark:text-text-secondary mb-1">
                {t('推理强度', 'Reasoning Effort')}
              </label>
              <select
                value={form.reasoningEffort}
                onChange={(e) => setForm(prev => ({ ...prev, reasoningEffort: e.target.value as '' | AIReasoningEffort }))}
                className="w-full px-3 py-2 border border-black/[0.06] dark:border-white/[0.04] rounded-lg bg-white dark:bg-panel-dark text-gray-900 dark:text-text-primary"
              >
                <option value="">{t('默认 / 不传', 'Default / Do not send')}</option>
                <option value="none">{t('none — 不推理', 'none — No reasoning')}</option>
                <option value="low">{t('low — 快速响应', 'low — Quick response')}</option>
                <option value="medium">{t('medium — 均衡模式', 'medium — Balanced')}</option>
                <option value="high">{t('high — 深度推理', 'high — Deep reasoning')}</option>
                <option value="xhigh">{t('xhigh — 最深推理', 'xhigh — Deepest reasoning')}</option>
              </select>
              <p className="text-xs text-gray-500 dark:text-text-tertiary mt-1">
                {t(
                  '仅对 OpenAI 兼容接口生效。留空时保持旧模式兼容，不额外传 reasoning。',
                  'Only applies to OpenAI-compatible APIs. Leave empty to preserve legacy behavior and omit reasoning.'
                )}
              </p>
            </div>
          </div>

          <div className="mb-4">
            {notification && (
              <div 
                className={`mb-3 p-3 rounded-lg flex items-center space-x-2 ${
                  notification.type === 'success' 
                    ? 'bg-status-emerald text-status-emerald ' 
                    : notification.type === 'error'
                      ? 'bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary'
                      : 'bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary'
                }`}
              >
                {notification.type === 'error' && <AlertCircle className="w-4 h-4" />}
                <span className="text-sm">{notification.message}</span>
              </div>
            )}
            
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-4">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.useCustomPrompt}
                    onChange={(e) => handleUseCustomPromptChange(e.target.checked)}
                    className="w-4 h-4 text-brand-violet bg-light-surfaceborder-black/[0.06] rounded focus:ring-brand-violet dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-white/[0.04] dark:border-white/[0.04]"
                  />
                  <span className="text-sm font-medium text-gray-900 dark:text-text-secondary">
                    {t('使用自定义提示词', 'Use Custom Prompt')}
                  </span>
                </label>
                <button
                  type="button"
                  onClick={handleToggleDefaultPrompt}
                  disabled={showCustomPrompt}
                  className={`flex items-center space-x-1 text-sm ${
                    showCustomPrompt 
                      ? 'text-gray-400 dark:text-text-tertiarycursor-not-allowed' 
                      : 'text-gray-700hover:text-gray-900 dark:text-text-tertiary dark:hover:text-gray-300'
                  }`}
                >
                  {showDefaultPrompt ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  <span>{showDefaultPrompt ? t('隐藏默认提示词', 'Hide Default Prompt') : t('查看默认提示词', 'View Default Prompt')}</span>
                </button>
              </div>
              {form.useCustomPrompt && (
                <button
                  type="button"
                  onClick={handleRestoreDefaultPrompt}
                  className="text-sm text-brand-violet hover:text-gray-700 dark:text-text-secondary dark:text-brand-violet dark:hover:text-gray-700 dark:text-text-secondary"
                >
                  {t('恢复默认提示词', 'Restore Default Prompt')}
                </button>
              )}
            </div>
            
            {showDefaultPrompt && !showCustomPrompt && (
              <div className="mb-3">
                <label className="block text-xs font-medium text-gray-500 dark:text-text-tertiary mb-1">
                  {t('默认提示词（只读）', 'Default Prompt (Read-only)')}
                </label>
                <pre className="w-full px-3 py-2 border border-black/[0.06] dark:border-white/[0.04] rounded-lg bg-light-bg dark:bg-panel-dark text-gray-900 dark:text-text-secondary font-mono text-xs whitespace-pre-wrap overflow-auto max-h-64">
                  {defaultPrompt}
                </pre>
              </div>
            )}
            
            {showCustomPrompt && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-gray-500 dark:text-text-tertiary">
                    {t('自定义提示词', 'Custom Prompt')}
                    {isCustomPromptModified && (
                      <span className="ml-2 text-gray-700 dark:text-text-secondary ">
                        ({t('已修改', 'Modified')})
                      </span>
                    )}
                    {isCustomPromptSameAsDefault && (
                      <span className="ml-2 text-status-emerald ">
                        ({t('默认值', 'Default')})
                      </span>
                    )}
                  </label>
                  <span className="text-xs text-gray-400 dark:text-text-quaternary">
                    {form.customPrompt.length} {t('字符', 'characters')}
                  </span>
                </div>
                <textarea
                  value={form.customPrompt}
                  onChange={(e) => setForm(prev => ({ ...prev, customPrompt: e.target.value }))}
                  rows={10}
                  className="w-full px-3 py-2 border border-black/[0.06] dark:border-white/[0.04] rounded-lg bg-white dark:bg-panel-dark text-gray-900 dark:text-text-primary font-mono text-sm focus:ring-2 focus:ring-brand-violet focus:border-transparent"
                  placeholder={t('在此输入自定义提示词...', 'Enter custom prompt here...')}
                />
              </div>
            )}
          </div>

          <div className="flex space-x-3">
            <button
              onClick={handleSave}
              className="flex items-center space-x-2 px-4 py-2 bg-brand-indigo text-white dark:bg-brand-indigo dark:text-white rounded-lg hover:bg-brand-hover transition-colors"
            >
              <Save className="w-4 h-4" />
              <span>{t('保存', 'Save')}</span>
            </button>
            <button
              onClick={handleTestForm}
              disabled={testingForm}
              className="flex items-center space-x-2 px-4 py-2 bg-brand-indigo text-white dark:bg-brand-indigo dark:text-white rounded-lg hover:bg-brand-hover transition-colors disabled:opacity-50"
            >
              {testingForm ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <TestTube className="w-4 h-4" />
              )}
              <span>{t('测试连接', 'Test Connection')}</span>
            </button>
            <button
              onClick={resetForm}
              className="flex items-center space-x-2 px-4 py-2 bg-light-surface hover:bg-gray-200 dark:bg-white/[0.04] dark:hover:bg-white/[0.08] text-gray-900 dark:text-text-primary rounded-lg border border-black/[0.06] dark:border-white/[0.04] transition-colors"
            >
              <X className="w-4 h-4" />
              <span>{t('取消', 'Cancel')}</span>
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {aiConfigs.map(config => (
          <div
            key={config.id}
            className={`p-4 rounded-lg border transition-colors ${
              config.id === activeAIConfig
                ? 'border-brand-violet bg-brand-indigo/10 dark:border-brand-violet/50 dark:bg-brand-indigo/20'
                : 'border-black/[0.06] dark:border-white/[0.04] hover:border-black/[0.06] dark:hover:border-gray-500'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <input
                  type="radio"
                  name="activeAI"
                  checked={config.id === activeAIConfig}
                  onChange={() => setActiveAIConfig(config.id)}
                  className="w-4 h-4 text-gray-700 dark:text-text-secondary bg-light-surfaceborder-black/[0.06] focus:ring-purple-500 dark:focus:ring-purple-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-white/[0.04] dark:border-white/[0.04]"
                />
                <div>
                  <h4 className="font-medium text-gray-900 dark:text-text-primary flex items-center">
                    {config.name}
                    {config.useCustomPrompt && (
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary">
                        <MessageSquare className="w-3 h-3 mr-1" />
                        {t('自定义提示词', 'Custom Prompt')}
                      </span>
                    )}
                  </h4>
                  <p className="text-sm text-gray-500 dark:text-text-tertiary">
                    {(config.apiType || 'openai').toUpperCase()} • {config.baseUrl} • {config.model} • {t('并发数', 'Concurrency')}: {config.concurrency || 1}
                    {config.reasoningEffort ? ` • reasoning: ${config.reasoningEffort}` : ''}
                  </p>
                  {config.apiKeyStatus === 'decrypt_failed' && (
                    <p className="mt-1 text-sm text-gray-700 dark:text-text-secondary ">
                      {t(
                        '存储的 API Key 无法解密，请重新输入并保存该配置。',
                        'The stored API key could not be decrypted. Please re-enter and save this configuration.'
                      )}
                    </p>
                  )}
                </div>
              </div>
              
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleTest(config)}
                  disabled={testingId === config.id}
                  className="p-2 rounded-lg bg-gray-100 text-gray-900 dark:bg-white/[0.08] dark:text-text-primary hover:bg-gray-200 dark:hover:bg-white/[0.12] border border-transparent dark:border-white/[0.04] transition-colors disabled:opacity-50"
                  title={t('测试连接', 'Test Connection')}
                >
                  {testingId === config.id ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <TestTube className="w-4 h-4" />
                  )}
                </button>
                <button
                  onClick={() => handleEdit(config)}
                  className="p-2 rounded-lg bg-gray-100 text-gray-900 dark:bg-white/[0.08] dark:text-text-primary hover:bg-gray-200 dark:hover:bg-white/[0.12] border border-transparent dark:border-white/[0.04] transition-colors"
                  title={t('编辑', 'Edit')}
                >
                  <Edit3 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    if (confirm(t('确定要删除这个AI配置吗？', 'Are you sure you want to delete this AI configuration?'))) {
                      if (config.id) {
                        deleteAIConfig(config.id);
                      } else {
                        alert(t('删除失败：配置ID无效', 'Delete failed: Invalid config ID'));
                      }
                    }
                  }}
                  className="p-2 rounded-lg bg-gray-100 text-gray-900 dark:bg-white/[0.08] dark:text-text-primary hover:bg-gray-200 dark:hover:bg-white/[0.12] border border-transparent dark:border-white/[0.04] transition-colors"
                  title={t('删除', 'Delete')}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
        
        {aiConfigs.length === 0 && (
          <div className="text-center py-8 text-gray-500 dark:text-text-tertiary">
            <Bot className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>{t('还没有配置AI服务', 'No AI services configured yet')}</p>
            <p className="text-sm">{t('点击上方按钮添加AI配置', 'Click the button above to add AI configuration')}</p>
          </div>
        )}
      </div>
    </div>
  );
};
