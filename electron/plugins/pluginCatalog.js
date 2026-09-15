'use strict';

const { protocolError, sanitizeRelease, sanitizeRepository } = require('./pluginProtocol');

const MAX_SNAPSHOT_REPOSITORIES = 10000;
const MAX_SNAPSHOT_RELEASES = 20000;
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;

function validateAssetDownloadUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw protocolError('PLUGIN_SNAPSHOT_INVALID', 'Release asset download URL is invalid');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hostname.toLowerCase() !== 'github.com') {
    throw protocolError('PLUGIN_SNAPSHOT_INVALID', 'Release asset download URL must be an HTTPS github.com URL');
  }
  return url.toString();
}

function createPluginCatalog() {
  let repositories = new Map();
  let releases = new Map();

  function normalizeRelease(release) {
    const sanitized = sanitizeRelease(release);
    const assets = sanitized.assets.map((asset) => {
      const source = release.assets.find((candidate) => candidate?.id === asset.id);
      return { ...asset, browser_download_url: validateAssetDownloadUrl(source?.browser_download_url) };
    });
    return { public: sanitized, assets };
  }

  return {
    update(snapshot) {
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        throw protocolError('PLUGIN_SNAPSHOT_INVALID', 'Plugin data snapshot must be an object');
      }
      let snapshotBytes;
      try {
        snapshotBytes = Buffer.byteLength(JSON.stringify(snapshot), 'utf8');
      } catch {
        throw protocolError('PLUGIN_SNAPSHOT_INVALID', 'Plugin data snapshot must be JSON serializable');
      }
      if (snapshotBytes > MAX_SNAPSHOT_BYTES) {
        throw protocolError('PLUGIN_SNAPSHOT_INVALID', 'Plugin data snapshot exceeds the size limit');
      }
      if (!Array.isArray(snapshot.repositories) || snapshot.repositories.length > MAX_SNAPSHOT_REPOSITORIES) {
        throw protocolError('PLUGIN_SNAPSHOT_INVALID', 'Plugin repository snapshot is invalid');
      }
      if (!Array.isArray(snapshot.releases) || snapshot.releases.length > MAX_SNAPSHOT_RELEASES) {
        throw protocolError('PLUGIN_SNAPSHOT_INVALID', 'Plugin release snapshot is invalid');
      }
      const nextRepositories = new Map();
      for (const repository of snapshot.repositories) {
        const sanitized = sanitizeRepository(repository);
        nextRepositories.set(sanitized.id, sanitized);
      }
      const nextReleases = new Map();
      for (const release of snapshot.releases) {
        const normalized = normalizeRelease(release);
        nextReleases.set(normalized.public.id, normalized);
      }
      repositories = nextRepositories;
      releases = nextReleases;
      return { repositories: repositories.size, releases: releases.size };
    },
    upsert(repository, release) {
      const sanitizedRepository = repository === undefined
        ? null
        : sanitizeRepository(repository);
      const normalizedRelease = normalizeRelease(release);
      if (sanitizedRepository) {
        repositories.set(sanitizedRepository.id, sanitizedRepository);
      }
      releases.set(normalizedRelease.public.id, normalizedRelease);
    },
    searchRepositories(query, limit = 20) {
      if (typeof query !== 'string' || query.trim().length === 0 || query.length > 200) {
        throw protocolError('PLUGIN_CAPABILITY_REQUEST_INVALID', 'GitHub repository query is invalid');
      }
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw protocolError('PLUGIN_CAPABILITY_REQUEST_INVALID', 'GitHub repository result limit must be between 1 and 100');
      }
      const needle = query.trim().toLowerCase();
      return [...repositories.values()]
        .filter((repository) => `${repository.full_name} ${repository.description || ''} ${repository.topics.join(' ')}`.toLowerCase().includes(needle))
        .slice(0, limit);
    },
    getRepository(repositoryId) {
      if (!Number.isSafeInteger(repositoryId)) {
        throw protocolError('PLUGIN_CAPABILITY_REQUEST_INVALID', 'GitHub repository id is invalid');
      }
      return repositories.get(repositoryId) || null;
    },
    getRelease(releaseId) {
      if (!Number.isSafeInteger(releaseId)) {
        throw protocolError('PLUGIN_CAPABILITY_REQUEST_INVALID', 'GitHub release id is invalid');
      }
      return releases.get(releaseId)?.public || null;
    },
    getDownloadAsset(releaseId, assetId) {
      if (!Number.isSafeInteger(releaseId) || !Number.isSafeInteger(assetId)) {
        throw protocolError('PLUGIN_CAPABILITY_REQUEST_INVALID', 'Release or asset id is invalid');
      }
      const release = releases.get(releaseId);
      if (!release) return null;
      const asset = release.assets.find((candidate) => candidate.id === assetId);
      return asset ? { release: release.public, asset } : null;
    },
  };
}

module.exports = { createPluginCatalog };
