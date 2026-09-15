'use strict';

let host;

const SOURCE_ARCHIVE = /(?:source[-_. ]?code|源码)/i;
const PLATFORM_PATTERNS = {
  win32: /(?:windows|win32|win64|win[-_.]?x64|\.exe$|\.msi$)/i,
  darwin: /(?:macos|mac[-_.]?os|darwin|osx|\.dmg$|\.pkg$)/i,
  linux: /(?:linux|appimage|\.deb$|\.rpm$)/i,
};
const ARCH_PATTERNS = {
  x64: /(?:x86[_-]?64|amd64|x64|win64)/i,
  arm64: /(?:aarch64|arm64)/i,
  ia32: /(?:x86(?![_-]?64)|i[3-6]86|win32)/i,
};

function scoreAsset(asset, environment) {
  const name = asset.name.toLowerCase();
  if (SOURCE_ARCHIVE.test(name) || /(?:checksum|sha256|\.sig$|\.asc$)/i.test(name)) return -100;
  if (Object.entries(PLATFORM_PATTERNS).some(([platform, pattern]) =>
    platform !== environment.os && pattern.test(name))) return -100;
  if (Object.entries(ARCH_PATTERNS).some(([architecture, pattern]) =>
    architecture !== environment.arch && pattern.test(name))) return -100;
  let score = 0;
  if (PLATFORM_PATTERNS[environment.os]?.test(name)) score += 50;
  if (ARCH_PATTERNS[environment.arch]?.test(name)) score += 35;
  if (/(?:setup|installer|portable|appimage|\.msi$|\.dmg$|\.deb$|\.rpm$)/i.test(name)) score += 10;
  return score;
}

module.exports = {
  activate(context) {
    host = context;
  },
  async runReleaseProcessor({ release: inputRelease, hostEnvironment }) {
    const release = await host.github.getRelease(inputRelease.id) || inputRelease;
    const ranked = release.assets
      .map((asset) => ({ asset, score: scoreAsset(asset, hostEnvironment) }))
      .sort((left, right) => right.score - left.score);
    if (ranked.length === 0 || ranked[0].score <= 0) {
      const error = new Error('No asset clearly matches this operating system and architecture');
      error.code = 'NO_COMPATIBLE_RELEASE_ASSET';
      throw error;
    }
    const best = ranked[0];
    return {
      recommendedAssetId: best.asset.id,
      confidence: Math.min(0.99, Math.max(0.35, best.score / 100)),
      reason: `Best filename match for ${hostEnvironment.os}/${hostEnvironment.arch}`,
    };
  },
};
