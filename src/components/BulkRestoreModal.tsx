import { useT } from "../i18n/useT";
import { Button } from './ui/button';
import React, { useState, useEffect, useMemo } from 'react';
import { RotateCcw, Bot, FileText, Tag, FolderOpen, AlertTriangle, Info } from 'lucide-react';
import { Modal } from './Modal';
import { Repository } from '../types';
import { useAppStore, getAllCategories } from '../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { Checkbox } from './ui/checkbox';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
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
  const { customCategories, hiddenDefaultCategoryIds, defaultCategoryOverrides, language } = useAppStore(useShallow((state) => ({
    customCategories: state.customCategories,
    hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds,
    defaultCategoryOverrides: state.defaultCategoryOverrides,
    language: state.language,
  })));
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
      if (repo.custom_category != null && repo.custom_category !== '') hasCustomCategory++;
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

  const t = useT('app');

  const handleRestore = async () => {
    if (!hasEnabledField) return;
    setIsProcessing(true);
    setError(null);
    try {
      await onRestore(config);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('bulkRestoreModal.restore-failed'));
    } finally {
      setIsProcessing(false);
    }
  };

  const sectionClass = "p-4 bg-card dark:bg-card rounded-xl border border-border dark:border-border";

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('bulkRestoreModal.bulk-restore')}
      maxWidth="max-w-lg"
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground dark:text-muted-foreground">
          {t('bulkRestoreModal.will-restore-the-following-fields-for-v1-reposit', { v1: repositories.length })}
        </p>

        {!hasAnyCustom && (
          <div className="bg-warning/10 border border-warning/30 rounded-lg p-3">
            <p className="text-sm text-warning flex items-center">
              <AlertTriangle className="w-4 h-4 mr-2 flex-shrink-0" />
              {t('bulkRestoreModal.no-custom-content-found-in-selected-repositories')}
            </p>
          </div>
        )}

        {/* Description Section */}
        <div className={sectionClass}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <Checkbox aria-labelledby="bulk-restore-description-heading" checked={config.description.enabled} onCheckedChange={(checked) => setConfig(prev => ({ ...prev, description: { ...prev.description, enabled: checked === true } }))} />
              <FileText className="w-4 h-4 text-primary" />
                <span id="bulk-restore-description-heading" className="text-sm font-medium text-foreground dark:text-foreground">
                  {t('bulkRestoreModal.description')}
                </span>
              {stats.hasCustomDesc > 0 && (
                <span className="text-xs text-muted-foreground dark:text-muted-foreground">
                  ({t('bulkRestoreModal.v1-custom', { v1: stats.hasCustomDesc })})
                </span>
              )}
            </div>
          </div>

          {config.description.enabled && (
            <RadioGroup aria-labelledby="bulk-restore-description-heading" value={config.description.target} onValueChange={(value) => setConfig(prev => ({ ...prev, description: { ...prev.description, target: value as RestoreTarget } }))} className="ml-6 flex items-center space-x-4">
              <label onClick={() => setConfig(prev => ({ ...prev, description: { ...prev.description, target: 'original' } }))} className="flex cursor-pointer items-center space-x-2">
                <RadioGroupItem value="original" id="desc-target-original" aria-labelledby="desc-target-original-label" />
                <span id="desc-target-original-label" className="text-sm text-muted-foreground dark:text-muted-foreground">
                  {t('bulkRestoreModal.default-github-original')}
                </span>
              </label>
              <label onClick={() => setConfig(prev => ({ ...prev, description: { ...prev.description, target: 'ai' } }))} className="flex cursor-pointer items-center space-x-2">
                <RadioGroupItem value="ai" id="desc-target-ai" aria-labelledby="desc-target-ai-label" />
                <span id="desc-target-ai-label" className="text-sm text-muted-foreground dark:text-muted-foreground flex items-center space-x-1">
                  <Bot className="w-3.5 h-3.5" />
                  <span>{t('bulkRestoreModal.ai-summary')}</span>
                </span>
              </label>
            </RadioGroup>
          )}
        </div>

        {/* Tags Section */}
        <div className={sectionClass}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <Checkbox aria-labelledby="bulk-restore-tags-heading" checked={config.tags.enabled} onCheckedChange={(checked) => setConfig(prev => ({ ...prev, tags: { ...prev.tags, enabled: checked === true } }))} />
              <Tag className="w-4 h-4 text-primary" />
                <span id="bulk-restore-tags-heading" className="text-sm font-medium text-foreground dark:text-foreground">
                  {t('bulkRestoreModal.tags')}
                </span>
              {stats.hasCustomTags > 0 && (
                <span className="text-xs text-muted-foreground dark:text-muted-foreground">
                  ({t('bulkRestoreModal.v1-custom', { v1: stats.hasCustomTags })})
                </span>
              )}
            </div>
          </div>

          {config.tags.enabled && (
            <RadioGroup aria-labelledby="bulk-restore-tags-heading" value={config.tags.target} onValueChange={(value) => setConfig(prev => ({ ...prev, tags: { ...prev.tags, target: value as RestoreTarget } }))} className="ml-6 flex items-center space-x-4">
              <label onClick={() => setConfig(prev => ({ ...prev, tags: { ...prev.tags, target: 'original' } }))} className="flex cursor-pointer items-center space-x-2">
                <RadioGroupItem value="original" id="tags-target-original" aria-labelledby="tags-target-original-label" />
                <span id="tags-target-original-label" className="text-sm text-muted-foreground dark:text-muted-foreground">
                  {t('bulkRestoreModal.default-topics')}
                </span>
              </label>
              <label onClick={() => setConfig(prev => ({ ...prev, tags: { ...prev.tags, target: 'ai' } }))} className="flex cursor-pointer items-center space-x-2">
                <RadioGroupItem value="ai" id="tags-target-ai" aria-labelledby="tags-target-ai-label" />
                <span id="tags-target-ai-label" className="text-sm text-muted-foreground dark:text-muted-foreground flex items-center space-x-1">
                  <Bot className="w-3.5 h-3.5" />
                  <span>{t('bulkRestoreModal.ai-tags')}</span>
                </span>
              </label>
            </RadioGroup>
          )}
        </div>

        {/* Category Section */}
        <div className={sectionClass}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <Checkbox aria-labelledby="bulk-restore-category-heading" checked={config.category.enabled} onCheckedChange={(checked) => setConfig(prev => ({ ...prev, category: { ...prev.category, enabled: checked === true } }))} />
              <FolderOpen className="w-4 h-4 text-success" />
                <span id="bulk-restore-category-heading" className="text-sm font-medium text-foreground dark:text-foreground">
                  {t('bulkRestoreModal.category')}
                </span>
              {stats.hasCustomCategory > 0 && (
                <span className="text-xs text-muted-foreground dark:text-muted-foreground">
                  ({t('bulkRestoreModal.v1-custom', { v1: stats.hasCustomCategory })})
                </span>
              )}
            </div>
          </div>

          {config.category.enabled && (
            <RadioGroup aria-labelledby="bulk-restore-category-heading" value={config.category.target} onValueChange={(value) => setConfig(prev => ({ ...prev, category: { ...prev.category, target: value as RestoreTarget } }))} className="ml-6 flex items-center space-x-4">
              <label onClick={() => setConfig(prev => ({ ...prev, category: { ...prev.category, target: 'original' } }))} className="flex cursor-pointer items-center space-x-2">
                <RadioGroupItem value="original" id="cat-target-original" aria-labelledby="cat-target-original-label" />
                <span id="cat-target-original-label" className="text-sm text-muted-foreground dark:text-muted-foreground">
                  {t('bulkRestoreModal.default-category')}
                </span>
              </label>
              <label onClick={() => setConfig(prev => ({ ...prev, category: { ...prev.category, target: 'ai' } }))} className="flex cursor-pointer items-center space-x-2">
                <RadioGroupItem value="ai" id="cat-target-ai" aria-labelledby="cat-target-ai-label" />
                <span id="cat-target-ai-label" className="text-sm text-muted-foreground dark:text-muted-foreground flex items-center space-x-1">
                  <Bot className="w-3.5 h-3.5" />
                  <span>{t('bulkRestoreModal.ai-category')}</span>
                </span>
              </label>
            </RadioGroup>
          )}
        </div>

        {/* AI Warning */}
        {hasAiWarning && (
          <div className="bg-warning/10 border border-warning/30 rounded-lg p-3">
            <p className="text-sm text-warning flex items-start">
              <AlertTriangle className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
              <span>
                {t('bulkRestoreModal.some-selected-repositories-have-not-been-ai-anal')}
              </span>
            </p>
          </div>
        )}

        {/* AI Data Loss Warning */}
        {hasOriginalTargetAiLoss && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
            <p className="text-sm text-destructive flex items-start">
              <AlertTriangle className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
              <span>
                {t('bulkRestoreModal.restoring-to-default-will-clear-ai-analysis-data', { v1: stats.hasAnyAiData })}
              </span>
            </p>
          </div>
        )}

        {/* Info */}
        <div className="bg-accent/50 dark:bg-muted/30 border border-border dark:border-border rounded-lg p-3">
          <p className="text-xs text-muted-foreground dark:text-muted-foreground flex items-start">
            <Info className="w-3.5 h-3.5 mr-1.5 mt-0.5 flex-shrink-0" />
            <span>
              {t('bulkRestoreModal.restoring-to-default-will-also-clear-ai-analysis')}
            </span>
          </p>
        </div>

        {error && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <div className="flex justify-end space-x-3 pt-4">
          <Button
            onClick={onClose}
            disabled={isProcessing}
            className="px-4 py-2 text-muted-foreground dark:text-muted-foreground bg-muted dark:bg-muted rounded-lg hover:bg-accent dark:hover:bg-accent disabled:opacity-50"
          >
            {t('bulkRestoreModal.cancel')}
          </Button>
          <Button
            onClick={handleRestore}
            disabled={!hasEnabledField || isProcessing}
            className="flex items-center space-x-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RotateCcw className="w-4 h-4" />
            <span>{isProcessing ? t('bulkRestoreModal.restoring') : t('bulkRestoreModal.confirm-restore')}</span>
          </Button>
        </div>
      </div>
    </Modal>
  );
};
