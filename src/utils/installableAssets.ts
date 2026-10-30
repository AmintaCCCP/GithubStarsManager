import type { ReleaseAsset } from '../types';
import type {
  InstallableAsset,
  InstallableAssetDetectionOptions,
  InstallableAssetDetectionResult,
  InstallablePackageType,
  InstallablePlatform,
} from '../types/installableAsset';
import {
  evaluateCurrentSystem,
  type AssetVerdict,
  type NonInstallableReason,
} from './assetCompatibility';

function assetToLink(asset: ReleaseAsset, index: number) {
  return {
    index,
    name: asset.name,
    url: asset.browser_download_url,
    contentType: asset.content_type,
    downloadCount: asset.download_count,
    assetId: asset.id,
  };
}

const EXCLUSION_LABELS: Record<NonInstallableReason, string> = {
  'source-archive': 'source code archive',
  checksum: 'checksum file',
  signature: 'signature file',
  'debug-symbols': 'debug symbols',
  'update-metadata': 'release metadata',
  media: 'media/preview file',
  document: 'documentation',
  'sbom-attestation': 'software bill of materials',
  'library-package': 'library package',
  'unsupported-format': 'not a supported installable package format',
};

function packageTypeOf(verdict: AssetVerdict): InstallablePackageType {
  return verdict.kind === 'compatible' ? verdict.packageType as InstallablePackageType : 'raw-binary';
}

function legacyPackageType(verdict: AssetVerdict, fileName: string): InstallablePackageType {
  const type = packageTypeOf(verdict);
  if (type === 'tar' && /\.tar\.gz$/i.test(fileName)) return 'tar.gz';
  return type;
}

function verdictExclusionReason(verdict: AssetVerdict): string | null {
  if (verdict.kind === 'non-installable') return EXCLUSION_LABELS[verdict.reason];
  if (verdict.kind === 'incompatible') return verdict.detail;
  if (verdict.kind === 'unknown') {
    return verdict.detail.startsWith('filename declares multiple platforms')
      ? verdict.detail
      : 'portable archive without a declared target platform';
  }
  return null;
}

/**
 * Thin compatibility wrapper over the shared classifier. The old API remains
 * available to Discovery, My Apps, AI, MCP and plugins.
 */
export function detectInstallableAssets(
  assets: readonly ReleaseAsset[] | undefined,
  options: InstallableAssetDetectionOptions = {},
): InstallableAssetDetectionResult {
  const validAssets = (assets ?? []).filter((asset) => !!asset?.name);
  const links = validAssets.map(assetToLink);
  const device = {
    platform: options.platform ?? null,
    architecture: options.architecture,
    architectureSource: 'none' as const,
    architectureSettled: true,
  };
  const evaluation = evaluateCurrentSystem(links, device, undefined, {
    // 省略 architecture 表示调用方没要求架构过滤，不能当成「设备架构未知」处理。
    filterUnknownArchitecture: options.architecture !== undefined,
  });
  const matches: InstallableAsset[] = [];
  const excluded: InstallableAssetDetectionResult['excluded'] = [];

  for (let index = 0; index < links.length; index++) {
    const asset = validAssets[index];
    const verdict = evaluation.verdicts.get(index);
    if (!verdict) continue;

    if (verdict.kind === 'compatible') {
      matches.push({
        assetId: asset.id,
        fileName: asset.name,
        downloadUrl: asset.browser_download_url,
        size: asset.size,
        platform: verdict.platform,
        architecture: verdict.architecture,
        packageType: legacyPackageType(verdict, asset.name),
        confidence: verdict.emulated && verdict.confidence === 'high' ? 'medium' : verdict.confidence,
        reason: verdict.detail,
      });
      continue;
    }

    if (options.includeDetectOnly && asset.name.toLowerCase().endsWith('.aab')) {
      const platform: InstallablePlatform = 'android';
      if (!options.platform || options.platform === platform) {
        matches.push({
          assetId: asset.id,
          fileName: asset.name,
          downloadUrl: asset.browser_download_url,
          size: asset.size,
          platform,
          packageType: 'aab',
          confidence: 'medium',
          reason: 'Android App Bundle; detect only - not directly installable',
        });
        continue;
      }
    }

    if (!options.includeDetectOnly && asset.name.toLowerCase().endsWith('.aab')) {
      excluded.push({
        assetId: asset.id,
        fileName: asset.name,
        reason: 'Android App Bundle is detect-only and cannot be installed directly',
      });
      continue;
    }

    const reason = verdictExclusionReason(verdict);
    if (reason) excluded.push({ assetId: asset.id, fileName: asset.name, reason });
  }

  const order = new Map(evaluation.orderedIndexes.map((index, rank) => [index, rank]));
  matches.sort((left, right) => {
    const leftIndex = links.findIndex((link) => link.assetId === left.assetId);
    const rightIndex = links.findIndex((link) => link.assetId === right.assetId);
    return (order.get(leftIndex) ?? Number.MAX_SAFE_INTEGER)
      - (order.get(rightIndex) ?? Number.MAX_SAFE_INTEGER);
  });
  return { matches, excluded };
}

export function hasInstallableAsset(
  assets: readonly ReleaseAsset[] | undefined,
  options: InstallableAssetDetectionOptions = {},
): boolean {
  return detectInstallableAssets(assets, options).matches.length > 0;
}
