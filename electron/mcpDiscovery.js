const NO_LICENSE_SENTINEL = '__NO_LICENSE__';
const NOASSERTION_KEYS = new Set(['', 'noassertion', 'other', 'none', 'no-license']);

function normalizeLicense(value) {
  if (value == null || value === '') return NO_LICENSE_SENTINEL;
  if (typeof value === 'object') {
    const spdx = typeof value.spdx_id === 'string' ? value.spdx_id.trim() : '';
    const key = typeof value.key === 'string' ? value.key.trim() : '';
    const resolved = spdx || key;
    if (!resolved) return NO_LICENSE_SENTINEL;
    return NOASSERTION_KEYS.has(resolved.toLowerCase()) ? NO_LICENSE_SENTINEL : resolved;
  }
  if (typeof value !== 'string') return NO_LICENSE_SENTINEL;
  const normalized = value.trim();
  return !normalized || NOASSERTION_KEYS.has(normalized.toLowerCase())
    ? NO_LICENSE_SENTINEL
    : normalized;
}

function performBasicTextSearch(repos, query) {
  const normalizedQuery = String(query || '').toLowerCase().trim();
  if (!normalizedQuery) return repos;
  const words = normalizedQuery.split(/\s+/).filter(Boolean);
  return repos.filter((repo) => {
    const text = [
      repo.name,
      repo.full_name,
      repo.description || '',
      repo.custom_description || '',
      repo.language || '',
      ...(repo.topics || []),
      repo.ai_summary || '',
      ...(repo.ai_tags || []),
      ...(repo.ai_platforms || []),
      ...(repo.custom_tags || []),
      repo.custom_category || '',
      normalizeLicense(repo.license),
    ]
      .join(' ')
      .toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

function matchesRepoFilters(repo, filters = {}) {
  if (filters.languages?.length && (!repo.language || !filters.languages.includes(repo.language))) {
    return false;
  }
  if (filters.tags?.length) {
    const tags = [...(repo.ai_tags || []), ...(repo.topics || []), ...(repo.custom_tags || [])];
    if (!filters.tags.some((tag) => tags.includes(tag))) return false;
  }
  if (filters.platforms?.length) {
    const platforms = repo.ai_platforms || [];
    if (!filters.platforms.some((platform) => platforms.includes(platform))) return false;
  }
  if (filters.licenses?.length && !filters.licenses.includes(normalizeLicense(repo.license))) {
    return false;
  }
  if (filters.isAnalyzed !== undefined && filters.analysisFailed === undefined) {
    const matches = filters.isAnalyzed
      ? !!repo.analyzed_at && !repo.analysis_failed
      : !repo.analyzed_at;
    if (!matches) return false;
  }
  if (filters.isSubscribed !== undefined && filters.isSubscribed !== !!repo.subscribed_to_releases) {
    return false;
  }
  if (filters.isCategoryLocked !== undefined && filters.isCategoryLocked !== !!repo.category_locked) {
    return false;
  }
  if (filters.analysisFailed !== undefined && filters.isAnalyzed === undefined) {
    const failed = !!(repo.analyzed_at && repo.analysis_failed);
    if (filters.analysisFailed !== failed) return false;
  }
  if (filters.minStars !== undefined && (repo.stargazers_count || 0) < filters.minStars) return false;
  if (filters.maxStars !== undefined && (repo.stargazers_count || 0) > filters.maxStars) return false;
  if (filters.category && filters.category !== 'all' && repo.custom_category !== filters.category) {
    return false;
  }
  return true;
}

function sortableValue(repo, sortBy) {
  switch (sortBy) {
    case 'stars':
      return repo.stargazers_count || 0;
    case 'updated':
      return new Date(repo.pushed_at || repo.updated_at || 0).getTime();
    case 'name':
      return String(repo.name || '').toLowerCase();
    case 'starred':
      return repo.starred_at ? new Date(repo.starred_at).getTime() : 0;
    default:
      return new Date(repo.pushed_at || repo.updated_at || 0).getTime();
  }
}

function applyRepoFilters(repos, filters = {}) {
  const sortBy = filters.sortBy || 'stars';
  const sortOrder = filters.sortOrder || 'desc';
  return repos
    .filter((repo) => matchesRepoFilters(repo, filters))
    .slice()
    .sort((left, right) => {
      const leftValue = sortableValue(left, sortBy);
      const rightValue = sortableValue(right, sortBy);
      if (leftValue < rightValue) return sortOrder === 'desc' ? 1 : -1;
      if (leftValue > rightValue) return sortOrder === 'desc' ? -1 : 1;
      return String(left.full_name || '').localeCompare(String(right.full_name || ''));
    });
}

function searchRepositories(repos, filters = {}) {
  let result = repos;
  if (filters.query?.trim()) result = performBasicTextSearch(result, filters.query);
  result = applyRepoFilters(result, filters);
  const total = result.length;
  const offset = Math.max(0, filters.offset || 0);
  const limit = Math.min(100, Math.max(1, filters.limit || 20));
  return { items: result.slice(offset, offset + limit), total, offset, limit };
}

function projectRepo(repo, max = 400) {
  const summary = repo.ai_summary || repo.custom_description || repo.description || null;
  const truncated =
    typeof summary === 'string' && summary.length > max ? `${summary.slice(0, max)}…` : summary;
  return {
    id: repo.id,
    full_name: repo.full_name,
    name: repo.name,
    html_url: repo.html_url,
    description: repo.description,
    language: repo.language,
    stargazers_count: repo.stargazers_count,
    topics: repo.topics || [],
    ai_summary: truncated,
    ai_tags: repo.ai_tags || [],
    ai_platforms: repo.ai_platforms || [],
    custom_description: repo.custom_description,
    custom_tags: repo.custom_tags,
    custom_category: repo.custom_category,
    analyzed_at: repo.analyzed_at,
    subscribed_to_releases: !!repo.subscribed_to_releases,
    starred_at: repo.starred_at,
    updated_at: repo.updated_at,
    pushed_at: repo.pushed_at,
    license: repo.license ?? null,
  };
}

function buildRepositoryEmbeddingText(repo) {
  const parts = [];
  if (repo.full_name) parts.push(`Repository: ${repo.full_name}`);
  const description = repo.description || '';
  const aiSummary = repo.ai_summary || '';
  const customDescription = repo.custom_description || '';
  if (description && !aiSummary.includes(description)) parts.push(`Description: ${description}`);
  if (customDescription) parts.push(`About: ${customDescription}`);
  if (aiSummary) parts.push(`Summary: ${aiSummary}`);
  const topics = [...new Set([...(repo.topics || []), ...(repo.ai_tags || []), ...(repo.custom_tags || [])])];
  if (topics.length) parts.push(`Topics: ${topics.join(', ')}`);
  if (repo.language) parts.push(`Language: ${repo.language}`);
  const license = normalizeLicense(repo.license);
  if (license !== NO_LICENSE_SENTINEL) parts.push(`License: ${license}`);
  return parts.join('\n');
}

function hasActiveVectorFilters(filters = {}) {
  return Boolean(
    filters.languages?.length ||
      filters.tags?.length ||
      filters.platforms?.length ||
      filters.licenses?.length ||
      (filters.category && filters.category !== 'all') ||
      filters.minStars !== undefined ||
      filters.maxStars !== undefined ||
      filters.isAnalyzed !== undefined ||
      filters.isSubscribed !== undefined
  );
}

function filterVectorCandidates(candidates, filters, topK) {
  const ordered = candidates.slice().sort(
    (left, right) =>
      right.score - left.score ||
      String(left.repository.full_name || '').localeCompare(String(right.repository.full_name || ''))
  );
  const filtered = ordered.filter((candidate) => matchesRepoFilters(candidate.repository, filters));
  return {
    matches: filtered.slice(0, Math.max(1, topK)),
    candidateCount: ordered.length,
    filteredCount: filtered.length,
  };
}

function buildBatchLookupResult(inputs, resolve) {
  const items = inputs.map((input) => {
    const repository = resolve(input);
    return repository
      ? { input, status: 'found', repository: projectRepo(repository) }
      : { input, status: 'not_found', repository: null };
  });
  const notFound = items.filter((item) => item.status === 'not_found').map((item) => item.input);
  return {
    requested: items.length,
    foundCount: items.length - notFound.length,
    notFoundCount: notFound.length,
    notFound,
    items,
  };
}

function buildRepoEvidence(repo, latestRelease) {
  const analysisStatus = repo.analyzed_at
    ? repo.analysis_failed
      ? 'failed'
      : 'analyzed'
    : 'not_analyzed';
  return {
    repository: projectRepo(repo, 2000),
    evidence: {
      repository: {
        full_name: repo.full_name,
        html_url: repo.html_url,
        description: repo.description ?? null,
        language: repo.language ?? null,
        license: repo.license ?? null,
        stargazers_count: repo.stargazers_count ?? 0,
        created_at: repo.created_at ?? null,
        updated_at: repo.updated_at ?? null,
        pushed_at: repo.pushed_at ?? null,
        starred_at: repo.starred_at ?? null,
        subscribed_to_releases: !!repo.subscribed_to_releases,
        analysis_status: analysisStatus,
        analyzed_at: repo.analyzed_at ?? null,
        archived: null,
      },
      latest_release: latestRelease || null,
      sources: {
        repository: 'repositories',
        latest_release: latestRelease ? 'releases_cache' : null,
      },
      limitations: [
        'archived is not stored locally',
        'release evidence is limited to locally cached releases',
      ],
    },
  };
}

function getLatestCachedRelease(releases, repoId) {
  const matching = (Array.isArray(releases) ? releases : [])
    .filter((release) => Number(release.repository?.id ?? release.repo_id) === Number(repoId))
    .slice()
    .sort((left, right) => {
      const leftDate = left.published_at ? Date.parse(left.published_at) : Number.NEGATIVE_INFINITY;
      const rightDate = right.published_at ? Date.parse(right.published_at) : Number.NEGATIVE_INFINITY;
      return rightDate - leftDate || Number(right.id || 0) - Number(left.id || 0);
    });
  const release = matching[0];
  if (!release) return null;
  return {
    id: release.id,
    tag_name: release.tag_name ?? null,
    name: release.name ?? null,
    html_url: release.html_url ?? null,
    published_at: release.published_at ?? null,
    prerelease: !!release.prerelease,
    draft: !!release.draft,
  };
}

function buildStats(repos) {
  const byLanguage = {};
  const byLicense = {};
  const tagCounts = {};
  let analyzed = 0;
  let subscribed = 0;
  let failed = 0;
  for (const repo of repos) {
    const language = repo.language || 'Unknown';
    byLanguage[language] = (byLanguage[language] || 0) + 1;
    const license = normalizeLicense(repo.license);
    byLicense[license] = (byLicense[license] || 0) + 1;
    if (repo.analyzed_at && !repo.analysis_failed) analyzed += 1;
    if (repo.analyzed_at && repo.analysis_failed) failed += 1;
    if (repo.subscribed_to_releases) subscribed += 1;
    for (const tag of [...(repo.ai_tags || []), ...(repo.custom_tags || [])]) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }
  const topTags = Object.entries(tagCounts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 20)
    .map(([tag, count]) => ({ tag, count }));
  return {
    totalRepositories: repos.length,
    analyzed,
    analysisFailed: failed,
    unanalyzed: repos.length - analyzed - failed,
    subscribedToReleases: subscribed,
    byLanguage,
    byLicense,
    topTags,
  };
}

module.exports = {
  NO_LICENSE_SENTINEL,
  normalizeLicense,
  performBasicTextSearch,
  matchesRepoFilters,
  applyRepoFilters,
  searchRepositories,
  projectRepo,
  buildRepositoryEmbeddingText,
  hasActiveVectorFilters,
  filterVectorCandidates,
  buildBatchLookupResult,
  buildRepoEvidence,
  getLatestCachedRelease,
  buildStats,
};
