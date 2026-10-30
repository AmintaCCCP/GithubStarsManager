import type { Release, Repository } from '../types';
import type {
  DeviceTarget,
  InstallableArchitecture,
  InstallablePlatform,
} from '../types/installableAsset';
import {
  inferPlatformsFromReleases,
  inferPlatformsFromRepositoryMetadata,
  PLATFORM_DISPLAY_THRESHOLD,
} from './repoPlatformDetection';

export type AssetLinkInput = {
  index: number;
  name: string;
  url: string;
  contentType?: string;
  isSourceCode?: boolean;
  downloadCount?: number;
  assetId?: number;
};

export type NonInstallableReason =
  | 'source-archive'
  | 'checksum'
  | 'signature'
  | 'debug-symbols'
  | 'update-metadata'
  | 'media'
  | 'document'
  | 'sbom-attestation'
  | 'library-package'
  | 'unsupported-format';

export type PlatformSource = 'extension' | 'token' | 'content-type' | 'sibling' | 'repo-history' | 'repo-metadata';
export type ArchSource = 'declared' | 'sibling-implied' | 'none';

export type AssetVerdict =
  | { kind: 'non-installable'; reason: NonInstallableReason; detail: string }
  | { kind: 'incompatible'; detail: string }
  | {
      kind: 'compatible';
      platform: InstallablePlatform;
      platformSource: PlatformSource;
      architecture?: InstallableArchitecture;
      archSource: ArchSource;
      emulated: boolean;
      packageType: string;
      variants: string[];
      confidence: 'high' | 'medium' | 'low';
      detail: string;
    }
  | { kind: 'unknown'; detail: string };

export interface CurrentSystemEvaluation {
  matchesRelease: boolean;
  matchedLinkIndexes: Set<number>;
  orderedIndexes: number[];
  badges: Map<number, 'recommended' | 'emulated' | 'unverified'>;
  verdicts: Map<number, AssetVerdict>;
}

export interface RepositoryHints {
  otherReleases?: Array<Pick<Release, 'assets' | 'published_at'>>;
  repository?: Pick<Repository, 'topics' | 'description' | 'language'>;
}

const SUPPORTED_PLATFORMS: readonly InstallablePlatform[] = ['windows', 'macos', 'linux', 'android'];

const FOREIGN_OS_TOKENS = new Set([
  'freebsd', 'openbsd', 'netbsd', 'dragonfly', 'dragonflybsd', 'solaris', 'illumos',
  'sunos', 'aix', 'plan9', 'haiku', 'wasm', 'wasi', 'ios', 'ipados', 'iphone',
  'tvos', 'watchos', 'visionos',
]);

const MACOS_TOKENS = new Set(['macos', 'mac', 'osx', 'darwin', 'apple', 'macosx', 'osx64', 'darwin' + '64']);
const WINDOWS_TOKENS = new Set(['windows', 'win', 'win32', 'win64', 'mingw', 'msvc']);
const LINUX_TOKENS = new Set([
  'linux', 'linux64', 'linux32', 'musllinux', 'manylinux', 'anylinux', 'ubuntu', 'debian',
  'fedora', 'alpine', 'musl', 'el7', 'el8', 'el9', 'appimage',
]);

const FOREIGN_ARCH_PATTERN = /^(?:mips|ppc|powerpc|s390x|riscv|loong|sparc)/;
const ARM32_PATTERN = /^arm(?:v[5-8][a-z]?|hf|el|eabi|32v\d*)?$/;

const KNOWN_VIDEO_AUDIO = new Set([
  'mp4', 'webm', 'mov', 'mkv', 'avi', 'mp3', 'wav', 'ogg', 'flac',
]);
const KNOWN_IMAGES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'icns', 'bmp', 'tif', 'tiff', 'heic', 'avif']);
const KNOWN_DOCUMENTS = new Set(['pdf', 'md', 'txt', 'rst', 'html', 'htm']);
const KNOWN_CHECKSUM_EXTENSIONS = new Set(['sha1', 'sha256', 'sha512', 'md5', 'sum', 'b2']);
const KNOWN_SIGNATURE_EXTENSIONS = new Set(['sig', 'asc', 'minisig', 'p7s', 'pem', 'crt', 'cer', 'sigstore']);
const KNOWN_DEBUG_EXTENSIONS = new Set(['pdb', 'dsym', 'dbg', 'debug']);
const KNOWN_UPDATE_EXTENSIONS = new Set(['yml', 'yaml', 'json', 'jsonl', 'xml', 'blockmap', 'zsync', 'asar', 'nupkg', 'delta']);
const KNOWN_LIBRARY_EXTENSIONS = new Set(['whl', 'gem', 'crate', 'nupkg', 'jar', 'vsix', 'xpi', 'crx', 'aab']);

interface PackageInfo {
  packageType: string;
  extension?: string;
  decisivePlatform: InstallablePlatform | null;
}

interface PackageTypeEntry {
  suffix: string;
  packageType: string;
  decisivePlatform: InstallablePlatform | null;
}

const PACKAGE_TYPE_ENTRIES: PackageTypeEntry[] = [
  { suffix: '.app.tar.gz', packageType: 'app-archive', decisivePlatform: 'macos' },
  { suffix: '.app.zip', packageType: 'app-archive', decisivePlatform: 'macos' },
  { suffix: '.pkg.tar.zst', packageType: 'pacman', decisivePlatform: 'linux' },
  { suffix: '.pkg.tar.xz', packageType: 'pacman', decisivePlatform: 'linux' },
  { suffix: '.flatpakref', packageType: 'flatpak', decisivePlatform: 'linux' },
  { suffix: '.appxbundle', packageType: 'msix', decisivePlatform: 'windows' },
  { suffix: '.msixbundle', packageType: 'msix', decisivePlatform: 'windows' },
  { suffix: '.appinstaller', packageType: 'msix', decisivePlatform: 'windows' },
  { suffix: '.appimage', packageType: 'appimage', decisivePlatform: 'linux' },
  { suffix: '.flatpak', packageType: 'flatpak', decisivePlatform: 'linux' },
  { suffix: '.tar.gz', packageType: 'tar', decisivePlatform: null },
  { suffix: '.tar.xz', packageType: 'tar', decisivePlatform: null },
  { suffix: '.tar.bz2', packageType: 'tar', decisivePlatform: null },
  { suffix: '.tar.zst', packageType: 'tar', decisivePlatform: null },
  { suffix: '.appx', packageType: 'msix', decisivePlatform: 'windows' },
  { suffix: '.msix', packageType: 'msix', decisivePlatform: 'windows' },
  { suffix: '.dmg', packageType: 'dmg', decisivePlatform: 'macos' },
  { suffix: '.pkg', packageType: 'pkg', decisivePlatform: 'macos' },
  { suffix: '.exe', packageType: 'exe', decisivePlatform: 'windows' },
  { suffix: '.msi', packageType: 'msi', decisivePlatform: 'windows' },
  { suffix: '.deb', packageType: 'deb', decisivePlatform: 'linux' },
  { suffix: '.rpm', packageType: 'rpm', decisivePlatform: 'linux' },
  { suffix: '.snap', packageType: 'snap', decisivePlatform: 'linux' },
  { suffix: '.apk', packageType: 'apk', decisivePlatform: 'android' },
  { suffix: '.xapk', packageType: 'xapk', decisivePlatform: 'android' },
  { suffix: '.apks', packageType: 'apks', decisivePlatform: 'android' },
  { suffix: '.aab', packageType: 'aab', decisivePlatform: 'android' },
  { suffix: '.tgz', packageType: 'tar', decisivePlatform: null },
  { suffix: '.txz', packageType: 'tar', decisivePlatform: null },
  { suffix: '.tbz2', packageType: 'tar', decisivePlatform: null },
  { suffix: '.tar', packageType: 'tar', decisivePlatform: null },
  { suffix: '.zip', packageType: 'zip', decisivePlatform: null },
  { suffix: '.7z', packageType: '7z', decisivePlatform: null },
  { suffix: '.rar', packageType: 'rar', decisivePlatform: null },
  { suffix: '.gz', packageType: 'compressed-binary', decisivePlatform: null },
  { suffix: '.xz', packageType: 'compressed-binary', decisivePlatform: null },
  { suffix: '.bz2', packageType: 'compressed-binary', decisivePlatform: null },
  { suffix: '.zst', packageType: 'compressed-binary', decisivePlatform: null },
];

const PACKAGE_TYPES = [...PACKAGE_TYPE_ENTRIES].sort(
  (left, right) => right.suffix.length - left.suffix.length,
);

interface ScannedName {
  normalized: string;
  tokens: string[];
  declaredPlatforms: Set<InstallablePlatform>;
  hasForeignOs: boolean;
  declaredArchitectures: Set<InstallableArchitecture>;
  hasForeignArchitecture: boolean;
  hasWin32: boolean;
  hasWin64: boolean;
  ambiguousArchitecture: boolean;
  variants: string[];
  variantScore: number;
  variantTie: number;
}

const SCAN_NAME_CACHE_LIMIT = 5000;
const scanNameCache = new Map<string, ScannedName>();

function fileExtension(name: string): string {
  const lower = name.toLowerCase();
  const compound = ['.tar.gz', '.tar.xz', '.tar.bz2', '.tar.zst', '.app.zip', '.app.tar.gz']
    .find((suffix) => lower.endsWith(suffix));
  if (compound) return compound.slice(1);
  const index = lower.lastIndexOf('.');
  return index >= 0 ? lower.slice(index + 1) : '';
}

function detectPackageInfo(name: string): PackageInfo | null {
  const lower = name.toLowerCase();
  const found = PACKAGE_TYPES.find((entry) => lower.endsWith(entry.suffix));
  return found ? { ...found } : null;
}

function basename(url: string): string {
  try {
    const path = new URL(url).pathname;
    return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
  } catch {
    return '';
  }
}

function displayName(link: AssetLinkInput): string {
  if (link.assetId !== undefined || link.isSourceCode) return link.name;
  const fromUrl = basename(link.url);
  return fileExtension(fromUrl) ? fromUrl : link.name;
}

function sourceArchiveReason(name: string): boolean {
  const lower = name.toLowerCase();
  if (/源码/.test(name)) return true;
  if (!/\.(?:tar\.gz|tgz|tar\.xz|tar\.bz2|zip)$/.test(lower)) return false;
  return /(?:^|[^a-z0-9])(?:source|src|sources)(?:[^a-z0-9]|$)/.test(lower);
}

function nonInstallableReason(name: string, contentType: string | undefined, isSourceCode: boolean): NonInstallableReason | null {
  if (isSourceCode) return 'source-archive';
  const lower = name.toLowerCase();
  const extension = fileExtension(lower);
  const type = (contentType ?? '').toLowerCase();

  if (KNOWN_IMAGES.has(extension) || KNOWN_VIDEO_AUDIO.has(extension)
    || type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/')) {
    return 'media';
  }
  if (KNOWN_DOCUMENTS.has(extension) || ['application/pdf', 'text/markdown', 'text/html'].includes(type)) {
    return 'document';
  }
  if (KNOWN_CHECKSUM_EXTENSIONS.has(extension)
    || /(?:^|[^a-z0-9])(?:checksums?|sha\d*sums?|sha2-\d+sums|md5sums?)(?=$|[^a-z0-9])/.test(lower)
    || /\.sha256\.txt$/.test(lower)) {
    return 'checksum';
  }
  if (KNOWN_SIGNATURE_EXTENSIONS.has(extension) || /\.sig$/.test(lower)
    || /\.(?:sig|asc|minisig|p7s)\.(?:zip|7z|tar\.gz|tgz)$/.test(lower)) return 'signature';
  if (KNOWN_DEBUG_EXTENSIONS.has(extension)
    || /\.(?:pdb|dsym|dbg|debug)\.(?:zip|7z|tar\.gz|tgz)$/.test(lower)
    || /(?:^|[^a-z0-9])(?:dsym|symbols?|debuginfo|dbgsym)(?=$|[^a-z0-9])/.test(lower)) {
    return 'debug-symbols';
  }
  if (/(?:^|[^a-z0-9])(?:sbom|spdx|cyclonedx|attestation|provenance|intoto)(?=$|[^a-z0-9])/.test(lower)) {
    return 'sbom-attestation';
  }
  if (KNOWN_UPDATE_EXTENSIONS.has(extension)
    || /\.asar\.gz$/.test(lower)
    || /\.(?:blockmap|zsync|asar)\.(?:zip|7z|tar\.gz|tgz)$/.test(lower)
    || lower === 'releases' || lower === '_update_spec'
    || /(?:^|[/\\])latest(?:-[a-z0-9]+)?\.ya?ml$/.test(lower)
    || /\.appcast\.xml$/.test(lower)) {
    return 'update-metadata';
  }
  if (sourceArchiveReason(lower)) return 'source-archive';
  if (KNOWN_LIBRARY_EXTENSIONS.has(extension)
    || /\.d\.ts$/.test(lower)
    || /\.(?:whl|gem|crate)$/.test(lower)) {
    return 'library-package';
  }
  return null;
}

function normalizeName(name: string): string {
  return name.toLowerCase()
    .replace(/x86[-_]64/g, 'x86x64')
    .replace(/arm[-_]64/g, 'arm64')
    .replace(/aarch[-_]64/g, 'aarch64')
    .replace(/arm[-_]32/g, 'arm32')
    .replace(/apple[-_]?silicon/g, 'applesilicon')
    .replace(/64[-_]?bit/g, '64bit')
    .replace(/32[-_]?bit/g, '32bit');
}

function scanName(name: string): ScannedName {
  const cached = scanNameCache.get(name);
  if (cached) return cached;
  const normalized = normalizeName(name);
  const parts = normalized.match(/[a-z0-9]+|[^a-z0-9]+/g) ?? [];
  const tokens = parts.filter((part) => /^[a-z0-9]+$/.test(part));
  const declaredPlatforms = new Set<InstallablePlatform>();
  let hasForeignOs = false;
  let hasWasm = false;

  for (const token of tokens) {
    if (MACOS_TOKENS.has(token) || token === 'applesilicon') declaredPlatforms.add('macos');
    else if (WINDOWS_TOKENS.has(token)) declaredPlatforms.add('windows');
    else if (LINUX_TOKENS.has(token) || /^(?:fc\d+|el\d+)$/.test(token)
      || token.startsWith('android')) declaredPlatforms.add(token.startsWith('android') ? 'android' : 'linux');
    if (token === 'android') declaredPlatforms.add('android');
    if (token === 'wasm') hasWasm = true;
    if (FOREIGN_OS_TOKENS.has(token)) hasForeignOs = true;
  }
  if (hasWasm && tokens.includes('js')) hasForeignOs = true;
  if (tokens.includes('gnu') && (tokens.includes('unknown') || tokens.includes('linux'))) {
    declaredPlatforms.add('linux');
  }

  const declaredArchitectures = new Set<InstallableArchitecture>();
  let hasForeignArchitecture = false;
  let hasWin32 = false;
  const hasWin64 = tokens.includes('win64');

  parts.forEach((part, partIndex) => {
    if (!/^[a-z0-9]+$/.test(part)) return;
    const token = part;
    if (token === 'win32') hasWin32 = true;
    if (token === 'win64' || token === 'linux64' || token === 'osx64' || token === ('darwin' + '64')
      || token === 'x86x64' || token === 'amd64' || token === 'x64') {
      declaredArchitectures.add('x64');
    }
    if (token === 'arm64' || token === 'aarch64' || token === 'arm64e' || token === 'arm64v8'
      || token === 'applesilicon') {
      declaredArchitectures.add('arm64');
    }
    if (token === 'x86' || /^i[3-6]86$/.test(token) || token === 'ia32' || token === '32bit') {
      declaredArchitectures.add('x86');
    }
    if (token === '386') {
      const previous = parts[partIndex - 1] ?? '';
      const previousToken = parts[partIndex - 2] ?? '';
      if ((previous === '-' || previous === '_') && !/^\d+$/.test(previousToken)) {
        declaredArchitectures.add('x86');
      }
    }
    if (ARM32_PATTERN.test(token) || token === 'arm32v7' || token === 'gnueabihf'
      || token === 'musleabi' || token === 'musleabihf') {
      declaredArchitectures.add('arm');
    }
    if (token === 'universal' || token === 'universal2' || token === 'multiarch'
      || token === 'fat' || token === 'allarch') {
      declaredArchitectures.add('universal');
    }
    if (FOREIGN_ARCH_PATTERN.test(token)) hasForeignArchitecture = true;
  });

  const variants: string[] = [];
  let variantScore = 0;
  const addVariant = (variant: string, score: number) => {
    if (!variants.includes(variant)) variants.push(variant);
    variantScore += score;
  };
  const variantTokens = new Set(tokens);
  if (['reh', 'server', 'headless', 'daemon', 'agent'].some((token) => variantTokens.has(token))) {
    addVariant('server-component', 1);
  }
  if (variantTokens.has('cli')) addVariant('cli', 1);
  if (variantTokens.has('upx')) addVariant('packed', 1);
  // Unsigned remains a variant for explanation, but does not jump ahead of a
  // separate package form solely because of this flag.
  if (variantTokens.has('unsigned')) addVariant('unsigned', 0);
  if (['minimal', 'minimalist', 'lite', 'slim'].some((token) => variantTokens.has(token))) addVariant('reduced', 1);
  if (normalized.includes('updates-disabled') || variantTokens.has('noupdate')) addVariant('no-update', 0);
  if (variantTokens.has('debug') || variantTokens.has('dbg')) addVariant('debug-build', 2);
  if (normalized.includes('google-play') || variantTokens.has('play') || variantTokens.has('fdroid')) addVariant('store', 1);
  if (variants.includes('store')) addVariant('google-play', 0);
  if (variantTokens.has('musl') || variantTokens.has('musllinux') || variantTokens.has('alpine')
    || [...variantTokens].some((token) => token.startsWith('musleabi'))) addVariant('musl', 1);
  if (variantTokens.has('gnu') || variantTokens.has('mingw')) addVariant('gnu-windows', 1);

  const result: ScannedName = {
    normalized,
    tokens,
    declaredPlatforms,
    hasForeignOs,
    declaredArchitectures,
    hasForeignArchitecture,
    hasWin32,
    hasWin64,
    ambiguousArchitecture: [...declaredArchitectures].filter((arch) => arch !== 'universal').length > 1,
    variants,
    variantScore,
    variantTie: Number(variants.includes('unsigned')) + Number(variants.includes('no-update')),
  };
  if (scanNameCache.size >= SCAN_NAME_CACHE_LIMIT) scanNameCache.clear();
  scanNameCache.set(name, result);
  return result;
}

function platformFromContentType(contentType: string | undefined, extension: string): InstallablePlatform | null {
  const type = (contentType ?? '').toLowerCase();
  if (!type || ['application/zip', 'application/x-zip-compressed', 'application/octet-stream', 'application/gzip'].includes(type)) {
    return null;
  }
  if (/android\.package-archive/.test(type)) return 'android';
  if (/apple-diskimage/.test(type)) return 'macos';
  if (/x-msi|x-ms-installer/.test(type) || (/x-msdownload/.test(type) && (!extension || extension === 'exe'))) return 'windows';
  if (/x-deb|redhat-package-manager|x-rpm/.test(type)) return 'linux';
  return null;
}

interface Classified {
  index: number;
  input: AssetLinkInput;
  name: string;
  packageInfo: PackageInfo | null;
  scan: ScannedName;
  platform: InstallablePlatform | null;
  platformSource: PlatformSource;
  architecture?: InstallableArchitecture;
  archSource: ArchSource;
  ambiguousArchitecture: boolean;
  hasForeignArchitecture: boolean;
  incompatibleDetail?: string;
  nonInstallable?: NonInstallableReason;
  suppressed?: boolean;
  emulated?: boolean;
  confidence: 'high' | 'medium' | 'low';
  detail: string;
}

function applyPlatformArchitecture(entry: Classified, releaseHasWin64: boolean): void {
  if (!entry.platform || entry.nonInstallable || entry.incompatibleDetail) return;
  const declared = new Set(entry.scan.declaredArchitectures);
  if ((entry.platform === 'windows' || entry.platform === 'linux')
    && entry.scan.tokens.includes('64bit')) {
    declared.add('x64');
  }
  if (entry.platform === 'macos'
    && entry.scan.tokens.some((token) => /^m[1-4]$/.test(token))) {
    declared.add('arm64');
  }

  entry.ambiguousArchitecture = [...declared]
    .filter((architecture) => architecture !== 'universal').length > 1;
  if (declared.size > 0) {
    entry.architecture = declared.has('universal')
      ? 'universal'
      : declared.size === 1
        ? [...declared][0]
        : 'universal';
    entry.archSource = 'declared';
  } else if (entry.scan.hasWin32 && releaseHasWin64 && entry.platform === 'windows') {
    entry.architecture = 'x86';
    entry.archSource = 'declared';
  } else if (entry.platform === 'macos' && entry.scan.tokens.includes('intel')) {
    entry.architecture = 'x64';
    entry.archSource = 'declared';
  } else if (entry.platform === 'android'
    && ['apk', 'xapk', 'apks'].includes(entry.packageInfo?.packageType ?? '')) {
    entry.architecture = 'universal';
    entry.archSource = 'none';
  }

  if (entry.platform === 'macos' && entry.architecture === 'arm') entry.architecture = 'arm64';
  if (entry.platform === 'windows' && entry.architecture === 'arm') entry.architecture = 'arm64';

  const platformLabel = entry.platform === 'macos'
    ? 'macOS'
    : entry.platform[0].toUpperCase() + entry.platform.slice(1);
  entry.detail = [
    platformLabel,
    entry.packageInfo?.packageType ?? 'unknown package',
    entry.architecture ?? 'architecture not declared',
  ].join('; ');
}

function classifyLink(
  link: AssetLinkInput,
  releaseHasWin64: boolean,
  name = displayName(link),
  scan = scanName(name),
): Classified {
  const packageInfo = detectPackageInfo(name);
  const exclusion = nonInstallableReason(name, link.contentType, link.isSourceCode === true);
  const extension = fileExtension(name);

  const base: Classified = {
    index: link.index,
    input: link,
    name,
    packageInfo,
    scan,
    platform: null,
    platformSource: 'token',
    archSource: 'none',
    ambiguousArchitecture: scan.ambiguousArchitecture,
    hasForeignArchitecture: scan.hasForeignArchitecture,
    confidence: 'low',
    detail: '',
  };
  if (extension === 'ipa') {
    return { ...base, incompatibleDetail: 'targets iOS, an unsupported operating system' };
  }
  if (exclusion) return { ...base, nonInstallable: exclusion, detail: exclusion };

  if (!packageInfo) {
    if (extension) return { ...base, nonInstallable: 'unsupported-format', detail: `unsupported .${extension}` };
    if (scan.declaredPlatforms.size === 0 && scan.declaredArchitectures.size === 0
      && !scan.hasForeignArchitecture && !platformFromContentType(link.contentType, extension)) {
      return base;
    }
    base.packageInfo = { packageType: 'raw-binary', extension: '', decisivePlatform: null };
  }

  const decisivePlatform = base.packageInfo?.decisivePlatform ?? null;
  const declared = new Set(scan.declaredPlatforms);
  if (declared.has('android') && declared.has('linux')) declared.delete('linux');

  if (declared.size === 0 && scan.hasForeignOs) {
    return { ...base, incompatibleDetail: 'targets an unsupported operating system' };
  }
  if (declared.size === 1) {
    const tokenPlatform = [...declared][0];
    if (decisivePlatform && decisivePlatform !== tokenPlatform) {
      return {
        ...base,
        incompatibleDetail: `package extension targets ${decisivePlatform} but filename declares ${tokenPlatform}`,
      };
    }
    base.platform = tokenPlatform;
    base.platformSource = 'token';
  } else if (declared.size > 1) {
    base.platform = null;
  } else if (decisivePlatform) {
    base.platform = decisivePlatform;
    base.platformSource = 'extension';
  } else {
    const fromMime = platformFromContentType(link.contentType, extension);
    if (fromMime) {
      base.platform = fromMime;
      base.platformSource = 'content-type';
    } else if (scan.hasForeignOs) {
      return { ...base, incompatibleDetail: 'targets an unsupported operating system' };
    }
  }
  if (!base.platform && scan.hasForeignArchitecture) {
    return { ...base, incompatibleDetail: 'targets an unsupported architecture' };
  }

  applyPlatformArchitecture(base, releaseHasWin64);

  if (decisivePlatform && base.platform === decisivePlatform && base.architecture
    && !base.ambiguousArchitecture) base.confidence = 'high';
  else if (base.platform) base.confidence = base.architecture ? 'medium' : 'medium';
  const platformLabel = base.platform === 'macos'
    ? 'macOS'
    : base.platform
      ? base.platform[0].toUpperCase() + base.platform.slice(1)
      : 'Unknown platform';
  base.detail = [
    platformLabel,
    base.packageInfo?.packageType ?? 'unknown package',
    base.architecture ?? 'architecture not declared',
  ].join('; ');
  if (!base.platform && declared.size > 1) {
    base.detail = `filename declares multiple platforms (${[...declared].join(', ')})`;
  }
  return base;
}

function architectureCompatibility(
  platform: InstallablePlatform,
  architecture: InstallableArchitecture | undefined,
  devicePlatform: InstallablePlatform | null,
  deviceArchitecture: DeviceTarget['architecture'],
  hasForeignArchitecture: boolean,
): { compatible: boolean; emulated: boolean } {
  if (devicePlatform && platform !== devicePlatform) return { compatible: false, emulated: false };
  if (hasForeignArchitecture) return { compatible: false, emulated: false };
  if (!architecture || architecture === 'universal') return { compatible: true, emulated: false };
  if (!devicePlatform) return { compatible: true, emulated: false };

  if (!deviceArchitecture) {
    if (platform === 'macos' || platform === 'windows') {
      return { compatible: architecture !== 'arm', emulated: false };
    }
    if (platform === 'linux') {
      // Accepted: unknown Linux architecture hides arm32 and foreign binaries;
      // desktop browsers almost always expose architecture, and retaining them
      // would flood common x64 devices with unrelated builds.
      return { compatible: architecture === 'x64' || architecture === 'arm64', emulated: false };
    }
    return { compatible: true, emulated: false };
  }

  if (architecture === deviceArchitecture) return { compatible: true, emulated: false };
  if (platform === 'macos' && deviceArchitecture === 'arm64' && architecture === 'x64') {
    return { compatible: true, emulated: true };
  }
  if (platform === 'windows' && deviceArchitecture === 'arm64'
    && (architecture === 'x64' || architecture === 'x86')) {
    return { compatible: true, emulated: true };
  }
  if (platform === 'windows' && deviceArchitecture === 'x64' && architecture === 'x86') {
    return { compatible: true, emulated: true };
  }
  if (platform === 'android' && deviceArchitecture === 'arm64' && architecture === 'arm') {
    return { compatible: true, emulated: true };
  }
  if (platform === 'android' && deviceArchitecture === 'x64' && architecture === 'x86') {
    return { compatible: true, emulated: true };
  }
  return { compatible: false, emulated: false };
}

function repoPlatforms(hints: RepositoryHints | undefined): Array<{ platform: InstallablePlatform; source: 'repo-history' | 'repo-metadata' }> {
  if (!hints) return [];
  const weights = new Map<InstallablePlatform, { weight: number; source: 'repo-history' | 'repo-metadata' }>();
  const add = (platform: string, weight: number, source: 'repo-history' | 'repo-metadata') => {
    if (!(SUPPORTED_PLATFORMS as readonly string[]).includes(platform)) return;
    const typed = platform as InstallablePlatform;
    const current = weights.get(typed);
    if (!current || current.weight < weight) weights.set(typed, { weight, source });
    else current.weight += weight;
  };
  if (hints.otherReleases?.length) {
    for (const signal of inferPlatformsFromReleases(hints.otherReleases)) add(signal.platform, signal.weight, 'repo-history');
  }
  if (hints.repository) {
    for (const signal of inferPlatformsFromRepositoryMetadata(hints.repository)) add(signal.platform, signal.weight, 'repo-metadata');
  }
  return [...weights.entries()]
    .filter(([, value]) => value.weight >= PLATFORM_DISPLAY_THRESHOLD)
    .map(([platform, value]) => ({ platform, source: value.source }));
}

function packageRank(platform: InstallablePlatform, packageType: string, name: string): number {
  const lower = name.toLowerCase();
  if (platform === 'macos') {
    const order = ['dmg', 'pkg', 'app-archive', 'raw-binary', 'zip', 'tar', 'compressed-binary'];
    return order.indexOf(packageType) === -1 ? order.length : order.indexOf(packageType);
  }
  if (platform === 'windows') {
    if (packageType === 'exe') {
      if (lower.includes('usersetup')) return 0;
      if (lower.includes('setup') || lower.includes('installer')) return 1;
      return 2;
    }
    const order = ['msi', 'msix', 'raw-binary', '7z', 'zip', 'rar'];
    const index = order.indexOf(packageType);
    return index === -1 ? order.length + 3 : index + 3;
  }
  if (platform === 'linux') {
    const order = ['appimage', 'deb', 'rpm', 'flatpak', 'snap', 'pacman', 'raw-binary', 'tar', 'zip', 'compressed-binary'];
    return order.indexOf(packageType) === -1 ? order.length : order.indexOf(packageType);
  }
  const order = ['apk', 'xapk', 'apks'];
  return order.indexOf(packageType) === -1 ? order.length : order.indexOf(packageType);
}

function architectureRank(
  architecture: InstallableArchitecture | undefined,
  deviceArchitecture: DeviceTarget['architecture'],
  platform: InstallablePlatform,
): number {
  if (architecture === 'universal') return 1;
  if (!architecture) return 2;
  if (deviceArchitecture) return architecture === deviceArchitecture ? 0 : 1;
  if (platform === 'macos') return architecture === 'arm64' ? 0 : architecture === 'x64' ? 1 : 2;
  if (platform === 'android') {
    return architecture === 'arm64' ? 0 : architecture === 'arm' ? 1 : architecture === 'x64' ? 2 : 3;
  }
  return architecture === 'x64' ? 0 : 1;
}

function confidenceRank(confidence: 'high' | 'medium' | 'low'): number {
  return confidence === 'high' ? 0 : confidence === 'medium' ? 1 : 2;
}

function platformNameRank(name: string): number {
  return /\b(?:windows|macos|linux|android)\b/.test(normalizeName(name)) ? 0 : 1;
}

export function evaluateCurrentSystem(
  links: AssetLinkInput[],
  device: DeviceTarget,
  hints?: RepositoryHints,
): CurrentSystemEvaluation {
  const preparedLinks = links.map((link) => {
    const name = displayName(link);
    return { link, name, scan: scanName(name) };
  });
  const releaseHasWin64 = preparedLinks.some(({ scan }) => scan.hasWin64);
  const classified = preparedLinks
    .slice()
    .sort((left, right) => left.link.index - right.link.index)
    .map(({ link, name, scan }) => classifyLink(link, releaseHasWin64, name, scan));

  // .jar/.vsix/.xpi/.crx are normally library packages. If the release has no
  // other installable product, retain them as unconfirmed candidates.
  const hasNonLibraryInstallable = classified.some((entry) => !entry.nonInstallable);
  if (!hasNonLibraryInstallable) {
    for (const entry of classified) {
      if (entry.nonInstallable === 'library-package'
        && /\.(?:jar|vsix|xpi|crx)$/i.test(entry.name)
        && !/sources?/.test(entry.name.toLowerCase())) {
        entry.nonInstallable = undefined;
        entry.detail = 'library package treated as an unconfirmed runnable artifact';
      }
    }
  }

  const knownPlatforms = new Set<InstallablePlatform>();
  for (const entry of classified) {
    if (!entry.nonInstallable && !entry.incompatibleDetail && entry.platform) knownPlatforms.add(entry.platform);
  }

  for (const entry of classified) {
    if (entry.nonInstallable || entry.incompatibleDetail) continue;
    if (!entry.platform) {
      if (knownPlatforms.size === 1) {
        entry.platform = [...knownPlatforms][0];
        entry.platformSource = 'sibling';
        entry.confidence = 'medium';
      } else if (knownPlatforms.size >= 2) {
        const matchesDevice = !!device.platform && knownPlatforms.has(device.platform);
        if (!matchesDevice) entry.incompatibleDetail = 'release targets other platforms';
        else entry.suppressed = true;
      }
    }
  }

  const repo = knownPlatforms.size === 0 ? repoPlatforms(hints) : [];
  if (repo.length > 0) {
    const repoSet = new Set(repo.map((entry) => entry.platform));
    for (const entry of classified) {
      if (entry.nonInstallable || entry.incompatibleDetail || entry.platform) continue;
      if (device.platform && repoSet.size === 1 && repoSet.has(device.platform)) {
        entry.platform = device.platform;
        entry.platformSource = repo[0].source;
        entry.confidence = 'low';
      } else if (device.platform && !repoSet.has(device.platform)) {
        entry.incompatibleDetail = 'repository targets other platforms';
      }
    }
  }

  for (const entry of classified) {
    applyPlatformArchitecture(entry, releaseHasWin64);
  }

  // Infer the unlabelled sibling's architecture within the same package family.
  for (const entry of classified) {
    if (entry.nonInstallable || entry.incompatibleDetail || !entry.platform
      || entry.architecture || !entry.packageInfo) continue;
    const siblingArchitectures = new Set<InstallableArchitecture>();
    for (const sibling of classified) {
      if (sibling === entry || sibling.nonInstallable || sibling.platform !== entry.platform
        || sibling.packageInfo?.packageType !== entry.packageInfo.packageType
        || sibling.archSource !== 'declared' || !sibling.architecture) continue;
      siblingArchitectures.add(sibling.architecture);
    }
    let inferred: InstallableArchitecture | undefined;
    if (entry.platform === 'windows') {
      if (siblingArchitectures.has('x64')) inferred = 'x86';
      else if (siblingArchitectures.size === 1 && siblingArchitectures.has('arm64')) inferred = 'x64';
    } else if ((entry.platform === 'linux' || entry.platform === 'macos')
      && siblingArchitectures.has('arm64') && !siblingArchitectures.has('x64')) {
      inferred = 'x64';
    }
    if (inferred) {
      entry.architecture = inferred;
      entry.archSource = 'sibling-implied';
      entry.confidence = 'medium';
    }
  }

  for (const entry of classified) {
    if (entry.nonInstallable || entry.incompatibleDetail || !entry.platform) continue;
    const compatibility = architectureCompatibility(
      entry.platform,
      entry.architecture,
      device.platform,
      device.architecture,
      entry.hasForeignArchitecture,
    );
    if (!compatibility.compatible) {
      if (device.platform && entry.platform !== device.platform) {
        entry.incompatibleDetail = `targets ${entry.platform}, this device is ${device.platform}`;
      } else if (entry.hasForeignArchitecture) {
        entry.incompatibleDetail = `targets ${entry.architecture ?? 'an unsupported architecture'}`;
      } else {
        entry.incompatibleDetail = `targets ${entry.architecture ?? 'an unsupported architecture'}, this device is ${device.architecture ?? 'unknown'}`;
      }
      entry.emulated = false;
    } else {
      entry.emulated = compatibility.emulated;
      if (entry.platformSource === 'extension' && entry.archSource === 'declared'
        && !entry.ambiguousArchitecture) entry.confidence = 'high';
      else if (entry.platformSource === 'sibling' || entry.archSource === 'sibling-implied') {
        entry.confidence = entry.confidence === 'low' ? 'low' : 'medium';
      }
    }
  }

  // Prefer native builds when the same platform offers one. Emulated builds
  // remain available through "Show all", but are not part of the default list.
  for (const platform of SUPPORTED_PLATFORMS) {
    const entries = classified.filter((entry) =>
      entry.platform === platform && !entry.nonInstallable && !entry.incompatibleDetail);
    if (platform !== 'android' && entries.some((entry) => !entry.emulated)) {
      for (const entry of entries) if (entry.emulated) entry.suppressed = true;
    }
  }

  const compatible = classified.filter((entry) =>
    entry.platform && !entry.nonInstallable && !entry.incompatibleDetail && !entry.suppressed);
  compatible.sort((left, right) =>
    Number(!!left.emulated) - Number(!!right.emulated)
    || left.scan.variantScore - right.scan.variantScore
    || packageRank(left.platform!, left.packageInfo?.packageType ?? '', left.name) -
      packageRank(right.platform!, right.packageInfo?.packageType ?? '', right.name)
    || architectureRank(left.architecture, device.architecture, left.platform!) -
      architectureRank(right.architecture, device.architecture, right.platform!)
    || left.scan.variantTie - right.scan.variantTie
    || confidenceRank(left.confidence) - confidenceRank(right.confidence)
    || (right.input.downloadCount ?? 0) - (left.input.downloadCount ?? 0)
    || platformNameRank(left.name) - platformNameRank(right.name)
    || left.index - right.index,
  );

  const unknowns = classified.filter((entry) =>
    !entry.platform && !entry.nonInstallable && !entry.incompatibleDetail && !entry.suppressed);
  const orderedIndexes = [...compatible, ...unknowns].map((entry) => entry.index);
  const matchedLinkIndexes = new Set(orderedIndexes);
  const badges = new Map<number, 'recommended' | 'emulated' | 'unverified'>();
  const first = compatible[0];
  if (first && first.confidence === 'high' && !first.emulated
    && (first.archSource !== 'none' || first.architecture === 'universal')) {
    badges.set(first.index, 'recommended');
  }
  for (const entry of classified) {
    if (entry.nonInstallable || entry.incompatibleDetail || !entry.emulated) continue;
    badges.set(entry.index, 'emulated');
  }
  for (const entry of unknowns) badges.set(entry.index, 'unverified');

  const verdicts = new Map<number, AssetVerdict>();
  for (const entry of classified) {
    if (entry.nonInstallable) {
      verdicts.set(entry.index, {
        kind: 'non-installable',
        reason: entry.nonInstallable,
        detail: entry.detail,
      });
    } else if (entry.incompatibleDetail) {
      verdicts.set(entry.index, { kind: 'incompatible', detail: entry.incompatibleDetail });
    } else if (entry.platform && !entry.suppressed) {
      verdicts.set(entry.index, {
        kind: 'compatible',
        platform: entry.platform,
        platformSource: entry.platformSource,
        architecture: entry.architecture,
        archSource: entry.archSource,
        emulated: entry.emulated === true,
        packageType: entry.packageInfo?.packageType ?? 'raw-binary',
        variants: entry.scan.variants,
        confidence: entry.confidence,
        detail: entry.detail,
      });
    } else if (entry.suppressed && entry.emulated) {
      verdicts.set(entry.index, {
        kind: 'incompatible',
        detail: 'emulated build hidden because a native build is available',
      });
    } else {
      verdicts.set(entry.index, {
        kind: 'unknown',
        detail: entry.suppressed ? 'suppressed by sibling platform evidence' : entry.detail || 'platform not declared',
      });
    }
  }

  return {
    matchesRelease: matchedLinkIndexes.size > 0,
    matchedLinkIndexes,
    orderedIndexes,
    badges,
    verdicts,
  };
}
