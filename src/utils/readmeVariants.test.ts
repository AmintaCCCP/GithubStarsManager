import { describe, expect, it } from 'vitest';
import { buildReadmeVariants, isReadmeCandidateItem } from './readmeVariants';

const file = (path: string, name?: string) => ({
  path,
  name,
  type: 'blob',
});

describe('readmeVariants', () => {
  it('keeps a synthetic default README option first', () => {
    const variants = buildReadmeVariants([
      file('README.md'),
      file('README_zh.md'),
    ], 'zh');

    expect(variants[0]).toMatchObject({
      key: 'default',
      path: null,
      label: '默认 README',
      isDefault: true,
    });
  });

  it('detects common multilingual README naming styles', () => {
    const variants = buildReadmeVariants([
      file('README_zh.md'),
      file('README.zh-CN.md'),
      file('README-ja.md'),
      file('README.pt-BR.md'),
      file('docs/README.ko.md'),
      file('readme/README-fr.markdown'),
    ], 'en');

    expect(variants.map((variant) => variant.path)).toEqual([
      null,
      'README_zh.md',
      'README.zh-CN.md',
      'README-ja.md',
      'docs/README.ko.md',
      'readme/README-fr.markdown',
      'README.pt-BR.md',
    ]);
  });

  it('does not duplicate non-localized README files with the default option', () => {
    const variants = buildReadmeVariants([
      file('README.md'),
      file('docs/README.markdown'),
      file('README_zh.md'),
    ], 'zh');

    expect(variants.map((variant) => variant.path)).toEqual([
      null,
      'README_zh.md',
    ]);
  });

  it('generates localized labels for known and regional language codes', () => {
    const zhLabels = buildReadmeVariants([
      file('README_zh.md'),
      file('README.pt-BR.md'),
    ], 'zh').map((variant) => variant.label);
    const enLabels = buildReadmeVariants([
      file('README_zh.md'),
      file('README.pt-BR.md'),
    ], 'en').map((variant) => variant.label);

    expect(zhLabels).toContain('中文 · README_zh.md');
    expect(zhLabels).toContain('葡萄牙语（巴西） · README.pt-BR.md');
    expect(enLabels).toContain('Chinese · README_zh.md');
    expect(enLabels).toContain('Portuguese (Brazil) · README.pt-BR.md');
  });

  it('ignores directories, non-readme files, and non-markdown README assets', () => {
    const variants = buildReadmeVariants([
      { path: 'README_zh.md', type: 'tree' },
      file('NOT_README_zh.md'),
      file('README_zh.png'),
      file('README.zh.mdx'),
      file('README.en.mdown'),
      file('README.fr.mkdn'),
    ], 'en');

    expect(variants.map((variant) => variant.path)).toEqual([
      null,
      'README.en.mdown',
      'README.fr.mkdn',
    ]);
  });

  it('matches candidate items case-insensitively', () => {
    expect(isReadmeCandidateItem(file('DOCS/ReadMe.ZH-cn.MD'))).toBe(true);
    expect(isReadmeCandidateItem(file('README_ES.MARKDOWN'))).toBe(true);
  });
});
