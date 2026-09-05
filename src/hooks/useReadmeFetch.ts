import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { GitHubApiService } from '../services/githubApi';
import { backend } from '../services/backendAdapter';
import { shouldBypassBackend } from '../services/routeMode';
import { useAppStore } from '../store/useAppStore';
import type { GitHubReadmeCandidateItem, ReadmeVariant } from '../utils/readmeVariants';

const isAbortError = (error: unknown, signal?: AbortSignal): boolean => {
  return Boolean(signal?.aborted || (error as { name?: string })?.name === 'AbortError');
};

// controller 被 hook 自身 abort（被新请求取代或 cancel()）时，以 AbortError 命名的错误
// 拒绝，调用方据此丢弃过期结果且不动 loading 态——等价于原先 View 持有 signal 的
// "resolve 后 signal.aborted 检查"（View 已不再持有 controller）。
const abortOperation = (): Error => new DOMException('Aborted', 'AbortError');

export interface UseReadmeFetchOptions {
  owner: string;
  name: string;
}

export interface ReadmeFetchActions {
  fetchReadmeContent: (variant: ReadmeVariant) => Promise<string>;
  fetchReadmeCandidates: (defaultBranch: string | undefined) => Promise<GitHubReadmeCandidateItem[]>;
  /** abort 两路 controller 并置 null；View 关闭 modal 时调，hook unmount 亦自动。 */
  cancel: () => void;
}

export const useReadmeFetch = ({ owner, name }: UseReadmeFetchOptions): ReadmeFetchActions => {
  const { githubToken, language } = useAppStore(useShallow((state) => ({
    githubToken: state.githubToken,
    language: state.language,
  })));

  const contentAbortRef = useRef<AbortController | null>(null);
  const candidatesAbortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    if (contentAbortRef.current) {
      contentAbortRef.current.abort();
      contentAbortRef.current = null;
    }
    if (candidatesAbortRef.current) {
      candidatesAbortRef.current.abort();
      candidatesAbortRef.current = null;
    }
  }, []);

  useEffect(() => cancel, [cancel]);

  const fetchReadmeContent = useCallback(async (variant: ReadmeVariant): Promise<string> => {
    if (contentAbortRef.current) {
      contentAbortRef.current.abort();
    }
    const controller = new AbortController();
    contentAbortRef.current = controller;
    const signal = controller.signal;

    const fetchFromGitHubApi = async (): Promise<string> => {
      if (!githubToken) {
        throw new Error(language === 'zh' ? '未登录且后端不可用，无法加载 README' : 'Not logged in and backend unavailable, cannot load README');
      }
      const githubApi = new GitHubApiService(githubToken);
      return variant.isDefault || !variant.path
        ? githubApi.getRepositoryReadme(owner, name, signal)
        : githubApi.getRepositoryReadmeByPath(owner, name, variant.path, signal);
    };

    if (shouldBypassBackend() || !backend.isAvailable) {
      return fetchFromGitHubApi();
    }

    try {
      const content = variant.isDefault || !variant.path
        ? await backend.getRepositoryReadme(owner, name, signal)
        : await backend.getRepositoryReadmeByPath(owner, name, variant.path, signal);
      if (signal.aborted) throw abortOperation();
      return content;
    } catch (backendError) {
      if (signal.aborted) throw abortOperation();
      if (isAbortError(backendError, signal) || !githubToken) {
        throw backendError;
      }

      console.warn('Falling back to direct GitHub README fetch after backend failure:', backendError);
      const content = await fetchFromGitHubApi();
      if (signal.aborted) throw abortOperation();
      return content;
    }
  }, [owner, name, githubToken, language]);

  const fetchReadmeCandidates = useCallback(async (defaultBranch: string | undefined): Promise<GitHubReadmeCandidateItem[]> => {
    if (candidatesAbortRef.current) {
      candidatesAbortRef.current.abort();
    }
    const controller = new AbortController();
    candidatesAbortRef.current = controller;
    const signal = controller.signal;

    const fetchFromGitHubApi = async (): Promise<GitHubReadmeCandidateItem[]> => {
      if (!githubToken) return [];
      const githubApi = new GitHubApiService(githubToken);
      return githubApi.listRepositoryReadmeCandidates(owner, name, defaultBranch, signal);
    };

    if (shouldBypassBackend() || !backend.isAvailable) {
      return fetchFromGitHubApi();
    }

    try {
      const candidates = await backend.listRepositoryReadmeCandidates(owner, name, defaultBranch, signal);
      if (signal.aborted) throw abortOperation();
      return candidates;
    } catch (backendError) {
      if (signal.aborted) throw abortOperation();
      if (isAbortError(backendError, signal) || !githubToken) {
        throw backendError;
      }

      console.warn('Falling back to direct GitHub README variant detection after backend failure:', backendError);
      const candidates = await fetchFromGitHubApi();
      if (signal.aborted) throw abortOperation();
      return candidates;
    }
  }, [owner, name, githubToken]);

  return useMemo(() => ({
    fetchReadmeContent,
    fetchReadmeCandidates,
    cancel,
  }), [fetchReadmeContent, fetchReadmeCandidates, cancel]);
};

// 原 ReadmeModal 变体选择的 find(...)||default 提纯。
export const pickReadmeCandidate = (
  variants: ReadmeVariant[],
  selectedKey: string | undefined,
  defaultVariant: ReadmeVariant,
): ReadmeVariant => variants.find(variant => variant.key === selectedKey) || defaultVariant;
