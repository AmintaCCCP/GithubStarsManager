import React, { useEffect, useState, useCallback } from 'react';
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
  return (
    <a
      href={href}
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

  return (
    <img
      src={imageUrl}
      alt={alt || ''}
      className="max-w-full h-auto rounded-lg my-4"
      onError={(e) => {
        // 图片加载失败时显示占位符
        const target = e.target as HTMLImageElement;
        target.style.display = 'none';
        target.parentElement!.innerHTML = `<span class="text-gray-500 italic">[图片加载失败: ${alt || 'image'}]</span>`;
      }}
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

  // Close modal on Escape key press
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen || !repository) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div
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
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
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
