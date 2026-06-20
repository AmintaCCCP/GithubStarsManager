import React, { useEffect, useMemo, useRef, useState } from 'react';
import hljs from 'highlight.js';
import { AlertCircle, Copy, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { Modal } from './Modal';
import type { Gist, GistFile } from '../types';
import { getGistTitle, inferGistCodeLanguage } from '../utils/gistUtils';
import { safeWriteText } from '../utils/clipboardUtils';
import { createGitHubApiService } from '../services/githubApiFactory';
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
  onContentLoaded?: (filename: string, content: string) => void;
}

const HighlightedCode: React.FC<HighlightedCodeProps> = ({ file, onContentLoaded }) => {
  const codeRef = useRef<HTMLElement>(null);
  const language = inferGistCodeLanguage(file.filename, file.language);
  const githubToken = useAppStore(state => state.githubToken);
  const language2 = useAppStore(state => state.language);
  const t = (zh: string, en: string) => language2 === 'zh' ? zh : en;

  // 截断文件（>1MB）的 content 会被 GitHub gist 详情 API 省略，需要按需拉取 raw_url。
  const needsRawFetch = !!file.truncated && !file.content && !!file.raw_url;
  const [rawContent, setRawContent] = useState<string | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);
  const [isLoadingRaw, setIsLoadingRaw] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const onContentLoadedRef = useRef(onContentLoaded);

  const content = file.content ?? rawContent ?? '';

  useEffect(() => {
    onContentLoadedRef.current = onContentLoaded;
  }, [onContentLoaded]);

  useEffect(() => {
    if (!needsRawFetch || !file.raw_url) return;
    const controller = new AbortController();

    setIsLoadingRaw(true);
    setRawError(null);
    const doFetch = async () => {
      if (!githubToken) {
        setRawError(t('未配置 GitHub token，无法加载截断文件', 'GitHub token not configured, cannot load truncated file'));
        setIsLoadingRaw(false);
        return;
      }
      try {
        const api = createGitHubApiService(githubToken);
        const text = await api.getGistFileRaw(file.raw_url!, controller.signal);
        if (controller.signal.aborted) return;
        setRawContent(text);
        onContentLoadedRef.current?.(file.filename, text);
      } catch (err) {
        if (controller.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        setRawError(msg === 'Aborted' ? t('加载已取消', 'Loading cancelled') : msg);
      } finally {
        if (!controller.signal.aborted) setIsLoadingRaw(false);
      }
    };
    doFetch();

    return () => controller.abort();
    // retryTick 用于手动触发重试；file.raw_url/filename 变化时也会重新拉取。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsRawFetch, file.raw_url, file.filename, retryTick, githubToken]);

  useEffect(() => {
    if (!codeRef.current) return;
    codeRef.current.removeAttribute('data-highlighted');
    try {
      hljs.highlightElement(codeRef.current);
    } catch {
      // Highlight.js can fail for obscure aliases; plaintext keeps the modal usable.
    }
  }, [content, language]);

  if (isLoadingRaw) {
    return (
      <div className="flex items-center justify-center rounded-lg bg-light-surface p-8 dark:bg-black/30">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-gray-500 dark:text-text-tertiary" />
        <span className="text-sm text-gray-500 dark:text-text-tertiary">{t('正在加载文件内容...', 'Loading file content...')}</span>
      </div>
    );
  }

  if (needsRawFetch && rawError) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg bg-light-surface p-8 dark:bg-black/30">
        <AlertCircle className="mb-3 h-8 w-8 text-gray-600 dark:text-text-secondary" />
        <p className="mb-4 max-w-md text-center text-sm text-gray-700 dark:text-text-secondary">{rawError}</p>
        <button
          type="button"
          onClick={() => {
            setRawContent(null);
            setRetryTick(tick => tick + 1);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-indigo px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-indigo/90"
        >
          <RefreshCw className="h-4 w-4" />
          {t('重试', 'Retry')}
        </button>
      </div>
    );
  }

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
  const updateGist = useAppStore(state => state.updateGist);
  const { toast } = useDialog();
  const [activeFilename, setActiveFilename] = useState<string>('');
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  const files = useMemo(() => Object.values(gist?.files || {}), [gist]);
  const activeFile = files.find(file => file.filename === activeFilename) || files[0];

  // 截断文件按需拉取到的 raw 内容回写 store，避免每次重开弹窗都重新请求。
  const handleContentLoaded = (filename: string, content: string) => {
    if (!gist) return;
    const state = useAppStore.getState();
    const latest =
      state.gists.find(item => item.id === gist.id) ||
      state.starredGists.find(item => item.id === gist.id) ||
      state.gistSearchResults.find(item => item.id === gist.id) ||
      gist;

    const targetFile = latest.files?.[filename];
    if (!targetFile || targetFile.content) return;
    updateGist({
      ...latest,
      files: {
        ...latest.files,
        [filename]: { ...targetFile, content },
      },
    });
  };

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
            <HighlightedCode file={activeFile} onContentLoaded={handleContentLoaded} />
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
