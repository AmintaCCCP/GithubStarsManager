import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Release, ReleaseAsset } from '../types';
import { InstallableAssetRecommendation } from './InstallableAssetRecommendation';
import { resolveDeviceArchitecture } from '../utils/deviceTarget';

// 只替换架构探测，平台探测保持真实实现（它读 navigator，测试里由 stubDevicePlatform 控制）。
vi.mock('../utils/deviceTarget', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/deviceTarget')>();
  return { ...actual, resolveDeviceArchitecture: vi.fn() };
});

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

/** 让平台探测拿不到任何线索，用于「平台未知」的用例。 */
function stubUnknownDevice(): void {
  Object.defineProperty(navigator, 'userAgentData', { value: undefined, configurable: true });
  Object.defineProperty(navigator, 'platform', { value: 'Unknown', configurable: true });
  Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Unknown)', configurable: true });
}

beforeEach(() => {
  // 默认：架构探测立刻给出「拿不到」的结果
  vi.mocked(resolveDeviceArchitecture).mockResolvedValue(undefined);
});

afterEach(() => {
  Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'userAgentData');
  vi.restoreAllMocks();
});

describe('InstallableAssetRecommendation', () => {
  it('为当前设备推荐最佳资产，且只有点击才下载', async () => {
    stubDevicePlatform('Windows');
    const onDownload = vi.fn();
    const user = userEvent.setup();
    render(
      <InstallableAssetRecommendation
        release={makeRelease([
          asset(42, 'App-1.2.0-x64-setup.exe'),
          asset(43, 'App-1.2.0-linux.AppImage'),
        ])}
        onDownload={onDownload}
      />,
    );

    // 未点击前绝不下载、绝不执行任何东西
    expect(onDownload).not.toHaveBeenCalled();
    expect(screen.getByText('App-1.2.0-x64-setup.exe')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /下载此版本/ }));

    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onDownload).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: 42, isSourceCode: false }),
    );
  });

  it('不声称安装包安全，并指向下方的手动资产列表', () => {
    stubDevicePlatform('Windows');
    render(
      <InstallableAssetRecommendation
        release={makeRelease([asset(1, 'App-x64-setup.exe')])}
        onDownload={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        '按文件名与 Release 元数据识别，未验证安装包安全性，也不会自动运行。你始终可以在下方资产列表中手动选择其他资产。',
      ),
    ).toBeInTheDocument();
    // 绝不能出现「已通过安全校验」这类结论
    expect(screen.queryByText(/已通过安全|安全可靠|已验证安全/)).not.toBeInTheDocument();
  });

  it('无适配资产时不渲染整块', () => {
    stubDevicePlatform('Windows');
    const { container } = render(
      <InstallableAssetRecommendation
        release={makeRelease([asset(1, 'App-1.2.0-linux.AppImage')])}
        onDownload={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('installable-asset-recommendation')).not.toBeInTheDocument();
  });

  it('只有源代码或元数据时不渲染', () => {
    stubDevicePlatform('Windows');
    const { container } = render(
      <InstallableAssetRecommendation
        release={makeRelease([
          asset(1, 'Source code (v1.2.0).zip'),
          asset(2, 'checksums.txt'),
          asset(3, 'myapp-1.0.zip'),
        ])}
        onDownload={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('列出其他候选，并说明排除了什么', async () => {
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
        onDownload={onDownload}
      />,
    );

    expect(screen.getByText('其他可选资产（1）')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '下载' }));
    expect(onDownload).toHaveBeenCalledWith(expect.objectContaining({ assetId: 2 }));

    // 排除说明点名了各类非安装资产，用户不会以为它们凭空消失
    expect(screen.getByText(/调试符号/)).toBeInTheDocument();
    expect(screen.getByText(/其他平台\/架构/)).toBeInTheDocument();
  });

  it('平台未知时并列候选，且不标成「适配当前设备」', () => {
    stubUnknownDevice();
    render(
      <InstallableAssetRecommendation
        release={makeRelease([asset(1, 'App-x64-setup.exe'), asset(2, 'App-universal.dmg')])}
        onDownload={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: '可安装候选' })).toBeInTheDocument();
    expect(screen.getByText('未识别出平台')).toBeInTheDocument();
    // 平台未知时候选来自所有平台，因此不能声称匹配当前设备
    expect(screen.queryByText('适配当前设备')).not.toBeInTheDocument();
    expect(screen.getByText('其他可选资产（1）')).toBeInTheDocument();
  });

  it('架构探测未完成前不启用下载', async () => {
    stubDevicePlatform('Windows');
    // 探测一直挂起：模拟 high-entropy hints 还没回来
    vi.mocked(resolveDeviceArchitecture).mockReturnValue(new Promise(() => {}));
    const onDownload = vi.fn();
    const user = userEvent.setup();
    render(
      <InstallableAssetRecommendation
        release={makeRelease([
          asset(1, 'App-x64-setup.exe'),
          asset(2, 'App-win64-portable.7z'),
        ])}
        onDownload={onDownload}
      />,
    );

    // 此时不能启用下载，否则 arm64 设备可能在探测完成前下到 x64 包
    const primary = screen.getByRole('button', { name: /下载此版本/ });
    expect(primary).toBeDisabled();
    expect(screen.getByRole('button', { name: '下载' })).toBeDisabled();
    expect(screen.getByText('正在识别架构…')).toBeInTheDocument();

    await user.click(primary);
    expect(onDownload).not.toHaveBeenCalled();
  });

  it('架构探测结束后恢复可下载', async () => {
    stubDevicePlatform('Windows');
    vi.mocked(resolveDeviceArchitecture).mockResolvedValue('arm64');
    const onDownload = vi.fn();
    const user = userEvent.setup();
    render(
      <InstallableAssetRecommendation
        release={makeRelease([asset(7, 'App-arm64-setup.exe')])}
        onDownload={onDownload}
      />,
    );

    // 探测是异步的：结算后按钮才恢复可用
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /下载此版本/ })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: /下载此版本/ }));
    expect(onDownload).toHaveBeenCalledWith(expect.objectContaining({ assetId: 7 }));
  });

  it('下载发送中或已发送时禁用对应候选按钮', async () => {
    stubDevicePlatform('Windows');
    const release = makeRelease([
      asset(1, 'App-x64-setup.exe'),
      asset(2, 'App-win64-portable.7z'),
    ]);
    const firstUrl = release.assets[0].browser_download_url;
    const secondUrl = release.assets[1].browser_download_url;

    render(
      <InstallableAssetRecommendation
        release={release}
        downloadStates={{
          [`${firstUrl}@${release.assets[0].updated_at}`]: 'sending',
          [`${secondUrl}@${release.assets[1].updated_at}`]: 'sent',
        }}
        onDownload={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /下载此版本/ })).toBeDisabled(),
    );
    expect(screen.getByRole('button', { name: '下载' })).toBeDisabled();
  });
});
