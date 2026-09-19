import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Release, ReleaseAsset } from '../types';
import { InstallableAssetRecommendation } from './InstallableAssetRecommendation';

function asset(id: number, name: string, contentType = 'application/octet-stream'): ReleaseAsset {
  return {
    id,
    name,
    size: 1024 * id,
    download_count: 0,
    browser_download_url: `https://github.com/acme/alpha/releases/download/v1/${name}`,
    content_type: contentType,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function makeRelease(assets: ReleaseAsset[]): Release {
  return {
    id: 1,
    tag_name: 'v1.2.0',
    name: 'v1.2.0',
    body: null,
    published_at: '2026-08-01T00:00:00.000Z',
    html_url: 'https://github.com/acme/alpha/releases/tag/v1.2.0',
    assets,
    repository: { id: 1, full_name: 'acme/alpha', name: 'alpha' },
  };
}

/** 固定「当前设备」为 Windows，避免依赖 jsdom 的 UA 字符串。 */
function stubDevicePlatform(platform: string): void {
  Object.defineProperty(navigator, 'userAgentData', {
    value: { platform },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'userAgentData');
  vi.restoreAllMocks();
});

describe('InstallableAssetRecommendation', () => {
  it('recommends the best asset for this device and downloads only on click', async () => {
    stubDevicePlatform('Windows');
    const onDownload = vi.fn();
    const user = userEvent.setup();
    render(
      <InstallableAssetRecommendation
        release={makeRelease([
          asset(42, 'App-1.2.0-x64-setup.exe'),
          asset(43, 'App-1.2.0-linux.AppImage'),
        ])}
        language="en"
        onDownload={onDownload}
      />,
    );

    // 未点击前绝不下载、绝不执行任何东西
    expect(onDownload).not.toHaveBeenCalled();
    expect(screen.getByText('App-1.2.0-x64-setup.exe')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /download this build/i }));

    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onDownload).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: 42, isSourceCode: false }),
    );
  });

  it('never claims the asset is safe and points at the manual asset list', () => {
    stubDevicePlatform('Windows');
    render(
      <InstallableAssetRecommendation
        release={makeRelease([asset(1, 'App-x64-setup.exe')])}
        language="en"
        onDownload={vi.fn()}
      />,
    );

    expect(screen.getByText(/no safety check is performed/i)).toBeInTheDocument();
    expect(screen.getByText(/pick another asset in the list below/i)).toBeInTheDocument();
    expect(screen.queryByText(/\bis safe\b/i)).not.toBeInTheDocument();
  });

  it('renders nothing when no asset matches this device', () => {
    stubDevicePlatform('Windows');
    const { container } = render(
      <InstallableAssetRecommendation
        release={makeRelease([asset(1, 'App-1.2.0-linux.AppImage')])}
        language="en"
        onDownload={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('installable-asset-recommendation')).not.toBeInTheDocument();
  });

  it('renders nothing for releases that only ship source or metadata', () => {
    stubDevicePlatform('Windows');
    const { container } = render(
      <InstallableAssetRecommendation
        release={makeRelease([
          asset(1, 'Source code (v1.2.0).zip'),
          asset(2, 'checksums.txt'),
          asset(3, 'myapp-1.0.zip'),
        ])}
        language="en"
        onDownload={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('lists the remaining candidates and explains what was excluded', async () => {
    stubDevicePlatform('Windows');
    const onDownload = vi.fn();
    const user = userEvent.setup();
    render(
      <InstallableAssetRecommendation
        release={makeRelease([
          asset(1, 'App-x64-setup.exe'),
          asset(2, 'App-win64-portable.7z'),
          asset(3, 'App-1.2.0.pdb'),
          asset(4, 'App-1.2.0.dmg'),
        ])}
        language="en"
        onDownload={onDownload}
      />,
    );

    expect(screen.getByText('Other candidates (1)')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(onDownload).toHaveBeenCalledWith(expect.objectContaining({ assetId: 2 }));

    // 排除说明里点名了各类非安装资产，用户不会以为它们凭空消失
    expect(screen.getByText(/debug symbols/i)).toBeInTheDocument();
    expect(screen.getByText(/other platforms or architectures/i)).toBeInTheDocument();
  });

  it('renders candidates for every platform when the device platform cannot be detected', () => {
    Object.defineProperty(navigator, 'userAgentData', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'platform', { value: 'Unknown', configurable: true });
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Unknown)', configurable: true });

    render(
      <InstallableAssetRecommendation
        release={makeRelease([asset(1, 'App-x64-setup.exe'), asset(2, 'App-universal.dmg')])}
        language="en"
        onDownload={vi.fn()}
      />,
    );

    expect(screen.getByTestId('installable-asset-recommendation')).toBeInTheDocument();
    expect(screen.getByText('Other candidates (1)')).toBeInTheDocument();
  });
});
