import { Repository } from '../types';

const dedupe = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }

  return result;
};

export function setRepositoryCategory(repo: Repository, category: string): Repository {
  return {
    ...repo,
    custom_category: category.trim(),
    last_edited: new Date().toISOString(),
  };
}

export function addRepositoryTags(repo: Repository, tags: string[]): Repository {
  const merged = dedupe([...(repo.custom_tags || []), ...tags]);
  return {
    ...repo,
    custom_tags: merged,
    last_edited: new Date().toISOString(),
  };
}
