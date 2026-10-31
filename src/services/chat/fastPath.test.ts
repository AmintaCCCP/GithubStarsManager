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

    const segments = selectFastPathSegments(document, 'usage');
    expect(segments.map((segment) => segment.label)).toEqual(['Install', 'Requirements']);
    expect(segments[0]).toMatchObject({ lineStart: 3, lineEnd: 5 });
    expect(segments[0].excerpt).toContain('npx example install');
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

    const segments = selectFastPathSegments(document, 'usage');
    expect(segments).toHaveLength(3);
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

    const segments = selectFastPathSegments(document, 'general');
    expect(segments[0]).toMatchObject({ lineStart: 1, label: 'Overview' });
    expect(segments[0]?.excerpt).toContain('A documented example project');
    expect(segments.map((segment) => segment.label)).toEqual(['Overview', 'Features']);
  });

  it('matches deployment sections only for the deployment focus', () => {
    const document = documentFrom([
      '# Example Project',
      '',
      '## Deployment',
      'Run it anywhere.',
      '',
      '## Architecture',
      'Client and worker.',
    ].join('\n'));

    expect(selectFastPathSegments(document, 'deployment').map((segment) => segment.label)).toEqual(['Deployment']);
    expect(selectFastPathSegments(document, 'usage')).toEqual([]);
  });

  it('returns no segments when the README has no matching heading', () => {
    const document = documentFrom(['# Example Project', '', '## Changelog', '1.0.0'].join('\n'));
    expect(selectFastPathSegments(document, 'usage')).toEqual([]);
  });
});
