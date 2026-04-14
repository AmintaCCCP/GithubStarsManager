import React, { useState } from 'react';
import { Bot, Plus, Edit3, Trash2, Save, X, TestTube, RefreshCw, MessageSquare } from 'lucide-react';
import { AIConfig, AIApiType, AIReasoningEffort } from '../../types';
import { useAppStore } from '../../store/useAppStore';
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
  const [showCustomPrompt, setShowCustomPrompt] = useState(false);

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
  };

  const handleSave = () => {
    if (!form.name || !form.baseUrl || !form.apiKey || !form.model) {
      alert(t('请填写所有必填字段', 'Please fill in all required fields'));
      return;
    }

    const config: AIConfig = {
      id: editingId || Date.now().toString(),
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

    if (editingId) {
      updateAIConfig(editingId, config);
    } else {
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
      reasoningEffort: (config.reasoningEffort === 'minimal' ? 'low' : config.reasoningEffort) || '',
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

  const getDefaultPrompt = () => {
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
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Bot className="w-6 h-6 text-purple-600 dark:text-purple-400" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t('AI服务配置', 'AI Service Configuration')}
          </h3>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>{t('添加AI配置', 'Add AI Config')}</span>
        </button>
      </div>

      {showForm && (
        <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
          <h4 className="font-medium text-gray-900 dark:text-white mb-4">
            {editingId ? t('编辑AI配置', 'Edit AI Configuration') : t('添加AI配置', 'Add AI Configuration')}
          </h4>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('配置名称', 'Configuration Name')} *
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                placeholder={t('例如: OpenAI GPT-4', 'e.g., OpenAI GPT-4')}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('接口格式', 'API Format')} *
              </label>
              <select
                value={form.apiType}
                onChange={(e) => setForm(prev => ({ ...prev, apiType: e.target.value as AIApiType }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                <option value="openai">OpenAI (Chat Completions)</option>
                <option value="openai-responses">OpenAI (Responses)</option>
                <option value="claude">Claude</option>
                <option value="gemini">Gemini</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('API端点', 'API Endpoint')} *
              </label>
              <input
                type="url"
                value={form.baseUrl}
                onChange={(e) => setForm(prev => ({ ...prev, baseUrl: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                placeholder={
                  form.apiType === 'openai' || form.apiType === 'openai-responses'
                    ? 'https://api.openai.com/v1'
                    : form.apiType === 'claude'
                      ? 'https://api.anthropic.com/v1'
                      : 'https://generativelanguage.googleapis.com/v1beta'
                }
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t(
                  '只填到版本号即可（如 .../v1 或 .../v1beta），不要包含 /chat/completions、/responses、/messages 或 :generateContent',
                  'Only include the version prefix (e.g. .../v1 or .../v1beta). Do not include /chat/completions, /responses, /messages, or :generateContent.'
                )}
              </p>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('API密钥', 'API Key')} *
              </label>
              <input
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm(prev => ({ ...prev, apiKey: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                placeholder={t('输入API密钥', 'Enter API key')}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('模型名称', 'Model Name')} *
              </label>
              <input
                type="text"
                value={form.model}
                onChange={(e) => setForm(prev => ({ ...prev, model: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                placeholder="gpt-4"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('并发数', 'Concurrency')}
              </label>
              <input
                type="number"
                min="1"
                max="10"
                value={form.concurrency}
                onChange={(e) => setForm(prev => ({ ...prev, concurrency: Math.max(1, Math.min(10, parseInt(e.target.value) || 1)) }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                placeholder="1"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t('同时进行AI分析的仓库数量 (1-10)', 'Number of repositories to analyze simultaneously (1-10)')}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('推理强度', 'Reasoning Effort')}
              </label>
              <select
                value={form.reasoningEffort}
                onChange={(e) => setForm(prev => ({ ...prev, reasoningEffort: e.target.value as '' | AIReasoningEffort }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                <option value="">{t('默认 / 不传', 'Default / Do not send')}</option>
                <option value="none">none</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="xhigh">xhigh</option>
              </select>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t(
                  '仅对 OpenAI 兼容接口生效。留空时保持旧模式兼容，不额外传 reasoning。',
                  'Only applies to OpenAI-compatible APIs. Leave empty to preserve legacy behavior and omit reasoning.'
                )}
              </p>
            </div>
          </div>

          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.useCustomPrompt}
                  onChange={(e) => {
                    setForm(prev => ({ ...prev, useCustomPrompt: e.target.checked }));
                    setShowCustomPrompt(e.target.checked);
                  }}
                  className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('使用自定义提示词', 'Use Custom Prompt')}
                </span>
              </label>
              {form.useCustomPrompt && (
                <button
                  type="button"
                  onClick={() => setForm(prev => ({ ...prev, customPrompt: getDefaultPrompt() }))}
                  className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  {t('恢复默认提示词', 'Restore Default Prompt')}
                </button>
              )}
            </div>
            
            {showCustomPrompt && (
              <textarea
                value={form.customPrompt}
                onChange={(e) => setForm(prev => ({ ...prev, customPrompt: e.target.value }))}
                rows={10}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white font-mono text-sm"
                placeholder={t('在此输入自定义提示词...', 'Enter custom prompt here...')}
              />
            )}
          </div>

          <div className="flex space-x-3">
            <button
              onClick={handleSave}
              className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <Save className="w-4 h-4" />
              <span>{t('保存', 'Save')}</span>
            </button>
            <button
              onClick={resetForm}
              className="flex items-center space-x-2 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
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
                ? 'border-purple-300 bg-purple-50 dark:border-purple-600 dark:bg-purple-900/20'
                : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <input
                  type="radio"
                  name="activeAI"
                  checked={config.id === activeAIConfig}
                  onChange={() => setActiveAIConfig(config.id)}
                  className="w-4 h-4 text-purple-600 bg-gray-100 border-gray-300 focus:ring-purple-500 dark:focus:ring-purple-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                />
                <div>
                  <h4 className="font-medium text-gray-900 dark:text-white flex items-center">
                    {config.name}
                    {config.useCustomPrompt && (
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                        <MessageSquare className="w-3 h-3 mr-1" />
                        {t('自定义提示词', 'Custom Prompt')}
                      </span>
                    )}
                  </h4>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {(config.apiType || 'openai').toUpperCase()} • {config.baseUrl} • {config.model} • {t('并发数', 'Concurrency')}: {config.concurrency || 1}
                    {config.reasoningEffort ? ` • reasoning: ${config.reasoningEffort}` : ''}
                  </p>
                  {config.apiKeyStatus === 'decrypt_failed' && (
                    <p className="mt-1 text-sm text-amber-600 dark:text-amber-400">
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
                  className="p-2 rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors disabled:opacity-50"
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
                  className="p-2 rounded-lg bg-orange-100 text-orange-600 dark:bg-orange-900 dark:text-orange-400 hover:bg-orange-200 dark:hover:bg-orange-800 transition-colors"
                  title={t('编辑', 'Edit')}
                >
                  <Edit3 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    if (confirm(t('确定要删除这个AI配置吗？', 'Are you sure you want to delete this AI configuration?'))) {
                      deleteAIConfig(config.id);
                    }
                  }}
                  className="p-2 rounded-lg bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-800 transition-colors"
                  title={t('删除', 'Delete')}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
        
        {aiConfigs.length === 0 && (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <Bot className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>{t('还没有配置AI服务', 'No AI services configured yet')}</p>
            <p className="text-sm">{t('点击上方按钮添加AI配置', 'Click the button above to add AI configuration')}</p>
          </div>
        )}
      </div>
    </div>
  );
};
