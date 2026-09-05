import { describe, expect, it } from 'vitest';
import { buildMcpDataSnapshot } from './mcpSnapshot';
import type { EmbeddingConfig, Repository, Release, VectorSearchConfig } from '../types';

const repository = {
  id: 1,
  name: 'alpha',
  full_name: 'acme/alpha',
  description: null,
  html_url: 'https://github.com/acme/alpha',
  stargazers_count: 1,
  forks_count: 0,
  forks: 0,
  language: 'Rust',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  pushed_at: '2026-01-01T00:00:00.000Z',
  owner: { login: 'acme', avatar_url: '' },
  topics: [],
} satisfies Repository;

const release = {
  id: 10,
  tag_name: 'v1.0.0',
  name: 'Release',
  body: null,
  published_at: '2026-02-01T00:00:00.000Z',
  html_url: 'https://github.com/acme/alpha/releases/tag/v1.0.0',
  assets: [],
  repository: { id: 1, full_name: 'acme/alpha', name: 'alpha' },
} satisfies Release;

const vectorSearchConfig = {
  enabled: true,
  workerUrl: 'https://worker.example',
  authToken: 'runtime-token',
  embeddingConfigId: 'embedding-1',
  indexMode: 'description',
  readmeMaxChars: 6000,
} satisfies VectorSearchConfig;

const embedding = {
  id: 'embedding-1',
  name: 'local',
  apiType: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  apiKey: '',
  model: 'bge-m3',
  dimensions: 1024,
  isActive: true,
} satisfies EmbeddingConfig;

describe('buildMcpDataSnapshot', () => {
  it('includes release cache data while keeping runtime config in the existing IPC snapshot', () => {
    const snapshot = buildMcpDataSnapshot(
      {
        repositories: [repository],
        customCategories: [],
        releases: [release],
        vectorSearchConfig,
        embeddingConfigs: [embedding],
        activeEmbeddingConfig: 'embedding-1',
      },
      '2026-09-05T00:00:00.000Z'
    );

    expect(snapshot.repositories).toEqual([repository]);
    expect(snapshot.releases).toEqual([release]);
    expect(snapshot.snapshotAt).toBe('2026-09-05T00:00:00.000Z');
    expect(snapshot.vectorSearchConfig.embedding?.model).toBe('bge-m3');
    expect(snapshot.vectorSearchConfig.authToken).toBe('runtime-token');
  });
});
