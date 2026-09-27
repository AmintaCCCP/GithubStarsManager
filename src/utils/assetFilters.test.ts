import { describe, expect, it } from 'vitest';
import { filterMatchesRelease, normalizeAssetFilters } from './assetFilters';

describe('normalizeAssetFilters', () => {
  it('strips the obsolete excludeRepos field from persisted filters', () => {
    // #405 曾短暂实现反向语义的 excludeRepos，hydration 时必须剥掉旧键
    const filters = [
      {
        id: 'f1',
        name: 'Portable',
        keywords: ['portable'],
        excludeRepos: ['owner/legacy'],
        includeRepos: ['owner/beta'],
      },
      { id: 'f2', name: 'Windows', keywords: ['exe'] },
    ];

    expect(normalizeAssetFilters(filters)).toEqual([
      { id: 'f1', name: 'Portable', keywords: ['portable'], includeRepos: ['owner/beta'] },
      { id: 'f2', name: 'Windows', keywords: ['exe'] },
    ]);
  });

  it('preserves alwaysExcludeRepos and keeps legacy excludeRepos unactivated', () => {
    expect(normalizeAssetFilters([
      {
        id: 'f1',
        name: 'Portable',
        keywords: ['portable'],
        includeRepos: ['owner/beta'],
        alwaysExcludeRepos: ['owner/noise'],
        excludeRepos: ['owner/legacy'],
      },
    ])).toEqual([
      {
        id: 'f1',
        name: 'Portable',
        keywords: ['portable'],
        includeRepos: ['owner/beta'],
        alwaysExcludeRepos: ['owner/noise'],
      },
    ]);
  });

  it('preserves preset metadata and coerces non-string elements out of string arrays', () => {
    expect(normalizeAssetFilters([
      {
        id: 'preset-windows',
        name: 'Windows',
        keywords: ['exe', 42, null],
        excludeKeywords: ['setup'],
        includeRepos: ['owner/beta', 7],
        alwaysExcludeRepos: ['owner/noise', false],
        isPreset: true,
        icon: 'Monitor',
      },
    ])).toEqual([
      {
        id: 'preset-windows',
        name: 'Windows',
        keywords: ['exe'],
        excludeKeywords: ['setup'],
        includeRepos: ['owner/beta'],
        alwaysExcludeRepos: ['owner/noise'],
        isPreset: true,
        icon: 'Monitor',
      },
    ]);
  });

  it('trims entries and drops empty or whitespace-only items (incl. empty-string keywords)', () => {
    // keywords: [""] 若保留，includes("") 恒为 true，会变相匹配所有 Release
    expect(normalizeAssetFilters([
      {
        id: 'f1',
        name: 'X',
        keywords: ['  mac  ', '', '   '],
        excludeKeywords: ['setup', ''],
        includeRepos: [' owner/beta ', '  '],
        alwaysExcludeRepos: [' owner/noise ', ''],
      },
    ])).toEqual([
      {
        id: 'f1',
        name: 'X',
        keywords: ['mac'],
        excludeKeywords: ['setup'],
        includeRepos: ['owner/beta'],
        alwaysExcludeRepos: ['owner/noise'],
      },
    ]);
  });

  it('dedupes repositories case-insensitively and keywords case-insensitively, keeping the first entry', () => {
    expect(normalizeAssetFilters([
      {
        id: 'f1',
        name: 'X',
        keywords: ['Mac', 'mac', 'MAC'],
        excludeKeywords: ['Setup', 'setup'],
        includeRepos: ['Owner/Beta', 'owner/beta'],
        alwaysExcludeRepos: ['Owner/Noise', 'owner/noise'],
      },
    ])).toEqual([
      {
        id: 'f1',
        name: 'X',
        keywords: ['Mac'],
        excludeKeywords: ['Setup'],
        includeRepos: ['Owner/Beta'],
        alwaysExcludeRepos: ['Owner/Noise'],
      },
    ]);
  });

  it('does not cross-dedupe includeRepos against alwaysExcludeRepos', () => {
    // 两组之间的重复是合法状态（用于展示“排除优先”冲突提示）
    expect(normalizeAssetFilters([
      {
        id: 'f1',
        name: 'X',
        keywords: ['k'],
        includeRepos: ['owner/both'],
        alwaysExcludeRepos: ['owner/both'],
      },
    ])).toEqual([
      {
        id: 'f1',
        name: 'X',
        keywords: ['k'],
        includeRepos: ['owner/both'],
        alwaysExcludeRepos: ['owner/both'],
      },
    ]);
  });

  it('preserves empty arrays written by the editor instead of dropping the keys', () => {
    expect(normalizeAssetFilters([
      {
        id: 'f1',
        name: 'X',
        keywords: [],
        excludeKeywords: [],
        includeRepos: [],
        alwaysExcludeRepos: [],
      },
    ])).toEqual([
      {
        id: 'f1',
        name: 'X',
        keywords: [],
        excludeKeywords: [],
        includeRepos: [],
        alwaysExcludeRepos: [],
      },
    ]);
  });

  it('drops filters missing required fields so keyword matching cannot throw', () => {
    expect(normalizeAssetFilters([
      { id: 'f1' },                              // 缺 name / keywords
      { id: '', name: 'X', keywords: ['k'] },    // 空 id
      { id: 'f2', keywords: ['k'] },             // 缺 name
      { id: 'f3', name: 'X' },                   // 缺 keywords
      { id: 'f4', name: 'X', keywords: 'oops' }, // keywords 不是数组
      { id: 'ok', name: 'OK', keywords: ['k'] }, // 合法条目保留
    ])).toEqual([{ id: 'ok', name: 'OK', keywords: ['k'] }]);
  });

  it('drops non-object entries and returns empty for non-arrays', () => {
    expect(normalizeAssetFilters([null, 'oops', { id: 'f1' }])).toEqual([]);
    expect(normalizeAssetFilters(undefined)).toEqual([]);
    expect(normalizeAssetFilters('nope')).toEqual([]);
  });
});

describe('filterMatchesRelease', () => {
  // 调用方传入的列表均已小写（与 ReleaseTimeline 的 lowerLinkNames 做法一致）
  const match = (
    filter: Parameters<typeof filterMatchesRelease>[0],
    repoKey: string,
    allLinkNames: string[] = [],
    realAssetNames: string[] = allLinkNames,
  ) => filterMatchesRelease(filter, repoKey, allLinkNames, realAssetNames);

  it('lets alwaysExcludeRepos win over includeRepos and keywords in the same filter', () => {
    const filter = {
      keywords: ['zip'],
      includeRepos: ['Owner/Repo'],
      alwaysExcludeRepos: ['owner/repo'],
    };
    expect(match(filter, 'owner/repo', ['app.zip'])).toBe(false);
  });

  it('matches case-insensitively on repository keys', () => {
    const filter = { keywords: [], alwaysExcludeRepos: ['OWNER/ALPHA'] };
    expect(match(filter, 'owner/alpha')).toBe(false);
    expect(match(filter, 'owner/beta')).toBe(true);
  });

  it('lets includeRepos bypass keywords and excludeKeywords of the same filter', () => {
    const filter = {
      keywords: ['portable'],
      excludeKeywords: ['beta'],
      includeRepos: ['owner/beta'],
    };
    expect(match(filter, 'owner/beta', ['beta.zip'])).toBe(true);
  });

  it('requires an asset to hit an include keyword and no exclude keyword', () => {
    const filter = { keywords: ['zip'], excludeKeywords: ['setup'] };
    expect(match(filter, 'owner/a', ['app.zip'])).toBe(true);
    expect(match(filter, 'owner/a', ['app-setup.zip'])).toBe(false);
  });

  it('keeps the legacy matching scope when include keywords are present (pseudo assets & body links)', () => {
    // preset-source 依赖 "source code (...)" 伪资产名参与匹配的现状
    const filter = { keywords: ['source'] };
    expect(match(filter, 'owner/a', ['app.bin', 'source code (v1.zip)'], ['app.bin'])).toBe(true);
    // 正文提取的下载链接名也参与匹配（包含关键词非空的现状路径）
    expect(match(filter, 'owner/a', ['app.bin', 'download-setup.exe'], ['app.bin'])).toBe(false);
    const setupFilter = { keywords: ['setup'] };
    expect(match(setupFilter, 'owner/a', ['app.bin', 'download-setup.exe'], ['app.bin'])).toBe(true);
  });

  it('matches only real uploaded assets when include keywords are empty', () => {
    const filter = { keywords: [], excludeKeywords: ['setup'] };

    // 至少一个真实上传资产未被排除 → 命中
    expect(match(filter, 'owner/a', ['source code (v1.zip)', 'app.zip'], ['app.zip'])).toBe(true);

    // 真实资产全部被排除，但伪资产未排除 → 隐藏（排除关键词必须能隐藏 Release）
    expect(
      match(filter, 'owner/a', ['source code (v1.zip)', 'app-setup.zip'], ['app-setup.zip']),
    ).toBe(false);

    // 没有真实上传资产 → 隐藏
    expect(match(filter, 'owner/a', ['source code (v1.zip)'], [])).toBe(false);
  });

  it('treats a pure includeRepos filter as a repository whitelist', () => {
    const filter = { keywords: [], includeRepos: ['owner/beta'] };
    expect(match(filter, 'owner/beta', [], [])).toBe(true);
    expect(match(filter, 'owner/gamma', ['tool.zip'], ['tool.zip'])).toBe(false);
  });

  it('treats a pure alwaysExcludeRepos filter as a repository denylist', () => {
    const filter = { keywords: [], alwaysExcludeRepos: ['owner/gamma'] };
    expect(match(filter, 'owner/gamma', [], [])).toBe(false);
    expect(match(filter, 'owner/beta', [], [])).toBe(true);
  });

  it('keeps includeRepos whitelist semantics when both repo lists are configured', () => {
    // 规则 7：两组都存在时，只命中包含列表中且不在排除列表中的仓库
    const filter = {
      keywords: [],
      includeRepos: ['owner/beta'],
      alwaysExcludeRepos: ['owner/alpha'],
    };
    expect(match(filter, 'owner/beta', [], [])).toBe(true);
    expect(match(filter, 'owner/alpha', [], [])).toBe(false);
    expect(match(filter, 'owner/gamma', [], [])).toBe(false);
  });

  it('never matches a defense-grade empty filter', () => {
    expect(match({ keywords: [] }, 'owner/a', ['app.zip'])).toBe(false);
    // 含空字符串关键词的畸形 filter 不得变相匹配所有 Release
    expect(match({ keywords: [''] }, 'owner/a', ['app.zip'])).toBe(false);
  });
});
