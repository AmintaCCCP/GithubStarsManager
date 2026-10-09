import { useT } from '../../i18n/useT';
import React, { useEffect, useId, useState } from 'react';
import { Modal } from '../Modal';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Category } from '../../types';

interface PushCategoriesModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
  onConfirm: (categoryIds: string[]) => void;
}

export const PushCategoriesModal: React.FC<PushCategoriesModalProps> = ({
  isOpen,
  onClose,
  categories,
  onConfirm
}) => {
  const t = useT('app');
  const [deselectedIds, setDeselectedIds] = useState<Set<string>>(new Set());
  const idPrefix = useId();
  const groupLabelId = useId();

  // 记录取消勾选的项：空集合即全选，每次打开重置为全选
  useEffect(() => {
    if (isOpen) setDeselectedIds(new Set());
  }, [isOpen]);

  const selectedIds = categories.filter(cat => !deselectedIds.has(cat.id)).map(cat => cat.id);

  const toggle = (id: string, checked: boolean) => {
    setDeselectedIds(prev => {
      const next = new Set(prev);
      if (checked) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleConfirm = () => {
    onConfirm(selectedIds);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('pushCategoriesModal.push-selected-categories')}
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 id={groupLabelId} className="text-sm font-medium text-foreground dark:text-foreground">
            {t('pushCategoriesModal.select-categories')}
          </h3>
          <div className="flex items-center space-x-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDeselectedIds(new Set())}
            >
              {t('pushCategoriesModal.select-all')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDeselectedIds(new Set(categories.map(cat => cat.id)))}
            >
              {t('pushCategoriesModal.select-none')}
            </Button>
          </div>
        </div>

        <div
          role="group"
          aria-labelledby={groupLabelId}
          className="max-h-64 overflow-y-auto space-y-2"
        >
          {categories.map(category => (
            <label
              key={category.id}
              htmlFor={`${idPrefix}-${category.id}`}
              className="flex cursor-pointer items-center space-x-3 rounded-lg border border-border px-4 py-3 transition-colors hover:bg-accent dark:hover:border-border-strong"
            >
              <Checkbox
                id={`${idPrefix}-${category.id}`}
                checked={!deselectedIds.has(category.id)}
                onCheckedChange={(checked) => toggle(category.id, checked === true)}
              />
              <span className="text-sm font-medium text-foreground dark:text-foreground">
                {category.icon} {category.name}
              </span>
            </label>
          ))}
        </div>

        <div className="flex justify-end space-x-3 pt-4">
          <Button
            onClick={onClose}
            className="px-4 py-2 text-foreground dark:text-foreground bg-muted dark:bg-muted/40 rounded-lg hover:bg-accent dark:hover:bg-accent"
          >
            {t('pushCategoriesModal.cancel')}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={selectedIds.length === 0}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 dark:bg-primary dark:hover:bg-primary/80 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('pushCategoriesModal.push-count-selected', { count: selectedIds.length })}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
