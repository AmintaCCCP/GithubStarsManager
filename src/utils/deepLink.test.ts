import { describe, expect, it } from 'vitest';
import { parseDeepLink } from './deepLink';

describe('parseDeepLink', () => {
  it('parses repository, release, developer and plugin links', () => {
    expect(parseDeepLink('githubstarsmanager://repo/owner/name')).toEqual({
      kind: 'repository',
      owner: 'owner',
      name: 'name',
      url: 'https://github.com/owner/name',
    });
    expect(parseDeepLink('githubstarsmanager://release/owner/name/v1.2.3')).toEqual({
      kind: 'release',
      owner: 'owner',
      name: 'name',
      tag: 'v1.2.3',
      url: 'https://github.com/owner/name/releases/tag/v1.2.3',
    });
    expect(parseDeepLink('githubstarsmanager://developer/torvalds')).toEqual({
      kind: 'developer',
      login: 'torvalds',
      url: 'https://github.com/torvalds',
    });
    expect(parseDeepLink('githubstarsmanager://plugins/com.example.plugin')).toEqual({
      kind: 'plugin',
      pluginId: 'com.example.plugin',
    });
  });

  it('accepts the triple-slash spelling and a case-insensitive scheme', () => {
    expect(parseDeepLink('githubstarsmanager:///repo/owner/name')?.kind).toBe('repository');
    expect(parseDeepLink('GitHubStarsManager://repo/owner/name')?.kind).toBe('repository');
    expect(parseDeepLink('  githubstarsmanager://repo/owner/name  ')?.kind).toBe('repository');
  });

  it('keeps slashes inside a release tag', () => {
    const target = parseDeepLink('githubstarsmanager://release/owner/name/release/1.0');
    expect(target?.kind).toBe('release');
    expect(target && target.kind === 'release' ? target.tag : null).toBe('release/1.0');
  });

  it('rejects unknown kinds, wrong arity and missing arguments', () => {
    for (const value of [
      'githubstarsmanager://',
      'githubstarsmanager:///',
      'githubstarsmanager://unknown/owner/name',
      'githubstarsmanager://repo/owner',
      'githubstarsmanager://repo/owner/name/extra',
      'githubstarsmanager://release/owner/name',
      'githubstarsmanager://developer',
      'githubstarsmanager://developer/torvalds/extra',
      'githubstarsmanager://plugins',
      'githubstarsmanager://plugins/com.example.plugin/extra',
    ]) {
      expect(parseDeepLink(value), value).toBeNull();
    }
  });

  it('rejects anything that is not this app protocol', () => {
    expect(parseDeepLink('https://github.com/owner/name')).toBeNull();
    expect(parseDeepLink('githubstarsmanager:repo/owner/name')).toBeNull();
    expect(parseDeepLink('owner/name')).toBeNull();
    expect(parseDeepLink('')).toBeNull();
    expect(parseDeepLink(null)).toBeNull();
    expect(parseDeepLink(7)).toBeNull();
  });

  it('re-validates every argument instead of trusting the link', () => {
    expect(parseDeepLink('githubstarsmanager://repo/../etc/passwd')).toBeNull();
    expect(parseDeepLink('githubstarsmanager://repo/owner/%2e%2e')).toBeNull();
    expect(parseDeepLink('githubstarsmanager://developer/settings')).toBeNull();
    expect(parseDeepLink('githubstarsmanager://developer/marketplace')).toBeNull();
    expect(parseDeepLink('githubstarsmanager://plugins/..')).toBeNull();
    expect(parseDeepLink('githubstarsmanager://plugins/a')).toBeNull();
    expect(parseDeepLink('githubstarsmanager://release/owner/name/bad%20tag')).toBeNull();
    expect(parseDeepLink('githubstarsmanager://release/owner/name/bad%ZZtag')).toBeNull();
    expect(parseDeepLink('githubstarsmanager://release/owner/name/bad..tag')).toBeNull();
    expect(parseDeepLink('githubstarsmanager://repo/bad--owner/name')).toBeNull();
    expect(parseDeepLink('githubstarsmanager://repo/bad_owner/name')).toBeNull();
    expect(parseDeepLink('githubstarsmanager://plugins/Com.Example.Plugin')).toBeNull();
    expect(parseDeepLink('githubstarsmanager://plugins/com_example_plugin')).toBeNull();
    expect(parseDeepLink('githubstarsmanager://repo/owner//name')).toBeNull();
    expect(parseDeepLink('githubstarsmanager://repo/owner/name?extra=1')).toBeNull();
    expect(parseDeepLink('githubstarsmanager://repo/owner/name#fragment')).toBeNull();
  });
});
