import React, { useEffect, useMemo, useRef, useState } from 'react';
import hljs from 'highlight.js';
import { Copy, ExternalLink } from 'lucide-react';
import { Modal } from './Modal';
import type { Gist, GistFile } from '../types';
import { getGistTitle, inferGistCodeLanguage } from '../utils/gistUtils';
import { safeWriteText } from '../utils/clipboardUtils';
import { useAppStore } from '../store/useAppStore';
import { useDialog } from '../hooks/useDialog';
import 'highlight.js/styles/github.min.css';

interface GistDetailModalProps {
  gist: Gist | null;
  isOpen: boolean;
  onClose: () => void;
}

interface HighlightedCodeProps {
  file: GistFile;
}

const HighlightedCode: React.FC<HighlightedCodeProps> = ({ file }) => {
  const codeRef = useRef<HTMLElement>(null);
  const language = inferGistCodeLanguage(file.filename, file.language);
  const content = file.content || '';

  useEffect(() => {
    if (!codeRef.current) return;
    codeRef.current.removeAttribute('data-highlighted');
    try {
      hljs.highlightElement(codeRef.current);
    } catch {
      // Highlight.js can fail for obscure aliases; plaintext keeps the modal usable.
    }
  }, [content, language]);

  return (
    <pre className="max-h-[60vh] overflow-auto rounded-lg bg-light-surface p-4 text-sm leading-6 dark:bg-black/30">
      <code ref={codeRef} className={`language-${language} font-mono text-gray-800 dark:text-[#e6edf3]`}>
        {content || ''}
      </code>
    </pre>
  );
};

export const GistDetailModal: React.FC<GistDetailModalProps> = ({ gist, isOpen, onClose }) => {
  const language = useAppStore(state => state.language);
  const { toast } = useDialog();
  const [activeFilename, setActiveFilename] = useState<string>('');
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  const files = useMemo(() => Object.values(gist?.files || {}), [gist]);
  const activeFile = files.find(file => file.filename === activeFilename) || files[0];

  useEffect(() => {
    setActiveFilename(files[0]?.filename || '');
  }, [gist?.id, files]);

  const handleCopy = async (text: string, message: string) => {
    const result = await safeWriteText(text);
    toast(result.success ? message : (result.error || t('复制失败', 'Copy failed')), result.success ? 'success' : 'error');
  };

  if (!gist) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={getGistTitle(gist)} maxWidth="max-w-5xl">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 text-sm text-gray-500 dark:text-text-tertiary">
            <span>{gist.owner?.login || t('未知创建者', 'Unknown owner')}</span>
            <span className="mx-2">·</span>
            <span>{t('更新于', 'Updated')} {new Date(gist.updated_at).toLocaleString()}</span>
            <span className="mx-2">·</span>
            <span>{gist.public ? t('公开', 'Public') : t('私有', 'Secret')}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleCopy(gist.html_url, t('链接已复制', 'Link copied'))}
              className="inline-flex items-center gap-2 rounded-lg border border-black/[0.06] bg-white px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-light-surface dark:border-white/[0.04] dark:bg-white/[0.04] dark:text-text-secondary dark:hover:bg-white/[0.08]"
            >
              <Copy className="h-4 w-4" />
              {t('复制链接', 'Copy link')}
            </button>
            <a
              href={gist.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-brand-indigo px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-indigo/90"
            >
              <ExternalLink className="h-4 w-4" />
              {t('打开', 'Open')}
            </a>
          </div>
        </div>

        {gist.ai_summary && (
          <div className="rounded-lg border border-brand-indigo/20 bg-brand-indigo/5 p-4 text-sm text-gray-800 dark:border-brand-indigo/30 dark:bg-brand-indigo/10 dark:text-text-primary">
            {gist.ai_summary}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {files.map(file => (
            <button
              key={file.filename}
              type="button"
              onClick={() => setActiveFilename(file.filename)}
              className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                activeFile?.filename === file.filename
                  ? 'border-brand-indigo bg-brand-indigo text-white'
                  : 'border-black/[0.06] bg-white text-gray-700 hover:bg-light-surface dark:border-white/[0.04] dark:bg-white/[0.04] dark:text-text-secondary dark:hover:bg-white/[0.08]'
              }`}
            >
              {file.filename}
            </button>
          ))}
        </div>

        {activeFile ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-medium text-gray-900 dark:text-text-primary">{activeFile.filename}</div>
                <div className="text-xs text-gray-500 dark:text-text-tertiary">
                  {activeFile.language || inferGistCodeLanguage(activeFile.filename)} · {activeFile.size.toLocaleString()} bytes
                  {activeFile.truncated ? ` · ${t('内容已截断', 'Content truncated')}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleCopy(activeFile.content || '', t('文件内容已复制', 'File copied'))}
                className="inline-flex items-center gap-2 rounded-lg border border-black/[0.06] bg-white px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-light-surface dark:border-white/[0.04] dark:bg-white/[0.04] dark:text-text-secondary dark:hover:bg-white/[0.08]"
              >
                <Copy className="h-4 w-4" />
                {t('复制文件', 'Copy file')}
              </button>
            </div>
            <HighlightedCode file={activeFile} />
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-black/[0.08] p-8 text-center text-gray-500 dark:border-white/[0.08] dark:text-text-tertiary">
            {t('没有文件', 'No files')}
          </div>
        )}
      </div>
    </Modal>
  );
};
