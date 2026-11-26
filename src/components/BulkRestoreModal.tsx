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

  const sectionClass = "rounded-lg bg-sunken p-3.5";

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('bulkRestoreModal.bulk-restore')}
      maxWidth="max-w-lg"
    >
      <div className="space-y-3.5">
        <p className="text-label text-secondary tabular-nums">
          {t('bulkRestoreModal.will-restore-the-following-fields-for-v1-reposit', { v1: repositories.length })}
        </p>

        {!hasAnyCustom && (
          <div className="rounded-md bg-warning-tint px-3 py-2">
            <p className="flex items-center text-label-sm text-warning">
              <AlertTriangle className="mr-2 size-4 shrink-0" />
              {t('bulkRestoreModal.no-custom-content-found-in-selected-repositories')}
            </p>
          </div>
        )}

        {/* Description Section */}
        <div className={sectionClass}>
          <div className="mb-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Checkbox aria-labelledby="bulk-restore-description-heading" checked={config.description.enabled} onCheckedChange={(checked) => setConfig(prev => ({ ...prev, description: { ...prev.description, enabled: checked === true } }))} />
              <FileText className="size-4 text-accent-text" />
              <span id="bulk-restore-description-heading" className="text-label font-medium text-foreground">
                {t('bulkRestoreModal.description')}
              </span>
              {stats.hasCustomDesc > 0 && (
                <span className="text-label-sm text-tertiary tabular-nums">
                  ({t('bulkRestoreModal.v1-custom', { v1: stats.hasCustomDesc })})
                </span>
              )}
            </div>
          </div>

          {config.description.enabled && (
            <RadioGroup aria-labelledby="bulk-restore-description-heading" value={config.description.target} onValueChange={(value) => setConfig(prev => ({ ...prev, description: { ...prev.description, target: value as RestoreTarget } }))} className="ml-6 flex items-center gap-4">
              <label onClick={() => setConfig(prev => ({ ...prev, description: { ...prev.description, target: 'original' } }))} className="flex cursor-pointer items-center gap-2">
                <RadioGroupItem value="original" id="desc-target-original" aria-labelledby="desc-target-original-label" />
                <span id="desc-target-original-label" className="text-label-sm text-secondary">
                  {t('bulkRestoreModal.default-github-original')}
                </span>
              </label>
              <label onClick={() => setConfig(prev => ({ ...prev, description: { ...prev.description, target: 'ai' } }))} className="flex cursor-pointer items-center gap-2">
                <RadioGroupItem value="ai" id="desc-target-ai" aria-labelledby="desc-target-ai-label" />
                <span id="desc-target-ai-label" className="flex items-center gap-1 text-label-sm text-secondary">
                  <Bot className="size-3.5 text-tertiary" />
                  <span>{t('bulkRestoreModal.ai-summary')}</span>
                </span>
              </label>
            </RadioGroup>
          )}
        </div>

        {/* Tags Section */}
        <div className={sectionClass}>
          <div className="mb-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Checkbox aria-labelledby="bulk-restore-tags-heading" checked={config.tags.enabled} onCheckedChange={(checked) => setConfig(prev => ({ ...prev, tags: { ...prev.tags, enabled: checked === true } }))} />
              <Tag className="size-4 text-accent-text" />
              <span id="bulk-restore-tags-heading" className="text-label font-medium text-foreground">
                {t('bulkRestoreModal.tags')}
              </span>
              {stats.hasCustomTags > 0 && (
                <span className="text-label-sm text-tertiary tabular-nums">
                  ({t('bulkRestoreModal.v1-custom', { v1: stats.hasCustomTags })})
                </span>
              )}
            </div>
          </div>

          {config.tags.enabled && (
            <RadioGroup aria-labelledby="bulk-restore-tags-heading" value={config.tags.target} onValueChange={(value) => setConfig(prev => ({ ...prev, tags: { ...prev.tags, target: value as RestoreTarget } }))} className="ml-6 flex items-center gap-4">
              <label onClick={() => setConfig(prev => ({ ...prev, tags: { ...prev.tags, target: 'original' } }))} className="flex cursor-pointer items-center gap-2">
                <RadioGroupItem value="original" id="tags-target-original" aria-labelledby="tags-target-original-label" />
                <span id="tags-target-original-label" className="text-label-sm text-secondary">
                  {t('bulkRestoreModal.default-topics')}
                </span>
              </label>
              <label onClick={() => setConfig(prev => ({ ...prev, tags: { ...prev.tags, target: 'ai' } }))} className="flex cursor-pointer items-center gap-2">
                <RadioGroupItem value="ai" id="tags-target-ai" aria-labelledby="tags-target-ai-label" />
                <span id="tags-target-ai-label" className="flex items-center gap-1 text-label-sm text-secondary">
                  <Bot className="size-3.5 text-tertiary" />
                  <span>{t('bulkRestoreModal.ai-tags')}</span>
                </span>
              </label>
            </RadioGroup>
          )}
        </div>

        {/* Category Section */}
        <div className={sectionClass}>
          <div className="mb-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Checkbox aria-labelledby="bulk-restore-category-heading" checked={config.category.enabled} onCheckedChange={(checked) => setConfig(prev => ({ ...prev, category: { ...prev.category, enabled: checked === true } }))} />
              <FolderOpen className="size-4 text-status-green" />
              <span id="bulk-restore-category-heading" className="text-label font-medium text-foreground">
                {t('bulkRestoreModal.category')}
              </span>
              {stats.hasCustomCategory > 0 && (
                <span className="text-label-sm text-tertiary tabular-nums">
                  ({t('bulkRestoreModal.v1-custom', { v1: stats.hasCustomCategory })})
                </span>
              )}
            </div>
          </div>

          {config.category.enabled && (
            <RadioGroup aria-labelledby="bulk-restore-category-heading" value={config.category.target} onValueChange={(value) => setConfig(prev => ({ ...prev, category: { ...prev.category, target: value as RestoreTarget } }))} className="ml-6 flex items-center gap-4">
              <label onClick={() => setConfig(prev => ({ ...prev, category: { ...prev.category, target: 'original' } }))} className="flex cursor-pointer items-center gap-2">
                <RadioGroupItem value="original" id="cat-target-original" aria-labelledby="cat-target-original-label" />
                <span id="cat-target-original-label" className="text-label-sm text-secondary">
                  {t('bulkRestoreModal.default-category')}
                </span>
              </label>
              <label onClick={() => setConfig(prev => ({ ...prev, category: { ...prev.category, target: 'ai' } }))} className="flex cursor-pointer items-center gap-2">
                <RadioGroupItem value="ai" id="cat-target-ai" aria-labelledby="cat-target-ai-label" />
                <span id="cat-target-ai-label" className="flex items-center gap-1 text-label-sm text-secondary">
                  <Bot className="size-3.5 text-tertiary" />
                  <span>{t('bulkRestoreModal.ai-category')}</span>
                </span>
              </label>
            </RadioGroup>
          )}
        </div>

        {/* AI Warning */}
        {hasAiWarning && (
          <div className="rounded-md bg-warning-tint px-3 py-2">
            <p className="flex items-start text-label-sm text-warning">
              <AlertTriangle className="mr-2 mt-0.5 size-4 shrink-0" />
              <span>
                {t('bulkRestoreModal.some-selected-repositories-have-not-been-ai-anal')}
              </span>
            </p>
          </div>
        )}

        {/* AI Data Loss Warning */}
        {hasOriginalTargetAiLoss && (
          <div className="rounded-md bg-destructive-tint px-3 py-2">
            <p className="flex items-start text-label-sm text-destructive">
              <AlertTriangle className="mr-2 mt-0.5 size-4 shrink-0" />
              <span>
                {t('bulkRestoreModal.restoring-to-default-will-clear-ai-analysis-data', { v1: stats.hasAnyAiData })}
              </span>
            </p>
          </div>
        )}

        {/* Info */}
        <div className="rounded-md bg-fill-hover px-3 py-2">
          <p className="flex items-start text-label-sm text-secondary">
            <Info className="mr-1.5 mt-0.5 size-3.5 shrink-0 text-tertiary" />
            <span>
              {t('bulkRestoreModal.restoring-to-default-will-also-clear-ai-analysis')}
            </span>
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-destructive-tint px-3 py-2">
            <p className="text-label-sm text-destructive">{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-subtle pt-3">
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={onClose}
            disabled={isProcessing}
          >
            {t('bulkRestoreModal.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={handleRestore}
            disabled={!hasEnabledField || isProcessing}
          >
            <RotateCcw className="size-3.5" />
            <span>{isProcessing ? t('bulkRestoreModal.restoring') : t('bulkRestoreModal.confirm-restore')}</span>
          </Button>
        </div>
      </div>
    </Modal>
  );
};
