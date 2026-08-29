import type { Release, ReleaseAsset, Repository } from '../types';
import { detectAssetPlatform, OS_TOKEN_PLATFORM } from './releaseAssets';

/**
 * 仓库「支持平台」的确定性识别（P1 + P2）。
 *
 * 背景：ai_platforms 来自 AI 分析，不够准。这里用两类免费、确定性的信号
 * 重新推断，卡片展示时优先采用，全部无信号时才回退 ai_platforms：
 *
 * P1 release-assets —— Release 资产文件名。复用 detectAssetPlatform，
 * 对最近 N 个 release 逐个聚合：同一 release 内同平台只计一次（一个版本
 * 打一堆架构包不应叠加权重），每个命中 release 记 WEIGHT_PER_RELEASE。
 * release 订阅刷新本来就会拉全量 assets，此层零额外网络请求。
 *
 * P2 repository-metadata —— topics / description / 主语言。
 * topics 与 OS 语义词表直接对应（'macos'/'android'/'cli'…，含
 * 'cross-platform' 这类组合词）；description 用与资产文件名同一份
 * OS 分词词表做整词匹配；主语言做弱映射（Swift→Apple 系、Kotlin→Android…）。
 *
 * 各信号带权重，总分达到 PLATFORM_DISPLAY_THRESHOLD 才参与展示：
 * 语言(2)/描述(2)单独不够，需要互相印证或叠加 topic(4)/资产(10)。
 */

export type PlatformSignalSource = 'release-assets' | 'topics' | 'description' | 'languages';

export interface PlatformSignal {
  platform: string;
  weight: number;
  source: PlatformSignalSource;
}

/** 聚合最近 N 个 release；项目转型后旧平台的产物不应继续投票。 */
const MAX_RELEASES = 10;
/** 每有一个 release 的资产命中该平台计一次权重。 */
const WEIGHT_PER_RELEASE = 10;
export const PLATFORM_DISPLAY_THRESHOLD = 4;

/** 展示顺序：与 platformMeta 的品牌图标一一对应，未知键排在最后。 */
const PLATFORM_DISPLAY_ORDER = ['macos', 'windows', 'linux', 'ios', 'android', 'docker', 'web', 'cli'];

const TOPIC_PLATFORM: Record<string, string[]> = {
  macos: ['macos'], mac: ['macos'], apple: ['macos'], swift: ['macos', 'ios'], swiftui: ['macos', 'ios'],
  ios: ['ios'], ipados: ['ios'], iphone: ['ios'],
  watchos: ['ios'], tvos: ['ios'],
  android: ['android'],
  windows: ['windows'], uwp: ['windows'], winui: ['windows'], dotnet: ['windows'],
  linux: ['linux'], unix: ['linux'],
  docker: ['docker'], container: ['docker'], containers: ['docker'], kubernetes: ['docker'],
  web: ['web'], webapp: ['web'],
  cli: ['cli'], terminal: ['cli'], tui: ['cli'],
  crossplatform: ['macos', 'windows', 'linux'],
};

/** 主语言 → 平台弱信号。仅作印证用，单独永远到不了展示阈值。 */
const LANGUAGE_PLATFORM: Record<string, string[]> = {
  swift: ['macos', 'ios'],
  'objective-c': ['macos', 'ios'],
  kotlin: ['android'],
  dart: ['android', 'ios'],
  'c#': ['windows'],
};

const addSignals = (map: Map<string, number>, platforms: string[], weight: number) => {
  for (const platform of platforms) {
    map.set(platform, (map.get(platform) ?? 0) + weight);
  }
};

/**
 * P1：从 release 资产推断平台信号。
 * 同一 release 内同平台去重后每个记 WEIGHT_PER_RELEASE；
 * 只看最近 MAX_RELEASES 个（按 published_at 降序）。
 */
export function inferPlatformsFromReleases(
  releases: Array<Pick<Release, 'assets' | 'published_at'>>,
): PlatformSignal[] {
  const sorted = [...releases]
    .filter(release => !Number.isNaN(new Date(release.published_at).getTime()))
    .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
    .slice(0, MAX_RELEASES);

  const weights = new Map<string, number>();
  for (const release of sorted) {
    const platforms = new Set<string>();
    for (const asset of (release.assets ?? []) as ReleaseAsset[]) {
      const platform = detectAssetPlatform(asset.name, asset.content_type);
      if (platform) platforms.add(platform);
    }
    addSignals(weights, [...platforms], WEIGHT_PER_RELEASE);
  }

  return [...weights.entries()]
    .map(([platform, weight]): PlatformSignal => ({ platform, weight, source: 'release-assets' }));
}

/**
 * P2：从仓库元数据（topics/description/主语言）推断平台信号。
 * topics 按去掉分隔符后的整词查表（'cross-platform' → 'crossplatform'）；
 * description 复用资产文件名的 OS 语义词表做整词匹配，避免子串误报。
 */
export function inferPlatformsFromRepositoryMetadata(
  repository: Pick<Repository, 'topics' | 'description' | 'language'>,
): PlatformSignal[] {
  const signals: PlatformSignal[] = [];

  const topicWeights = new Map<string, number>();
  for (const topic of repository.topics ?? []) {
    const platforms = TOPIC_PLATFORM[topic.toLowerCase().replace(/[^a-z0-9]/g, '')];
    if (platforms) addSignals(topicWeights, platforms, 4);
  }
  signals.push(...[...topicWeights.entries()]
    .map(([platform, weight]): PlatformSignal => ({ platform, weight, source: 'topics' })));

  const description = (repository.description ?? '').toLowerCase();
  if (description) {
    const descriptionWeights = new Map<string, number>();
    for (const token of description.split(/[^a-z0-9]+/)) {
      const platform = OS_TOKEN_PLATFORM[token];
      if (platform) {
        descriptionWeights.set(platform, (descriptionWeights.get(platform) ?? 0) + 2);
        break; // 描述命中一次即可，多次重复不叠加
      }
    }
    signals.push(...[...descriptionWeights.entries()]
      .map(([platform, weight]): PlatformSignal => ({ platform, weight, source: 'description' })));
  }

  const language = repository.language?.toLowerCase();
  if (language) {
    for (const platform of LANGUAGE_PLATFORM[language] ?? []) {
      signals.push({ platform, weight: 2, source: 'languages' });
    }
  }

  return signals;
}

/**
 * 汇总 P1+P2 信号并按展示顺序输出确定性平台列表。
 * 只统计 `release.repository.id === repository.id` 的 release——调用方
 * （useRepositoryPlatforms）传入的是全局 releases 数组，若不过滤，
 * 其它仓库的资产信号会串台到当前仓库的平台列表。
 * 信号总分达到 PLATFORM_DISPLAY_THRESHOLD 的平台才入选；
 * 没有任何平台达标时回退 ai_platforms（保持旧行为）。
 */
export function resolveRepositoryPlatforms(
  repository: Pick<Repository, 'id' | 'topics' | 'description' | 'language' | 'ai_platforms'>,
  releases: Array<Pick<Release, 'repository' | 'assets' | 'published_at'>>,
): string[] {
  const ownReleases = releases.filter(
    release => release.repository?.id === repository.id,
  );

  const totals = new Map<string, number>();
  for (const signal of [
    ...inferPlatformsFromReleases(ownReleases),
    ...inferPlatformsFromRepositoryMetadata(repository),
  ]) {
    totals.set(signal.platform, (totals.get(signal.platform) ?? 0) + signal.weight);
  }

  const detected = [...totals.entries()]
    .filter(([, weight]) => weight >= PLATFORM_DISPLAY_THRESHOLD)
    .map(([platform]) => platform);

  if (detected.length === 0) {
    return repository.ai_platforms ?? [];
  }

  const order = (platform: string) => {
    const index = PLATFORM_DISPLAY_ORDER.indexOf(platform);
    return index === -1 ? PLATFORM_DISPLAY_ORDER.length : index;
  };
  return detected.sort((a, b) => order(a) - order(b));
}
