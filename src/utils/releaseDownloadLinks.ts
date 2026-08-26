import type { Release } from '../types';

export interface ReleaseDownloadLink {
  id: string;
  name: string;
  url: string;
  size: number | null;
  isSourceCode: boolean;
  assetId?: number;
}

export const buildReleaseDownloadLinks = (release: Release): ReleaseDownloadLink[] => {
  const links: ReleaseDownloadLink[] = release.assets.map((asset) => ({
    id: `asset-${asset.id}`,
    name: asset.name,
    url: asset.browser_download_url,
    size: asset.size,
    isSourceCode: false,
    assetId: asset.id,
  }));

  if (release.zipball_url) {
    links.push({
      id: `source-zip-${release.id}`,
      name: `Source code (${release.tag_name}.zip)`,
      url: release.zipball_url,
      size: null,
      isSourceCode: true,
    });
  }

  if (release.tarball_url) {
    links.push({
      id: `source-tar-${release.id}`,
      name: `Source code (${release.tag_name}.tar.gz)`,
      url: release.tarball_url,
      size: null,
      isSourceCode: true,
    });
  }

  return links;
};
