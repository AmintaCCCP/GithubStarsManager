import { describe, expect, it } from 'vitest';
import type { CachedDocument } from './retrieval';
import {
  findRootReadmePath,
  hasPriorAssistantTurn,
  resolveFastPathEnabled,
  selectFastPathSegments,
} from './fastPath';

const documentFrom = (content: string): CachedDocument => ({
  path: 'README.md',
  content,
  headings: content.split('\n').flatMap((line, index) => {
    const match = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    return match ? [{ title: match[2].trim(), lineStart: index + 1, level: match[1].length }] : [];
  }),
  linkedDocumentationPaths: [],
});

describe('findRootReadmePath', () => {
  it('prefers the root README over nested and localized variants', () => {
    expect(findRootReadmePath(['docs/README.md', 'README.zh.md', 'readme.txt'])).toBe('README.zh.md');
  });

  it('returns null when no root README exists', () => {
    expect(findRootReadmePath(['docs/README.md', 'CONTRIBUTING.md'])).toBeNull();
  });
});

describe('hasPriorAssistantTurn', () => {
  it('treats the first question as a fresh turn', () => {
    expect(hasPriorAssistantTurn([{ role: 'user' }])).toBe(false);
    expect(hasPriorAssistantTurn([])).toBe(false);
  });

  it('detects follow-up questions after an assistant answer', () => {
    expect(hasPriorAssistantTurn([{ role: 'user' }, { role: 'assistant' }, { role: 'user' }])).toBe(true);
  });
});

describe('resolveFastPathEnabled', () => {
  it('is enabled by default for the default and quick depths', () => {
    expect(resolveFastPathEnabled({})).toBe(true);
    expect(resolveFastPathEnabled({ fastPath: true, taskDepth: 'default' })).toBe(true);
    expect(resolveFastPathEnabled({ taskDepth: 'quick' })).toBe(true);
  });

  it('is disabled when the setting is off or the depth is deep/unlimited', () => {
    expect(resolveFastPathEnabled({ fastPath: false })).toBe(false);
    expect(resolveFastPathEnabled({ taskDepth: 'deep' })).toBe(false);
    expect(resolveFastPathEnabled({ taskDepth: 'unlimited' })).toBe(false);
    expect(resolveFastPathEnabled({ fastPath: true, taskDepth: 'unlimited' })).toBe(false);
  });
});

describe('selectFastPathSegments', () => {
  it('matches usage sections such as Install and Requirements', () => {
    const document = documentFrom([
      '# Example Project',
      '',
      '## Install',
      'Run `npx example install`.',
      '',
      '## Requirements',
      'Node.js 20+.',
      '',
      '## License',
      'MIT.',
    ].join('\n'));

    const segments = selectFastPathSegments(document, 'usage', 'How do I install this project?');
    expect(segments.map((segment) => segment.label)).toEqual(['Install', 'Requirements']);
    expect(segments[0]).toMatchObject({ lineStart: 3, lineEnd: 5 });
    expect(segments[0].excerpt).toContain('npx example install');
  });

  it('ranks matched sections by question wording before taking the first three', () => {
    const document = documentFrom([
      '# Example Project',
      '',
      '## Setup',
      'Prepare the environment.',
      '',
      '## Usage',
      'Daily commands.',
      '',
      '## Requirements',
      'Node.js 20+.',
      '',
      '## Installation',
      'Run `npx example install`.',
    ].join('\n'));

    // 问题明确指向安装：Installation（文档中排最后）应排在纯前置条件之前，
    // 而不是按文档顺序截取前三段。
    const segments = selectFastPathSegments(document, 'usage', 'How do I install this project?');
    expect(segments.map((segment) => segment.label)).toEqual(['Installation', 'Setup', 'Usage']);
  });

  it('ranks matched sections before the six-section cap so late sections stay selectable', () => {
    const document = documentFrom([
      '# Example Project',
      '',
      '## Setup',
      'a',
      '',
      '## Quick start',
      'b',
      '',
      '## Getting started',
      'c',
      '',
      '## Usage',
      'd',
      '',
      '## Requirements',
      'e',
      '',
      '## Prerequisites',
      'f',
      '',
      '## Installation',
      'Run `npx example install`.',
    ].join('\n'));

    // 命中章节超过 6 段上限：相关度排序先于上限生效，排在文档最后但与问题词
    // 重合度最高的 Installation 不再被文档顺序截取排除。
    const segments = selectFastPathSegments(document, 'usage', 'How do I install this project?');
    expect(segments.map((segment) => segment.label)).toEqual(['Installation', 'Setup', 'Quick start']);
  });

  it('caps the matched sections at three', () => {
    const document = documentFrom([
      '# Example Project',
      '',
      '## Installation',
      'a',
      '',
      '## Usage',
      'b',
      '',
      '## Setup',
      'c',
      '',
      '## Requirements',
      'd',
      '',
      '## Getting started',
      'e',
    ].join('\n'));

    const segments = selectFastPathSegments(document, 'usage', 'How do I install and get started?');
    expect(segments).toHaveLength(3);
    expect(segments.map((segment) => segment.label)).toContain('Getting started');
    expect(segments.map((segment) => segment.label)).toContain('Installation');
  });

  it('collects sections across intents when the question spans them (install and deploy)', () => {
    const document = documentFrom([
      '# Example Project',
      '',
      '## Install',
      'Run `npx example install`.',
      '',
      '## Deployment',
      'Deploy with Docker.',
      '',
      '## License',
      'MIT.',
    ].join('\n'));

    // “如何安装并部署”的主 focus 是 deployment（detectResearchFocus 优先级），
    // 但问题原话同时命中 usage 意图：Install 章节必须一并进入证据。
    const segments = selectFastPathSegments(document, 'deployment', 'How do I install and deploy this project?');
    expect(segments.map((segment) => segment.label)).toEqual(['Install', 'Deployment']);
  });

  it('keeps a section for each uncovered requested intent', () => {
    const document = documentFrom([
      '# Example Project',
      '',
      '## Installation',
      'a',
      '',
      '## Setup',
      'b',
      '',
      '## Usage',
      'c',
      '',
      '## Self-hosting',
      'd',
    ].join('\n'));

    // 多意图问题（install + deploy）：每个命中意图都保留章节名额，
    // Self-hosting（deployment）不因得分并列且靠后而被全局截取排除。
    const segments = selectFastPathSegments(document, 'usage', 'How do I install and deploy?');
    expect(segments.map((segment) => segment.label)).toEqual(['Installation', 'Setup', 'Self-hosting']);
  });

  it('keeps the deployment section when install headings exceed the cap', () => {
    const document = documentFrom([
      '# Example Project',
      '',
      '## Install 1',
      'a',
      '',
      '## Install 2',
      'b',
      '',
      '## Install 3',
      'c',
      '',
      '## Install 4',
      'd',
      '',
      '## Install 5',
      'e',
      '',
      '## Install 6',
      'f',
      '',
      '## Deployment',
      'g',
    ].join('\n'));

    // 6 个 Install 标题触发 6 段上限，Deployment 排在其后且得分并列：
    // 意图保留必须先于任何上限生效，否则 Deployment 会在截取处被丢弃。
    const segments = selectFastPathSegments(document, 'usage', 'How do I install and deploy?');
    expect(segments.map((segment) => segment.label)).toEqual(['Install 1', 'Install 2', 'Deployment']);
  });

  it('does not reserve an extra slot for an intent already covered by a chosen section', () => {
    const document = documentFrom([
      '# Example Project',
      '',
      '## Installation and Deployment',
      'a',
      '',
      '## Setup',
      'b',
      '',
      '## Usage',
      'c',
      '',
      '## Self-hosting',
      'd',
    ].join('\n'));

    // “Installation and Deployment”同时覆盖 usage 与 deployment 意图：
    // 不再为 deployment 保留新名额，剩余名额按得分补足到三段。
    const segments = selectFastPathSegments(document, 'usage', 'How do I install and deploy?');
    expect(segments.map((segment) => segment.label)).toEqual(['Installation and Deployment', 'Setup', 'Usage']);
  });

  it('adds the pre-heading introduction for general questions once', () => {
    const document = documentFrom([
      '# Example Project',
      '',
      'A documented example project for repository research.',
      '',
      '## Features',
      'Fast and small.',
      '',
      '## License',
      'MIT.',
    ].join('\n'));

    const segments = selectFastPathSegments(document, 'general', 'What does this project do?');
    expect(segments[0]).toMatchObject({ lineStart: 1, label: 'Overview' });
    expect(segments[0]?.excerpt).toContain('A documented example project');
    expect(segments.map((segment) => segment.label)).toEqual(['Overview', 'Features']);
  });

  it('trims the lowest-ranked match when the general intro plus three matches overflow the cap', () => {
    const document = documentFrom([
      '# Example Project',
      '',
      'A documented example project for repository research.',
      '',
      '## Introduction',
      'Introduces the project.',
      '',
      '## Features',
      'Fast and small.',
      '',
      '## Highlights',
      'Notable moments.',
    ].join('\n'));

    // general 导语段占用一个名额：三个匹配章节按重合度排序后只保留前两段，
    // 排序最低的 Highlights 被截掉。
    const segments = selectFastPathSegments(document, 'general', 'What is the introduction and features of this project?');
    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ lineStart: 1, label: 'Overview' });
    expect(segments.map((segment) => segment.label)).toEqual(['Overview', 'Introduction', 'Features']);
  });

  it('keeps reserved intent sections when the general intro and matches overflow the cap', () => {
    const document = documentFrom([
      '# Example Project',
      '',
      'A documented example project for repository research.',
      '',
      '## Deployment',
      'Deploy to production.',
      '',
      '## Installation and Deployment',
      'Install locally, deploy anywhere.',
      '',
      '## About',
      'What the project does.',
    ].join('\n'));

    // 问题同时命中 general（about）与 usage（install）、deployment（deploy）：
    // “Installation and Deployment”覆盖 usage 与 deployment 两个意图，与 About
    // （general）一并各占一个保留名额；多出的 Deployment 填充章节必须为导语段
    // 让位，两个保留章节不得被导语段挤出。
    const segments = selectFastPathSegments(document, 'general', 'What is this project about, how do I install it, and how do I deploy it?');
    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ lineStart: 1, label: 'Overview' });
    expect(segments.map((segment) => segment.label)).toEqual(['Overview', 'Installation and Deployment', 'About']);
  });

  it('yields the intro slot when reserved intent sections already fill the cap', () => {
    const document = documentFrom([
      '# Example Project',
      '',
      'A documented example project for repository research.',
      '',
      '## About',
      'What the project does.',
      '',
      '## Install',
      'Run `npx example install`.',
      '',
      '## Deployment',
      'Deploy with Docker.',
    ].join('\n'));

    // 极端组合：general + usage + deployment 三个意图各有一个保留章节，占满
    // 3 个名额。截断优先级为意图覆盖 > 导语段 > 未被意图保留的填充章节，
    // 导语段让位，三个保留章节全部保留。
    const segments = selectFastPathSegments(document, 'general', 'What is this project about, how do I install it, and how do I deploy it?');
    expect(segments).toHaveLength(3);
    expect(segments.map((segment) => segment.label)).toEqual(['About', 'Install', 'Deployment']);
    expect(segments.some((segment) => segment.label === 'Overview')).toBe(false);
  });

  it('adds no intro when the README has no pre-heading introduction', () => {
    const document = documentFrom([
      '# Example Project',
      '## Features',
      'Fast and small.',
      '',
      '## License',
      'MIT.',
    ].join('\n'));

    const segments = selectFastPathSegments(document, 'general', 'What features does this project have?');
    expect(segments.map((segment) => segment.label)).toEqual(['Features']);
  });

  it('adds no intro for non-general foci even when the README has an introduction', () => {
    const document = documentFrom([
      '# Example Project',
      '',
      'A documented example project for repository research.',
      '',
      '## Install',
      'Run `npx example install`.',
      '',
      '## Requirements',
      'Node.js 20+.',
    ].join('\n'));

    const segments = selectFastPathSegments(document, 'usage', 'How do I install this project?');
    expect(segments.map((segment) => segment.label)).toEqual(['Install', 'Requirements']);
  });

  it('keeps both intent sections and skips the intro for a non-general multi-intent question', () => {
    const document = documentFrom([
      '# Example Project',
      '',
      'A documented example project for repository research.',
      '',
      '## Install',
      'Run `npx example install`.',
      '',
      '## Deployment',
      'Deploy with Docker.',
    ].join('\n'));

    const segments = selectFastPathSegments(document, 'deployment', 'How do I install and deploy this project?');
    expect(segments.map((segment) => segment.label)).toEqual(['Install', 'Deployment']);
  });

  it('keeps unrelated sections out for a single-intent question', () => {
    const document = documentFrom([
      '# Example Project',
      '',
      '## Deployment',
      'Run it anywhere.',
      '',
      '## Architecture',
      'Client and worker.',
    ].join('\n'));

    expect(selectFastPathSegments(document, 'deployment', 'How do I deploy this project?').map((segment) => segment.label)).toEqual(['Deployment']);
    expect(selectFastPathSegments(document, 'usage', 'How do I install this project?')).toEqual([]);
    // 问题原话同时命中部署意图时，即使主 focus 是 usage 也纳入 Deployment 章节。
    expect(selectFastPathSegments(document, 'usage', 'How do I deploy this project?').map((segment) => segment.label)).toEqual(['Deployment']);
  });

  it('returns no segments when the README has no matching heading', () => {
    const document = documentFrom(['# Example Project', '', '## Changelog', '1.0.0'].join('\n'));
    expect(selectFastPathSegments(document, 'usage', 'How do I install this project?')).toEqual([]);
  });
});
