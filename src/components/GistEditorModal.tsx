import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from './Modal';
import type { Gist } from '../types';
import type { GistCreateInput, GistUpdateInput } from '../services/githubApi';
import { useAppStore } from '../store/useAppStore';

interface EditableFile {
  id: string;
  originalFilename?: string;
  filename: string;
  content: string;
  deleted?: boolean;
}

interface GistEditorModalProps {
  gist: Gist | null;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: GistCreateInput | GistUpdateInput) => Promise<void>;
}

const generateFileId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // 非安全上下文或旧浏览器降级
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const createEmptyFile = (): EditableFile => ({
  id: generateFileId(),
  filename: 'snippet.txt',
  content: '',
});

export const GistEditorModal: React.FC<GistEditorModalProps> = ({ gist, isOpen, onClose, onSubmit }) => {
  const language = useAppStore(state => state.language);
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [files, setFiles] = useState<EditableFile[]>([createEmptyFile()]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setDescription(gist?.description || '');
    setIsPublic(gist?.public ?? false);
    const nextFiles = Object.values(gist?.files || {}).map(file => ({
      id: generateFileId(),
      originalFilename: file.filename,
      filename: file.filename,
      content: file.content || '',
    }));
    setFiles(nextFiles.length > 0 ? nextFiles : [createEmptyFile()]);
  }, [gist, isOpen]);

  const visibleFiles = files.filter(file => !file.deleted);
  const hasDuplicateFilenames = useMemo(() => {
    const names = visibleFiles.map(file => file.filename.trim()).filter(Boolean);
    return new Set(names).size !== names.length;
  }, [visibleFiles]);
  const canSubmit = useMemo(() => {
    return (
      visibleFiles.length > 0 &&
      !hasDuplicateFilenames &&
      visibleFiles.every(file => file.filename.trim() && file.content.length > 0)
    );
  }, [visibleFiles, hasDuplicateFilenames]);

  const updateFile = (id: string, updates: Partial<EditableFile>) => {
    setFiles(prev => prev.map(file => file.id === id ? { ...file, ...updates } : file));
  };

  const removeFile = (id: string) => {
    setFiles(prev => {
      const target = prev.find(file => file.id === id);
      if (!target?.originalFilename) {
        return prev.filter(file => file.id !== id);
      }
      return prev.map(file => file.id === id ? { ...file, deleted: true } : file);
    });
  };

  const handleSubmit = async () => {
    if (!canSubmit || isSaving) return;
    setIsSaving(true);
    try {
      if (gist) {
        await onSubmit({
          description,
          files: files.map(file => ({
            filename: file.filename.trim(),
            previousFilename: file.originalFilename,
            content: file.content,
            deleted: file.deleted,
          })),
        });
      } else {
        await onSubmit({
          description,
          public: isPublic,
          files: visibleFiles.map(file => ({
            filename: file.filename.trim(),
            content: file.content,
          })),
        });
      }
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={gist ? t('编辑 Gist', 'Edit Gist') : t('新建 Gist', 'New Gist')}
      maxWidth="max-w-4xl"
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-900 dark:text-text-primary">
            {t('描述', 'Description')}
          </label>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="w-full rounded-lg border border-black/[0.06] bg-white px-3 py-2 text-gray-900 outline-none transition-colors focus:border-brand-indigo dark:border-white/[0.04] dark:bg-white/[0.04] dark:text-text-primary"
            placeholder={t('这个 gist 是做什么的？', 'What is this gist for?')}
          />
        </div>

        {!gist && (
          <label className="flex items-center gap-3 text-sm text-gray-700 dark:text-text-secondary">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(event) => setIsPublic(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-brand-indigo focus:ring-brand-indigo"
            />
            {t('公开 Gist', 'Public gist')}
          </label>
        )}

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-gray-900 dark:text-text-primary">{t('文件', 'Files')}</div>
            {hasDuplicateFilenames && (
              <div className="text-xs text-red-600 dark:text-red-300">
                {t('文件名不能重复', 'Filenames must be unique')}
              </div>
            )}
            <button
              type="button"
              onClick={() => setFiles(prev => [...prev, createEmptyFile()])}
              className="inline-flex items-center gap-2 rounded-lg border border-black/[0.06] bg-white px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-light-surface dark:border-white/[0.04] dark:bg-white/[0.04] dark:text-text-secondary dark:hover:bg-white/[0.08]"
            >
              <Plus className="h-4 w-4" />
              {t('添加文件', 'Add file')}
            </button>
          </div>

          {visibleFiles.map((file, index) => (
            <div key={file.id} className="space-y-2 rounded-lg border border-black/[0.06] bg-light-surface p-3 dark:border-white/[0.04] dark:bg-white/[0.03]">
              <div className="flex items-center gap-2">
                <input
                  value={file.filename}
                  onChange={(event) => updateFile(file.id, { filename: event.target.value })}
                  className="min-w-0 flex-1 rounded-lg border border-black/[0.06] bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-indigo dark:border-white/[0.04] dark:bg-black/20 dark:text-text-primary"
                  placeholder={`file-${index + 1}.txt`}
                />
                <button
                  type="button"
                  onClick={() => removeFile(file.id)}
                  disabled={visibleFiles.length === 1}
                  className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:text-text-tertiary dark:hover:bg-red-500/10 dark:hover:text-red-300"
                  title={t('删除文件', 'Delete file')}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <textarea
                value={file.content}
                onChange={(event) => updateFile(file.id, { content: event.target.value })}
                rows={8}
                className="w-full resize-y rounded-lg border border-black/[0.06] bg-white px-3 py-2 font-mono text-sm text-gray-900 outline-none focus:border-brand-indigo dark:border-white/[0.04] dark:bg-black/20 dark:text-text-primary"
                placeholder={t('输入文件内容', 'Enter file content')}
              />
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-black/[0.06] bg-white px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-light-surface dark:border-white/[0.04] dark:bg-white/[0.04] dark:text-text-secondary dark:hover:bg-white/[0.08]"
          >
            {t('取消', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || isSaving}
            className="rounded-lg bg-brand-indigo px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-indigo/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? t('保存中...', 'Saving...') : t('保存', 'Save')}
          </button>
        </div>
      </div>
    </Modal>
  );
};
