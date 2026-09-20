import { useT } from "../i18n/useT";
import React, { useEffect, useMemo, useState } from 'react';
import { Download, Info, ShieldQuestion } from 'lucide-react';
import type { Release } from '../types';
import type { InstallableArchitecture, InstallablePlatform } from '../types/installableAsset';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { getPlatformDisplayName, getPlatformIcon } from './platformMeta';
import { buildReleaseDownloadLinks, type ReleaseDownloadLink } from '../utils/releaseDownloadLinks';
import { detectInstallableAssets } from '../utils/installableAssets';
import { detectDevicePlatformSync, resolveDeviceArchitecture } from '../utils/deviceTarget';
import { formatFileSize } from '../utils/formatBytes';
import { computeRpcDownloadKey } from '../hooks/useReleaseArtifactActions';

/**
 * 「这台设备能装哪个资产」的内置推荐块。
 *
 * 与插件提供的 `ReleasePluginRecommendations` 的关系：那个是插件能力（需要用户点击分析、
 * 结果由插件负责），这里是 Core 的确定性识别，无需插件、不联网、每次渲染即得。
 * 两者互不替代，可以同时出现——插件可以基于 Health/资产事实给出自己的主观推荐。
 *
 * 明确不做的事（roadmap §5.3）：
 * - 不自动下载、不自动运行安装程序；必须用户点击。
 * - 不声称安装包安全——只说明「按文件名识别为适配当前设备」。
 * - 不隐藏其他资产：识别不出来或平台不匹配的资产仍在下方资产表中可手动下载。
 */
interface InstallableAssetRecommendationProps {
  release: Release;
  downloadStates?: Record<string, 'idle' | 'sending' | 'sent'>;
  /** 复用 Release 资产表同一条下载链路（RPC / 认证下载 / 后端代理）。 */
  onDownload: (link: ReleaseDownloadLink) => void;
}

const ARCHITECTURE_LABELS: Record<InstallableArchitecture, string> = {
  x64: 'x64',
  arm64: 'arm64',
  x86: 'x86',
  universal: 'Universal',
};

export const InstallableAssetRecommendation: React.FC<InstallableAssetRecommendationProps> = ({
  release,
  downloadStates = {},
  onDownload,
}) => {
  const t = useT('app');

  // 平台可同步得到（Electron/Chromium 报告宿主 OS，Web 版报告浏览器所在设备）。
  const [platform] = useState<InstallablePlatform | null>(() => detectDevicePlatformSync());
  const [architecture, setArchitecture] = useState<InstallableArchitecture | undefined>(undefined);
  /**
   * 架构探测是否已结束。
   *
   * 必需状态：`architecture === undefined` 同时表示「还在探测」和「确实拿不到」，
   * 两者混在一起会让首次渲染就保留全部架构并立刻启用下载按钮——在 arm64 设备上，
   * 若 x64 资产排序更靠前，用户可能在探测完成前下到错误架构的包。
   */
  const [architectureSettled, setArchitectureSettled] = useState(false);

  useEffect(() => {
    let active = true;
    void resolveDeviceArchitecture().then((resolved) => {
      if (!active) return;
      setArchitecture(resolved);
      setArchitectureSettled(true);
    });
    return () => {
      active = false;
    };
  }, []);

  // 架构拿不到时不传 architecture —— 跳过架构过滤，并列展示候选而不是猜一个。
  const detection = useMemo(
    () =>
      detectInstallableAssets(release.assets, {
        platform: platform ?? undefined,
        architecture,
      }),
    [release.assets, platform, architecture],
  );

  // 识别结果只带 assetId，下载仍走既有 link 模型，避免第二套下载逻辑。
  const linksByAssetId = useMemo(() => {
    const map = new Map<number, ReleaseDownloadLink>();
    for (const link of buildReleaseDownloadLinks(release)) {
      if (link.assetId !== undefined) map.set(link.assetId, link);
    }
    return map;
  }, [release]);

  if (detection.matches.length === 0) return null;

  const [best, ...alternatives] = detection.matches;
  const bestLink = linksByAssetId.get(best.assetId);
  const bestDownloadState = bestLink
    ? downloadStates[computeRpcDownloadKey(bestLink)] ?? 'idle'
    : 'idle';
  const PlatformIcon = getPlatformIcon(best.platform);
  // 平台未知时不要声称「适配当前设备」：此时候选是并列的全部平台，不是设备匹配结果。
  const platformKnown = platform !== null;
  // 架构探测结束前禁用下载：否则可能在探测完成前下到错误架构的包。
  const downloadEnabled = architectureSettled;

  const describe = (match: typeof best) => {
    // 平台显示名复用 platformMeta，避免再维护一份平台名表。
    const parts = [getPlatformDisplayName(match.platform)];
    if (match.architecture) parts.push(ARCHITECTURE_LABELS[match.architecture]);
    parts.push(match.packageType);
    return parts.join(' · ');
  };

  let deviceSummary: string;
  if (!platformKnown) {
    deviceSummary = t('installableAssetRecommendation.platform-not-detected');
  } else if (!architectureSettled) {
    deviceSummary = t('installableAssetRecommendation.detecting-architecture');
  } else {
    deviceSummary = `${getPlatformDisplayName(platform)}${architecture ? ` · ${ARCHITECTURE_LABELS[architecture]}` : ''}`;
  }

  return (
    <section
      className="mb-3 rounded-md border border-border bg-muted/20 px-3 py-3"
      data-testid="installable-asset-recommendation"
      aria-label={
        platformKnown
          ? t('installableAssetRecommendation.assets-for-this-device')
          : t('installableAssetRecommendation.installable-candidates')
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold">
          {platformKnown
            ? t('installableAssetRecommendation.matches-this-device')
            : t('installableAssetRecommendation.installable-candidates')}
        </h3>
        <span className="text-[11px] text-muted-foreground">{deviceSummary}</span>
        <Badge variant="outline" className="text-[11px] font-normal">
          {t(`installableAssetRecommendation.confidence-${best.confidence}`)}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <PlatformIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="truncate text-xs font-medium" title={best.fileName}>{best.fileName}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {describe(best)} · {formatFileSize(best.size)}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!bestLink || !downloadEnabled || bestDownloadState !== 'idle'}
          onClick={() => bestLink && onDownload(bestLink)}
        >
          <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {t('installableAssetRecommendation.download-this-build')}
        </Button>
      </div>

      {alternatives.length > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <p className="mb-1 text-[11px] text-muted-foreground">
            {t('installableAssetRecommendation.other-candidates-v1', { v1: alternatives.length })}
          </p>
          <ul className="space-y-1">
            {alternatives.map((match) => {
              const link = linksByAssetId.get(match.assetId);
              const downloadState = link
                ? downloadStates[computeRpcDownloadKey(link)] ?? 'idle'
                : 'idle';
              return (
                <li key={match.assetId} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[11px]" title={match.fileName}>
                    {match.fileName}
                    <span className="ml-1 text-muted-foreground">
                      {describe(match)} · {formatFileSize(match.size)}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    disabled={!link || !downloadEnabled || downloadState !== 'idle'}
                    onClick={() => link && onDownload(link)}
                  >
                    {t('installableAssetRecommendation.download')}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="mt-2 flex items-start gap-1 text-[11px] text-muted-foreground">
        <ShieldQuestion className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        <span>
          {t('installableAssetRecommendation.detected-from-filenames-and-release-metadata-no')}
        </span>
      </p>

      {detection.excluded.length > 0 && (
        <p className="mt-1 flex items-start gap-1 text-[11px] text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          <span>
            {t('installableAssetRecommendation.excluded-v1-asset-s-that-do-not-apply-to-this-de', { v1: detection.excluded.length })}
          </span>
        </p>
      )}
    </section>
  );
};

export default InstallableAssetRecommendation;
