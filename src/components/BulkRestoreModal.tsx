import React, { useState, useEffect, useMemo } from 'react';
import { RotateCcw, Bot, FileText, Tag, FolderOpen, AlertTriangle, Info } from 'lucide-react';
import { Modal } from './Modal';
import { Repository } from '../types';
import { useAppStore, getAllCategories } from '../store/useAppStore';
import { getAICategory } from '../utils/categoryUtils';

type RestoreTarget = 'original' | 'ai';

interface RestoreFieldConfig {
  enabled: boolean;
  target: RestoreTarget;
}

interface RestoreConfig {
  description: RestoreFieldConfig;
  tags: RestoreFieldConfig;
  category: RestoreFieldConfig;
}

interface BulkRestoreModalProps {
  isOpen: boolean;
  onClose: () => void;
  repositories: Repository[];
  onRestore: (config: RestoreConfig) => Promise<void>;
}

export type { RestoreConfig, RestoreFieldConfig, RestoreTarget };

export const BulkRestoreModal: React.FC<BulkRestoreModalProps> = ({
  isOpen,
  onClose,
  repositories,
  onRestore
}) => {
  const { customCategories, hiddenDefaultCategoryIds, defaultCategoryOverrides, language } = useAppStore();
  const [config, setConfig] = useState<RestoreConfig>({
    description: { enabled: true, target: 'original' },
    tags: { enabled: true, target: 'original' },
    category: { enabled: true, target: 'original' }
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allCategories = useMemo(
    () => getAllCategories(customCategories, language, hiddenDefaultCategoryIds, defaultCategoryOverrides),
    [customCategories, language, hiddenDefaultCategoryIds, defaultCategoryOverrides]
  );

  useEffect(() => {
    if (isOpen) {
      setConfig({
        description: { enabled: true, target: 'original' },
        tags: { enabled: true, target: 'original' },
        category: { enabled: true, target: 'original' }
      });
      setError(null);
    }
  }, [isOpen]);

  const stats = useMemo(() => {
    let hasCustomDesc = 0;
    let hasCustomTags = 0;
    let hasCustomCategory = 0;
    let hasAiSummary = 0;
    let hasAiTags = 0;
    let hasAiCategory = 0;
    let hasAnyAiData = 0;

    for (const repo of repositories) {
      if (repo.custom_description !== undefined && repo.custom_description !== null) hasCustomDesc++;
      if (repo.custom_tags !== undefined) hasCustomTags++;
      if (repo.custom_category !== undefined && repo.custom_category !== '') hasCustomCategory++;
      if (repo.ai_summary && repo.ai_summary.trim() !== '') hasAiSummary++;
      if (repo.ai_tags && repo.ai_tags.length > 0) hasAiTags++;
      if (getAICategory(repo, allCategories) !== '') hasAiCategory++;
      if ((repo.ai_summary && repo.ai_summary.trim() !== '') ||
          (repo.ai_tags && repo.ai_tags.length > 0) ||
          (repo.analyzed_at && !repo.analysis_failed)) hasAnyAiData++;
    }

    return { hasCustomDesc, hasCustomTags, hasCustomCategory, hasAiSummary, hasAiTags, hasAiCategory, hasAnyAiData };
  }, [repositories, allCategories]);

  const hasAnyCustom = stats.hasCustomDesc > 0 || stats.hasCustomTags > 0 || stats.hasCustomCategory > 0;
  const hasEnabledField = config.description.enabled || config.tags.enabled || config.category.enabled;

  const hasAiWarning = useMemo(() => {
    if (config.description.enabled && config.description.target === 'ai' && stats.hasAiSummary === 0) return true;
    if (config.tags.enabled && config.tags.target === 'ai' && stats.hasAiTags === 0) return true;
    if (config.category.enabled && config.category.target === 'ai' && stats.hasAiCategory === 0) return true;
    return false;
  }, [config, stats]);

  const hasOriginalTargetAiLoss = useMemo(() => {
    if (stats.hasAnyAiData === 0) return false;
    const anyOriginalTarget =
      (config.description.enabled && config.description.target === 'original') ||
      (config.tags.enabled && config.tags.target === 'original') ||
      (config.category.enabled && config.category.target === 'original');
    return anyOriginalTarget;
  }, [config, stats]);

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  const handleRestore = async () => {
    if (!hasEnabledField) return;
    setIsProcessing(true);
    setError(null);
    try {
      await onRestore(config);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('还原失败', 'Restore failed'));
    } finally {
      setIsProcessing(false);
    }
  };

  const sectionClass = "p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700";
  const checkboxClass = "w-4 h-4 text-teal-600 bg-gray-100 border-gray-300 rounded focus:ring-teal-500 dark:focus:ring-teal-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600";

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('批量还原', 'Bulk Restore')}
      maxWidth="max-w-lg"
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t(
            `将为 ${repositories.length} 个仓库还原以下字段，清除自定义内容并回退到指定来源：`,
            `Will restore the following fields for ${repositories.length} repositories, clearing custom content and falling back to the specified source:`
          )}
        </p>

        {!hasAnyCustom && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
            <p className="text-sm text-amber-700 dark:text-amber-300 flex items-center">
              <AlertTriangle className="w-4 h-4 mr-2 flex-shrink-0" />
              {t('选中的仓库中没有自定义内容，还原操作无实际效果。', 'No custom content found in selected repositories. Restore will have no effect.')}
            </p>
          </div>
        )}

        {/* Description Section */}
        <div className={sectionClass}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={config.description.enabled}
                onChange={(e) => setConfig(prev => ({
                  ...prev,
                  description: { ...prev.description, enabled: e.target.checked }
                }))}
                className={checkboxClass}
              />
              <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span className="text-sm font-medium text-gray-900 dark:text-white">
                {t('描述', 'Description')}
              </span>
              {stats.hasCustomDesc > 0 && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  ({t(`${stats.hasCustomDesc} 个自定义`, `${stats.hasCustomDesc} custom`)})
                </span>
              )}
            </div>
          </div>

          {config.description.enabled && (
            <div className="ml-6 flex items-center space-x-4">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="desc-target"
                  checked={config.description.target === 'original'}
                  onChange={() => setConfig(prev => ({
                    ...prev,
                    description: { ...prev.description, target: 'original' }
                  }))}
                  className="w-4 h-4 text-teal-600 bg-gray-100 border-gray-300 focus:ring-teal-500 dark:focus:ring-teal-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {t('默认（GitHub原始）', 'Default (GitHub Original)')}
                </span>
              </label>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="desc-target"
                  checked={config.description.target === 'ai'}
                  onChange={() => setConfig(prev => ({
                    ...prev,
                    description: { ...prev.description, target: 'ai' }
                  }))}
                  className="w-4 h-4 text-teal-600 bg-gray-100 border-gray-300 focus:ring-teal-500 dark:focus:ring-teal-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300 flex items-center space-x-1">
                  <Bot className="w-3.5 h-3.5" />
                  <span>{t('AI总结', 'AI Summary')}</span>
                </span>
              </label>
            </div>
          )}
        </div>

        {/* Tags Section */}
        <div className={sectionClass}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={config.tags.enabled}
                onChange={(e) => setConfig(prev => ({
                  ...prev,
                  tags: { ...prev.tags, enabled: e.target.checked }
                }))}
                className={checkboxClass}
              />
              <Tag className="w-4 h-4 text-purple-600 dark:text-purple-400" />
              <span className="text-sm font-medium text-gray-900 dark:text-white">
                {t('标签', 'Tags')}
              </span>
              {stats.hasCustomTags > 0 && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  ({t(`${stats.hasCustomTags} 个自定义`, `${stats.hasCustomTags} custom`)})
                </span>
              )}
            </div>
          </div>

          {config.tags.enabled && (
            <div className="ml-6 flex items-center space-x-4">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="tags-target"
                  checked={config.tags.target === 'original'}
                  onChange={() => setConfig(prev => ({
                    ...prev,
                    tags: { ...prev.tags, target: 'original' }
                  }))}
                  className="w-4 h-4 text-teal-600 bg-gray-100 border-gray-300 focus:ring-teal-500 dark:focus:ring-teal-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {t('默认（Topics）', 'Default (Topics)')}
                </span>
              </label>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="tags-target"
                  checked={config.tags.target === 'ai'}
                  onChange={() => setConfig(prev => ({
                    ...prev,
                    tags: { ...prev.tags, target: 'ai' }
                  }))}
                  className="w-4 h-4 text-teal-600 bg-gray-100 border-gray-300 focus:ring-teal-500 dark:focus:ring-teal-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300 flex items-center space-x-1">
                  <Bot className="w-3.5 h-3.5" />
                  <span>{t('AI标签', 'AI Tags')}</span>
                </span>
              </label>
            </div>
          )}
        </div>

        {/* Category Section */}
        <div className={sectionClass}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={config.category.enabled}
                onChange={(e) => setConfig(prev => ({
                  ...prev,
                  category: { ...prev.category, enabled: e.target.checked }
                }))}
                className={checkboxClass}
              />
              <FolderOpen className="w-4 h-4 text-green-600 dark:text-green-400" />
              <span className="text-sm font-medium text-gray-900 dark:text-white">
                {t('分类', 'Category')}
              </span>
              {stats.hasCustomCategory > 0 && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  ({t(`${stats.hasCustomCategory} 个自定义`, `${stats.hasCustomCategory} custom`)})
                </span>
              )}
            </div>
          </div>

          {config.category.enabled && (
            <div className="ml-6 flex items-center space-x-4">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="cat-target"
                  checked={config.category.target === 'original'}
                  onChange={() => setConfig(prev => ({
                    ...prev,
                    category: { ...prev.category, target: 'original' }
                  }))}
                  className="w-4 h-4 text-teal-600 bg-gray-100 border-gray-300 focus:ring-teal-500 dark:focus:ring-teal-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {t('默认分类', 'Default Category')}
                </span>
              </label>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="cat-target"
                  checked={config.category.target === 'ai'}
                  onChange={() => setConfig(prev => ({
                    ...prev,
                    category: { ...prev.category, target: 'ai' }
                  }))}
                  className="w-4 h-4 text-teal-600 bg-gray-100 border-gray-300 focus:ring-teal-500 dark:focus:ring-teal-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300 flex items-center space-x-1">
                  <Bot className="w-3.5 h-3.5" />
                  <span>{t('AI分类', 'AI Category')}</span>
                </span>
              </label>
            </div>
          )}
        </div>

        {/* AI Warning */}
        {hasAiWarning && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
            <p className="text-sm text-amber-700 dark:text-amber-300 flex items-start">
              <AlertTriangle className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
              <span>
                {t(
                  '部分选中仓库尚未进行AI分析，还原到AI来源后将回退到默认来源。',
                  'Some selected repositories have not been AI-analyzed. They will fall back to the default source after restoring to AI.'
                )}
              </span>
            </p>
          </div>
        )}

        {/* AI Data Loss Warning */}
        {hasOriginalTargetAiLoss && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
            <p className="text-sm text-red-700 dark:text-red-300 flex items-start">
              <AlertTriangle className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
              <span>
                {t(
                  `⚠️ 还原到默认来源将清除 ${stats.hasAnyAiData} 个仓库的AI分析数据（AI总结、AI标签等），此操作不可撤销。清除后需重新运行AI分析才能恢复这些数据。如需保留AI数据，请选择还原到AI来源。`,
                  `⚠️ Restoring to default will clear AI analysis data (AI summary, AI tags, etc.) for ${stats.hasAnyAiData} repositories. This action cannot be undone. You will need to re-run AI analysis to recover this data. To keep AI data, choose "Restore to AI" instead.`
                )}
              </span>
            </p>
          </div>
        )}

        {/* Info */}
        <div className="bg-gray-50 dark:bg-gray-700/30 border border-gray-100 dark:border-gray-600/50 rounded-lg p-3">
          <p className="text-xs text-gray-500 dark:text-gray-400 flex items-start">
            <Info className="w-3.5 h-3.5 mr-1.5 mt-0.5 flex-shrink-0" />
            <span>
              {t(
                '还原到默认来源将同时清除该仓库的AI分析数据（AI总结/标签），显示逻辑直接回退到GitHub原始内容。还原到AI来源仅清除自定义内容，保留AI分析数据。还原分类时会同时解锁分类锁定。AI数据可通过重新分析恢复。',
                'Restoring to default will also clear AI analysis data (AI summary/tags), falling back directly to GitHub original content. Restoring to AI only clears custom content while keeping AI data. Category lock will be released when restoring categories. AI data can be recovered by re-running analysis.'
              )}
            </span>
          </p>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        <div className="flex justify-end space-x-3 pt-4">
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
          >
            {t('取消', 'Cancel')}
          </button>
          <button
            onClick={handleRestore}
            disabled={!hasEnabledField || isProcessing}
            className="flex items-center space-x-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RotateCcw className="w-4 h-4" />
            <span>{isProcessing ? t('还原中...', 'Restoring...') : t('确认还原', 'Confirm Restore')}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
