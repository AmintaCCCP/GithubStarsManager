import { makeT } from './useT';
import type { AppLanguage } from './languages';

/**
 * Discovery 频道/平台的本地化名称：内置频道按稳定 id 走翻译资源，
 * 用户自定义频道回退 nameEn（再回退中文规范名）。zh 直接用规范名。
 */
export function discoveryChannelName(
  channel: { id: string; name: string; nameEn?: string },
  language: AppLanguage,
): string {
  if (language === 'zh') return channel.name;
  const key = `discoveryChannel.${channel.id}`;
  const localized = makeT(language, 'discovery')(key);
  if (localized !== key) return localized;
  return channel.nameEn || channel.name;
}

export function discoveryPlatformName(
  platform: { id: string; name: string; nameEn?: string },
  language: AppLanguage,
): string {
  if (language === 'zh') return platform.name;
  const key = `discoveryPlatform.${platform.id}`;
  const localized = makeT(language, 'discovery')(key);
  if (localized !== key) return localized;
  return platform.nameEn || platform.name;
}
