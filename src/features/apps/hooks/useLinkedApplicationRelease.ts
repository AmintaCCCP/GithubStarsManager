import { useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Release, ReleaseAsset } from '../../../types';
import type { LinkedApplication } from '../../../types/linkedApplication';
import { backend } from '../../../services/backendAdapter';
import { GitHubApiService } from '../../../services/githubApi';
import { shouldBypassBackend } from '../../../services/routeMode';
import { useAppStore } from '../../../store/useAppStore';
import {
  resolveLinkedApplicationUpdateStatus,
  selectLatestRelease,
  type LinkedApplicationUpdateStatus,
} from '../../../utils/linkedApplications';
import { buildReleaseDownloadLinks } from '../../../utils/releaseDownloadLinks';

/** 详情面板一次只看一个仓库，取一页足够覆盖「最新稳定版 + 少量历史」。 */
const REMOTE_RELEASE_PAGE_SIZE = 30;

export interface UseLinkedApplicationReleaseResult {
  /** 已取到的 Release（按 GitHub 返回顺序），供阶段 3 的版本选择器继续复用。 */
  releases: Release[];
  /** 结合 `includePrereleases` 选出的最新版本。 */
  latestRelease: Release | null;
  updateStatus: LinkedApplicationUpdateStatus;
  isLoading: boolean;
  /** 原始错误信息，仅用于诊断；界面文案统一走 i18n 的失败态。 */
  error: string | null;
  /** 最新 Release 里的可下载资产名（复用 releaseDownloadLinks，不在本阶段提供下载入口）。 */
  assetNames: string[];
  refresh: () => void;
}

const isAbortError = (error: unknown): boolean => (
  (error instanceof DOMException && error.name === 'AbortError')
  || (error instanceof Error && error.name === 'AbortError')
);

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const asNumber = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) ? value : null
);

const mapBackendAsset = (value: unknown): ReleaseAsset | null => {
  if (!value || typeof value !== 'object') return null;
  const asset = value as Record<string, unknown>;
  const id = asNumber(asset.id);
  const name = asString(asset.name);
  const browserDownloadUrl = asString(asset.browser_download_url);
  if (id === null || name === null || browserDownloadUrl === null) return null;
  return {
    id,
    name,
    size: asNumber(asset.size) ?? 0,
    download_count: asNumber(asset.download_count) ?? 0,
    browser_download_url: browserDownloadUrl,
    content_type: asString(asset.content_type) ?? '',
    created_at: asString(asset.created_at) ?? '',
    updated_at: asString(asset.updated_at) ?? '',
  };
};

/**
 * 后端代理返回的是原始 GitHub JSON，需要在这里映射成领域 `Release`。
 * 只映射展示所需的字段；草稿或缺少发布时间的条目直接丢弃（与 release sheet 同一口径）。
 */
const mapBackendRelease = (value: Record<string, unknown>, repositoryFullName: string): Release | null => {
  if (value.draft === true) return null;
  const id = asNumber(value.id);
  const tagName = asString(value.tag_name);
  const publishedAt = asString(value.published_at);
  const htmlUrl = asString(value.html_url);
  if (id === null || tagName === null || publishedAt === null || htmlUrl === null) return null;

  return {
    id,
    tag_name: tagName,
    name: asString(value.name) ?? tagName,
    body: asString(value.body) ?? '',
    published_at: publishedAt,
    html_url: htmlUrl,
    assets: Array.isArray(value.assets)
      ? value.assets.map(mapBackendAsset).filter((asset): asset is ReleaseAsset => asset !== null)
      : [],
    zipball_url: asString(value.zipball_url) ?? undefined,
    tarball_url: asString(value.tarball_url) ?? undefined,
    prerelease: value.prerelease === true,
    repository: {
      id: 0,
      full_name: repositoryFullName,
      name: repositoryFullName.split('/').pop() ?? repositoryFullName,
    },
  };
};

const splitRepositoryFullName = (fullName: string): { owner: string; name: string } | null => {
  const [owner, ...nameParts] = fullName.split('/');
  const name = nameParts.join('/');
  if (!owner || !name) return null;
  return { owner, name };
};

/**
 * 查询某个已关联应用对应的仓库 Release（开发守则 §3，阶段 1a）。
 *
 * 边界：
 * - **只在用户打开界面时查询**（组件挂载/切换应用/手动刷新），没有后台轮询与定时器；
 *   后台更新检测是阶段 2，必须单独成 PR。
 * - 复用既有 GitHub 能力（`backendAdapter` / `githubApi`）并按 `routeMode` 决定走
 *   后端代理还是浏览器直连，不新写一套 API 调用。
 * - 查询成功后把 `lastCheckedAt` 记回 Store：effect 依赖只挂基本类型（id / 全名 / token /
 *   刷新序号），因此这次写入不会反过来触发自身重跑。
 */
export const useLinkedApplicationRelease = (
  application: LinkedApplication | null,
): UseLinkedApplicationReleaseResult => {
  const { githubToken } = useAppStore(useShallow((state) => ({
    githubToken: state.githubToken,
  })));

  const [releases, setReleases] = useState<Release[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const applicationId = application?.id ?? null;
  const repositoryFullName = application?.repositoryFullName ?? '';
  const includePrereleases = application?.includePrereleases ?? true;

  useEffect(() => {
    if (!applicationId || !repositoryFullName) {
      setReleases([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    const coordinates = splitRepositoryFullName(repositoryFullName);
    if (!coordinates) {
      setReleases([]);
      setError('Invalid repository full name');
      setIsLoading(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);
    setError(null);

    void (async () => {
      try {
        let fetched: Release[] | null = null;
        let backendError: unknown;

        if (!shouldBypassBackend() && backend.isAvailable) {
          try {
            const records = await backend.getRepositoryReleases(
              coordinates.owner,
              coordinates.name,
              1,
              REMOTE_RELEASE_PAGE_SIZE,
              controller.signal,
            );
            fetched = records
              .map((record) => mapBackendRelease(record, repositoryFullName))
              .filter((release): release is Release => release !== null);
          } catch (requestError) {
            if (isAbortError(requestError)) throw requestError;
            backendError = requestError;
          }
        }

        if (fetched === null) {
          if (!githubToken) {
            throw backendError ?? new Error('A GitHub token is required to read releases');
          }
          const githubApi = new GitHubApiService(githubToken);
          const page = await githubApi.getRepositoryReleasesPage(
            coordinates.owner,
            coordinates.name,
            1,
            REMOTE_RELEASE_PAGE_SIZE,
            controller.signal,
          );
          fetched = page.releases.map((release) => ({
            ...release,
            repository: {
              id: release.repository?.id ?? 0,
              full_name: repositoryFullName,
              name: coordinates.name,
            },
          }));
        }

        if (controller.signal.aborted) return;
        setReleases(fetched);
        useAppStore.getState().markLinkedApplicationChecked(applicationId, new Date().toISOString());
      } catch (requestError) {
        if (isAbortError(requestError) || controller.signal.aborted) return;
        setReleases([]);
        setError(requestError instanceof Error ? requestError.message : String(requestError));
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setIsLoading(false);
        }
      }
    })();

    return () => controller.abort();
  }, [applicationId, repositoryFullName, githubToken, reloadToken]);

  const latestRelease = selectLatestRelease(releases, includePrereleases);

  const updateStatus = resolveLinkedApplicationUpdateStatus({
    installedVersion: application?.installedVersion,
    latestRelease,
    includePrereleases,
  });

  const assetNames = latestRelease
    ? buildReleaseDownloadLinks(latestRelease)
        .filter((link) => !link.isSourceCode)
        .map((link) => link.name)
    : [];

  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  return { releases, latestRelease, updateStatus, isLoading, error, assetNames, refresh };
};
