import { useT } from '../../i18n/useT';
import React, { useEffect, useId, useState } from 'react';
import { Modal } from '../Modal';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Category } from '../../types';
import { CategoryGlyph } from '../CategoryGlyph';
import { SettingsCard, SettingsDivider } from './SettingsPrimitives';

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
  onConfirm,
}) => {
  const t = useT('app');
  const [deselectedIds, setDeselectedIds] = useState<Set<string>>(new Set());
  const idPrefix = useId();
  const groupLabelId = useId();

  useEffect(() => {
    if (isOpen) setDeselectedIds(new Set());
  }, [isOpen]);

  const selectedIds = categories.filter((cat) => !deselectedIds.has(cat.id)).map((cat) => cat.id);

  const toggle = (id: string, checked: boolean) => {
    setDeselectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.delete(id);
      else next.add(id);
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
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 id={groupLabelId} className="text-label font-medium text-foreground">
            {t('pushCategoriesModal.select-categories')}
          </h3>
          <div className="flex items-center gap-1">
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
              onClick={() => setDeselectedIds(new Set(categories.map((cat) => cat.id)))}
            >
              {t('pushCategoriesModal.select-none')}
            </Button>
          </div>
        </div>

        <SettingsCard>
          <div
            role="group"
            aria-labelledby={groupLabelId}
            className="max-h-64 overflow-y-auto"
          >
            {categories.map((category, index) => (
              <React.Fragment key={category.id}>
                {index > 0 && <SettingsDivider />}
                <label
                  htmlFor={`${idPrefix}-${category.id}`}
                  className="flex min-h-11 cursor-pointer items-center gap-3 px-3.5 py-2 transition-[background-color] duration-micro ease-out-subtle hover:bg-fill-hover hover:duration-instant"
                >
                  <Checkbox
                    id={`${idPrefix}-${category.id}`}
                    checked={!deselectedIds.has(category.id)}
                    onCheckedChange={(checked) => toggle(category.id, checked === true)}
                  />
                  <span className="flex min-w-0 items-center gap-2 text-label font-medium text-foreground">
                    <CategoryGlyph
                      icon={category.icon}
                      name={category.name}
                      categoryId={category.id}
                    />
                    <span className="truncate">{category.name}</span>
                  </span>
                </label>
              </React.Fragment>
            ))}
          </div>
        </SettingsCard>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" size="md" onClick={onClose}>
            {t('pushCategoriesModal.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={handleConfirm}
            disabled={selectedIds.length === 0}
          >
            {t('pushCategoriesModal.push-count-selected', { count: selectedIds.length })}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
