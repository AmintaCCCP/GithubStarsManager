import React, { useEffect, useState, useCallback, useRef } from 'react';
import { X, Loader2, AlertCircle, FileText, ExternalLink } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';
import { Repository } from '../types';
import { GitHubApiService } from '../services/githubApi';
import { useAppStore } from '../store/useAppStore';

interface ReadmeModalProps {
  isOpen: boolean;
  onClose: () => void;
  repository: Repository | null;
}

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
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchReadme = useCallback(async () => {
    if (!repository || !githubToken) return;

    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setLoading(true);
    setError(null);

    try {
      const githubApi = new GitHubApiService(githubToken);
      const [owner, name] = repository.full_name.split('/');
      const content = await githubApi.getRepositoryReadme(owner, name);

      // Check if request was aborted before updating state
      if (abortController.signal.aborted) return;

      if (content.trim()) {
        setReadmeContent(content);
      } else {
        setError(language === 'zh' ? '该仓库没有 README 文件' : 'This repository has no README file');
      }
    } catch (err) {
      // Check if request was aborted before updating state
      if (abortController.signal.aborted) return;
      console.error('Failed to fetch README:', err);
      setError(language === 'zh' ? '加载 README 失败，请检查网络连接或稍后重试' : 'Failed to load README. Please check your network connection and try again later');
    } finally {
      if (!abortController.signal.aborted) {
        setLoading(false);
      }
    }
  }, [repository, githubToken, language]);

  useEffect(() => {
    if (isOpen && repository && githubToken) {
      fetchReadme();
    }
  }, [isOpen, repository, githubToken, fetchReadme]);

  // Reset state when modal closes and cleanup abortController on unmount
  useEffect(() => {
    if (!isOpen) {
      setReadmeContent('');
      setError(null);
      setLoading(false);
    }
  }, [isOpen]);

  // Cleanup abortController on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

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
              <MarkdownRenderer
                content={readmeContent}
                enableHtml={true}
                baseUrl={repository?.html_url}
              />
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
