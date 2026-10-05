import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NETWORK_ALLOWED_HOSTS, NETWORK_ALLOWED_REPO_PATHS, NETWORK_ALLOWED_USER_PATHS, buildNetworkRequestUrl, isAllowedNetworkTarget } from './networkTargets';

/**
 * 主进程与渲染端各自维护同一份 host/path 白名单（两侧技术栈不同，无法直接共享
 * 模块）；这里的 parity 测试从 electron/plugins/pluginPageBridge.js 源码提取
 * 导出清单，防止两份列表漂移。
 */
const bridgeSource = readFileSync(resolve(process.cwd(), 'electron/plugins/pluginPageBridge.js'), 'utf8');

function extractStringArray(source: string, name: string): string[] {
  const match = source.match(new RegExp(`${name}\\s*=\\s*(?:new Set\\()?\\[([\\s\\S]*?)\\]`));
  if (!match) throw new Error(`Cannot extract ${name} from pluginPageBridge.js`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('networkTargets parity with the main-process allowlist', () => {
  it('declares the same hosts', () => {
    const bridgeHosts = extractStringArray(bridgeSource, 'NETWORK_ALLOWED_HOSTS');
    expect(bridgeHosts.sort()).toEqual([...NETWORK_ALLOWED_HOSTS].sort());
  });

  it('declares the same repo path templates', () => {
    const bridgePaths = extractStringArray(bridgeSource, 'NETWORK_ALLOWED_REPO_PATHS');
    expect(bridgePaths.sort()).toEqual([...NETWORK_ALLOWED_REPO_PATHS].sort());
  });

  it('declares the same user path templates', () => {
    const bridgeUsers = extractStringArray(bridgeSource, 'NETWORK_ALLOWED_USER_PATHS');
    expect(bridgeUsers.sort()).toEqual([...NETWORK_ALLOWED_USER_PATHS].sort());
  });
});

describe('isAllowedNetworkTarget', () => {
  const base = { host: 'api.github.com' };

  it('accepts allowlisted metric endpoints with pagination params', () => {
    expect(isAllowedNetworkTarget({ ...base, path: '/repos/facebook/react' })).toBe(true);
    expect(isAllowedNetworkTarget({ ...base, path: '/repos/facebook/react/stats/commit_activity' })).toBe(true);
    expect(isAllowedNetworkTarget({ ...base, path: '/repos/facebook/react/contributors', query: { per_page: 12 } })).toBe(true);
    expect(isAllowedNetworkTarget({ ...base, path: '/repos/facebook/react/stargazers/history', query: { per_page: 30, page: 2 } })).toBe(true);
    expect(isAllowedNetworkTarget({ ...base, path: '/repos/facebook/react/community/profile' })).toBe(true);
    expect(isAllowedNetworkTarget({ ...base, path: '/repos/facebook/react/pulls', query: { state: 'closed', per_page: 30 } })).toBe(true);
    expect(isAllowedNetworkTarget({ ...base, path: '/users/facebook' })).toBe(true);
  });

  it('rejects non-allowlisted hosts, paths and shapes', () => {
    expect(isAllowedNetworkTarget({ host: 'evil.example', path: '/repos/facebook/react' })).toBe(false);
    expect(isAllowedNetworkTarget({ ...base, path: '/repos/facebook/react/settings' })).toBe(false);
    expect(isAllowedNetworkTarget({ ...base, path: '/repos/facebook/react?per_page=1' })).toBe(false);
    expect(isAllowedNetworkTarget({ ...base, path: '/repos/facebook/../evil' })).toBe(false);
    expect(isAllowedNetworkTarget({ ...base, path: '/repos/%2e%2e/evil' })).toBe(false);
    expect(isAllowedNetworkTarget({ ...base, path: '//repos/facebook/react' })).toBe(false);
    expect(isAllowedNetworkTarget({ ...base, path: '/repos/facebook/react/' })).toBe(false);
    expect(isAllowedNetworkTarget({ ...base, path: '/repos/-bad/react' })).toBe(false);
    expect(isAllowedNetworkTarget({ ...base, path: '/repos/facebook/react', query: { url: 'x' } })).toBe(false);
    expect(isAllowedNetworkTarget({ ...base, path: '/repos/facebook/react', query: 'per_page=12' })).toBe(false);
    expect(isAllowedNetworkTarget({ ...base, path: '/repos/facebook/react', query: { state: 'evil' } })).toBe(false);
    expect(isAllowedNetworkTarget({ ...base, path: '/users/facebook/repos' })).toBe(false);
    expect(isAllowedNetworkTarget({ ...base, path: '/users' })).toBe(false);
    expect(isAllowedNetworkTarget({ ...base, path: '' })).toBe(false);
  });
});

describe('buildNetworkRequestUrl', () => {
  it('serializes pagination params into the query string', () => {
    expect(buildNetworkRequestUrl({ host: 'api.github.com', path: '/repos/o/r/contributors', query: { per_page: 12 } }))
      .toBe('https://api.github.com/repos/o/r/contributors?per_page=12');
    expect(buildNetworkRequestUrl({ host: 'api.github.com', path: '/repos/o/r' }))
      .toBe('https://api.github.com/repos/o/r');
    expect(buildNetworkRequestUrl({ host: 'api.github.com', path: '/repos/o/r/releases', query: { per_page: 20, page: 2 } }))
      .toBe('https://api.github.com/repos/o/r/releases?per_page=20&page=2');
  });
});
