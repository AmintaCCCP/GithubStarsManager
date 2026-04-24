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
        <p className="text-sm text-gray-700 dark:text-text-secondary">
          {t(`将为 ${repositories.length} 个仓库设置分类：`, `Will set category for ${repositories.length} repositories:`)}
        </p>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-900 dark:text-text-primary mb-2">
            {t('选择分类', 'Select Category')}
          </label>

          <div className="max-h-64 overflow-y-auto space-y-2">
            {allCategories.filter(cat => cat.id !== 'all').map(category => (
              <button
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-colors ${
                  selectedCategory === category.id
                    ? 'border-brand-violet bg-gray-100 dark:bg-white/[0.04] dark:bg-brand-indigo/10'
                    : 'border-black/[0.06] dark:border-white/[0.04] hover:border-black/[0.06] dark:border-white/[0.04] dark:hover:border-white/20'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <span className="text-sm font-medium text-gray-900 dark:text-text-primary">
                    {category.name}
                  </span>
                </div>
                {selectedCategory === category.id && (
                  <Check className="w-5 h-5 text-brand-violet" />
                )}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="bg-gray-100 dark:bg-white/[0.04] dark:bg-status-red/10 border border-black/[0.06] dark:border-white/[0.04] dark:border-status-red/20 rounded-lg p-3">
            <p className="text-sm text-gray-700 dark:text-text-secondary ">
              {error}
            </p>
          </div>
        )}

        <div className="bg-gray-100 dark:bg-white/[0.04] dark:bg-status-amber/10 border border-black/[0.06] dark:border-white/[0.04] dark:border-status-amber/20 rounded-lg p-3">
          <p className="text-sm text-gray-700 dark:text-text-secondary ">
            {t('提示：此操作将覆盖这些仓库现有的自定义分类。', 'Note: This operation will overwrite the existing custom categories of these repositories.')}
          </p>
        </div>

        <div className="flex justify-end space-x-3 pt-4">
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="px-4 py-2 text-gray-900 dark:text-text-primary bg-light-surface dark:bg-white/[0.04] rounded-lg hover:bg-gray-200 dark:hover:bg-white/10 disabled:opacity-50"
          >
            {t('取消', 'Cancel')}
          </button>
          <button
            onClick={handleCategorize}
            disabled={!selectedCategory || isProcessing}
            className="px-4 py-2 bg-brand-indigo text-white rounded-lg hover:bg-brand-hover dark:bg-brand-indigo dark:hover:bg-brand-indigo/80 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? t('处理中...', 'Processing...') : t('确认分类', 'Confirm Categorize')}
          </button>
        </div>
      </div>
    </Modal>
  );
};
