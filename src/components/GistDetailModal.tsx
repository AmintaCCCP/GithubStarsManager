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
  const language2 = useAppStore(state => state.language);
  const t = (zh: string, en: string) => language2 === 'zh' ? zh : en;

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
        setRawError(msg === 'Aborted' ? t('加载已取消', 'Loading cancelled') : msg);
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
      <div className="flex items-center justify-center rounded-lg bg-muted p-8 dark:bg-muted/40">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-muted-foreground dark:text-muted-foreground" />
        <span className="text-sm text-muted-foreground dark:text-muted-foreground">{t('正在加载文件内容...', 'Loading file content...')}</span>
      </div>
    );
  }

  if (needsRawFetch && rawError) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg bg-muted p-8 dark:bg-muted/40">
        <AlertCircle className="mb-3 h-8 w-8 text-muted-foreground dark:text-muted-foreground" />
        <p className="mb-4 max-w-md text-center text-sm text-muted-foreground dark:text-muted-foreground">{rawError}</p>
        <Button
          type="button"
          onClick={() => {
            setRawContent(null);
            setRetryTick(tick => tick + 1);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <RefreshCw className="h-4 w-4" />
          {t('重试', 'Retry')}
        </Button>
      </div>
    );
  }

  return (
    <pre className="max-h-[60vh] overflow-auto rounded-lg bg-muted p-4 text-sm leading-6 dark:bg-muted/40">
      <code ref={codeRef} className={`language-${language} font-mono text-foreground `}>
        {content || ''}
      </code>
    </pre>
  );
};

export const GistDetailModal: React.FC<GistDetailModalProps> = ({ gist, isOpen, onClose }) => {
  const language = useAppStore(state => state.language);
  const updateGist = useAppStore(state => state.updateGist);
  const { fetchGistFileRaw } = useGistActions();
  const { toast } = useDialog();
  const [activeFilename, setActiveFilename] = useState<string>('');
  const [loadedContents, setLoadedContents] = useState<Record<string, string>>({});
  const previousGistIdRef = useRef<Gist['id'] | null>(null);
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

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
    toast(result.success ? message : (result.error || t('复制失败', 'Copy failed')), result.success ? 'success' : 'error');
  };

  if (!gist) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={getGistTitle(gist)} maxWidth="max-w-5xl">
      <div className="min-w-0 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 text-sm text-muted-foreground dark:text-muted-foreground">
            <span>{gist.owner?.login || t('未知创建者', 'Unknown owner')}</span>
            <span className="mx-2">·</span>
            <span>{t('更新于', 'Updated')} {new Date(gist.updated_at).toLocaleString()}</span>
            <span className="mx-2">·</span>
            <span>{gist.public ? t('公开', 'Public') : t('私有', 'Secret')}</span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              onClick={() => handleCopy(gist.html_url, t('链接已复制', 'Link copied'))}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted dark:border-border dark:bg-muted/40 dark:text-muted-foreground dark:hover:bg-accent"
            >
              <Copy className="h-4 w-4" />
              {t('复制链接', 'Copy link')}
            </Button>
            <a
              href={gist.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <ExternalLink className="h-4 w-4" />
              {t('打开', 'Open')}
            </a>
          </div>
        </div>

        {gist.ai_summary && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-foreground dark:border-primary/30 dark:bg-primary/10 dark:text-foreground">
            {gist.ai_summary}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {files.map(file => (
            <Button
              key={file.filename}
              type="button"
              aria-pressed={activeFile?.filename === file.filename}
              onClick={() => setActiveFilename(file.filename)}
                className={`min-w-0 max-w-full break-all rounded-lg border px-3 py-1.5 text-left text-sm transition-colors ${
                activeFile?.filename === file.filename
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted dark:border-border dark:bg-muted/40 dark:text-muted-foreground dark:hover:bg-accent'
              }`}
            >
              {file.filename}
            </Button>
          ))}
        </div>

        {activeFile ? (
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-medium text-foreground dark:text-foreground">{activeFile.filename}</div>
                <div className="text-xs text-muted-foreground dark:text-muted-foreground">
                  {activeFile.language || inferGistCodeLanguage(activeFile.filename)} · {activeFile.size.toLocaleString()} bytes
                  {activeFile.truncated ? ` · ${t('内容已截断', 'Content truncated')}` : ''}
                </div>
              </div>
              <Button
                type="button"
                disabled={!canCopyActiveFile}
                onClick={() => handleCopy(activeCopyContent, t('文件内容已复制', 'File copied'))}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted dark:border-border dark:bg-muted/40 dark:text-muted-foreground dark:hover:bg-accent"
              >
                <Copy className="h-4 w-4" />
                {t('复制文件', 'Copy file')}
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
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground dark:border-border dark:text-muted-foreground">
            {t('没有文件', 'No files')}
          </div>
        )}
      </div>
    </Modal>
  );
};
