import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Release, ReleaseAsset, Repository } from '../../../types';
import { backend } from '../../../services/backendAdapter';
import { GitHubApiService } from '../../../services/githubApi';
import { shouldBypassBackend } from '../../../services/routeMode';
import { useAppStore } from '../../../store/useAppStore';
import { useDialog } from '../../../hooks/useDialog';
import { computeRpcDownloadKey, useReleaseArtifactActions } from '../../../hooks/useReleaseArtifactActions';
import type { ReleaseDownloadLink } from '../../../utils/releaseDownloadLinks';

const REMOTE_RELEASE_PAGE_SIZE = 100;
const MAX_LIVE_RELEASES = 200;

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
  } = useAppStore(useShallow((state) => ({
    language: state.language,
    githubToken: state.githubToken,
    rpcDownloadConfig: state.rpcDownloadConfig,
  })));
  const { toast } = useDialog();
  // RPC 发送与 AI 总结动作委托共享 hook（避免第三份拷贝）；summaries/downloadStates
  // 的对外形状由 hook 供给，downloadStates 的 key 已版本化为 computeRpcDownloadKey(link)。
  const artifactActions = useReleaseArtifactActions();
  const [releases, setReleases] = useState<Release[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 非 RPC（浏览器）下载路径的行内 sending 状态不属 RPC 委托范围，留在本 hook；
  // 同样使用版本化 key，与 RPC 状态合并后对外暴露。
  const [browserDownloadStates, setBrowserDownloadStates] = useState<Record<string, 'idle' | 'sending'>>({});
  const fetchAbortRef = useRef<AbortController | null>(null);
  const t = useCallback((zh: string, en: string) => language === 'zh' ? zh : en, [language]);

  const cancelPendingRequests = useCallback(() => {
    fetchAbortRef.current?.abort();
    fetchAbortRef.current = null;
    artifactActions.cancelSummaryRequests();
  }, [artifactActions]);

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
    setBrowserDownloadStates({});
    artifactActions.reset();

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
  }, [artifactActions, fetchAllPages, githubToken, repository, t]);

  const sendAssetToRpc = useCallback(async (link: ReleaseDownloadLink) => {
    // enabled 守卫留在 sheet：ReleaseCard 侧由按钮显隐承担（共享 hook 不重复判断）
    if (!rpcDownloadConfig.enabled) return;
    await artifactActions.sendRpcDownload(link);
  }, [artifactActions, rpcDownloadConfig.enabled]);

  const downloadAsset = useCallback(async (link: ReleaseDownloadLink) => {
    if (rpcDownloadConfig.enabled) {
      await sendAssetToRpc(link);
      return;
    }

    const downloadKey = computeRpcDownloadKey(link);
    if (browserDownloadStates[downloadKey] === 'sending') return;
    setBrowserDownloadStates((previous) => ({ ...previous, [downloadKey]: 'sending' }));

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
        setBrowserDownloadStates((previous) => ({ ...previous, [downloadKey]: 'idle' }));
        return;
      }
      downloadBrowserBlob(blob, link.name);
      setBrowserDownloadStates((previous) => ({ ...previous, [downloadKey]: 'idle' }));
    } catch (downloadError) {
      setBrowserDownloadStates((previous) => ({ ...previous, [downloadKey]: 'idle' }));
      toast(`${t('下载失败', 'Download failed')}: ${getErrorMessage(downloadError)}`, 'error');
    }
  }, [browserDownloadStates, githubToken, rpcDownloadConfig.enabled, sendAssetToRpc, t, toast]);

  const generateSummary = artifactActions.generateSummary;

  return {
    releases,
    isLoading,
    error,
    summaries: artifactActions.summaries,
    downloadStates: useMemo(
      () => ({ ...browserDownloadStates, ...artifactActions.rpcDownloadStates }),
      [browserDownloadStates, artifactActions.rpcDownloadStates],
    ),
    isRpcEnabled: rpcDownloadConfig.enabled,
    loadReleases,
    sendAssetToRpc,
    downloadAsset,
    generateSummary,
    cancelPendingRequests,
  };
};
