import type { Release } from '../types';

export interface ReleaseDownloadLink {
  id: string;
  name: string;
  url: string;
  authenticatedUrl?: string;
  authenticatedPath?: string;
  size: number | null;
  isSourceCode: boolean;
  assetId?: number;
  /** 资产自身的 updated_at（ISO 字符串）；Source code 条目没有。 */
  updatedAt?: string;
  /** GitHub 给出的 MIME 类型，供平台推断的 MIME 兜底层使用。 */
  contentType?: string;
}

export const buildReleaseDownloadLinks = (release: Release): ReleaseDownloadLink[] => {
  const links: ReleaseDownloadLink[] = release.assets.map((asset) => ({
    id: `asset-${asset.id}`,
    name: asset.name,
    url: asset.browser_download_url,
    authenticatedUrl: `https://api.github.com/repos/${release.repository.full_name}/releases/assets/${asset.id}`,
    authenticatedPath: `/repos/${release.repository.full_name}/releases/assets/${asset.id}`,
    size: asset.size,
    isSourceCode: false,
    assetId: asset.id,
    updatedAt: asset.updated_at,
    contentType: asset.content_type,
  }));

  if (release.zipball_url) {
    links.push({
      id: `source-zip-${release.id}`,
      name: `Source code (${release.tag_name}.zip)`,
      url: release.zipball_url,
      authenticatedUrl: release.zipball_url,
      authenticatedPath: `/repos/${release.repository.full_name}/zipball/${encodeURIComponent(release.tag_name)}`,
      size: null,
      isSourceCode: true,
    });
  }

  if (release.tarball_url) {
    links.push({
      id: `source-tar-${release.id}`,
      name: `Source code (${release.tag_name}.tar.gz)`,
      url: release.tarball_url,
      authenticatedUrl: release.tarball_url,
      authenticatedPath: `/repos/${release.repository.full_name}/tarball/${encodeURIComponent(release.tag_name)}`,
      size: null,
      isSourceCode: true,
    });
  }

  return links;
};
