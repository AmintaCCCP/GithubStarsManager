import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { AIConfig, Release, ReleaseAsset, Repository } from '../../../types';
import { backend } from '../../../services/backendAdapter';
import { GitHubApiService } from '../../../services/githubApi';
import { sendToRpcDownload } from '../../../services/rpcDownloadService';
import { AIService } from '../../../services/aiService';
import { shouldBypassBackend } from '../../../services/routeMode';
import { useAppStore } from '../../../store/useAppStore';
import { useDialog } from '../../../hooks/useDialog';
import type { ReleaseDownloadLink } from '../../../utils/releaseDownloadLinks';

const REMOTE_RELEASE_PAGE_SIZE = 100;
const MAX_LIVE_RELEASES = 200;

export type ReleaseSummaryState = {
  status: 'idle' | 'loading' | 'done' | 'error';
  content?: string;
  error?: string;
};

type DownloadState = 'idle' | 'sending' | 'sent';

const isAbortError = (error: unknown): boolean => (
  error instanceof DOMException && error.name === 'AbortError'
) || (
  error instanceof Error && error.name === 'AbortError'
);

const asString = (value: unknown): string | null => typeof value === 'string' ? value : null;
const asNumber = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;

const mapBackendAsset = (value: unknown): ReleaseAsset | null => {
  if (!value || typeof value !== 'object') return null;
  const asset = value as Record<string, unknown>;
  const id = asNumber(asset.id);
  const name = asString(asset.name);
  const size = asNumber(asset.size);
  const browserDownloadUrl = asString(asset.browser_download_url);
  if (id === null || name === null || size === null || browserDownloadUrl === null) return null;

  return {
    id,
    name,
    size,
    browser_download_url: browserDownloadUrl,
    download_count: asNumber(asset.download_count) ?? 0,
    content_type: asString(asset.content_type) ?? '',
    created_at: asString(asset.created_at) ?? '',
    updated_at: asString(asset.updated_at) ?? '',
  };
};

const mapBackendRelease = (value: Record<string, unknown>, repository: Repository): Release => {
  const id = asNumber(value.id);
  const tagName = asString(value.tag_name);
  const publishedAt = asString(value.published_at);
  const htmlUrl = asString(value.html_url);
  if (id === null || tagName === null || publishedAt === null || htmlUrl === null) {
    throw new Error('Backend proxy returned an invalid release');
  }

  const rawAssets = Array.isArray(value.assets) ? value.assets : [];
  return {
    id,
    tag_name: tagName,
    name: asString(value.name),
    body: asString(value.body),
    published_at: publishedAt,
    html_url: htmlUrl,
    assets: rawAssets.map(mapBackendAsset).filter((asset): asset is ReleaseAsset => asset !== null),
    zipball_url: asString(value.zipball_url) ?? undefined,
    tarball_url: asString(value.tarball_url) ?? undefined,
    prerelease: value.prerelease === true,
    repository: {
      id: repository.id,
      full_name: repository.full_name,
      name: repository.name,
    },
  };
};

const withRepositoryIdentity = (release: Release, repository: Repository): Release => ({
  ...release,
  repository: {
    id: repository.id,
    full_name: repository.full_name,
    name: repository.name,
  },
});

const getRepositoryCoordinates = (fullName: string): { owner: string; name: string } => {
  const [owner, ...nameParts] = fullName.split('/');
  const name = nameParts.join('/');
  if (!owner || !name) throw new Error('Invalid repository full name');
  return { owner, name };
};

const getErrorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : String(error)
);

const isPublishedReleaseRecord = (value: Record<string, unknown>): boolean => (
  value.draft !== true && typeof value.published_at === 'string'
);

const downloadBrowserBlob = (blob: Blob, fileName: string) => {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
};

export const useRepositoryReleaseSheet = (repository: Repository) => {
  const {
    language,
    githubToken,
    rpcDownloadConfig,
    backendApiSecret,
    aiConfigs,
    activeAIConfig,
  } = useAppStore(useShallow((state) => ({
    language: state.language,
    githubToken: state.githubToken,
    rpcDownloadConfig: state.rpcDownloadConfig,
    backendApiSecret: state.backendApiSecret,
    aiConfigs: state.aiConfigs,
    activeAIConfig: state.activeAIConfig,
  })));
  const { toast } = useDialog();
  const [releases, setReleases] = useState<Release[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<number, ReleaseSummaryState>>({});
  const [downloadStates, setDownloadStates] = useState<Record<string, DownloadState>>({});
  const fetchAbortRef = useRef<AbortController | null>(null);
  const summaryAbortRefs = useRef<Record<number, AbortController | undefined>>({});
  const activeConfig = useMemo<AIConfig | undefined>(
    () => aiConfigs.find((config) => config.id === activeAIConfig),
    [activeAIConfig, aiConfigs],
  );
  const t = useCallback((zh: string, en: string) => language === 'zh' ? zh : en, [language]);

  const cancelPendingRequests = useCallback(() => {
    fetchAbortRef.current?.abort();
    fetchAbortRef.current = null;
    Object.values(summaryAbortRefs.current).forEach((controller) => controller?.abort());
    summaryAbortRefs.current = {};
  }, []);

  useEffect(() => cancelPendingRequests, [cancelPendingRequests]);

  const fetchAllPages = useCallback(async (
    getPage: (page: number, signal: AbortSignal) => Promise<{ releases: Release[]; hasMore: boolean }>,
    signal: AbortSignal,
  ): Promise<Release[]> => {
    const collected: Release[] = [];
    let page = 1;

    while (collected.length < MAX_LIVE_RELEASES) {
      const { releases, hasMore } = await getPage(page, signal);
      collected.push(...releases.slice(0, MAX_LIVE_RELEASES - collected.length));
      if (!hasMore || collected.length >= MAX_LIVE_RELEASES) break;
      page += 1;
    }

    return collected;
  }, []);

  const loadReleases = useCallback(async () => {
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    setIsLoading(true);
    setError(null);
    setSummaries({});
    setDownloadStates({});

    try {
      const { owner, name } = getRepositoryCoordinates(repository.full_name);
      let liveReleases: Release[] | null = null;
      let backendError: unknown;

      if (!shouldBypassBackend() && backend.isAvailable) {
        try {
          liveReleases = await fetchAllPages(async (page, signal) => {
            const records = await backend.getRepositoryReleases(owner, name, page, REMOTE_RELEASE_PAGE_SIZE, signal);
            return {
              releases: records
                .filter(isPublishedReleaseRecord)
                .map((record) => mapBackendRelease(record, repository)),
              hasMore: records.length === REMOTE_RELEASE_PAGE_SIZE,
            };
          }, controller.signal);
        } catch (requestError) {
          if (isAbortError(requestError)) throw requestError;
          backendError = requestError;
        }
      }

      if (liveReleases === null) {
        if (!githubToken) {
          throw backendError || new Error(t('请先在设置中配置 GitHub Token，或连接后端服务。', 'Configure a GitHub token in Settings or connect the backend service first.'));
        }
        const githubApi = new GitHubApiService(githubToken);
        liveReleases = await fetchAllPages(
          (page, signal) => githubApi.getRepositoryReleasesPage(owner, name, page, REMOTE_RELEASE_PAGE_SIZE, signal),
          controller.signal,
        );
      }

      if (controller.signal.aborted) return;
      setReleases(liveReleases.map((release) => withRepositoryIdentity(release, repository)));
    } catch (requestError) {
      if (isAbortError(requestError) || controller.signal.aborted) return;
      setReleases([]);
      setError(getErrorMessage(requestError));
    } finally {
      if (fetchAbortRef.current === controller) {
        fetchAbortRef.current = null;
        setIsLoading(false);
      }
    }
  }, [fetchAllPages, githubToken, repository, t]);

  const sendAssetToRpc = useCallback(async (link: ReleaseDownloadLink) => {
    if (!rpcDownloadConfig.enabled || downloadStates[link.url] === 'sending' || downloadStates[link.url] === 'sent') return;

    setDownloadStates((previous) => ({ ...previous, [link.url]: 'sending' }));
    try {
      const result = await sendToRpcDownload(link.url, link.name, backendApiSecret || undefined);
      if (!result.success) {
        throw new Error(result.error || t('发送失败', 'Failed to send download'));
      }
      setDownloadStates((previous) => ({ ...previous, [link.url]: 'sent' }));
      toast(t('已发送到远程下载器', 'Sent to remote downloader'), 'success');
    } catch (downloadError) {
      setDownloadStates((previous) => ({ ...previous, [link.url]: 'idle' }));
      toast(
        getErrorMessage(downloadError) || t('远程下载服务未运行，请检查配置', 'Remote download service is not running. Check its configuration.'),
        'error',
      );
    }
  }, [backendApiSecret, downloadStates, rpcDownloadConfig.enabled, t, toast]);

  const downloadAsset = useCallback(async (link: ReleaseDownloadLink) => {
    if (rpcDownloadConfig.enabled) {
      await sendAssetToRpc(link);
      return;
    }

    if (downloadStates[link.url] === 'sending') return;
    setDownloadStates((previous) => ({ ...previous, [link.url]: 'sending' }));

    try {
      let blob: Blob;
      if (githubToken && link.authenticatedUrl) {
        const response = await fetch(link.authenticatedUrl, {
          headers: {
            Accept: 'application/octet-stream',
            Authorization: `Bearer ${githubToken}`,
          },
        });
        if (!response.ok) {
          throw new Error(`${t('下载失败', 'Download failed')} (${response.status})`);
        }
        blob = await response.blob();
      } else if (!shouldBypassBackend() && backend.isAvailable && link.authenticatedPath) {
        blob = await backend.downloadGitHubResource(link.authenticatedPath);
      } else {
        window.open(link.url, '_blank', 'noopener,noreferrer');
        setDownloadStates((previous) => ({ ...previous, [link.url]: 'idle' }));
        return;
      }
      downloadBrowserBlob(blob, link.name);
      setDownloadStates((previous) => ({ ...previous, [link.url]: 'idle' }));
    } catch (downloadError) {
      setDownloadStates((previous) => ({ ...previous, [link.url]: 'idle' }));
      toast(`${t('下载失败', 'Download failed')}: ${getErrorMessage(downloadError)}`, 'error');
    }
  }, [downloadStates, githubToken, rpcDownloadConfig.enabled, sendAssetToRpc, t, toast]);

  const generateSummary = useCallback(async (release: Release) => {
    const existing = summaries[release.id];
    if (existing?.status === 'loading' || (existing?.status === 'done' && existing.content)) return;

    if (!activeConfig) {
      const configMessage = t('请先在设置中配置 AI 服务。', 'Please configure AI service in Settings first.');
      setSummaries((previous) => ({
        ...previous,
        [release.id]: { status: 'error', error: configMessage },
      }));
      return;
    }

    summaryAbortRefs.current[release.id]?.abort();
    const controller = new AbortController();
    summaryAbortRefs.current[release.id] = controller;
    setSummaries((previous) => ({ ...previous, [release.id]: { status: 'loading' } }));

    try {
      const aiService = new AIService(activeConfig, language);
      const content = await aiService.analyzeReleaseSummary(
        release.body || '',
        {
          repoName: release.repository.full_name,
          tagName: release.tag_name,
          releaseName: release.name && release.name !== release.tag_name ? release.name : undefined,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setSummaries((previous) => ({ ...previous, [release.id]: { status: 'done', content } }));
    } catch (summaryError) {
      if (isAbortError(summaryError) || controller.signal.aborted) return;
      const message = getErrorMessage(summaryError);
      setSummaries((previous) => ({ ...previous, [release.id]: { status: 'error', error: message } }));
      toast(t(`总结生成失败：${message}`, `Summary failed: ${message}`), 'error');
    } finally {
      if (summaryAbortRefs.current[release.id] === controller) {
        delete summaryAbortRefs.current[release.id];
      }
    }
  }, [activeConfig, language, summaries, t, toast]);

  return {
    releases,
    isLoading,
    error,
    summaries,
    downloadStates,
    isRpcEnabled: rpcDownloadConfig.enabled,
    loadReleases,
    sendAssetToRpc,
    downloadAsset,
    generateSummary,
    cancelPendingRequests,
  };
};
