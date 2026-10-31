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

  it('keeps the opening section under its own heading when the README opens with a lower-level heading', () => {
    const document = documentFrom([
      '## License',
      'MIT License.',
      'Copyright 2024.',
      '',
      '## Features',
      'Fast and small.',
    ].join('\n'));

    // README 第一行是二级标题（`## License`）：该章节从第 1 行开始，其后内容
    // 属于章节而非导语。审计 UEIs 要求该内容不得误标为 Overview 导语段；
    // 审计 ULc4 进一步要求内容不得丢失：首个章节以自身标题（License）作为
    // label 进入证据段。
    const segments = selectFastPathSegments(document, 'general', 'What features does this project have?');
    expect(segments.map((segment) => segment.label)).toEqual(['License', 'Features']);
    expect(segments.some((segment) => segment.label === 'Overview')).toBe(false);
    expect(segments[0]).toMatchObject({ lineStart: 1, lineEnd: 4 });
    expect(segments[0]?.excerpt).toContain('MIT License.');
    expect(segments[0]?.excerpt).toContain('Copyright 2024.');
    expect(segments[1]).toMatchObject({ lineStart: 5, lineEnd: 6 });
  });

  it('keeps the opening section description when the README starts with a descriptive section', () => {
    const document = documentFrom([
      '## Example Project',
      'A documented example project for repository research.',
      '',
      '## Features',
      'Fast and small.',
    ].join('\n'));

    // 审计 ULc4：首行为二级标题时，其下的描述内容不得因跳过 Overview 导语而
    // 丢失——首个章节以自身标题（Example Project）作为 label 携带描述内容进入
    // 证据段，且不出现 Overview 误标（审计 UEIs）。
    const segments = selectFastPathSegments(document, 'general', 'What does this project do?');
    expect(segments.map((segment) => segment.label)).toEqual(['Example Project', 'Features']);
    expect(segments.some((segment) => segment.label === 'Overview')).toBe(false);
    expect(segments[0]).toMatchObject({ lineStart: 1, lineEnd: 3 });
    expect(segments[0]?.excerpt).toContain('A documented example project');
  });

  it('does not duplicate the opening section when it is itself a matched section', () => {
    const document = documentFrom([
      '## Features',
      'Fast and small.',
      '',
      '## License',
      'MIT.',
    ].join('\n'));

    // 首个章节（Features）本身就是 general 命中章节：只保留该章节自身一段，
    // 不再以首个章节段或 Overview 导语的形式重复输出其内容。
    const segments = selectFastPathSegments(document, 'general', 'What features does this project have?');
    expect(segments.map((segment) => segment.label)).toEqual(['Features']);
    expect(segments.some((segment) => segment.label === 'Overview')).toBe(false);
    expect(segments[0]).toMatchObject({ lineStart: 1, lineEnd: 3 });
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

  it('adds no opening-section lead when no section matches the question', () => {
    const document = documentFrom([
      '## License',
      'MIT.',
      '',
      '## Changelog',
      '1.0.0',
    ].join('\n'));

    // 审计 UVhl：README 首行为二级标题且没有匹配章节时，首个章节（License）不得
    // 作为前导段充当证据——否则快速路径会以无关章节直接回答并跳过完整检索循环，
    // 应回落完整循环（无段产出）。
    const segments = selectFastPathSegments(document, 'general', 'What is the release history?');
    expect(segments).toEqual([]);
  });

  it('does not displace matched sections with an unrelated opening section', () => {
    const document = documentFrom([
      '## License',
      'MIT.',
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

    // 审计 UVhx：首行低层级标题未命中问题且三个章节占满名额时，前导段让位，
    // 三个匹配章节全部保留，排序最低的匹配章节不得被未命中的首章节挤出。
    const segments = selectFastPathSegments(document, 'general', 'What is the introduction and features and highlights of this project?');
    expect(segments.map((segment) => segment.label)).toEqual(['Introduction', 'Features', 'Highlights']);
  });

  it('ends the Overview intro before the first lower-level heading of any depth', () => {
    const document = documentFrom([
      '# Example Project',
      'A documented example project for repository research.',
      '',
      '### Features',
      'Fast and small.',
      '',
      '## Deployment',
      'Deploy with Docker.',
    ].join('\n'));

    // 审计 UVhp：H1 之后、首个 H2 之前的 H3 章节（Features）不得混入 Overview
    // 导语段——导语在首个任意层级标题处结束，H3 内容只随其自身章节入选一次，
    // 不再与选中章节重复，也不额外占用填充名额。
    const segments = selectFastPathSegments(document, 'general', 'What are the features and how do I deploy?');
    expect(segments.map((segment) => segment.label)).toEqual(['Overview', 'Features', 'Deployment']);
    expect(segments[0]).toMatchObject({ lineStart: 1, lineEnd: 3 });
    expect(segments[0]?.excerpt).toContain('A documented example project');
    expect(segments[0]?.excerpt).not.toContain('Fast and small.');
  });

  it('keeps the README description in the intro when a level-3 heading follows it', () => {
    const document = documentFrom([
      '# Example Project',
      'A documented example project for repository research.',
      '### Features',
      'Fast and small.',
    ].join('\n'));

    // 审计 UVht：H1（第 1 行）+ 描述（第 2 行）+ H3（第 3 行）时导语段不得为空，
    // 描述必须进入证据——导语截取到第一个已选章节之前，下限判断放宽到 2 行。
    const segments = selectFastPathSegments(document, 'general', 'What does this project do?');
    expect(segments.map((segment) => segment.label)).toEqual(['Overview', 'Features']);
    expect(segments[0]).toMatchObject({ lineStart: 1, lineEnd: 2 });
    expect(segments[0]?.excerpt).toContain('A documented example project');
  });

  it('truncates the opening-section lead before a nested matched section', () => {
    const document = documentFrom([
      '## License',
      'MIT License.',
      'Copyright 2024.',
      '',
      '### Features',
      'Fast and small.',
      'Small and fast CLI.',
    ].join('\n'));

    // 审计 UctX：首行二级标题（License）的章节区间完整覆盖其下嵌套的 Features
    // 章节（sectionSegments 只在同层级或更高层级标题处切章）。前导段必须截断
    // 到嵌套已选章节（Features，第 5 行）起始行之前：License 自述内容保留、
    // Features 内容不重复输出，任意两段行区间零重叠。
    const segments = selectFastPathSegments(document, 'general', 'What are the features of this project?');
    expect(segments.map((segment) => segment.label)).toEqual(['License', 'Features']);
    expect(segments[0]).toMatchObject({ lineStart: 1, lineEnd: 4 });
    expect(segments[0]?.excerpt).toContain('MIT License.');
    expect(segments[0]?.excerpt).not.toContain('Fast and small.');
    expect(segments[1]).toMatchObject({ lineStart: 5, lineEnd: 7 });
  });

  it('skips the opening-section lead when truncation would leave only the heading', () => {
    const document = documentFrom([
      '## License',
      '### Features',
      'Fast and small.',
    ].join('\n'));

    // 审计 UctX 边界：嵌套章节紧跟开头标题（第 2 行），截断后前导段只剩标题行、
    // 除标题行外无任何非空内容——前导段让位，不产出纯标题段。
    const segments = selectFastPathSegments(document, 'general', 'What are the features of this project?');
    expect(segments.map((segment) => segment.label)).toEqual(['Features']);
    expect(segments.some((segment) => segment.label === 'License')).toBe(false);
    expect(segments[0]).toMatchObject({ lineStart: 2, lineEnd: 3 });
  });

  it('generates no pure-title Overview intro and keeps the lowest filler section', () => {
    const document = documentFrom([
      '# Example Project',
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

    // 审计 Ucta：H1 + 空行 + 章节开头时 introEnd >= 2 的导语段只含标题行，不满足
    // “标题行之外至少一行非空内容”——不生成纯标题 Overview 导语，该名额不消耗，
    // 排序最低的填充章节（Highlights）不被挤掉，三个匹配章节全部保留。
    const segments = selectFastPathSegments(document, 'general', 'What is the introduction and features and highlights of this project?');
    expect(segments).toHaveLength(3);
    expect(segments.some((segment) => segment.label === 'Overview')).toBe(false);
    expect(segments.map((segment) => segment.label)).toEqual(['Introduction', 'Features', 'Highlights']);
    expect(segments.every((segment) => segment.lineStart > 2)).toBe(true);
  });

  it('keeps a one-line prose lead followed immediately by a heading', () => {
    const document = documentFrom([
      'A CLI for managing stars.',
      '## Features',
      'Fast and small.',
    ].join('\n'));

    // 审计 Up06 布局一：首行为说明文字、第 2 行紧接二级标题。introEnd 为 1，
    // 导语下限放宽为 >= 1 后单行说明文字仍作为 Overview 导语进入证据。
    const segments = selectFastPathSegments(document, 'general', 'What are the features of this project?');
    expect(segments.map((segment) => segment.label)).toEqual(['Overview', 'Features']);
    expect(segments[0]).toMatchObject({ lineStart: 1, lineEnd: 1 });
    expect(segments[0]?.excerpt).toContain('A CLI for managing stars.');
  });

  it('keeps a prose lead followed by a blank line and a heading', () => {
    const document = documentFrom([
      'A CLI for managing stars.',
      '',
      '## Features',
      'Fast and small.',
    ].join('\n'));

    // 审计 Up06 布局二：首行为说明文字、第 2 行为空行、第 3 行为二级标题。
    // 有效性检查从第 1 行开始（首行不是标题），首行说明文字不再被跳过。
    const segments = selectFastPathSegments(document, 'general', 'What are the features of this project?');
    expect(segments.map((segment) => segment.label)).toEqual(['Overview', 'Features']);
    expect(segments[0]).toMatchObject({ lineStart: 1, lineEnd: 2 });
    expect(segments[0]?.excerpt).toContain('A CLI for managing stars.');
  });

  it('still excludes a heading-only lead', () => {
    const document = documentFrom([
      '# Example Project',
      '## Features',
      'Fast and small.',
    ].join('\n'));

    // 审计 Up06 不回归（Ucta）：首行是标题时有效性检查照旧跳过第 1 行，
    // 标题后没有非空内容的前导段仍被排除。
    const segments = selectFastPathSegments(document, 'general', 'What are the features of this project?');
    expect(segments.some((segment) => segment.label === 'Overview')).toBe(false);
  });

  it('keeps the install instructions before a nested deployment section', () => {
    const document = documentFrom([
      '## Installation',
      'Install with npm.',
      '### Deployment',
      'Deploy with Docker.',
      'Deploy to production.',
    ].join('\n'));

    // 审计 Up04：`## Installation` 完整覆盖嵌套的 `### Deployment`。部署焦点 +
    // 安装意图的问题不得只保留 Deployment——Installation 截断为 Deployment 起始
    // 行之前的前缀（含安装正文）后与 Deployment 一并入选，安装说明不丢失。
    const segments = selectFastPathSegments(document, 'deployment', 'How do I install and deploy this project?');
    expect(segments.map((segment) => segment.label)).toEqual(['Installation', 'Deployment']);
    expect(segments[0]).toMatchObject({ lineStart: 1, lineEnd: 2 });
    expect(segments[0]?.excerpt).toContain('Install with npm.');
    expect(segments[0]?.excerpt).not.toContain('Deploy with Docker.');
    expect(segments[1]).toMatchObject({ lineStart: 3, lineEnd: 5 });
  });

  it('does not keep a nested child when its matched parent already covers it', () => {
    const document = documentFrom([
      '## Features',
      'Fast and small.',
      '### Features detail',
      'Details.',
    ].join('\n'));

    // 审计 nitpick：父章节与嵌套子章节同时命中时，子章节起始行落在父章节区间
    // 内（被包含方向）——跳过子章节，只返回父章节，行区间 1-4 不与子章节重叠。
    const segments = selectFastPathSegments(document, 'general', 'What are the features of this project?');
    expect(segments.map((segment) => segment.label)).toEqual(['Features']);
    expect(segments[0]).toMatchObject({ lineStart: 1, lineEnd: 4 });
  });

  it('returns no segments when only unrelated headings follow a first-line note', () => {
    const document = documentFrom([
      'A CLI for managing stars.',
      '',
      '## License',
      'MIT.',
    ].join('\n'));

    // 审计 U7mU：首行为普通说明文字、其后只有无关标题时，Overview 前导段不得
    // 单独充当快速路径证据——无任何匹配章节（chosen 为空）时不产出前导段，
    // 返回空数组让调用方回落完整检索循环。与首章节前导段（形态 a）的
    // chosen.size > 0 条件保持语义一致。
    expect(selectFastPathSegments(document, 'general', 'How do I install this project?')).toEqual([]);
  });

  it('does not keep a heading-only opening-section lead between nested headings', () => {
    const document = documentFrom([
      '## License',
      '### Metadata',
      '### Features',
      'Fast and small.',
    ].join('\n'));

    // 审计 U7mX：`## License` → `### Metadata` → `### Features` 布局中，导语
    // 范围只含标题行（Metadata 本身也是标题行），“非空正文”判定必须排除标题行，
    // 仅含标题的导语段不得保留，输出只保留带正文的 Features 章节。
    const segments = selectFastPathSegments(document, 'general', 'What are the features of this project?');
    expect(segments.map((segment) => segment.label)).toEqual(['Features']);
    expect(segments.some((segment) => segment.label === 'License')).toBe(false);
    expect(segments[0]).toMatchObject({ lineStart: 3, lineEnd: 4 });
  });

  it('excludes a heading-only section that directly precedes a same-level heading', () => {
    const document = documentFrom([
      '## Installation',
      '## License',
      'MIT.',
    ].join('\n'));

    // 审计 U7mc：`## Installation` 后紧跟同级标题、自身无正文（区间内只有标题
    // 行）时不得进入快速路径证据——不重叠候选同样要求正文，返回空数组回落
    // 完整检索循环，避免以空章节作答。
    expect(selectFastPathSegments(document, 'usage', 'How do I install this project?')).toEqual([]);
  });

  it('skips a heading-only section and keeps the next matched section with body', () => {
    const document = documentFrom([
      '## Installation',
      '## Deployment',
      'Deploy with Docker.',
    ].join('\n'));

    // 审计 U7mc 补充：同意图的纯标题章节被跳过后，名额继续留给下一个带正文的
    // 匹配章节（Deployment），Installation 不进入证据。
    const segments = selectFastPathSegments(document, 'deployment', 'How do I install and deploy this project?');
    expect(segments.map((segment) => segment.label)).toEqual(['Deployment']);
    expect(segments.some((segment) => segment.label === 'Installation')).toBe(false);
  });

  it('keeps the parent prefix and admits the nested child beyond the excerpt truncation point', () => {
    const padding = 'x'.repeat(25_000);
    const document = documentFrom([
      '## Deployment',
      'Deploy with Docker.',
      padding,
      '### Docker',
      'Docker compose steps.',
    ].join('\n'));

    // 审计 U7mZ：父章节正文超 24,000 字符后 excerpt 截断，嵌套子章节（Docker，
    // 第 4 行）落在截断点之后——不得再按“被包含方向”跳过。保留父章节前缀
    // （含 Deploy with Docker.）并纳入子章节，子章节说明出现在证据 excerpt 中。
    const segments = selectFastPathSegments(document, 'deployment', 'How do I deploy this project?');
    expect(segments.map((segment) => segment.label)).toEqual(['Deployment', 'Docker']);
    expect(segments[0]).toMatchObject({ lineStart: 1, lineEnd: 3 });
    expect(segments[0]?.excerpt).toContain('Deploy with Docker.');
    expect(segments[0]?.excerpt).not.toContain('Docker compose steps.');
    expect(segments[1]).toMatchObject({ lineStart: 4, lineEnd: 5 });
    expect(segments[1]?.excerpt).toContain('Docker compose steps.');
    expect(segments.length).toBeLessThanOrEqual(3);
  });

  it('preserves sibling sections after the truncated parent for slot allocation', () => {
    const padding = 'x'.repeat(25_000);
    const document = documentFrom([
      '## Deployment',
      'Deploy with Docker.',
      padding,
      '### Docker',
      'Docker compose steps.',
      '### macOS',
      'macOS install steps.',
    ].join('\n'));

    // 审计 U7mi：包含方向截断父章节后，位于截断点之后、父章节原区间内的其余
    // 小节（macOS，第 6–7 行）不得静默丢弃——作为独立候选段参与名额分配
    // （2 段已选 + 1 个剩余名额），行区间与已选段两两不重叠。
    const segments = selectFastPathSegments(document, 'deployment', 'How do I deploy this project?');
    expect(segments.map((segment) => segment.label)).toEqual(['Deployment', 'Docker', 'macOS']);
    expect(segments[0]).toMatchObject({ lineStart: 1, lineEnd: 3 });
    expect(segments[1]).toMatchObject({ lineStart: 4, lineEnd: 5 });
    expect(segments[2]).toMatchObject({ lineStart: 6, lineEnd: 7 });
    expect(segments[2]?.excerpt).toContain('macOS install steps.');
    for (let i = 0; i < segments.length; i += 1) {
      for (let j = i + 1; j < segments.length; j += 1) {
        expect(segments[j]!.lineStart).toBeGreaterThan(segments[i]!.lineEnd);
      }
    }
  });

  it('preserves sibling sections after a prefix-truncated parent without truncation', () => {
    const document = documentFrom([
      '## Installation',
      'Install with npm.',
      '### Deployment',
      'Deploy with Docker.',
      '### macOS',
      'macOS install steps.',
    ].join('\n'));

    // 审计 U7mi（Up04 前缀截断路径）：Installation 因嵌套 Deployment 入选而
    // 截断为前缀（1–2 行）后，其原区间内 Deployment 之后的 macOS（5–6 行）
    // 同样作为独立候选段补入名额。
    const segments = selectFastPathSegments(document, 'deployment', 'How do I install and deploy this project?');
    expect(segments.map((segment) => segment.label)).toEqual(['Installation', 'Deployment', 'macOS']);
    expect(segments[0]).toMatchObject({ lineStart: 1, lineEnd: 2 });
    expect(segments[1]).toMatchObject({ lineStart: 3, lineEnd: 4 });
    expect(segments[2]).toMatchObject({ lineStart: 5, lineEnd: 6 });
    expect(segments[2]?.excerpt).toContain('macOS install steps.');
  });

  it('drops a parent whose truncated prefix has no body content and keeps the child', () => {
    const headingLines = Array.from({ length: 4_000 }, (_, index) => `### note ${index}`);
    const document = documentFrom([
      '## Docker deployment',
      ...headingLines,
      '### Docker',
      'Docker compose steps.',
    ].join('\n'));

    // 全局不变量（纯标题段不入证据）：父章节正文只有嵌套章节内的内容，被包含
    // 方向截断后前缀只剩标题行——父章节整体丢弃，子章节（超出 excerpt 截断点，
    // 审计 U7mZ 路径入选）保留，不输出纯标题段。父章节标题与问题词重合度更高，
    // 保证其在排序中先于子章节入选。
    const segments = selectFastPathSegments(document, 'deployment', 'How do I deploy with Docker?');
    expect(segments.map((segment) => segment.label)).toEqual(['Docker']);
    expect(segments[0]?.excerpt).toContain('Docker compose steps.');
  });

  it('admits a nested child whose heading is the last line covered by the truncated excerpt', () => {
    const padding = 'x'.repeat(23_960);
    const document = documentFrom([
      '## Deployment',
      'Deploy with Docker.',
      padding,
      '### Docker',
      'Docker compose steps.',
    ].join('\n'));

    // 审计 VWe7：父章节正文超 24,000 字符、子章节标题（Docker，第 4 行）恰好是
    // 父章节截断后 excerpt 覆盖的最后一行（第 4 行起始偏移 23,995 < 24,000，
    // 第 5 行起始偏移 24,006 ≥ 24,000）。子章节正文仍在截断点之后，不得按
    // “被包含方向”跳过——应作为未覆盖候选参与名额分配，父章节截断为子章节
    // 之前的前缀（1–3 行），子章节（4–5 行）独立入选，两段零重叠、不重复输出。
    const segments = selectFastPathSegments(document, 'deployment', 'How do I deploy this project?');
    expect(segments.map((segment) => segment.label)).toEqual(['Deployment', 'Docker']);
    expect(segments[0]).toMatchObject({ lineStart: 1, lineEnd: 3 });
    expect(segments[0]?.excerpt).toContain('Deploy with Docker.');
    expect(segments[0]?.excerpt).not.toContain('### Docker');
    expect(segments[0]?.excerpt).not.toContain('Docker compose steps.');
    expect(segments[1]).toMatchObject({ lineStart: 4, lineEnd: 5 });
    expect(segments[1]?.excerpt).toContain('Docker compose steps.');
    expect(segments[1]!.lineStart).toBeGreaterThan(segments[0]!.lineEnd);
  });

  it('excludes a section whose visible excerpt holds no body beyond the heading', () => {
    const whitespace = ' '.repeat(23_983);
    const document = documentFrom([
      '## Installation',
      whitespace,
      'Install steps here.',
    ].join('\n'));

    // 审计 VWfA：正文完全落在 24,000 字符截断点之后的章节（可见摘录只剩标题与
    // 空白：第 3 行起始偏移恰为 24,000）不得入选且不前导作答——无其他匹配章节时
    // 返回空数组，让调用方回落完整检索循环。
    expect(selectFastPathSegments(document, 'usage', 'How do I install this project?')).toEqual([]);
  });

  it('keeps the next matched section when the first match is truncated to heading and whitespace', () => {
    const whitespace = ' '.repeat(23_983);
    const document = documentFrom([
      '## Installation',
      whitespace,
      'Install steps here.',
      '## Setup',
      'Prepare the environment.',
    ].join('\n'));

    // 审计 VWfA 补充：摘录不可见的 Installation 被排除后，名额让给摘录含正文的
    // 下一匹配章节（Setup）；Installation 也不得经包含方向前缀路径以不可见摘录
    // 混入证据。
    const segments = selectFastPathSegments(document, 'usage', 'How do I install this project?');
    expect(segments.map((segment) => segment.label)).toEqual(['Setup']);
  });

  it('drops the general intro whose truncated excerpt holds only whitespace', () => {
    const blankRun = Array.from({ length: 78 }, () => ' '.repeat(320));
    const document = documentFrom([
      '# Example Project',
      ...blankRun,
      'A documented example project for repository research.',
      '## Features',
      'Fast and small.',
    ].join('\n'));

    // 审计 VWfC：说明文字前有 78 行超长空白（第 80 行）时，导语有效性检查基于
    // 24,000 字符截断后的摘录（只覆盖到第 76 行附近、全为空白）——该前导段不得
    // 生成、不得占名额，只有 Features 章节进入证据。
    const segments = selectFastPathSegments(document, 'general', 'What does this project do?');
    expect(segments.map((segment) => segment.label)).toEqual(['Features']);
    expect(segments.some((segment) => segment.label === 'Overview')).toBe(false);
    expect(segments[0]).toMatchObject({ lineStart: 81, lineEnd: 82 });
  });

  it('keeps leftover enumeration behavior with precomputed heading boundaries on a large document', () => {
    const subsections = Array.from({ length: 1_200 }, (_, index) => [`### Subsection ${index}`, `Subsection ${index} steps.`, '']);
    const document = documentFrom([
      '## Deployment',
      'Deploy with Docker.',
      'x'.repeat(25_000),
      '### Docker',
      'Docker compose steps.',
      '',
      ...subsections.flat(),
    ].join('\n'));

    // 审计 VWfE（性能）：剩余小节枚举不再逐标题从 document.headings 头部 `.find`
    // 查找切章边界（O(H²/2)，位于同步聊天回合路径上），改为一次反向单调栈扫描
    // 预计算。行为完全等价：父章节截断为前缀（1–3 行），Docker（4–5 行）经
    // U7mZ 路径入选，1,200 个未命中小节按得分（并列 0 分）与行号竞争仅剩的
    // 一个名额，Subsection 0（7–9 行）入选。
    const segments = selectFastPathSegments(document, 'deployment', 'How do I deploy this project?');
    expect(segments.map((segment) => segment.label)).toEqual(['Deployment', 'Docker', 'Subsection 0']);
    expect(segments[0]).toMatchObject({ lineStart: 1, lineEnd: 3 });
    expect(segments[1]).toMatchObject({ lineStart: 4, lineEnd: 6 });
    expect(segments[2]).toMatchObject({ lineStart: 7, lineEnd: 9 });
    expect(segments[2]?.excerpt).toContain('Subsection 0 steps.');
  });

  it('gives the last leftover slot to the higher-scoring remaining section', () => {
    const padding = 'x'.repeat(25_000);
    const document = documentFrom([
      '## Deployment',
      'Deploy with Docker.',
      padding,
      '### Docker',
      'Docker compose steps.',
      '### Linux',
      'Linux install steps.',
      '### Windows',
      'Windows install steps.',
    ].join('\n'));

    // 审计 VWfH：剩余小节候选先按得分降序排列再分配名额——问题提到 Windows 时
    // `### Windows`（得分 1）不得被文档顺序在前的零分 `### Linux` 挤掉。
    const segments = selectFastPathSegments(document, 'deployment', 'Deploy this project on Windows?');
    expect(segments.map((segment) => segment.label)).toEqual(['Deployment', 'Windows', 'Docker']);
    expect(segments.some((segment) => segment.label === 'Linux')).toBe(false);
    expect(segments[1]).toMatchObject({ lineStart: 8, lineEnd: 9 });
    expect(segments[1]?.excerpt).toContain('Windows install steps.');
  });
});
