import { describe, expect, it } from 'vitest';
import type { Release } from '../types';
import { buildReleaseDownloadLinks } from './releaseDownloadLinks';

const release: Release = {
  id: 12,
  tag_name: 'v1.2.0',
  name: 'Version 1.2.0',
  body: '',
  published_at: '2026-01-01T00:00:00.000Z',
  html_url: 'https://github.com/owner/repo/releases/tag/v1.2.0',
  assets: [{
    id: 7,
    name: 'app.zip',
    size: 1024,
    download_count: 0,
    browser_download_url: 'https://example.com/app.zip',
    content_type: 'application/zip',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }],
  zipball_url: 'https://api.github.com/repos/owner/repo/zipball/v1.2.0',
  tarball_url: 'https://api.github.com/repos/owner/repo/tarball/v1.2.0',
  repository: { id: 1, full_name: 'owner/repo', name: 'repo' },
};

describe('buildReleaseDownloadLinks', () => {
  it('lists uploaded assets first and appends ZIP/TAR source archives with unknown sizes', () => {
    expect(buildReleaseDownloadLinks(release)).toEqual([
      {
        id: 'asset-7',
        name: 'app.zip',
        url: 'https://example.com/app.zip',
        authenticatedUrl: 'https://api.github.com/repos/owner/repo/releases/assets/7',
        size: 1024,
        isSourceCode: false,
        assetId: 7,
      },
      {
        id: 'source-zip-12',
        name: 'Source code (v1.2.0.zip)',
        url: 'https://api.github.com/repos/owner/repo/zipball/v1.2.0',
        authenticatedUrl: 'https://api.github.com/repos/owner/repo/zipball/v1.2.0',
        size: null,
        isSourceCode: true,
      },
      {
        id: 'source-tar-12',
        name: 'Source code (v1.2.0.tar.gz)',
        url: 'https://api.github.com/repos/owner/repo/tarball/v1.2.0',
        authenticatedUrl: 'https://api.github.com/repos/owner/repo/tarball/v1.2.0',
        size: null,
        isSourceCode: true,
      },
    ]);
  });
});
