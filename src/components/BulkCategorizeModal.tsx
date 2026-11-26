import { useT } from "../i18n/useT";
import { Button } from './ui/button';
import React, { useId, useState, useEffect } from 'react';
import { Check } from 'lucide-react';
import { Modal } from './Modal';
import { Repository } from '../types';
import { useAppStore, getAllCategories } from '../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';

interface BulkCategorizeModalProps {
  isOpen: boolean;
  onClose: () => void;
  repositories: Repository[];
  onCategorize: (categoryName: string) => Promise<void>;
}

export const BulkCategorizeModal: React.FC<BulkCategorizeModalProps> = ({
  isOpen,
  onClose,
  repositories,
  onCategorize
}) => {
  const { customCategories, hiddenDefaultCategoryIds, defaultCategoryOverrides, language } = useAppStore(useShallow((state) => ({
    customCategories: state.customCategories,
    hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds,
    defaultCategoryOverrides: state.defaultCategoryOverrides,
    language: state.language,
  })));
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const categorySelectionLabelId = useId();

  const allCategories = getAllCategories(customCategories, language, hiddenDefaultCategoryIds, defaultCategoryOverrides);

  useEffect(() => {
    if (isOpen) {
      setSelectedCategory(null);
    }
  }, [isOpen]);

  const [error, setError] = useState<string | null>(null);

  const handleCategorize = async () => {
    if (!selectedCategory) return;

    const category = allCategories.find(cat => cat.id === selectedCategory);
    if (!category) return;

    setIsProcessing(true);
    setError(null);
    try {
      await onCategorize(category.name);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('bulkCategorizeModal.categorization-failed'));
    } finally {
      setIsProcessing(false);
    }
  };

  const t = useT('app');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('bulkCategorizeModal.bulk-categorize')}
    >
      <div className="space-y-4">
        <p className="text-label text-secondary tabular-nums">
          {t('bulkCategorizeModal.will-set-category-for-v1-repositories', { v1: repositories.length })}
        </p>

        <div className="space-y-2">
          <h3 id={categorySelectionLabelId} className="block text-label-sm font-medium text-tertiary">
            {t('bulkCategorizeModal.select-category')}
          </h3>

          <div
            role="group"
            aria-labelledby={categorySelectionLabelId}
            className="max-h-64 space-y-1 overflow-y-auto rounded-lg bg-sunken p-1.5"
          >
            {allCategories.filter(cat => cat.id !== 'all').map(category => (
              <Button
                key={category.id}
                type="button"
                variant="ghost"
                aria-pressed={selectedCategory === category.id}
                onClick={() => setSelectedCategory(category.id)}
                className={`h-control-lg w-full justify-between rounded-md px-3 text-label font-medium ${
                  selectedCategory === category.id
                    ? 'bg-fill-selected text-foreground shadow-[inset_0_0_0_1px_var(--focus-ring)]'
                    : 'text-secondary hover:bg-fill-hover hover:text-foreground'
                }`}
              >
                <span className="truncate">{category.name}</span>
                {selectedCategory === category.id && (
                  <Check className="size-4 shrink-0 text-accent-text" />
                )}
              </Button>
            ))}
          </div>
        </div>

        {error && (
          <div role="alert" className="rounded-md bg-destructive-tint px-3 py-2 text-label-sm text-destructive">
            {error}
          </div>
        )}

        <div className="rounded-md bg-warning-tint px-3 py-2">
          <p className="text-label-sm text-secondary">
            {t('bulkCategorizeModal.note-this-operation-will-overwrite-the-existing')}
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-subtle pt-3">
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={onClose}
            disabled={isProcessing}
          >
            {t('bulkCategorizeModal.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={handleCategorize}
            disabled={!selectedCategory || isProcessing}
          >
            {isProcessing ? t('bulkCategorizeModal.processing') : t('bulkCategorizeModal.confirm-categorize')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
