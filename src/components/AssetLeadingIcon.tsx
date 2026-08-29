import { Download } from 'lucide-react';
import { detectAssetPlatform } from '../utils/releaseAssets';
import { getPlatformDisplayName, getPlatformIcon } from './platformMeta';

/**
 * 资产行左侧图标：按文件名/扩展名（含 MIME 兜底）推断平台 → 方形品牌徽章；
 * 推断不出时回退到通用下载图标（不猜）。
 * 下载状态图标（进行中/已完成/源码）由调用方优先渲染。
 * Release 页（ReleaseCard）与仓库 Release 边栏（RepositoryReleaseSheet）共用，
 * 保证两处资产的平台图标一致。
 */
const AssetLeadingIcon = ({ name, contentType }: { name: string; contentType?: string }) => {
  const platform = detectAssetPlatform(name, contentType);
  if (!platform) {
    return <Download className="w-3.5 h-3.5 text-muted-foreground dark:text-muted-foreground/70 flex-shrink-0" aria-hidden="true" />;
  }
  const Icon = getPlatformIcon(platform);
  return (
    <span className="asset-platform-badge flex-shrink-0" title={getPlatformDisplayName(platform)}>
      <Icon className="h-[11px] w-[11px]" aria-hidden="true" />
    </span>
  );
};

export default AssetLeadingIcon;
