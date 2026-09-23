import { describe, it, expect } from 'vitest';
import {
  extractRepositoryCandidates,
  isPlausibleBareSlug,
  normalizeRepositoryFullName,
  resolveRepositoryFromGitHubUrl,
  toLocalRepositoryNameSet,
} from './repositoryImport';

/** 便捷断言：取候选的 `repositoryFullName` 列表。 */
const names = (input: string, source: 'text' | 'json' = 'text') =>
  extractRepositoryCandidates(input, { source }).candidates.map((c) => c.repositoryFullName);

describe('normalizeRepositoryFullName', () => {
  it('accepts GitHub-legal owner/repo pairs', () => {
    expect(normalizeRepositoryFullName('deskflow', 'deskflow')).toBe('deskflow/deskflow');
    expect(normalizeRepositoryFullName('My-Org', 'my_repo.js')).toBe('My-Org/my_repo.js');
    expect(normalizeRepositoryFullName('a1', 'b2')).toBe('a1/b2');
  });

  it('strips a trailing .git suffix', () => {
    expect(normalizeRepositoryFullName('foo', 'bar.git')).toBe('foo/bar');
    expect(normalizeRepositoryFullName('foo', 'bar.GIT')).toBe('foo/bar');
  });

  it('rejects illegal names', () => {
    expect(normalizeRepositoryFullName('-bad', 'repo')).toBeNull();
    expect(normalizeRepositoryFullName('owner-', 'repo')).toBeNull();
    expect(normalizeRepositoryFullName('own er', 'repo')).toBeNull();
    expect(normalizeRepositoryFullName('owner', '..')).toBeNull();
    expect(normalizeRepositoryFullName('owner', '.')).toBeNull();
    expect(normalizeRepositoryFullName('owner', 'has space')).toBeNull();
    expect(normalizeRepositoryFullName('owner', 'a'.repeat(101))).toBeNull();
  });
});

describe('resolveRepositoryFromGitHubUrl', () => {
  it.each([
    ['deskflow/deskflow', 'deskflow/deskflow'],
    ['deskflow/deskflow/', 'deskflow/deskflow'],
    ['deskflow/deskflow.git', 'deskflow/deskflow'],
    ['deskflow/deskflow/releases/tag/v1.2.0', 'deskflow/deskflow'],
    ['deskflow/deskflow/releases', 'deskflow/deskflow'],
    ['deskflow/deskflow/releases/download/v1/app.exe', 'deskflow/deskflow'],
    ['deskflow/deskflow/issues/12', 'deskflow/deskflow'],
    ['deskflow/deskflow/pull/34', 'deskflow/deskflow'],
    ['deskflow/deskflow/pulls', 'deskflow/deskflow'],
    ['deskflow/deskflow/tree/main/src', 'deskflow/deskflow'],
    ['deskflow/deskflow/blob/main/README.md', 'deskflow/deskflow'],
    ['deskflow/deskflow/actions', 'deskflow/deskflow'],
    ['deskflow/deskflow/wiki', 'deskflow/deskflow'],
    ['deskflow/deskflow/discussions/5', 'deskflow/deskflow'],
    ['deskflow/deskflow/commit/abc123', 'deskflow/deskflow'],
    ['deskflow/deskflow/compare/a...b', 'deskflow/deskflow'],
    ['deskflow/deskflow/stargazers', 'deskflow/deskflow'],
    ['deskflow/deskflow/graphs/commit-activity', 'deskflow/deskflow'],
    ['deskflow/deskflow/security/advisories', 'deskflow/deskflow'],
    ['deskflow/deskflow/packages/1', 'deskflow/deskflow'],
    ['deskflow/deskflow#readme', 'deskflow/deskflow'],
    ['deskflow/deskflow?tab=readme-ov-file', 'deskflow/deskflow'],
  ])('normalizes %s to its owning repository', (path, expected) => {
    expect(resolveRepositoryFromGitHubUrl(path)).toEqual({ repositoryFullName: expected });
  });

  it.each([
    ['orgs/foo/repositories', 'not-a-repository-url'],
    ['topics/react', 'not-a-repository-url'],
    ['settings/profile', 'not-a-repository-url'],
    ['features/actions', 'not-a-repository-url'],
    ['sponsors/someone', 'not-a-repository-url'],
    ['marketplace/actions/checkout', 'not-a-repository-url'],
    ['apps/dependabot', 'not-a-repository-url'],
    ['trending', 'not-a-repository-url'],
    ['', 'not-a-repository-url'],
    ['-bad-owner/repo', 'malformed-slug'],
    ['owner/..', 'malformed-slug'],
  ])('reports %s as unusable (%s)', (path, reason) => {
    expect(resolveRepositoryFromGitHubUrl(path)).toEqual({ reason });
  });
});

describe('extractRepositoryCandidates — GitHub URL 形态', () => {
  it('handles scheme, www, bare host, trailing slash and .git', () => {
    const input = [
      'https://github.com/deskflow/deskflow',
      'github.com/CyrilPeng/FlowScroll',
      'http://www.github.com/foo/bar/',
      'https://github.com/acme/app.git',
    ].join('\n');

    expect(names(input)).toEqual([
      'deskflow/deskflow',
      'CyrilPeng/FlowScroll',
      'foo/bar',
      'acme/app',
    ]);
  });

  it('normalizes release / issue / PR / tree / blob links to the owning repository', () => {
    const input = [
      'https://github.com/foo/bar/releases/tag/v1.2.0',
      'https://github.com/foo/bar/issues/7',
      'https://github.com/foo/bar/pull/9',
      'https://github.com/foo/bar/tree/main/src',
      'https://github.com/foo/bar/blob/main/index.ts',
    ].join('\n');

    // 五条都指向同一个仓库：首条 pending，其余为 duplicate
    expect(names(input)).toEqual(['foo/bar', 'foo/bar', 'foo/bar', 'foo/bar', 'foo/bar']);
    const result = extractRepositoryCandidates(input);
    expect(result.stats).toEqual({ scanned: 1, valid: 1, duplicates: 4, invalid: 0 });
  });

  it('finds URLs inside Markdown links, brackets, angle brackets and code spans', () => {
    const input = [
      '[deskflow](https://github.com/deskflow/deskflow)',
      '(https://github.com/foo/bar)',
      '<https://github.com/acme/app>',
      '`https://github.com/org/tool`',
    ].join('\n');

    expect(names(input)).toEqual(['deskflow/deskflow', 'foo/bar', 'acme/app', 'org/tool']);
  });

  it('ignores sentence punctuation after a URL', () => {
    expect(names('See https://github.com/foo/bar.')).toEqual(['foo/bar']);
    expect(names('Is it https://github.com/foo/bar?')).toEqual(['foo/bar']);
    expect(names('Yes: https://github.com/foo/bar, and more')).toEqual(['foo/bar']);
  });

  it('splits adjacent URLs separated by punctuation', () => {
    expect(names('https://github.com/a-one/repo-one,https://github.com/b-two/repo-two')).toEqual([
      'a-one/repo-one',
      'b-two/repo-two',
    ]);
    expect(names('https://github.com/a-one/repo-one|https://github.com/b-two/repo-two')).toEqual([
      'a-one/repo-one',
      'b-two/repo-two',
    ]);
  });

  it('handles Markdown emphasis around a URL', () => {
    expect(names('*https://github.com/foo/bar*')).toEqual(['foo/bar']);
    expect(names('~~https://github.com/acme/tool~~')).toEqual(['acme/tool']);
    expect(names('_https://github.com/acme/tool_')).toEqual(['acme/tool']);
    expect(names('__https://github.com/acme/tool__')).toEqual(['acme/tool']);
  });

  it('does not treat a lookalike host as GitHub', () => {
    // `notgithub.com` 内部含有 `github.com`，若不做主机边界检查会被当成高可信度候选
    expect(extractRepositoryCandidates('see https://notgithub.com/acme/tool').candidates).toEqual([]);
    expect(extractRepositoryCandidates('see https://mygithub.com/acme/tool').candidates).toEqual([]);
    expect(extractRepositoryCandidates('see https://github.com.evil.example/acme/tool').candidates).toEqual([]);
    expect(extractRepositoryCandidates('see https://example.com/github.com/acme/tool').candidates).toEqual([]);
    // 正常主机仍然能识别，包括 www 与省略 scheme 的写法
    expect(names('https://www.github.com/acme/tool')).toEqual(['acme/tool']);
  });

  it('keeps the raw fragment in originalValue for traceability', () => {
    const [candidate] = extractRepositoryCandidates('see https://github.com/foo/bar.').candidates;
    expect(candidate.originalValue).toBe('https://github.com/foo/bar.');
    expect(candidate.matchedBy).toBe('github-url');
    expect(candidate.confidence).toBe('high');
  });

  it('marks site功能 paths as invalid with a reason instead of dropping them', () => {
    const result = extractRepositoryCandidates(
      'https://github.com/orgs/foo/repositories\nhttps://github.com/topics/react',
    );

    expect(result.candidates).toEqual([
      expect.objectContaining({
        repositoryFullName: '',
        status: 'invalid',
        reason: 'not-a-repository-url',
        matchedBy: 'github-url',
      }),
      expect.objectContaining({ status: 'invalid', reason: 'not-a-repository-url' }),
    ]);
    expect(result.stats.invalid).toBe(2);
  });
});

describe('extractRepositoryCandidates — 裸 owner/repo', () => {
  it('accepts plausible bare slugs and marks them low confidence', () => {
    const result = extractRepositoryCandidates('facebook/react and deskflow/deskflow');

    expect(result.candidates.map((c) => c.repositoryFullName)).toEqual([
      'facebook/react',
      'deskflow/deskflow',
    ]);
    expect(result.candidates.every((c) => c.matchedBy === 'bare-slug')).toBe(true);
    expect(result.candidates.every((c) => c.confidence === 'low')).toBe(true);
  });

  it.each([
    ['_foo/bar_', 'foo/bar'],
    ['__foo/bar__', 'foo/bar'],
  ])('normalizes Markdown underscore emphasis: %s', (input, expected) => {
    expect(names(input)).toEqual([expected]);
  });

  it.each([
    ['src/utils', '代码目录名'],
    ['docs/plans', '代码目录名'],
    ['src/utils.ts', '文件扩展名'],
    ['docs/guide.md', '文件扩展名'],
    ['and/or', '常见词组'],
    ['TCP/IP', '常见词组'],
    ['read/write', '常见词组'],
    ['topics/react', '站点保留字'],
    ['24/7', '单字符段'],
    ['i/o', '单字符段'],
  ])('rejects the false positive %s (%s)', (slug) => {
    expect(extractRepositoryCandidates(`see ${slug} for details`).candidates).toEqual([]);
  });

  it('does not treat part of a longer path as a slug', () => {
    expect(extractRepositoryCandidates('path/to/thing').candidates).toEqual([]);
  });

  it('does not re-scan URL path segments as bare slugs', () => {
    // 若不做 URL 屏蔽，`releases/tag` 与 `tag/v1.2.0` 会被误当成仓库
    const result = extractRepositoryCandidates('https://github.com/foo/bar/releases/tag/v1.2.0');
    expect(result.candidates.map((c) => c.matchedBy)).toEqual(['github-url']);
  });

  it('accepts a bare slug with a .git suffix', () => {
    expect(names('clone acme/app.git now')).toEqual(['acme/app']);
  });

  it('strips sentence punctuation from a bare slug', () => {
    expect(names('See deskflow/deskflow.')).toEqual(['deskflow/deskflow']);
  });

  it('exposes the bare-slug heuristic for reuse', () => {
    expect(isPlausibleBareSlug('deskflow', 'deskflow')).toBe(true);
    expect(isPlausibleBareSlug('src', 'utils')).toBe(false);
  });
});

describe('extractRepositoryCandidates — 去重', () => {
  it('keeps the first occurrence as pending and marks the rest as duplicate', () => {
    const input = [
      'https://github.com/foo/bar',
      'foo/bar',
      'https://github.com/FOO/BAR/releases',
    ].join('\n');

    const result = extractRepositoryCandidates(input);
    expect(result.candidates.map((c) => c.status)).toEqual(['pending', 'duplicate', 'duplicate']);
    // 保留首次出现的大小写
    expect(result.candidates[0].repositoryFullName).toBe('foo/bar');
    expect(result.stats).toEqual({ scanned: 1, valid: 1, duplicates: 2, invalid: 0 });
  });

  it('upgrades a first bare occurrence when a duplicate is an explicit URL', () => {
    const result = extractRepositoryCandidates('foo/bar then https://github.com/foo/bar');
    expect(result.candidates.map((candidate) => candidate.confidence)).toEqual(['high', 'high']);
  });

  it('deduplicates repeated invalid fragments too', () => {
    const result = extractRepositoryCandidates(
      'https://github.com/topics/a\nhttps://github.com/topics/a',
    );
    expect(result.candidates.map((c) => c.status)).toEqual(['invalid', 'duplicate']);
  });
});

describe('extractRepositoryCandidates — JSON', () => {
  it('scans string values recursively without requiring a schema', () => {
    const input = JSON.stringify([
      'https://github.com/foo/bar',
      { repo: 'owner/repo', note: '值得看看' },
      { nested: { deeper: ['acme/tool'] } },
    ]);

    expect(names(input, 'json')).toEqual(['foo/bar', 'owner/repo', 'acme/tool']);
  });

  it('ignores non-string values and object keys', () => {
    const input = JSON.stringify({ 'acme/key': 1, flag: true, count: 3, nothing: null });
    expect(names(input, 'json')).toEqual([]);
  });

  it('reports unparsable JSON without producing candidates', () => {
    const result = extractRepositoryCandidates('{ not json', { source: 'json' });
    expect(result.candidates).toEqual([]);
    expect(result.inputErrors[0].code).toBe('json-parse-failed');
  });

  it('stops at the value limit but keeps what it already found', () => {
    const result = extractRepositoryCandidates(JSON.stringify(['acme/one', 'acme/two']), {
      source: 'json',
      maxValues: 1,
    });

    expect(result.candidates.map((c) => c.repositoryFullName)).toEqual(['acme/one']);
    expect(result.inputErrors[0].code).toBe('too-many-values');
  });

  it('reports nesting beyond the depth limit', () => {
    const result = extractRepositoryCandidates(JSON.stringify({ a: { b: { c: 'acme/deep' } } }), {
      source: 'json',
      maxDepth: 1,
    });

    expect(result.candidates).toEqual([]);
    expect(result.inputErrors[0].code).toBe('depth-limit-exceeded');
  });

  it('propagates the source onto every candidate', () => {
    const result = extractRepositoryCandidates(JSON.stringify(['acme/one']), { source: 'json' });
    expect(result.candidates[0].source).toBe('json');
  });
});

describe('extractRepositoryCandidates — 边界与本地数据', () => {
  it('returns nothing for empty input', () => {
    expect(extractRepositoryCandidates('')).toEqual({
      candidates: [],
      inputErrors: [],
      stats: { scanned: 1, valid: 0, duplicates: 0, invalid: 0 },
    });
  });

  it('rejects oversized input before scanning', () => {
    const result = extractRepositoryCandidates('https://github.com/foo/bar', { maxInputLength: 10 });
    expect(result.candidates).toEqual([]);
    expect(result.inputErrors[0].code).toBe('input-too-large');
    expect(result.stats.scanned).toBe(0);
  });

  it('flags candidates that are already in the local library', () => {
    const result = extractRepositoryCandidates('https://github.com/foo/bar\nacme/tool', {
      localRepositoryFullNames: new Set(['foo/bar']),
    });

    expect(result.candidates[0].alreadyStarred).toBe(true);
    expect(result.candidates[1].alreadyStarred).toBeUndefined();
  });

  it('flags duplicate rows that are already in the local library', () => {
    const result = extractRepositoryCandidates('foo/bar https://github.com/foo/bar', {
      localRepositoryFullNames: new Set(['foo/bar']),
    });

    expect(result.candidates.map((candidate) => candidate.alreadyStarred)).toEqual([true, true]);
  });

  it('does not reject a repository owned by the git organization', () => {
    expect(names('https://github.com/git/git')).toEqual(['git/git']);
  });

  it('builds a lowercase local name set from repositories', () => {
    expect(toLocalRepositoryNameSet([{ full_name: 'Foo/Bar' }])).toEqual(new Set(['foo/bar']));
    expect(toLocalRepositoryNameSet(undefined)).toEqual(new Set());
  });

  it('handles the documented example end to end', () => {
    const input = `https://github.com/deskflow/deskflow
github.com/CyrilPeng/FlowScroll
owner/repo
https://github.com/foo/bar/releases/tag/v1.2.0`;

    expect(names(input)).toEqual([
      'deskflow/deskflow',
      'CyrilPeng/FlowScroll',
      'owner/repo',
      'foo/bar',
    ]);
  });
});
