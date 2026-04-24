import React, { memo, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { Copy, Check, Download } from 'lucide-react';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.min.css';
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
    const codeText = typeof children === 'string'
      ? children
      : String(children);

    setCopyError(null);

    const result = await safeWriteText(codeText);

    if (result.success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      console.error('Failed to copy:', result.error);
      setCopyError(result.error || getClipboardErrorMessage('write', uiLanguage));
    }
  }, [children, uiLanguage]);

  const codeLines = typeof children === 'string' ? children.split('\n') : [];
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
              <code ref={codeRef} className={`text-sm font-mono leading-6 ${normalizedLanguage ? `language-${normalizedLanguage}` : ''}`}>
                {children}
              </code>
            </pre>
          </div>
        ) : (
          <pre className={`p-4 overflow-x-auto ${className || ''}`}>
            <code ref={codeRef} className={`text-sm font-mono leading-6 ${normalizedLanguage ? `language-${normalizedLanguage}` : ''}`}>
              {children}
            </code>
          </pre>
        )}
      </div>
    </div>
  );
};

const MarkdownLink: React.FC<{ href?: string; children?: React.ReactNode; baseUrl?: string }> = ({ 
  href, 
  children, 
  baseUrl 
}) => {
  if (!href) return <>{children}</>;

  const resolveHref = (link: string): string => {
    if (link.startsWith('http://') || link.startsWith('https://') || link.startsWith('//')) {
      return link;
    }
    if (link.startsWith('#')) {
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

  return (
    <a
      href={resolvedHref}
      target={isHashLink ? undefined : "_blank"}
      rel={isHashLink ? undefined : "noopener noreferrer"}
      className="text-brand-violet dark:text-brand-violet hover:text-gray-700 dark:text-text-secondary dark:hover:text-gray-700 dark:text-text-secondary underline decoration-blue-400 hover:decoration-blue-600 transition-colors"
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </a>
  );
};

const MarkdownImage: React.FC<{ src?: string; alt?: string; baseUrl?: string }> = ({ 
  src, 
  alt, 
  baseUrl 
}) => {
  const [hasError, setHasError] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isZoomed, setIsZoomed] = React.useState(false);
  const [isInsideLink, setIsInsideLink] = React.useState(false);
  const [parentLinkHref, setParentLinkHref] = React.useState<string | null>(null);
  const [isDownloading, setIsDownloading] = React.useState(false);
  const [naturalWidth, setNaturalWidth] = React.useState<number>(0);
  const [naturalHeight, setNaturalHeight] = React.useState<number>(0);
  const [zoomScale, setZoomScale] = React.useState(1);
  const [zoomPos, setZoomPos] = React.useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = React.useState(false);
  const dragStartRef = React.useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const imgRef = React.useRef<HTMLImageElement>(null);
  const { language } = useAppStore();
  
  if (!src) return null;

  const resolveImageSrc = (imageSrc: string): string => {
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

  const imageUrl = resolveImageSrc(src);

  React.useEffect(() => {
    if (imgRef.current) {
      const parent = imgRef.current.closest('a');
      setIsInsideLink(!!parent);
      if (parent) {
        setParentLinkHref(parent.getAttribute('href'));
      }
    }
  }, []);

  const handleImageClick = React.useCallback((e: React.MouseEvent) => {
    if (isInsideLink && parentLinkHref) {
      // 带链接的图片：Ctrl+点击打开链接，普通点击放大
      if (e.ctrlKey || e.metaKey) {
        window.open(parentLinkHref, '_blank', 'noopener,noreferrer');
        return;
      }
    }
    // 普通点击放大图片
    e.preventDefault();
    e.stopPropagation();
    setIsZoomed(true);
  }, [isInsideLink, parentLinkHref]);

  const handleDownload = React.useCallback(async (e: React.MouseEvent) => {
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

  // 判断是否需要限制小图片尺寸（小于300px的图片不放大显示）
  const isSmallImage = naturalWidth > 0 && naturalWidth < 300;

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
          onClick={() => { setHasError(false); setIsLoading(true); }}
          className="px-2 py-1 text-xs bg-gray-100 dark:bg-white/[0.04] text-gray-700 dark:text-text-secondary rounded hover:bg-gray-100 dark:bg-white/[0.04] dark:hover:bg-gray-100 dark:bg-white/[0.04] transition-colors flex-shrink-0"
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
              onLoad={(e) => {
                setIsLoading(false);
                setNaturalWidth((e.target as HTMLImageElement).naturalWidth);
                setNaturalHeight((e.target as HTMLImageElement).naturalHeight);
              }}
              onError={() => {
                setHasError(true);
                setIsLoading(false);
              }}
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
              onLoad={(e) => {
                setIsLoading(false);
                setNaturalWidth((e.target as HTMLImageElement).naturalWidth);
                setNaturalHeight((e.target as HTMLImageElement).naturalHeight);
              }}
              onError={() => {
                setHasError(true);
                setIsLoading(false);
              }}
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

      {/* 放大视图：通过Portal渲染到body，避免链接冒泡 */}
      {isZoomed && createPortal(
        <div 
          className="fixed inset-0 z-[99999] bg-black/90 backdrop-blur-sm flex items-center justify-center cursor-default select-none"
          onClick={() => {
            if (!isDragging) {
              setIsZoomed(false);
              setZoomScale(1);
              setZoomPos({ x: 0, y: 0 });
            }
          }}
          onWheel={(e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.15 : 0.15;
            setZoomScale(prev => Math.min(5, Math.max(0.5, prev + delta)));
          }}
        >
          {/* 顶部工具栏 */}
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
                  setIsZoomed(false);
                  setZoomScale(1);
                  setZoomPos({ x: 0, y: 0 });
                }}
                title={language === 'zh' ? '关闭' : 'Close'}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          
          {/* 图片区域 */}
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
          
          {/* 底部提示 */}
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-white/50 text-xs pointer-events-none flex items-center gap-3">
            <span>{language === 'zh' ? '滚轮缩放 · 拖拽移动' : 'Scroll to zoom · Drag to pan'}</span>
            <span className="text-white/30">|</span>
            <span>{language === 'zh' ? '点击背景关闭' : 'Click background to close'}</span>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

const MarkdownRenderer: React.FC<MarkdownRendererProps> = memo(({ 
  content, 
  className = '', 
  shouldRender = true,
  enableHtml = false,
  baseUrl,
  headingIds
}) => {
  if (!shouldRender) {
    return <div className="h-32 flex items-center justify-center text-gray-400 dark:text-text-quaternary">Loading...</div>;
  }

  const remarkPlugins = [remarkGfm, remarkBreaks];
  const rehypePlugins = enableHtml ? [rehypeRaw, rehypeSanitize] : [];

  const getHeadingId = (children: React.ReactNode): string | undefined => {
    const text = typeof children === 'string' 
      ? children 
      : Array.isArray(children) 
        ? children.join('') 
        : String(children);
    return headingIds?.get(text);
  };

  return (
    <div className={`prose prose-sm dark:prose-invert max-w-none ${className}`}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={{
          a: (props) => <MarkdownLink {...props} baseUrl={baseUrl} />,
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
          li: ({ children }) => <li className="ml-2">{children}</li>,
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
            <blockquote className="border-l-4 border-black/[0.06] dark:border-white/[0.04] dark:border-black/[0.06] dark:border-white/[0.04] pl-4 py-1 my-2 text-gray-700 dark:text-text-tertiary italic bg-light-bg dark:bg-panel-dark/50 rounded-r">
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
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

MarkdownRenderer.displayName = 'MarkdownRenderer';

export default MarkdownRenderer;
