import React, { memo, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { Copy, Check, Download } from 'lucide-react';
import hljs from 'highlight.js';
import 'highlight.js/styles/github.min.css';
import { useAppStore } from '../store/useAppStore';
import { safeWriteText, getClipboardErrorMessage } from '../utils/clipboardUtils';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  shouldRender?: boolean;
  enableHtml?: boolean;
  baseUrl?: string;
  headingIds?: Map<string, string>;
}

const REMARK_PLUGINS = [remarkGfm, remarkBreaks];
const REHYPE_PLUGINS_WITH_HTML = [rehypeRaw, rehypeSanitize];
const REHYPE_PLUGINS_NO_HTML: never[] = [];

const CodeBlock: React.FC<{
  children: React.ReactNode;
  className?: string;
  language: string;
}> = ({ children, className, language }) => {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const codeRef = useRef<HTMLElement>(null);
  const { language: uiLanguage } = useAppStore();

  const normalizedLanguage = useMemo(() => {
    if (!language) return '';
    const langLower = language.toLowerCase();
    const langMap: Record<string, string> = {
      'sh': 'bash',
      'shell': 'bash',
      'zsh': 'bash',
      'fish': 'bash',
      'ksh': 'bash',
      'csh': 'bash',
      'tcsh': 'bash',
      'yml': 'yaml',
      'py': 'python',
      'js': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'jsx': 'javascript',
      'rb': 'ruby',
      'cs': 'csharp',
      'kt': 'kotlin',
      'rs': 'rust',
      'go': 'go',
      'md': 'markdown',
    };
    return langMap[langLower] || langLower;
  }, [language]);

  const codeText = useMemo(() => {
    if (typeof children === 'string') {
      return children.replace(/\n$/, '');
    }
    return String(children).replace(/\n$/, '');
  }, [children]);

  useEffect(() => {
    if (codeRef.current) {
      try {
        hljs.highlightElement(codeRef.current);
      } catch (error) {
        console.warn('highlight.js failed:', error);
      }
    }
  }, [children, normalizedLanguage]);

  const handleCopy = useCallback(async () => {
    setCopyError(null);

    const result = await safeWriteText(codeText);

    if (result.success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      console.error('Failed to copy:', result.error);
      setCopyError(result.error || getClipboardErrorMessage('write', uiLanguage));
    }
  }, [codeText, uiLanguage]);

  const codeLines = codeText.split('\n');
  const lineCount = codeLines.length;
  const showLineNumbers = lineCount > 3;

  const isBashLike = ['bash', 'sh', 'shell', 'zsh'].includes(normalizedLanguage);
  const isPowerShell = ['powershell', 'ps1'].includes(normalizedLanguage);
  const isCmdLike = ['cmd', 'bat'].includes(normalizedLanguage);

  return (
    <div className={`relative group my-3 rounded-xl overflow-hidden border shadow-md ${
      isBashLike
        ? 'border-black/[0.06] dark:border-white/[0.04]/30 dark:border-black/[0.06] dark:border-white/[0.04]/30'
        : isPowerShell
          ? 'border-brand-violet/30 dark:border-black/[0.06] dark:border-white/[0.04]/30'
          : isCmdLike
            ? 'border-cyan-500/30 dark:border-cyan-400/30'
            : 'border-black/[0.06] dark:border-white/[0.04]'
    }`}>
      <div className="flex items-center justify-between px-4 py-2.5 bg-light-surface dark:bg-panel-dark/90 border-b border-black/[0.06] dark:border-white/[0.04]">
        <div className="flex items-center gap-2.5">
          <div className="flex gap-1.5">
            <span className="w-3 h-3 rounded-full bg-gray-100 dark:bg-white/[0.04] " />
            <span className="w-3 h-3 rounded-full bg-gray-100 dark:bg-white/[0.04] " />
            <span className="w-3 h-3 rounded-full bg-status-emerald0/80 dark:bg-status-emerald0/70" />
          </div>
          {language && (
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-md ${
              isBashLike
                ? 'bg-status-emerald text-status-emerald border border-black/[0.06] dark:border-white/[0.04] dark:border-black/[0.06] dark:border-white/[0.04]'
                : isPowerShell
                  ? 'bg-brand-indigo/20 dark:bg-brand-indigo/20/40 text-gray-700 dark:text-text-secondary border border-black/[0.06] dark:border-white/[0.04] dark:border-black/[0.06] dark:border-white/[0.04]'
                  : isCmdLike
                    ? 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800'
                    : 'bg-gray-200 dark:bg-white/[0.04] text-gray-700 dark:text-text-tertiary border border-black/[0.06] dark:border-white/[0.04]'
            }`}>
              {isBashLike && (
                <span className="mr-1.5 inline-block w-2 h-2 rounded-full bg-status-emerald0 animate-pulse" />
              )}
              {isPowerShell && (
                <span className="mr-1.5 inline-block w-2 h-2 rounded-full bg-brand-violet animate-pulse" />
              )}
              {isCmdLike && (
                <span className="mr-1.5 inline-block w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
              )}
              {language}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {showLineNumbers && (
            <span className="text-xs text-gray-400 dark:text-text-tertiaryfont-mono">
              {lineCount} {uiLanguage === 'zh' ? '行' : 'lines'}
            </span>
          )}
          <button
            onClick={handleCopy}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              copyError
                ? 'bg-gray-100 dark:bg-white/[0.04] text-gray-700 dark:text-text-secondary border border-black/[0.06] dark:border-white/[0.04] dark:border-black/[0.06] dark:border-white/[0.04]'
                : copied
                  ? 'bg-status-emerald text-status-emerald border border-black/[0.06] dark:border-white/[0.04] dark:border-black/[0.06] dark:border-white/[0.04]'
                  : 'bg-white dark:bg-white/[0.04] text-gray-700 dark:text-text-secondary hover:bg-light-bg dark:hover:bg-gray-600 border border-black/[0.06] dark:border-white/[0.04]'
            }`}
            title={copyError || (uiLanguage === 'zh' ? '复制代码' : 'Copy code')}
          >
            {copyError ? (
              <span>!</span>
            ) : copied ? (
              <>
                <Check className="w-3.5 h-3.5" />
                {uiLanguage === 'zh' ? '已复制' : 'Copied'}
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                {uiLanguage === 'zh' ? '复制' : 'Copy'}
              </>
            )}
          </button>
        </div>
      </div>
      {copyError && (
        <div className="absolute top-14 right-4 max-w-xs bg-gray-100 dark:bg-white/[0.04] text-gray-700 dark:text-text-secondary text-xs px-3 py-2 rounded-lg shadow-lg z-20 border border-black/[0.06] dark:border-white/[0.04] dark:border-black/[0.06] dark:border-white/[0.04]">
          {copyError}
        </div>
      )}
      <div className={`overflow-x-auto ${
        isBashLike
          ? 'bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900/95 dark:to-gray-800/95'
          : isPowerShell
            ? 'bg-gradient-to-br from-blue-50/50 to-indigo-50/30 dark:from-blue-950/20 dark:to-slate-900/20'
            : isCmdLike
              ? 'bg-gradient-to-br from-cyan-50/40 to-slate-100/20 dark:from-cyan-950/15 dark:to-slate-900/10'
              : 'bg-light-bg dark:bg-[#1e1e1e]'
      }`}>
        {showLineNumbers ? (
          <div className="flex">
            <div className={`flex-shrink-0 py-3 px-3 text-right select-none border-r ${
              isBashLike
                ? 'border-black/[0.06] dark:border-white/[0.04] dark:border-black/[0.06] dark:border-white/[0.04] bg-status-emerald/30 '
                : isPowerShell
                  ? 'border-black/[0.06] dark:border-white/[0.04] dark:border-black/[0.06] dark:border-white/[0.04] bg-gray-100 dark:bg-white/[0.04] dark:bg-brand-indigo/20/10'
                  : isCmdLike
                    ? 'border-cyan-200 dark:border-cyan-800 bg-cyan-50/20 dark:bg-cyan-900/10'
                    : 'border-black/[0.06] dark:border-white/[0.04] bg-light-surface50 dark:bg-panel-dark/30'
            }`}>
              {codeLines.map((_, i) => (
                <div key={i} className="text-xs leading-6 text-gray-400 dark:text-text-tertiaryfont-mono tabular-nums">
                  {i + 1}
                </div>
              ))}
            </div>
            <pre className={`flex-1 p-4 overflow-x-auto ${className || ''}`}>
              <code ref={codeRef} className={`text-sm font-mono leading-6 text-gray-800 dark:text-gray-200 ${normalizedLanguage ? `language-${normalizedLanguage}` : ''}`}>
                {codeText}
              </code>
            </pre>
          </div>
        ) : (
          <pre className={`p-4 overflow-x-auto ${className || ''}`}>
            <code ref={codeRef} className={`text-sm font-mono leading-6 text-gray-800 dark:text-gray-200 ${normalizedLanguage ? `language-${normalizedLanguage}` : ''}`}>
              {codeText}
            </code>
          </pre>
        )}
      </div>
    </div>
  );
};

const MarkdownLink: React.FC<{ href?: string; children?: React.ReactNode; baseUrl?: string; headingIds?: Map<string, string> }> = ({
  href,
  children,
  baseUrl,
  headingIds
}) => {
  if (!href) return <>{children}</>;

  const isMailto = href.startsWith('mailto:');
  const isTel = href.startsWith('tel:');

  const resolveHref = (link: string): string => {
    if (link.startsWith('http://') || link.startsWith('https://') || link.startsWith('//')) {
      return link;
    }
    if (link.startsWith('#')) {
      return link;
    }
    if (link.startsWith('mailto:') || link.startsWith('tel:')) {
      return link;
    }
    if (baseUrl) {
      try {
        return new URL(link, baseUrl + '/blob/HEAD/').href;
      } catch {
        return link;
      }
    }
    return link;
  };

  const resolvedHref = resolveHref(href);
  const isHashLink = href.startsWith('#');
  const isSpecialLink = isMailto || isTel;

  const handleAnchorClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.stopPropagation();
    if (isHashLink && headingIds) {
      e.preventDefault();
      const anchorText = decodeURIComponent(href.substring(1));
      const targetId = headingIds.get(anchorText);
      if (targetId) {
        const targetElement = document.getElementById(targetId);
        if (targetElement) {
          targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
      }
      const elementById = document.getElementById(anchorText);
      if (elementById) {
        elementById.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  return (
    <a
      href={resolvedHref}
      target={isHashLink || isSpecialLink ? undefined : "_blank"}
      rel={isHashLink || isSpecialLink ? undefined : "noopener noreferrer"}
      className="text-brand-violet dark:text-brand-violet hover:text-gray-700 dark:hover:text-text-secondary underline decoration-blue-400 hover:decoration-blue-600 transition-colors"
      onClick={handleAnchorClick}
    >
      {children}
    </a>
  );
};

const resolveImageSrc = (imageSrc: string, baseUrl?: string): string => {
  if (imageSrc.startsWith('http://') || imageSrc.startsWith('https://') || imageSrc.startsWith('//')) {
    return imageSrc;
  }
  if (baseUrl) {
    try {
      return new URL(imageSrc, baseUrl + '/raw/HEAD/').href;
    } catch {
      return imageSrc;
    }
  }
  return imageSrc;
};

const truncateUrl = (url: string, maxLength: number = 50): string => {
  if (url.length <= maxLength) return url;
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname;
    if (path.length > 20) {
      return `${urlObj.host}${path.substring(0, 20)}...`;
    }
    return `${urlObj.host}${path}`;
  } catch {
    return url.substring(0, maxLength) + '...';
  }
};

const MarkdownImage: React.FC<{ src?: string; alt?: string; baseUrl?: string }> = ({
  src,
  alt,
  baseUrl
}) => {
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isZoomed, setIsZoomed] = useState(false);
  const [isInsideLink, setIsInsideLink] = useState(false);
  const [parentLinkHref, setParentLinkHref] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [naturalWidth, setNaturalWidth] = useState<number>(0);
  const [naturalHeight, setNaturalHeight] = useState<number>(0);
  const [zoomScale, setZoomScale] = useState(1);
  const [zoomPos, setZoomPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [imageSizeKnown, setImageSizeKnown] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const imgRef = useRef<HTMLImageElement>(null);
  const zoomOverlayRef = useRef<HTMLDivElement>(null);
  const { language } = useAppStore();

  const imageUrl = useMemo(() => resolveImageSrc(src || '', baseUrl), [src, baseUrl]);

  useEffect(() => {
    if (!src) return;
    if (imgRef.current) {
      const parent = imgRef.current.closest('a');
      setIsInsideLink(!!parent);
      if (parent) {
        setParentLinkHref(parent.getAttribute('href'));
      }
    }
  }, [src]);

  const closeZoom = useCallback(() => {
    setIsZoomed(false);
    setZoomScale(1);
    setZoomPos({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    if (!isZoomed) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeZoom();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isZoomed, closeZoom]);

  useEffect(() => {
    if (!isZoomed || !zoomOverlayRef.current) return;

    const overlay = zoomOverlayRef.current;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.15 : 0.15;
      setZoomScale(prev => Math.min(5, Math.max(0.5, prev + delta)));
    };

    overlay.addEventListener('wheel', handleWheel, { passive: false });
    return () => overlay.removeEventListener('wheel', handleWheel);
  }, [isZoomed]);

  const handleImageClick = useCallback((e: React.MouseEvent) => {
    if (isInsideLink && parentLinkHref) {
      if (e.ctrlKey || e.metaKey) {
        window.open(parentLinkHref, '_blank', 'noopener,noreferrer');
        return;
      }
    }
    e.preventDefault();
    e.stopPropagation();
    setIsZoomed(true);
  }, [isInsideLink, parentLinkHref]);

  const handleDownload = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (isDownloading) return;

    setIsDownloading(true);
    let objectUrl: string | null = null;
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      const fileName = alt
        ? `${alt.replace(/[/\\?%*:|"<>]/g, '_')}.${blob.type.split('/')[1] || 'png'}`
        : `image-${Date.now()}.${blob.type.split('/')[1] || 'png'}`;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      try {
        const a = document.createElement('a');
        a.href = imageUrl;
        a.download = alt ? alt.replace(/[/\\?%*:|"<>]/g, '_') : 'image';
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } catch {
        // fallback failed
      }
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setIsDownloading(false);
    }
  }, [imageUrl, alt, isDownloading]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (zoomScale > 1 && e.touches.length === 1) {
      setIsDragging(true);
      const touch = e.touches[0];
      dragStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        posX: zoomPos.x,
        posY: zoomPos.y
      };
    }
  }, [zoomScale, zoomPos]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (isDragging && zoomScale > 1 && e.touches.length === 1) {
      const touch = e.touches[0];
      const dx = touch.clientX - dragStartRef.current.x;
      const dy = touch.clientY - dragStartRef.current.y;
      setZoomPos({
        x: dragStartRef.current.posX + dx,
        y: dragStartRef.current.posY + dy
      });
    }
  }, [isDragging, zoomScale]);

  const handleTouchEnd = useCallback(() => {
    setTimeout(() => setIsDragging(false), 50);
  }, []);

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    setIsLoading(false);
    const w = (e.target as HTMLImageElement).naturalWidth;
    const h = (e.target as HTMLImageElement).naturalHeight;
    setNaturalWidth(w);
    setNaturalHeight(h);
    setImageSizeKnown(true);
  }, []);

  const handleImageError = useCallback(() => {
    setHasError(true);
    setIsLoading(false);
  }, []);

  const handleRetry = useCallback(() => {
    setHasError(false);
    setIsLoading(true);
    setImageSizeKnown(false);
  }, []);

  const isSmallImage = imageSizeKnown && naturalWidth > 0 && naturalWidth < 300;

  if (!src) return null;

  if (hasError) {
    return (
      <div className="my-4 p-4 bg-gray-100 dark:bg-white/[0.04] rounded-lg border border-black/[0.06] dark:border-white/[0.04] dark:border-black/[0.06] dark:border-white/[0.04] flex items-center gap-3">
        <svg className="w-5 h-5 text-gray-700 dark:text-text-secondary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-700 dark:text-text-secondary font-medium">
            {language === 'zh' ? '图片加载失败' : 'Image failed to load'}
          </p>
          {alt && <p className="text-xs text-gray-700 dark:text-text-secondary truncate">{alt}</p>}
        </div>
        <button
          onClick={handleRetry}
          className="px-2 py-1 text-xs bg-gray-100 dark:bg-white/[0.04] text-gray-700 dark:text-text-secondary rounded hover:bg-gray-200 dark:hover:bg-white/[0.08] transition-colors flex-shrink-0"
        >
          {language === 'zh' ? '重试' : 'Retry'}
        </button>
      </div>
    );
  }

  return (
    <>
      {isSmallImage ? (
        <span className="inline-flex items-center my-1">
          {isLoading && (
            <span className="w-20 h-7 bg-light-surface dark:bg-white/[0.04] rounded animate-pulse inline-block" />
          )}
          <span className="relative inline-block">
            <img
              ref={imgRef}
              src={imageUrl}
              alt={alt || ''}
              className={`
                h-auto rounded
                ${isInsideLink
                  ? 'hover:opacity-80'
                  : 'hover:opacity-80 transition-opacity duration-200 cursor-pointer'
                }
                ${isLoading ? 'opacity-0 absolute' : 'opacity-100'}
                min-h-[16px]
              `}
              style={{
                maxWidth: `${naturalWidth}px`,
                width: `${naturalWidth}px`,
                objectFit: 'contain'
              }}
              onLoad={handleImageLoad}
              onError={handleImageError}
              onClick={handleImageClick}
            />
          </span>
        </span>
      ) : (
        <div className="my-4 flex flex-col items-center group/img">
          {isLoading && (
            <div className="w-full max-w-md h-48 bg-light-surface dark:bg-panel-dark rounded-xl flex flex-col items-center justify-center animate-pulse gap-2">
              <svg className="w-8 h-8 text-gray-300 dark:text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-xs text-gray-400 dark:text-text-tertiary">{language === 'zh' ? '加载中...' : 'Loading...'}</span>
            </div>
          )}

          <div className={`relative inline-block rounded-xl overflow-hidden shadow-sm hover:shadow-lg transition-shadow duration-300 ${isLoading ? 'hidden' : ''}`}>
            <img
              ref={imgRef}
              src={imageUrl}
              alt={alt || ''}
              className={`
                h-auto rounded-xl
                ${isInsideLink
                  ? 'hover:brightness-95 transition-all duration-200'
                  : 'hover:brightness-95 transition-all duration-200 cursor-pointer'
                }
              `}
              style={{
                maxHeight: '65vh',
                maxWidth: '100%',
                width: 'auto',
                objectFit: 'contain'
              }}
              onLoad={handleImageLoad}
              onError={handleImageError}
              onClick={handleImageClick}
            />
            <div className="absolute inset-0 rounded-xl ring-1 ring-inset ring-black/5 dark:ring-white/5 pointer-events-none" />
          </div>

          {!isLoading && !hasError && (
            <div className="text-center mt-2 text-xs text-gray-400 dark:text-text-tertiaryopacity-0 group-hover/img:opacity-100 transition-opacity duration-200 flex items-center gap-3">
              <span>
                {isInsideLink
                  ? (language === 'zh' ? '单击放大 · Ctrl+点击打开链接' : 'Click to zoom · Ctrl+Click to open link')
                  : (language === 'zh' ? '点击可放大' : 'Click to zoom')
                }
              </span>
              {naturalWidth > 0 && (
                <span className="text-gray-300 dark:text-text-secondary">|</span>
              )}
              {naturalWidth > 0 && (
                <span>{naturalWidth} × {naturalHeight}</span>
              )}
            </div>
          )}

          {!isLoading && !hasError && isInsideLink && parentLinkHref && (
            <div
              className="text-center mt-1 text-xs text-brand-violet dark:text-brand-violet opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-1 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                window.open(parentLinkHref, '_blank', 'noopener,noreferrer');
              }}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              <span className="truncate max-w-[200px]" title={parentLinkHref}>
                {truncateUrl(parentLinkHref)}
              </span>
            </div>
          )}
        </div>
      )}

      {isZoomed && createPortal(
        <div
          ref={zoomOverlayRef}
          className="fixed inset-0 z-[99999] bg-black/90 backdrop-blur-sm flex items-center justify-center cursor-default select-none"
          onClick={() => {
            if (!isDragging) {
              closeZoom();
            }
          }}
        >
          <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/60 to-transparent pointer-events-none">
            <div className="flex items-center gap-2 pointer-events-auto">
              {alt && (
                <span className="text-white/70 text-sm truncate max-w-[300px]">{alt}</span>
              )}
              {naturalWidth > 0 && (
                <span className="text-white/50 text-xs">{naturalWidth} × {naturalHeight}</span>
              )}
            </div>
            <div className="flex items-center gap-2 pointer-events-auto">
              {isInsideLink && parentLinkHref && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(parentLinkHref, '_blank', 'noopener,noreferrer');
                  }}
                  className="p-2 bg-white/10 hover:bg-white/20 text-white/80 hover:text-white rounded-lg transition-colors backdrop-blur-sm"
                  title={language === 'zh' ? '打开链接' : 'Open link'}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDownload(e);
                }}
                disabled={isDownloading}
                className="p-2 bg-white/10 hover:bg-white/20 text-white/80 hover:text-white rounded-lg transition-colors backdrop-blur-sm"
                title={language === 'zh' ? '下载图片' : 'Download image'}
              >
                <Download className={`w-4 h-4 ${isDownloading ? 'animate-bounce' : ''}`} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setZoomScale(prev => Math.min(5, prev + 0.5));
                }}
                className="p-2 bg-white/10 hover:bg-white/20 text-white/80 hover:text-white rounded-lg transition-colors backdrop-blur-sm text-sm font-bold"
                title={language === 'zh' ? '放大' : 'Zoom in'}
              >
                +
              </button>
              <span className="text-white/60 text-xs min-w-[3rem] text-center">
                {Math.round(zoomScale * 100)}%
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setZoomScale(prev => Math.max(0.5, prev - 0.5));
                }}
                className="p-2 bg-white/10 hover:bg-white/20 text-white/80 hover:text-white rounded-lg transition-colors backdrop-blur-sm text-sm font-bold"
                title={language === 'zh' ? '缩小' : 'Zoom out'}
              >
                −
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setZoomScale(1);
                  setZoomPos({ x: 0, y: 0 });
                }}
                className="p-2 bg-white/10 hover:bg-white/20 text-white/80 hover:text-white rounded-lg transition-colors backdrop-blur-sm text-xs"
                title={language === 'zh' ? '重置' : 'Reset'}
              >
                1:1
              </button>
              <button
                className="p-2 bg-white/10 hover:bg-white/20 text-white/80 hover:text-white rounded-lg transition-colors backdrop-blur-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  closeZoom();
                }}
                title={language === 'zh' ? '关闭 (Esc)' : 'Close (Esc)'}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div
            className="flex items-center justify-center w-full h-full"
            onMouseDown={(e) => {
              if (zoomScale > 1) {
                setIsDragging(true);
                dragStartRef.current = {
                  x: e.clientX,
                  y: e.clientY,
                  posX: zoomPos.x,
                  posY: zoomPos.y
                };
              }
            }}
            onMouseMove={(e) => {
              if (isDragging && zoomScale > 1) {
                const dx = e.clientX - dragStartRef.current.x;
                const dy = e.clientY - dragStartRef.current.y;
                setZoomPos({
                  x: dragStartRef.current.posX + dx,
                  y: dragStartRef.current.posY + dy
                });
              }
            }}
            onMouseUp={() => {
              setTimeout(() => setIsDragging(false), 50);
            }}
            onMouseLeave={() => {
              setIsDragging(false);
            }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <img
              src={imageUrl}
              alt={alt || ''}
              className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg shadow-2xl transition-transform duration-100"
              style={{
                transform: `scale(${zoomScale}) translate(${zoomPos.x / zoomScale}px, ${zoomPos.y / zoomScale}px)`,
                cursor: zoomScale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default'
              }}
              onClick={(e) => e.stopPropagation()}
              draggable={false}
            />
          </div>

          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-white/50 text-xs pointer-events-none flex items-center gap-3">
            <span>{language === 'zh' ? '滚轮缩放 · 拖拽移动' : 'Scroll to zoom · Drag to pan'}</span>
            <span className="text-white/30">|</span>
            <span>{language === 'zh' ? 'Esc 或点击背景关闭' : 'Esc or click background to close'}</span>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

const extractTextFromChildren = (children: React.ReactNode): string => {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(extractTextFromChildren).join('');
  if (React.isValidElement(children)) {
    return extractTextFromChildren((children.props as { children?: React.ReactNode }).children);
  }
  return '';
};

const MarkdownRenderer: React.FC<MarkdownRendererProps> = memo(({
  content,
  className = '',
  shouldRender = true,
  enableHtml = false,
  baseUrl,
  headingIds
}) => {
  const headingCounterRef = useRef(headingIds?.size ?? 0);
  const headingTextCountMapRef = useRef(new Map<string, number>());

  useEffect(() => {
    headingCounterRef.current = headingIds?.size ?? 0;
    headingTextCountMapRef.current = new Map<string, number>();
  }, [content, headingIds]);

  const rehypePlugins = enableHtml ? REHYPE_PLUGINS_WITH_HTML : REHYPE_PLUGINS_NO_HTML;

  const getHeadingId = useCallback((children: React.ReactNode): string | undefined => {
    if (headingIds && headingIds.size > 0) {
      const text = extractTextFromChildren(children);
      const count = headingTextCountMapRef.current.get(text) || 0;
      const mapKey = count === 0 ? text : `${text}__${count}`;
      headingTextCountMapRef.current.set(text, count + 1);
      const id = headingIds.get(mapKey);
      if (id) return id;
    }
    return `heading-extra-${headingCounterRef.current++}`;
  }, [headingIds]);

  const markdownComponents: Components = useMemo(() => ({
    a: (props) => <MarkdownLink {...props} baseUrl={baseUrl} headingIds={headingIds} />,
    img: (props) => <MarkdownImage {...props} baseUrl={baseUrl} />,
    h1: ({ children }) => {
      const id = getHeadingId(children);
      return <h1 id={id} className="text-lg font-bold text-gray-900 dark:text-text-primary mt-4 mb-2">{children}</h1>;
    },
    h2: ({ children }) => {
      const id = getHeadingId(children);
      return <h2 id={id} className="text-base font-semibold text-gray-900 dark:text-gray-200 mt-3 mb-2">{children}</h2>;
    },
    h3: ({ children }) => {
      const id = getHeadingId(children);
      return <h3 id={id} className="text-sm font-medium text-gray-900 dark:text-text-secondary mt-2 mb-1">{children}</h3>;
    },
    h4: ({ children }) => {
      const id = getHeadingId(children);
      return <h4 id={id} className="text-sm font-medium text-gray-900 dark:text-text-secondary mt-2 mb-1">{children}</h4>;
    },
    h5: ({ children }) => {
      const id = getHeadingId(children);
      return <h5 id={id} className="text-sm font-medium text-gray-500 dark:text-text-tertiary mt-1 mb-1">{children}</h5>;
    },
    h6: ({ children }) => {
      const id = getHeadingId(children);
      return <h6 id={id} className="text-sm font-medium text-gray-500 dark:text-text-tertiary mt-1 mb-1">{children}</h6>;
    },
    p: ({ children }) => {
      const childArray = React.Children.toArray(children);
      const hasImagesOnly = childArray.every(
        child => {
          if (React.isValidElement(child)) {
            if (child.type === MarkdownImage) return true;
            if (child.type === 'img') return true;
          }
          if (typeof child === 'string' && child.trim() === '') return true;
          return false;
        }
      );
      return (
        <p className={`text-gray-900 dark:text-text-secondary mb-2 leading-relaxed ${
          hasImagesOnly
            ? 'flex flex-wrap items-center justify-center gap-3'
            : ''
        }`}>
          {children}
        </p>
      );
    },
    ul: ({ children }) => <ul className="list-disc list-inside text-gray-900 dark:text-text-secondary mb-2 space-y-1">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal list-inside text-gray-900 dark:text-text-secondary mb-2 space-y-1">{children}</ol>,
    li: ({ children, className, ...props }) => (
      <li className={`ml-2 ${className || ''}`} {...props}>
        {children}
      </li>
    ),
    strong: ({ children }) => (
      <strong className="font-semibold text-gray-900 dark:text-gray-100">{children}</strong>
    ),
    em: ({ children }) => (
      <em className="italic text-gray-900 dark:text-text-secondary">{children}</em>
    ),
    del: ({ children }) => (
      <del className="line-through text-gray-500 dark:text-text-tertiary">{children}</del>
    ),
    code: ({ className, children, ...props }) => {
      const isInline = !className;
      const match = /language-(\w+)/.exec(className || '');
      const language = match ? match[1] : '';

      return isInline ? (
        <code className="px-1.5 py-0.5 bg-light-surface dark:bg-white/[0.04] text-gray-900 dark:text-gray-200 rounded text-xs font-mono" {...props}>
          {children}
        </code>
      ) : (
        <CodeBlock className={className} language={language}>
          {children}
        </CodeBlock>
      );
    },
    pre: ({ children }) => <>{children}</>,
    blockquote: ({ children }) => (
      <blockquote className="border-l-4 border-black/[0.06] dark:border-white/[0.04] pl-4 py-1 my-2 text-gray-700 dark:text-text-tertiary italic bg-light-bg dark:bg-panel-dark/50 rounded-r">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-4 border-black/[0.06] dark:border-white/[0.04]" />,
    table: ({ children }) => (
      <div className="overflow-x-auto my-3">
        <table className="min-w-full border-collapse border border-black/[0.06] dark:border-white/[0.04] text-sm">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-light-surface dark:bg-panel-dark">{children}</thead>,
    tbody: ({ children }) => <tbody className="text-gray-900 dark:text-text-secondary">{children}</tbody>,
    th: ({ children }) => (
      <th className="border border-black/[0.06] dark:border-white/[0.04] px-3 py-2 text-left font-semibold text-gray-900 dark:text-gray-200">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border border-black/[0.06] dark:border-white/[0.04] px-3 py-2 text-gray-900 dark:text-text-secondary">
        {children}
      </td>
    ),
    input: (props) => {
      if (props.type === 'checkbox') {
        return (
          <input
            {...props}
            readOnly
            className="mr-1.5 align-middle w-3.5 h-3.5 rounded border-gray-300 text-brand-violet focus:ring-brand-violet dark:border-white/[0.08] dark:bg-white/[0.04]"
          />
        );
      }
      return <input {...props} />;
    },
  }), [baseUrl, headingIds, getHeadingId]);

  if (!shouldRender) {
    return <div className="h-32 flex items-center justify-center text-gray-400 dark:text-text-quaternary">Loading...</div>;
  }

  return (
    <div className={`prose prose-sm dark:prose-invert max-w-none ${className}`}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={rehypePlugins}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

MarkdownRenderer.displayName = 'MarkdownRenderer';

export default MarkdownRenderer;
