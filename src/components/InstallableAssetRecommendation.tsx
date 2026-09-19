import React, { useEffect, useMemo, useState } from 'react';
import { Download, Info, ShieldQuestion } from 'lucide-react';
import type { Release } from '../types';
import type { InstallableArchitecture, InstallableConfidence, InstallablePlatform } from '../types/installableAsset';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { getPlatformDisplayName, getPlatformIcon } from './platformMeta';
import { buildReleaseDownloadLinks, type ReleaseDownloadLink } from '../utils/releaseDownloadLinks';
import { detectInstallableAssets } from '../utils/installableAssets';
import { detectDevicePlatformSync, resolveDeviceArchitecture } from '../utils/deviceTarget';
import { formatFileSize } from '../utils/formatBytes';

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
  language: 'zh' | 'en';
  /** 复用 Release 资产表同一条下载链路（RPC / 认证下载 / 后端代理）。 */
  onDownload: (link: ReleaseDownloadLink) => void;
}

const ARCHITECTURE_LABELS: Record<InstallableArchitecture, string> = {
  x64: 'x64',
  arm64: 'arm64',
  x86: 'x86',
  universal: 'Universal',
};

const CONFIDENCE_LABELS: Record<InstallableConfidence, { zh: string; en: string }> = {
  high: { zh: '高置信', en: 'High confidence' },
  medium: { zh: '中等置信', en: 'Medium confidence' },
  low: { zh: '低置信', en: 'Low confidence' },
};

export const InstallableAssetRecommendation: React.FC<InstallableAssetRecommendationProps> = ({
  release,
  language,
  onDownload,
}) => {
  const t = (zh: string, en: string) => (language === 'zh' ? zh : en);

  // 平台可同步得到（Electron/Chromium 报告宿主 OS，Web 版报告浏览器所在设备）。
  const [platform, setPlatform] = useState<InstallablePlatform | null>(() => detectDevicePlatformSync());
  const [architecture, setArchitecture] = useState<InstallableArchitecture | undefined>(undefined);

  useEffect(() => {
    setPlatform(detectDevicePlatformSync());
  }, []);

  useEffect(() => {
    let active = true;
    void resolveDeviceArchitecture().then((resolved) => {
      if (active) setArchitecture(resolved);
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
  const PlatformIcon = getPlatformIcon(best.platform);

  const describe = (match: typeof best) => {
    // 平台显示名复用 platformMeta，避免再维护一份平台名表。
    const parts = [getPlatformDisplayName(match.platform)];
    if (match.architecture) parts.push(ARCHITECTURE_LABELS[match.architecture]);
    parts.push(match.packageType);
    return parts.join(' · ');
  };

  return (
    <section
      className="mb-3 rounded-md border border-border bg-muted/20 px-3 py-3"
      data-testid="installable-asset-recommendation"
      aria-label={t('适配当前设备的资产', 'Assets for this device')}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold">{t('适配当前设备', 'Matches this device')}</h3>
        {platform && (
          <span className="text-[11px] text-muted-foreground">
            {getPlatformDisplayName(platform)}
            {architecture ? ` · ${ARCHITECTURE_LABELS[architecture]}` : ''}
          </span>
        )}
        <Badge variant="outline" className="text-[11px] font-normal">
          {language === 'zh'
            ? CONFIDENCE_LABELS[best.confidence].zh
            : CONFIDENCE_LABELS[best.confidence].en}
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
          disabled={!bestLink}
          onClick={() => bestLink && onDownload(bestLink)}
        >
          <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {t('下载此版本', 'Download this build')}
        </Button>
      </div>

      {alternatives.length > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <p className="mb-1 text-[11px] text-muted-foreground">
            {t(`其他可选资产（${alternatives.length}）`, `Other candidates (${alternatives.length})`)}
          </p>
          <ul className="space-y-1">
            {alternatives.map((match) => {
              const link = linksByAssetId.get(match.assetId);
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
                    disabled={!link}
                    onClick={() => link && onDownload(link)}
                  >
                    {t('下载', 'Download')}
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
          {t(
            '按文件名与 Release 元数据识别，未验证安装包安全性，也不会自动运行。你始终可以在下方资产列表中手动选择其他资产。',
            'Detected from filenames and release metadata. No safety check is performed and nothing runs automatically. You can always pick another asset in the list below.',
          )}
        </span>
      </p>

      {detection.excluded.length > 0 && (
        <p className="mt-1 flex items-start gap-1 text-[11px] text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          <span title={detection.excluded.map((entry) => `${entry.fileName}: ${entry.reason}`).join('\n')}>
            {t(
              `已排除 ${detection.excluded.length} 个不适用于当前设备的资产（源代码、校验和、签名、调试符号、blockmap、其他平台/架构）。`,
              `Excluded ${detection.excluded.length} asset(s) that do not apply to this device (source code, checksums, signatures, debug symbols, blockmaps, other platforms or architectures).`,
            )}
          </span>
        </p>
      )}
    </section>
  );
};

export default InstallableAssetRecommendation;
