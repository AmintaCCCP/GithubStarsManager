import { describe, expect, it } from 'vitest';
import { parseGitHubClipboardTarget } from './githubClipboard';

describe('parseGitHubClipboardTarget', () => {
  it('recognizes a repository URL and normalizes it', () => {
    expect(parseGitHubClipboardTarget('https://github.com/facebook/react')).toEqual({
      kind: 'repository',
      owner: 'facebook',
      name: 'react',
      url: 'https://github.com/facebook/react',
      label: 'facebook/react',
    });
    expect(parseGitHubClipboardTarget('https://www.github.com/facebook/react/?tab=readme')?.label).toBe('facebook/react');
    expect(parseGitHubClipboardTarget('https://github.com/facebook/react.git')?.label).toBe('facebook/react');
  });

  it('folds repository sub-pages into the owning repository', () => {
    for (const path of ['issues', 'tree/main/src', 'blob/main/README.md', 'pull/42']) {
      expect(parseGitHubClipboardTarget(`https://github.com/owner/repo/${path}`)?.kind).toBe('repository');
      expect(parseGitHubClipboardTarget(`https://github.com/owner/repo/${path}`)?.label).toBe('owner/repo');
    }
  });

  it('recognizes release tags, keeping the tag verbatim', () => {
    expect(parseGitHubClipboardTarget('https://github.com/owner/repo/releases/tag/v1.2.3')).toEqual({
      kind: 'release',
      owner: 'owner',
      name: 'repo',
      tag: 'v1.2.3',
      url: 'https://github.com/owner/repo/releases/tag/v1.2.3',
      label: 'owner/repo@v1.2.3',
    });
    expect(parseGitHubClipboardTarget('https://github.com/owner/repo/releases/tag/v1.0.0-beta.1')?.tag).toBe('v1.0.0-beta.1');
    expect(parseGitHubClipboardTarget('https://github.com/owner/repo/releases/tag/feature/test')?.tag).toBe('feature/test');
    // releases 列表页没有 tag，按仓库处理
    expect(parseGitHubClipboardTarget('https://github.com/owner/repo/releases')?.kind).toBe('repository');
  });

  it('recognizes a developer profile URL', () => {
    expect(parseGitHubClipboardTarget('https://github.com/torvalds')).toEqual({
      kind: 'developer',
      login: 'torvalds',
      url: 'https://github.com/torvalds',
      label: '@torvalds',
    });
  });

  it('rejects reserved github.com roots instead of treating them as users', () => {
    for (const path of ['settings', 'marketplace', 'topics', 'notifications', 'explore']) {
      expect(parseGitHubClipboardTarget(`https://github.com/${path}`)).toBeNull();
    }
  });

  it('rejects anything that is not a GitHub URL', () => {
    expect(parseGitHubClipboardTarget('https://gitlab.com/owner/repo')).toBeNull();
    expect(parseGitHubClipboardTarget('https://github.com.evil.example/owner/repo')).toBeNull();
    expect(parseGitHubClipboardTarget('https://gist.github.com/owner/abc123')).toBeNull();
    expect(parseGitHubClipboardTarget('举个例子 https://example.com/owner/repo')).toBeNull();
    expect(parseGitHubClipboardTarget('owner/repo')).toBeNull();
    expect(parseGitHubClipboardTarget('')).toBeNull();
    expect(parseGitHubClipboardTarget(null)).toBeNull();
    expect(parseGitHubClipboardTarget(undefined)).toBeNull();
  });

  it('picks the first URL out of a longer clipboard excerpt', () => {
    const text = '看看这个 https://github.com/owner/repo 挺不错，还有 https://github.com/other/thing';
    expect(parseGitHubClipboardTarget(text)?.label).toBe('owner/repo');
    expect(parseGitHubClipboardTarget('https://example.com/private then https://github.com/other/thing')?.label)
      .toBe('other/thing');
    expect(parseGitHubClipboardTarget('[project](https://github.com/owner/repo).')?.label).toBe('owner/repo');
  });

  it('drops path segments that cannot be a repository name', () => {
    expect(parseGitHubClipboardTarget('https://github.com/owner/%E4%B8%AD%E6%96%87')).toBeNull();
    expect(parseGitHubClipboardTarget('https://github.com/owner/.')).toBeNull();
    expect(parseGitHubClipboardTarget('https://github.com/owner/..')).toBeNull();
    expect(parseGitHubClipboardTarget('https://github.com/owner/repo/../other')).toBeNull();
    expect(parseGitHubClipboardTarget('https://github.com/bad--owner/repo')).toBeNull();
    expect(parseGitHubClipboardTarget('https://github.com/bad_owner/repo')).toBeNull();
    expect(parseGitHubClipboardTarget('https://github.com/owner/repo/releases/tag/%')).toBeNull();
  });
});
