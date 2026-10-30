import { describe, expect, it } from 'vitest';
import type { DeviceTarget, InstallablePlatform } from '../types/installableAsset';
import { evaluateCurrentSystem, type AssetLinkInput, type RepositoryHints } from './assetCompatibility';
import { RELEASE_ASSET_CORPUS } from './__fixtures__/releaseAssetCorpus';

const device = (
  platform: InstallablePlatform | null,
  architecture?: DeviceTarget['architecture'],
): DeviceTarget => ({
  platform,
  architecture,
  architectureSource: architecture ? 'ua-ch' : 'none',
  architectureSettled: true,
});

const linksFrom = (key: keyof typeof RELEASE_ASSET_CORPUS): AssetLinkInput[] =>
  RELEASE_ASSET_CORPUS[key].assets.map((asset, index) => ({
    index,
    name: asset.name,
    url: `https://github.com/example/releases/download/v1/${encodeURIComponent(asset.name)}`,
    contentType: asset.content_type,
    assetId: index + 1,
  }));

const linksFromNames = (names: string[]): AssetLinkInput[] =>
  names.map((name, index) => ({
    index,
    name,
    url: `https://example.com/${encodeURIComponent(name)}`,
    assetId: index + 1,
  }));

const orderedNames = (
  key: keyof typeof RELEASE_ASSET_CORPUS,
  target: DeviceTarget,
  hints?: RepositoryHints,
): string[] => {
  const links = linksFrom(key);
  return evaluateCurrentSystem(links, target, hints).orderedIndexes.map((index) => links[index].name);
};

describe('evaluateCurrentSystem — real release corpus', () => {
  it.each([
    ['macos arm64', device('macos', 'arm64'), ['alist-darwin-arm64.tar.gz']],
    ['macOS x64', device('macos', 'x64'), ['alist-darwin-amd64.tar.gz']],
    ['macOS unknown arch', device('macos'), ['alist-darwin-arm64.tar.gz', 'alist-darwin-amd64.tar.gz']],
    ['Windows x64', device('windows', 'x64'), ['alist-windows-amd64.zip', 'alist-windows-amd64-upx.zip']],
    ['Windows arm64', device('windows', 'arm64'), ['alist-windows-arm64.zip']],
    ['Linux x64', device('linux', 'x64'), ['alist-linux-amd64.tar.gz', 'alist-linux-musl-amd64.tar.gz']],
    ['Linux arm64', device('linux', 'arm64'), ['alist-linux-arm64.tar.gz', 'alist-linux-musl-arm64.tar.gz']],
    ['Android unknown ABI', device('android'), [
      'alist-android-arm64.tar.gz', 'alist-android-arm.tar.gz',
      'alist-android-amd64.tar.gz', 'alist-android-386.tar.gz',
    ]],
  ])('alist: %s', (_label, target, expected) => {
    expect(orderedNames('alist', target)).toEqual(expected);
  });

  it('neovim parses win64 and excludes zsync metadata', () => {
    expect(orderedNames('neovim', device('windows', 'x64')))
      .toEqual(['nvim-win64.msi', 'nvim-win64.zip']);
    expect(orderedNames('neovim', device('linux', 'x64')))
      .toEqual(['nvim-linux-x86_64.appimage', 'nvim-linux-x86_64.tar.gz']);
  });

  it('ripgrep prefers msvc and deb while excluding unsupported architectures', () => {
    expect(orderedNames('ripgrep', device('windows', 'x64'))).toEqual([
      'ripgrep-15.2.0-x86_64-pc-windows-msvc.zip',
      'ripgrep-15.2.0-x86_64-pc-windows-gnu.zip',
    ]);
    expect(orderedNames('ripgrep', device('linux', 'x64'))).toEqual([
      'ripgrep_15.2.0-1_amd64.deb',
      'ripgrep-15.2.0-x86_64-unknown-linux-musl.tar.gz',
    ]);
    expect(orderedNames('ripgrep', device('linux', 'arm64'))).toEqual([
      'ripgrep-15.2.0-aarch64-unknown-linux-gnu.tar.gz',
      'ripgrep-15.2.0-aarch64-unknown-linux-musl.tar.gz',
    ]);
  });

  it('jq recognises extensionless binaries and excludes source archives', () => {
    expect(orderedNames('jq', device('macos', 'arm64'))).toEqual(['jq-macos-arm64']);
    expect(orderedNames('jq', device('linux', 'x64'))).toEqual(['jq-linux-amd64', 'jq-linux64']);
    expect(orderedNames('jq', device('windows', 'x64')))
      .toEqual(['jq-windows-amd64.exe', 'jq-win64.exe']);
  });

  it('yt-dlp suppresses unlabelled release-wide and source artifacts', () => {
    expect(orderedNames('ytDlp', device('macos', 'arm64'))).toEqual(['yt-dlp_macos', 'yt-dlp_macos.zip']);
    expect(orderedNames('ytDlp', device('windows', 'x64'))).toEqual(['yt-dlp.exe', 'yt-dlp_win.zip']);
    expect(orderedNames('ytDlp', device('linux', 'x64'))).toEqual([
      'yt-dlp_linux', 'yt-dlp_linux.zip', 'yt-dlp_musllinux', 'yt-dlp_musllinux.zip',
    ]);
    expect(orderedNames('ytDlp', device('linux', 'arm64'))).toEqual([
      'yt-dlp_linux_aarch64', 'yt-dlp_linux_aarch64.zip',
      'yt-dlp_musllinux_aarch64', 'yt-dlp_musllinux_aarch64.zip',
    ]);
  });

  it('obsidian uses sibling-platform and sibling-architecture evidence', () => {
    expect(orderedNames('obsidian', device('macos', 'arm64'))).toEqual(['Obsidian-1.14.5.dmg']);
    expect(orderedNames('obsidian', device('linux', 'x64'))).toEqual([
      'Obsidian-1.14.5.AppImage', 'obsidian_1.14.5_amd64.deb',
    ]);
    expect(orderedNames('obsidian', device('linux', 'arm64'))).toEqual([
      'Obsidian-1.14.5-arm64.AppImage',
    ]);
  });

  it('notepad++ infers the unlabelled installers as x86 and drops them on x64', () => {
    expect(orderedNames('npp', device('windows', 'x64'))).toEqual([
      'npp.8.9.8.1.Installer.x64.exe',
      'npp.8.9.8.1.Installer.x64.msi',
      'npp.8.9.8.1.portable.x64.7z',
      'npp.8.9.8.1.portable.x64.zip',
      'npp.8.9.8.1.portable.minimalist.x64.7z',
    ]);
    expect(orderedNames('npp', device('windows', 'arm64'))).toEqual([
      'npp.8.9.8.1.Installer.arm64.exe',
      'npp.8.9.8.1.portable.arm64.7z',
      'npp.8.9.8.1.portable.arm64.zip',
      'npp.8.9.8.1.portable.minimalist.arm64.7z',
    ]);
  });

  it('localsend parses arm-64 and x86-64 without confusing them', () => {
    expect(orderedNames('localsend', device('macos', 'arm64'))).toEqual([
      'LocalSend-1.18.2.dmg', 'LocalSend-CLI-1.18.2-macos-arm-64.tar.gz',
    ]);
    expect(orderedNames('localsend', device('windows', 'x64'))).toEqual([
      'LocalSend-1.18.2-windows-x86-64.exe',
      'LocalSend-1.18.2-windows-x86-64-unsigned.exe',
      'LocalSend-1.18.2-windows-x86-64.zip',
      'LocalSend-CLI-1.18.2-windows-x86-64.exe',
    ]);
    expect(orderedNames('localsend', device('android', 'arm64'))).toEqual([
      'LocalSend-1.18.2-android-arm64v8.apk',
      'LocalSend-1.18.2-android-google-play.apk',
      'LocalSend-1.18.2-android-arm32v7.apk',
    ]);
  });

  it('vscodium recognises win32-x64 and keeps CLI/server variants behind native apps', () => {
    expect(orderedNames('vscodium', device('macos', 'arm64'))).toEqual([
      'VSCodium.arm64.1.143.17232.dmg',
      'VSCodium-darwin-arm64-1.143.17232.zip',
      'vscodium-cli-darwin-arm64-1.143.17232.tar.gz',
      'vscodium-reh-darwin-arm64-1.143.17232.tar.gz',
      'vscodium-reh-web-darwin-arm64-1.143.17232.tar.gz',
    ]);
    expect(orderedNames('vscodium', device('windows', 'x64'))).toEqual([
      'VSCodiumUserSetup-x64-1.143.17232.exe',
      'VSCodiumSetup-x64-1.143.17232.exe',
      'VSCodium-x64-1.143.17232.msi',
      'VSCodium-x64-updates-disabled-1.143.17232.msi',
      'VSCodium-win32-x64-1.143.17232.zip',
      'vscodium-cli-win32-x64-1.143.17232.tar.gz',
    ]);
  });
});

describe('evaluateCurrentSystem — synthetic edge cases', () => {
  const evaluate = (
    names: string[],
    target: DeviceTarget,
    hints?: RepositoryHints,
  ) => {
    const links = linksFromNames(names);
    return evaluateCurrentSystem(links, target, hints);
  };

  it('uses repository topics only when the release has no platform evidence', () => {
    const hints = { repository: { topics: ['macos'], description: null, language: 'Swift' } };
    expect(evaluate(['Bob.zip'], device('macos', 'arm64'), hints).orderedIndexes).toHaveLength(1);
    expect(evaluate(['Bob.zip'], device('windows', 'x64'), hints).matchesRelease).toBe(false);
    expect(evaluate(['Bob.zip'], device('windows', 'x64')).matchesRelease).toBe(true);
  });

  it('does not use a weak Swift language signal as a platform verdict', () => {
    const hints = { repository: { topics: [], description: null, language: 'Swift' } };
    expect(evaluate(['MyTool.zip'], device('windows', 'x64'), hints).badges.get(0)).toBe('unverified');
  });

  it('excludes screenshots even when their names mention macOS', () => {
    const evaluation = evaluate([
      'MyApp-1.0.dmg', 'screenshot-macos.png', 'demo.gif', 'preview.webp', 'MyApp-1.0-mac-preview.mp4',
    ], device('macos', 'arm64'));
    expect(evaluation.orderedIndexes.map((index) => index)).toEqual([0]);
  });

  it('handles Electron metadata, universal Mac fallbacks and missing architectures', () => {
    expect(evaluate([
      'App-1.0.0-arm64.dmg', 'App-1.0.0.dmg', 'App-1.0.0-arm64-mac.zip', 'App-1.0.0-mac.zip',
      'App Setup 1.0.0.exe', 'App-1.0.0.AppImage', 'latest.yml', 'latest-mac.yml', 'latest-linux.yml',
      'App Setup 1.0.0.exe.blockmap', 'App-1.0.0-mac.zip.blockmap',
    ], device('macos', 'arm64')).orderedIndexes.map((index) => index)).toEqual([0, 2]);

    const x64Only = evaluate(
      ['App-1.0-macos-x64.dmg', 'App-1.0-windows-x64.exe'],
      device('macos', 'arm64'),
    );
    expect(Array.from(x64Only.matchedLinkIndexes)).toEqual([0]);
    expect(x64Only.badges.get(0)).toBe('emulated');
  });

  it('does not mistake version 1.386.0 for x86', () => {
    expect(evaluate(
      ['tool-1.386.0-linux-amd64.tar.gz', 'tool-1.386.0-darwin-arm64.tar.gz'],
      device('linux', 'x64'),
    ).orderedIndexes).toEqual([0]);
  });

  it('lets Android win over Linux inside a Rust triple', () => {
    const android = evaluate(
      ['tool-aarch64-linux-android.tar.gz', 'tool-x86_64-unknown-linux-gnu.tar.gz'],
      device('android', 'arm64'),
    );
    expect(android.orderedIndexes).toEqual([0]);
    expect(evaluate(
      ['tool-aarch64-linux-android.tar.gz', 'tool-x86_64-unknown-linux-gnu.tar.gz'],
      device('linux', 'x64'),
    ).orderedIndexes).toEqual([1]);
  });

  it('keeps Linux builds of Android-named products visible on Linux', () => {
    expect(evaluate(['android-studio-2024.1-linux.tar.gz'], device('linux', 'x64')).orderedIndexes)
      .toEqual([0]);
    expect(evaluate(['android-studio-2024.1-linux.deb'], device('linux', 'x64')).orderedIndexes)
      .toEqual([0]);
    expect(evaluate(['android-studio-2024.1-linux.deb'], device('android', 'arm64')).matchesRelease)
      .toBe(false);
    // A name that keeps going after the android token is not a triple either.
    expect(evaluate(['tool-linux-android-sdk.tar.gz'], device('linux', 'x64')).orderedIndexes)
      .toEqual([0]);
  });

  it('keeps a pure-Java jar as unverified but excludes source jars', () => {
    const evaluation = evaluate(['app-1.2.jar', 'app-1.2-sources.jar'], device('windows', 'x64'));
    expect(evaluation.orderedIndexes).toEqual([0]);
    expect(evaluation.badges.get(0)).toBe('unverified');
  });

  it('does not revive unrelated libraries or app bundles as runnable fallbacks', () => {
    expect(evaluate(['tool-1.0.whl'], device('windows', 'x64')).matchesRelease).toBe(false);
    expect(evaluate(['app-1.0.aab'], device('android', 'arm64')).matchesRelease).toBe(false);
  });

  it('rejects a foreign-architecture binary even when its platform is unlabelled', () => {
    expect(evaluate(['tool-mips64'], device('linux', 'x64')).matchesRelease).toBe(false);
  });

  it('applies context-sensitive architecture tokens only on their platforms', () => {
    const windowsProductName = evaluate(['Tool-M1-Setup.exe'], device('windows', 'x64'));
    expect(windowsProductName.orderedIndexes).toEqual([0]);
    expect(windowsProductName.verdicts.get(0)).toMatchObject({
      kind: 'compatible',
      architecture: undefined,
    });

    const macProductName = evaluate(['Tool-M1.dmg'], device('macos', 'arm64'));
    expect(macProductName.verdicts.get(0)).toMatchObject({
      kind: 'compatible',
      architecture: 'arm64',
    });

    const mac64Bit = evaluate(['Tool-64bit.dmg'], device('macos', 'arm64'));
    expect(mac64Bit.verdicts.get(0)).toMatchObject({
      kind: 'compatible',
      architecture: undefined,
    });

    const linux64Bit = evaluate(['Tool-linux-64bit.tar.gz'], device('linux', 'x64'));
    expect(linux64Bit.verdicts.get(0)).toMatchObject({
      kind: 'compatible',
      architecture: 'x64',
    });

    const siblingPlatform = evaluate(
      ['Tool-M1.zip', 'Tool.dmg'],
      device('macos', 'arm64'),
    );
    expect(siblingPlatform.verdicts.get(0)).toMatchObject({
      kind: 'compatible',
      platform: 'macos',
      architecture: 'arm64',
    });
  });

  it('keeps the emulated badge when a native sibling hides it from the default list', () => {
    const evaluation = evaluate(
      ['App-arm64.dmg', 'App-x64.dmg'],
      device('macos', 'arm64'),
    );
    expect(evaluation.orderedIndexes).toEqual([0]);
    expect(evaluation.badges.get(1)).toBe('emulated');
  });

  it('handles win32/win64 sibling architecture inference', () => {
    expect(evaluate(['app-win32.zip', 'app-win64.zip'], device('windows', 'x64')).orderedIndexes)
      .toEqual([1]);
    expect(evaluate(
      ['app-win32-x64.zip', 'app-win32-arm64.zip', 'app-darwin-arm64.zip'],
      device('windows', 'x64'),
    ).orderedIndexes).toEqual([0]);
  });

  it('keeps unlabelled .apk visible on Linux without disturbing Android', () => {
    expect(evaluate(['tool-1.0.apk'], device('linux', 'x64')).orderedIndexes).toEqual([0]);
    expect(evaluate(['tool-1.0.apk'], device('android', 'arm64')).verdicts.get(0))
      .toMatchObject({ kind: 'compatible', platform: 'android' });
    expect(evaluate(['tool-1.0.apk'], device('windows', 'x64')).matchesRelease).toBe(false);

    // A Linux sibling must not turn the ambiguous .apk into a Linux asset.
    const mixed = evaluate(['tool-linux-amd64.tar.gz', 'mobile.apk'], device('linux', 'x64'));
    expect(mixed.orderedIndexes).toEqual([0, 1]);
    expect(mixed.verdicts.get(1)).toMatchObject({ kind: 'unknown' });
    expect(mixed.badges.get(1)).toBe('unverified');
  });

  it('does not treat 64bit as x64 when a different architecture is declared', () => {
    expect(evaluate(['tool-linux-arm64-64bit.tar.gz'], device('linux', 'x64')).matchesRelease)
      .toBe(false);
    expect(evaluate(['tool-linux-arm64-64bit.tar.gz'], device('linux', 'arm64')).orderedIndexes)
      .toEqual([0]);
    expect(evaluate(['tool-linux-64bit.tar.gz'], device('linux', 'x64')).orderedIndexes)
      .toEqual([0]);
  });

  it('still filters architectures when only the architecture is known', () => {
    const architectureOnly: DeviceTarget = {
      platform: null,
      architecture: 'x64',
      architectureSource: 'ua-ch',
      architectureSettled: true,
    };
    expect(evaluate(['app-x64.dmg', 'app-arm64.dmg'], architectureOnly).orderedIndexes)
      .toEqual([0]);
  });

  it('only infers sibling architecture within the same product', () => {
    // `Tool-x64.zip` must not decide the architecture of an unrelated `Other.zip`.
    expect(evaluate(['Tool-x64.zip', 'Other.zip'], device('windows', 'x64')).orderedIndexes)
      .toEqual([0, 1]);
  });

  it('uses the URL basename for body links', () => {
    const link: AssetLinkInput = {
      index: 0,
      name: 'Download for macOS',
      url: 'https://example.com/dl/App-2.0-universal.dmg',
    };
    const evaluation = evaluateCurrentSystem([link], device('macos', 'arm64'));
    expect(evaluation.orderedIndexes).toEqual([0]);
    expect(evaluation.verdicts.get(0)).toMatchObject({ kind: 'compatible', architecture: 'universal' });
  });

  it('does not let an unlabelled zip leak into a multi-platform release', () => {
    const evaluation = evaluate(
      ['app-windows-x64.exe', 'app-linux-x64.AppImage', 'app.zip'],
      device('macos', 'arm64'),
    );
    expect(evaluation.matchesRelease).toBe(false);
  });
});
