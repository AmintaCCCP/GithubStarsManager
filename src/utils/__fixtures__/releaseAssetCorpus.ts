export interface CorpusAsset {
  name: string;
  content_type?: string;
}

export interface ReleaseAssetCorpusEntry {
  repo: string;
  assets: CorpusAsset[];
}

const names = (...items: string[]): CorpusAsset[] => items.map((name) => ({ name }));

export const RELEASE_ASSET_CORPUS: Record<string, ReleaseAssetCorpusEntry> = {
  alist: {
    repo: 'AlistGo/alist',
    assets: names(
      'alist-android-386.tar.gz', 'alist-android-amd64.tar.gz', 'alist-android-arm.tar.gz', 'alist-android-arm64.tar.gz',
      'alist-darwin-amd64.tar.gz', 'alist-darwin-arm64.tar.gz',
      'alist-freebsd-amd64.tar.gz', 'alist-freebsd-arm64.tar.gz', 'alist-freebsd-i386.tar.gz',
      'alist-linux-386.tar.gz', 'alist-linux-amd64.tar.gz', 'alist-linux-arm-5.tar.gz', 'alist-linux-arm-6.tar.gz',
      'alist-linux-arm-7.tar.gz', 'alist-linux-arm64.tar.gz', 'alist-linux-mips.tar.gz', 'alist-linux-mips64.tar.gz',
      'alist-linux-mips64le.tar.gz', 'alist-linux-mipsle.tar.gz', 'alist-linux-musl-amd64.tar.gz',
      'alist-linux-musl-arm64.tar.gz', 'alist-linux-musl-mips.tar.gz', 'alist-linux-musl-mips64.tar.gz',
      'alist-linux-musl-mips64le.tar.gz', 'alist-linux-musl-mipsle.tar.gz', 'alist-linux-musl-ppc64le.tar.gz',
      'alist-linux-musl-s390x.tar.gz', 'alist-linux-musleabi-arm.tar.gz', 'alist-linux-musleabi-armel.tar.gz',
      'alist-linux-musleabi-armv5l.tar.gz', 'alist-linux-musleabi-armv6.tar.gz', 'alist-linux-musleabi-armv7m.tar.gz',
      'alist-linux-musleabihf-arm.tar.gz', 'alist-linux-musleabihf-armel.tar.gz',
      'alist-linux-musleabihf-armv5l.tar.gz', 'alist-linux-musleabihf-armv6.tar.gz',
      'alist-linux-musleabihf-armv7l.tar.gz', 'alist-linux-musleabihf-armv7r.tar.gz',
      'alist-linux-ppc64le.tar.gz', 'alist-linux-riscv64.tar.gz', 'alist-linux-s390x.tar.gz',
      'alist-windows-386.zip', 'alist-windows-amd64-upx.zip', 'alist-windows-amd64.zip', 'alist-windows-arm64.zip',
      'md5-android.txt', 'md5-freebsd.txt', 'md5-linux-musl-arm.txt', 'md5-linux-musl.txt', 'md5.txt',
    ),
  },
  neovim: {
    repo: 'neovim/neovim',
    assets: names(
      'nvim-linux-arm64.appimage', 'nvim-linux-arm64.appimage.zsync', 'nvim-linux-arm64.tar.gz',
      'nvim-linux-x86_64.appimage', 'nvim-linux-x86_64.appimage.zsync', 'nvim-linux-x86_64.tar.gz',
      'nvim-macos-arm64.tar.gz', 'nvim-macos-x86_64.tar.gz',
      'nvim-win-arm64.msi', 'nvim-win-arm64.zip', 'nvim-win64.msi', 'nvim-win64.zip',
    ),
  },
  ripgrep: {
    repo: 'BurntSushi/ripgrep',
    assets: names(
      'ripgrep-15.2.0-aarch64-apple-darwin.tar.gz', 'ripgrep-15.2.0-aarch64-pc-windows-msvc.zip',
      'ripgrep-15.2.0-aarch64-unknown-linux-gnu.tar.gz', 'ripgrep-15.2.0-aarch64-unknown-linux-musl.tar.gz',
      'ripgrep-15.2.0-armv7-unknown-linux-gnueabihf.tar.gz',
      'ripgrep-15.2.0-armv7-unknown-linux-musleabi.tar.gz',
      'ripgrep-15.2.0-armv7-unknown-linux-musleabihf.tar.gz',
      'ripgrep-15.2.0-i686-pc-windows-msvc.zip',
      'ripgrep-15.2.0-s390x-unknown-linux-gnu.tar.gz',
      'ripgrep-15.2.0-x86_64-apple-darwin.tar.gz',
      'ripgrep-15.2.0-x86_64-pc-windows-gnu.zip', 'ripgrep-15.2.0-x86_64-pc-windows-msvc.zip',
      'ripgrep-15.2.0-x86_64-unknown-linux-musl.tar.gz', 'ripgrep_15.2.0-1_amd64.deb',
    ),
  },
  jq: {
    repo: 'jqlang/jq',
    assets: names(
      'jq-1.8.2.tar.gz', 'jq-1.8.2.zip', 'jq-attestation.json', 'jq-linux-amd64', 'jq-linux-arm64',
      'jq-linux-armel', 'jq-linux-armhf', 'jq-linux-i386', 'jq-linux-mips', 'jq-linux-mips64',
      'jq-linux-mips64el', 'jq-linux-mips64r6', 'jq-linux-mips64r6el', 'jq-linux-mipsel',
      'jq-linux-mipsr6', 'jq-linux-mipsr6el', 'jq-linux-powerpc', 'jq-linux-ppc64el',
      'jq-linux-riscv64', 'jq-linux-s390x', 'jq-linux64', 'jq-macos-amd64', 'jq-macos-arm64',
      'jq-osx-amd64', 'jq-win64.exe', 'jq-windows-amd64.exe', 'jq-windows-arm64.exe',
      'jq-windows-i386.exe', 'sha256sum.txt',
    ),
  },
  ytDlp: {
    repo: 'yt-dlp/yt-dlp',
    assets: names(
      'SHA2-256SUMS', 'SHA2-256SUMS.sig', 'SHA2-512SUMS', 'SHA2-512SUMS.sig', 'yt-dlp', 'yt-dlp.exe',
      'yt-dlp.tar.gz', 'yt-dlp_arm64.exe', 'yt-dlp_linux', 'yt-dlp_linux.zip', 'yt-dlp_linux_aarch64',
      'yt-dlp_linux_aarch64.zip', 'yt-dlp_linux_armv7l.zip', 'yt-dlp_macos', 'yt-dlp_macos.zip',
      'yt-dlp_musllinux', 'yt-dlp_musllinux.zip', 'yt-dlp_musllinux_aarch64',
      'yt-dlp_musllinux_aarch64.zip', 'yt-dlp_win.zip', 'yt-dlp_win_arm64.zip', 'yt-dlp_win_x86.zip',
      'yt-dlp_x86.exe', '_update_spec',
    ),
  },
  obsidian: {
    repo: 'obsidianmd/obsidian-releases',
    assets: names(
      'Obsidian-1.14.5-arm64.AppImage', 'obsidian-1.14.5-arm64.tar.gz', 'Obsidian-1.14.5.AppImage',
      'obsidian-1.14.5.asar.gz', 'Obsidian-1.14.5.dmg', 'Obsidian-1.14.5.exe',
      'obsidian-1.14.5.tar.gz', 'obsidian_1.14.5_amd64.deb',
    ),
  },
  npp: {
    repo: 'notepad-plus-plus/notepad-plus-plus',
    assets: names(
      'npp.8.9.8.1.checksums.sha256', 'npp.8.9.8.1.Installer.arm64.exe', 'npp.8.9.8.1.Installer.exe',
      'npp.8.9.8.1.Installer.x64.exe', 'npp.8.9.8.1.Installer.x64.msi', 'npp.8.9.8.1.portable.7z',
      'npp.8.9.8.1.portable.arm64.7z', 'npp.8.9.8.1.portable.arm64.zip',
      'npp.8.9.8.1.portable.minimalist.7z', 'npp.8.9.8.1.portable.minimalist.arm64.7z',
      'npp.8.9.8.1.portable.minimalist.x64.7z', 'npp.8.9.8.1.portable.x64.7z',
      'npp.8.9.8.1.portable.x64.zip', 'npp.8.9.8.1.portable.zip',
    ),
  },
  localsend: {
    repo: 'localsend/localsend',
    assets: names(
      'LocalSend-1.18.2-android-arm32v7.apk', 'LocalSend-1.18.2-android-arm64v8.apk',
      'LocalSend-1.18.2-android-google-play.apk', 'LocalSend-1.18.2-android-x64.apk',
      'LocalSend-1.18.2-linux-arm-64.deb', 'LocalSend-1.18.2-linux-arm-64.tar.gz',
      'LocalSend-1.18.2-linux-x86-64.AppImage', 'LocalSend-1.18.2-linux-x86-64.deb',
      'LocalSend-1.18.2-linux-x86-64.tar.gz', 'LocalSend-1.18.2-windows-arm-64.zip',
      'LocalSend-1.18.2-windows-x86-64-unsigned.exe', 'LocalSend-1.18.2-windows-x86-64.exe',
      'LocalSend-1.18.2-windows-x86-64.zip', 'LocalSend-1.18.2.dmg',
      'LocalSend-CLI-1.18.2-linux-arm-64.tar.gz', 'LocalSend-CLI-1.18.2-linux-x86-64.tar.gz',
      'LocalSend-CLI-1.18.2-macos-arm-64.tar.gz', 'LocalSend-CLI-1.18.2-macos-x86-64.tar.gz',
      'LocalSend-CLI-1.18.2-windows-arm-64.exe', 'LocalSend-CLI-1.18.2-windows-x86-64.exe',
    ),
  },
  vscodium: {
    repo: 'VSCodium/vscodium',
    assets: names(
      'codium-1.143.17232-el8.aarch64.rpm', 'codium-1.143.17232-el8.aarch64.rpm.sha1',
      'codium-1.143.17232-el8.x86_64.rpm', 'codium-1.143.17232-el8.ppc64le.rpm',
      'codium_1.143.17232_amd64.deb', 'codium_1.143.17232_arm64.deb',
      'codium_1.143.17232_ppc64el.deb', 'VSCodium-1.143.17232-anylinux-aarch64.AppImage',
      'VSCodium-1.143.17232-anylinux-x86_64.AppImage',
      'VSCodium-1.143.17232-anylinux-x86_64.AppImage.zsync',
      'VSCodium-1.143.17232-src.tar.gz', 'VSCodium-1.143.17232-src.zip',
      'vscodium-cli-darwin-arm64-1.143.17232.tar.gz',
      'vscodium-cli-win32-x64-1.143.17232.tar.gz', 'VSCodium-darwin-arm64-1.143.17232.zip',
      'VSCodium-darwin-x64-1.143.17232.zip', 'VSCodium-linux-loong64-1.143.17232.tar.gz',
      'VSCodium-linux-x64-1.143.17232.tar.gz', 'vscodium-reh-darwin-arm64-1.143.17232.tar.gz',
      'vscodium-reh-web-darwin-arm64-1.143.17232.tar.gz',
      'vscodium-reh-web-linux-armhf-1.143.17232.tar.gz',
      'vscodium-reh-alpine-x64-1.143.17232.tar.gz',
      'VSCodium-win32-arm64-1.143.17232.zip', 'VSCodium-win32-x64-1.143.17232.zip',
      'VSCodium-x64-1.143.17232.msi', 'VSCodium-x64-updates-disabled-1.143.17232.msi',
      'VSCodium.arm64.1.143.17232.dmg', 'VSCodium.x64.1.143.17232.dmg',
      'VSCodiumSetup-arm64-1.143.17232.exe', 'VSCodiumSetup-x64-1.143.17232.exe',
      'VSCodiumUserSetup-arm64-1.143.17232.exe', 'VSCodiumUserSetup-x64-1.143.17232.exe',
    ),
  },
};
