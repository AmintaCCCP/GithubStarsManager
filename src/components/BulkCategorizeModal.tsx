import { Button } from './ui/button';
import React, { useState, useEffect } from 'react';
import { Check } from 'lucide-react';
import { Modal } from './Modal';
import { Repository } from '../types';
import { useAppStore, getAllCategories } from '../store/useAppStore';

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
  const { customCategories, hiddenDefaultCategoryIds, defaultCategoryOverrides, language } = useAppStore();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

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
      setError(err instanceof Error ? err.message : t('分类失败', 'Categorization failed'));
    } finally {
      setIsProcessing(false);
    }
  };

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('批量分类', 'Bulk Categorize')}
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground dark:text-muted-foreground">
          {t(`将为 ${repositories.length} 个仓库设置分类：`, `Will set category for ${repositories.length} repositories:`)}
        </p>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground dark:text-foreground mb-2">
            {t('选择分类', 'Select Category')}
          </label>

          <div className="max-h-64 overflow-y-auto space-y-2">
            {allCategories.filter(cat => cat.id !== 'all').map(category => (
              <Button
                key={category.id}
                variant="ghost"
                aria-pressed={selectedCategory === category.id}
                onClick={() => setSelectedCategory(category.id)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-colors ${
                  selectedCategory === category.id
                    ? 'border-primary bg-muted dark:bg-muted/40 dark:bg-primary/10'
                    : 'border-border dark:border-border hover:border-border dark:border-border dark:hover:border-white/20'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <span className="text-sm font-medium text-foreground dark:text-foreground">
                    {category.name}
                  </span>
                </div>
                {selectedCategory === category.id && (
                  <Check className="w-5 h-5 text-primary" />
                )}
              </Button>
            ))}
          </div>
        </div>

        {error && (
          <div className="bg-muted dark:bg-muted/40 dark:bg-destructive/10 border border-border dark:border-border dark:border-destructive/20 rounded-lg p-3">
            <p className="text-sm text-muted-foreground dark:text-muted-foreground ">
              {error}
            </p>
          </div>
        )}

        <div className="bg-muted dark:bg-muted/40 dark:bg-amber-600/10 border border-border dark:border-border dark:border-amber-600/20 rounded-lg p-3">
          <p className="text-sm text-muted-foreground dark:text-muted-foreground ">
            {t('提示：此操作将覆盖这些仓库现有的自定义分类。', 'Note: This operation will overwrite the existing custom categories of these repositories.')}
          </p>
        </div>

        <div className="flex justify-end space-x-3 pt-4">
          <Button
            onClick={onClose}
            disabled={isProcessing}
            className="px-4 py-2 text-foreground dark:text-foreground bg-muted dark:bg-muted/40 rounded-lg hover:bg-accent dark:hover:bg-accent disabled:opacity-50"
          >
            {t('取消', 'Cancel')}
          </Button>
          <Button
            onClick={handleCategorize}
            disabled={!selectedCategory || isProcessing}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 dark:bg-primary dark:hover:bg-primary/80 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? t('处理中...', 'Processing...') : t('确认分类', 'Confirm Categorize')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
