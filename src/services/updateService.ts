export interface VersionInfo {
  number: string;
  releaseDate: string;
  changelog: string[];
  downloadUrl: string;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion?: VersionInfo;
}

export class UpdateService {
  private static readonly REPO_URL = 'https://raw.githubusercontent.com/AmintaCCCP/GithubStarsManager/main/versions/version-info.xml';

  private static getCurrentVersion(): string {
    // 在实际应用中，这个版本号应该在构建时注入
    // 这里暂时硬编码，你可以通过构建脚本或环境变量来动态设置
    return '0.1.8';
  }

  static async checkForUpdates(): Promise<UpdateCheckResult> {
    const currentVersion = this.getCurrentVersion();

    try {
      const response = await fetch(this.REPO_URL);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const xmlText = await response.text();
      const versions = this.parseVersionXML(xmlText);

      if (versions.length === 0) {
        return {
          hasUpdate: false,
          currentVersion
        };
      }

      // 获取最新版本（假设XML中版本按时间排序，最后一个是最新的）
      const latestVersion = versions[versions.length - 1];
      const hasUpdate = this.compareVersions(currentVersion, latestVersion.number) < 0;

      return {
        hasUpdate,
        currentVersion,
        latestVersion: hasUpdate ? latestVersion : undefined
      };
    } catch (error) {
      console.error('检查更新失败:', error);
      throw error;
    }
  }

  private static parseVersionXML(xmlText: string): VersionInfo[] {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

    // 检查解析错误
    const parseError = xmlDoc.querySelector('parsererror');
    if (parseError) {
      throw new Error('XML解析失败');
    }

    const versions: VersionInfo[] = [];
    const versionNodes = xmlDoc.querySelectorAll('version');

    versionNodes.forEach(versionNode => {
      const number = versionNode.querySelector('number')?.textContent?.trim();
      const releaseDate = versionNode.querySelector('releaseDate')?.textContent?.trim();
      const downloadUrl = versionNode.querySelector('downloadUrl')?.textContent?.trim();

      if (!number || !releaseDate || !downloadUrl) {
        return; // 跳过不完整的版本信息
      }

      const changelog: string[] = [];
      const changelogItems = versionNode.querySelectorAll('changelog item');
      changelogItems.forEach(item => {
        const text = item.textContent?.trim();
        if (text) {
          changelog.push(text);
        }
      });

      versions.push({
        number,
        releaseDate,
        changelog,
        downloadUrl
      });
    });

    return versions;
  }

  private static compareVersions(version1: string, version2: string): number {
    const v1Parts = version1.split('.').map(Number);
    const v2Parts = version2.split('.').map(Number);

    const maxLength = Math.max(v1Parts.length, v2Parts.length);

    for (let i = 0; i < maxLength; i++) {
      const v1Part = v1Parts[i] || 0;
      const v2Part = v2Parts[i] || 0;

      if (v1Part < v2Part) return -1;
      if (v1Part > v2Part) return 1;
    }

    return 0;
  }

  static openDownloadUrl(url: string): void {
    window.open(url, '_blank');
  }
}
