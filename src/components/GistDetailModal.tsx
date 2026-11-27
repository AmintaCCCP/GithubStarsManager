



import { useT } from '../i18n/useT';
import { Button } from './ui/button';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import hljs from 'highlight.js';
import { AlertCircle, Copy, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { Modal } from './Modal';
import type { Gist, GistFile } from '../types';
import { getGistTitle, inferGistCodeLanguage } from '../utils/gistUtils';
import { safeWriteText } from '../utils/clipboardUtils';
import { useAppStore } from '../store/useAppStore';
import { useGistActions } from '../features/gists/hooks/useGistActions';
import { useDialog } from '../hooks/useDialog';
import 'highlight.js/styles/github.min.css';

interface GistDetailModalProps {
  gist: Gist | null;
  isOpen: boolean;
  onClose: () => void;
}

interface HighlightedCodeProps {
  file: GistFile;
  fetchRaw: (rawUrl: string, signal: AbortSignal) => Promise<string>;
  onContentLoaded?: (filename: string, content: string, rawUrl?: string) => void;
}

const HighlightedCode: React.FC<HighlightedCodeProps> = ({ file, fetchRaw, onContentLoaded }) => {
  const codeRef = useRef<HTMLElement>(null);
  const language = inferGistCodeLanguage(file.filename, file.language);
  const t = useT('gists');

  // 需要按需从 raw_url 拉取完整内容的场景：
  // 1. file.truncated === true：详情 API 标记文件已截断（>1MB），content 仅是部分内容
  // 2. 详情 API 502 降级后用列表缓存数据打开（列表 API 不返回 content，但返回 raw_url）
  const needsRawFetch = (!!file.truncated || !file.content) && !!file.raw_url;
  const [rawContent, setRawContent] = useState<string | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);
  const [isLoadingRaw, setIsLoadingRaw] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const onContentLoadedRef = useRef(onContentLoaded);

  // rawContent 来自 raw_url，始终比 file.content（可能是 API 截断的部分内容）更完整。
  const content = rawContent ?? file.content ?? '';

  useEffect(() => {
    onContentLoadedRef.current = onContentLoaded;
  }, [onContentLoaded]);

  useEffect(() => {
    if (!needsRawFetch || !file.raw_url) return;
    const controller = new AbortController();

    setIsLoadingRaw(true);
    setRawError(null);
    const doFetch = async () => {
      try {
        // 无 token 时由 hook 抛出原文案错误，catch 落 rawError 后与原直写渲染一致
        const text = await fetchRaw(file.raw_url!, controller.signal);
        if (controller.signal.aborted) return;
        setRawContent(text);
        onContentLoadedRef.current?.(file.filename, text, file.raw_url);
      } catch (err) {
        if (controller.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        setRawError(msg === 'Aborted' ? t('gistDetailModal.loading-cancelled') : msg);
      } finally {
        if (!controller.signal.aborted) setIsLoadingRaw(false);
      }
    };
    doFetch();

    return () => controller.abort();
    // retryTick 用于手动触发重试；file.raw_url/filename 变化时也会重新拉取。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsRawFetch, file.raw_url, file.filename, retryTick, fetchRaw]);

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
      <div className="flex items-center justify-center rounded-md border border-subtle bg-sunken p-8">
        <Loader2 className="mr-2 size-4 animate-spin text-tertiary" />
        <span className="text-label text-secondary">{t('gistDetailModal.loading-file-content')}</span>
      </div>
    );
  }

  if (needsRawFetch && rawError) {
    return (
      <div className="flex flex-col items-center justify-center rounded-md border border-subtle bg-sunken p-8">
        <AlertCircle className="mb-3 size-8 stroke-[1.5] text-tertiary" />
        <p className="mb-4 max-w-md text-center text-label text-secondary">{rawError}</p>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setRawContent(null);
            setRetryTick(tick => tick + 1);
          }}
          className="gap-1.5"
        >
          <RefreshCw className="size-3.5" />
          {t('gistDetailModal.retry')}
        </Button>
      </div>
    );
  }

  return (
    <pre className="max-h-[60vh] overflow-auto rounded-md border border-subtle bg-sunken p-4 text-mono-ui leading-6">
      <code ref={codeRef} className={`language-${language} font-mono text-foreground`}>
        {content || ''}
      </code>
    </pre>
  );
};

export const GistDetailModal: React.FC<GistDetailModalProps> = ({ gist, isOpen, onClose }) => {
  const updateGist = useAppStore(state => state.updateGist);
  const { fetchGistFileRaw } = useGistActions();
  const { toast } = useDialog();
  const [activeFilename, setActiveFilename] = useState<string>('');
  const [loadedContents, setLoadedContents] = useState<Record<string, string>>({});
  const previousGistIdRef = useRef<Gist['id'] | null>(null);
  const t = useT('gists');

  const files = useMemo(() => Object.values(gist?.files || {}), [gist]);
  const activeFile = files.find(file => file.filename === activeFilename) || files[0];
  const loadedContentKey = gist && activeFile
    ? `${gist.id}:${activeFile.filename}:${activeFile.raw_url ?? ''}`
    : null;
  const loadedActiveContent = loadedContentKey ? loadedContents[loadedContentKey] : undefined;
  const hasLoadedActiveContent = Boolean(loadedContentKey && Object.prototype.hasOwnProperty.call(loadedContents, loadedContentKey));
  const effectiveActiveFile = activeFile && hasLoadedActiveContent
    ? { ...activeFile, content: loadedActiveContent, truncated: false }
    : activeFile;
  const requiresLoadedContent = Boolean(activeFile && !hasLoadedActiveContent && (
    activeFile.truncated || (!activeFile.content && activeFile.raw_url)
  ));
  const canCopyActiveFile = Boolean(effectiveActiveFile) && !requiresLoadedContent;
  const activeCopyContent = effectiveActiveFile
    ? effectiveActiveFile.content ?? ''
    : '';

  // 截断文件按需拉取到的 raw 内容回写 store，避免每次重开弹窗都重新请求。
  const handleContentLoaded = (filename: string, content: string, rawUrl?: string) => {
    if (!gist) return;
    const cacheKey = `${gist.id}:${filename}:${rawUrl ?? ''}`;
    setLoadedContents(previous => ({ ...previous, [cacheKey]: content }));
    const state = useAppStore.getState();
    const latest =
      state.gists.find(item => item.id === gist.id) ||
      state.starredGists.find(item => item.id === gist.id) ||
      state.gistSearchResults.find(item => item.id === gist.id) ||
      gist;

    const targetFile = latest.files?.[filename];
    if (!targetFile || (rawUrl && targetFile.raw_url && targetFile.raw_url !== rawUrl)) return;
    if (targetFile.content && !targetFile.truncated) return;
    updateGist({
      ...latest,
        files: {
          ...latest.files,
          [filename]: { ...targetFile, content, truncated: false },
        },
    });
  };

  useEffect(() => {
    const gistChanged = previousGistIdRef.current !== gist?.id;
    previousGistIdRef.current = gist?.id ?? null;
    setActiveFilename((currentFilename) => {
      if (gistChanged) return files[0]?.filename || '';
      return currentFilename && files.some((file) => file.filename === currentFilename)
        ? currentFilename
        : files[0]?.filename || '';
    });
    if (gistChanged) {
      setLoadedContents({});
    }
  }, [gist?.id, files]);

  const handleCopy = async (text: string, message: string) => {
    const result = await safeWriteText(text);
    toast(result.success ? message : (result.error || t('gistDetailModal.copy-failed')), result.success ? 'success' : 'error');
  };

  if (!gist) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={getGistTitle(gist)} maxWidth="max-w-5xl">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 text-label-sm text-tertiary tabular-nums">
            <span>{gist.owner?.login || t('gistDetailModal.unknown-owner')}</span>
            <span className="mx-2">·</span>
            <span>{t('gistDetailModal.updated')} {new Date(gist.updated_at).toLocaleString()}</span>
            <span className="mx-2">·</span>
            <span>{gist.public ? t('gistDetailModal.public') : t('gistDetailModal.secret')}</span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleCopy(gist.html_url, t('gistDetailModal.link-copied'))}
              className="gap-1.5"
            >
              <Copy className="size-3.5" />
              {t('gistDetailModal.copy-link')}
            </Button>
            <a
              href={gist.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="motion-press state-overlay inline-flex h-control items-center gap-1.5 rounded-md bg-accent-solid px-2.5 text-label font-medium text-on-accent"
            >
              <ExternalLink className="size-3.5" />
              {t('gistDetailModal.open')}
            </a>
          </div>
        </div>

        {gist.ai_summary && (
          <div className="rounded-md border border-subtle bg-accent-tint/50 px-3.5 py-2.5 text-label text-foreground">
            {gist.ai_summary}
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {files.map(file => {
            const isSelected = activeFile?.filename === file.filename;
            return (
              <Button
                key={file.filename}
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={isSelected}
                onClick={() => setActiveFilename(file.filename)}
                className={`!h-auto min-h-control-sm min-w-0 max-w-full whitespace-normal break-all px-2.5 py-1 text-left ${
                  isSelected
                    ? 'bg-fill-selected text-foreground shadow-elev-0'
                    : 'bg-fill-hover/60 text-secondary hover:bg-fill-hover hover:text-foreground'
                }`}
              >
                {file.filename}
              </Button>
            );
          })}
        </div>

        {activeFile ? (
          <div className="min-w-0 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-label font-medium text-foreground">{activeFile.filename}</div>
                <div className="text-label-sm text-tertiary tabular-nums">
                  {activeFile.language || inferGistCodeLanguage(activeFile.filename)} · {activeFile.size.toLocaleString()} bytes
                  {activeFile.truncated ? ` · ${t('gistDetailModal.content-truncated')}` : ''}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canCopyActiveFile}
                onClick={() => handleCopy(activeCopyContent, t('gistDetailModal.file-copied'))}
                className="gap-1.5"
              >
                <Copy className="size-3.5" />
                {t('gistDetailModal.copy-file')}
              </Button>
            </div>
            <HighlightedCode
              key={`${gist.id}:${activeFile.filename}:${activeFile.raw_url ?? ''}`}
              file={effectiveActiveFile!}
              fetchRaw={fetchGistFileRaw}
              onContentLoaded={handleContentLoaded}
            />
          </div>
        ) : (
          <div className="rounded-md bg-sunken py-10 text-center text-label text-tertiary">
            {t('gistDetailModal.no-files')}
          </div>
        )}
      </div>
    </Modal>
  );
};
