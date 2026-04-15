import React, { useEffect, useState, useCallback, useRef } from 'react';
import { X, Loader2, AlertCircle, FileText, ExternalLink } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Repository } from '../types';
import { GitHubApiService } from '../services/githubApi';
import { useAppStore } from '../store/useAppStore';

interface ReadmeModalProps {
  isOpen: boolean;
  onClose: () => void;
  repository: Repository | null;
}

// Markdown链接组件
interface MarkdownLinkProps {
  href?: string;
  children?: React.ReactNode;
}

const MarkdownLink: React.FC<MarkdownLinkProps> = ({ href, children }) => {
  if (!href) return <>{children}</>;
  
  // 获取当前仓库的基础URL用于解析相对链接
  const getBaseUrl = () => {
    if (typeof window === 'undefined') return '';
    // 从当前URL提取仓库信息
    const pathMatch = window.location.pathname.match(/\/([^/]+)\/([^/]+)/);
    if (pathMatch) {
      return `https://github.com/${pathMatch[1]}/${pathMatch[2]}`;
    }
    return '';
  };
  
  // 处理相对链接
  const resolveHref = (link: string): string => {
    // 绝对链接保持不变
    if (link.startsWith('http://') || link.startsWith('https://') || link.startsWith('//')) {
      return link;
    }
    // 锚点链接保持不变
    if (link.startsWith('#')) {
      return link;
    }
    // 相对链接转换为绝对链接
    const baseUrl = getBaseUrl();
    if (baseUrl) {
      try {
        return new URL(link, baseUrl + '/').href;
      } catch {
        return link;
      }
    }
    return link;
  };
  
  const resolvedHref = resolveHref(href);
  
  return (
    <a
      href={resolvedHref}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline decoration-blue-400 hover:decoration-blue-600 transition-colors"
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </a>
  );
};

// Markdown图片组件 - 处理相对路径
interface MarkdownImageProps {
  src?: string;
  alt?: string;
}

const MarkdownImage: React.FC<MarkdownImageProps> = ({ src, alt }) => {
  const [hasError, setHasError] = useState(false);
  
  if (!src) return null;

  // 确保图片路径是完整的 URL
  const imageUrl = src;
  if (src.startsWith('./') || src.startsWith('../')) {
    // 相对路径，需要特殊处理
    return (
      <span className="text-gray-500 italic">
        [图片: {alt || 'image'}]
      </span>
    );
  }

  // 图片加载失败时显示安全回退元素
  if (hasError) {
    return (
      <span className="text-gray-500 italic">
        [图片加载失败: {alt || 'image'}]
      </span>
    );
  }

  return (
    <img
      src={imageUrl}
      alt={alt || ''}
      className="max-w-full h-auto rounded-lg my-4"
      onError={() => setHasError(true)}
    />
  );
};

export const ReadmeModal: React.FC<ReadmeModalProps> = ({
  isOpen,
  onClose,
  repository
}) => {
  const { githubToken, language } = useAppStore();
  const [readmeContent, setReadmeContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const fetchReadme = useCallback(async () => {
    if (!repository || !githubToken) return;

    setLoading(true);
    setError(null);

    try {
      const githubApi = new GitHubApiService(githubToken);
      const [owner, name] = repository.full_name.split('/');
      const content = await githubApi.getRepositoryReadme(owner, name);

      if (content.trim()) {
        setReadmeContent(content);
      } else {
        setError(language === 'zh' ? '该仓库没有 README 文件' : 'This repository has no README file');
      }
    } catch (err) {
      console.error('Failed to fetch README:', err);
      setError(language === 'zh' ? '加载 README 失败，请检查网络连接或稍后重试' : 'Failed to load README. Please check your network connection and try again later');
    } finally {
      setLoading(false);
    }
  }, [repository, githubToken, language]);

  useEffect(() => {
    if (isOpen && repository && githubToken) {
      fetchReadme();
    }
  }, [isOpen, repository, githubToken, fetchReadme]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setReadmeContent('');
      setError(null);
      setLoading(false);
    }
  }, [isOpen]);

  // Close modal on Escape key press and manage focus
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      // Save previous focus
      previousFocusRef.current = document.activeElement as HTMLElement;
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
      // Focus the modal container
      setTimeout(() => {
        modalRef.current?.focus();
      }, 0);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
      // Restore previous focus
      previousFocusRef.current?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen || !repository) return null;

  // 处理遮罩层点击，确保只有点击真正的背景时才关闭
  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    // 只有点击的是 flex 容器本身（即背景区域）时才关闭
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Modal Container - 点击背景区域关闭 */}
      <div
        className="flex min-h-full items-center justify-center p-4 bg-black bg-opacity-50 transition-opacity"
        onClick={handleBackdropClick}
      >
        <div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="readme-modal-title"
          tabIndex={-1}
          className="relative w-full max-w-4xl bg-white dark:bg-gray-800 rounded-xl shadow-xl transform transition-all max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
            <div className="flex items-center space-x-3">
              <img
                src={repository.owner.avatar_url}
                alt={repository.owner.login}
                className="w-8 h-8 rounded-full"
              />
              <div>
                <h3 id="readme-modal-title" className="text-lg font-semibold text-gray-900 dark:text-white">
                  {repository.full_name}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  README
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <a
                href={repository.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center space-x-1 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                title={language === 'zh' ? '在 GitHub 上查看' : 'View on GitHub'}
              >
                <ExternalLink className="w-4 h-4" />
                <span className="hidden sm:inline">{language === 'zh' ? '在 GitHub 上查看' : 'View on GitHub'}</span>
              </a>
              <button
                onClick={onClose}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-4" />
                <p className="text-gray-500 dark:text-gray-400">
                  {language === 'zh' ? '正在加载 README...' : 'Loading README...'}
                </p>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-12">
                <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
                <p className="text-gray-700 dark:text-gray-300 text-center mb-4">
                  {error}
                </p>
                <button
                  onClick={fetchReadme}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                  {language === 'zh' ? '重试' : 'Retry'}
                </button>
              </div>
            ) : readmeContent ? (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw]}
                  components={{
                    a: MarkdownLink,
                    img: MarkdownImage,
                    h1: ({ children }) => <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-6 mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">{children}</h1>,
                    h2: ({ children }) => <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 mt-5 mb-3">{children}</h2>,
                    h3: ({ children }) => <h3 className="text-lg font-medium text-gray-700 dark:text-gray-300 mt-4 mb-2">{children}</h3>,
                    p: ({ children }) => <p className="text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">{children}</p>,
                    ul: ({ children }) => <ul className="list-disc list-inside text-gray-700 dark:text-gray-300 mb-4 space-y-1">{children}</ul>,
                    ol: ({ children }) => <ol className="list-decimal list-inside text-gray-700 dark:text-gray-300 mb-4 space-y-1">{children}</ol>,
                    li: ({ children }) => <li className="ml-4 mb-1">{children}</li>,
                    code: ({ children, className }) => {
                      const isInline = !className;
                      return isInline ? (
                        <code className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded text-sm font-mono">
                          {children}
                        </code>
                      ) : (
                        <pre className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg overflow-x-auto my-4">
                          <code className="text-sm font-mono text-gray-800 dark:text-gray-200">{children}</code>
                        </pre>
                      );
                    },
                    blockquote: ({ children }) => (
                      <blockquote className="border-l-4 border-blue-400 dark:border-blue-600 pl-4 py-2 my-4 text-gray-600 dark:text-gray-400 italic bg-gray-50 dark:bg-gray-800/50 rounded-r">
                        {children}
                      </blockquote>
                    ),
                    hr: () => <hr className="my-6 border-gray-200 dark:border-gray-700" />,
                    table: ({ children }) => (
                      <div className="overflow-x-auto my-4">
                        <table className="min-w-full border-collapse border border-gray-200 dark:border-gray-700 text-sm">
                          {children}
                        </table>
                      </div>
                    ),
                    thead: ({ children }) => <thead className="bg-gray-100 dark:bg-gray-800">{children}</thead>,
                    th: ({ children }) => (
                      <th className="border border-gray-200 dark:border-gray-700 px-4 py-2 text-left font-semibold text-gray-800 dark:text-gray-200">
                        {children}
                      </th>
                    ),
                    td: ({ children }) => (
                      <td className="border border-gray-200 dark:border-gray-700 px-4 py-2 text-gray-700 dark:text-gray-300">
                        {children}
                      </td>
                    ),
                  }}
                >
                  {readmeContent}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12">
                <FileText className="w-12 h-12 text-gray-400 mb-4" />
                <p className="text-gray-500 dark:text-gray-400">
                  {language === 'zh' ? '该仓库没有 README 文件' : 'This repository has no README file'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
