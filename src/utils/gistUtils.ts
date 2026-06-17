import type { Gist, GistCategoryId, GistSearchFilters } from '../types';

const extensionLanguageMap: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  php: 'php',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  cs: 'csharp',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  html: 'xml',
  xml: 'xml',
  css: 'css',
  scss: 'scss',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  markdown: 'markdown',
  sql: 'sql',
  dockerfile: 'dockerfile',
};

export const getGistTitle = (gist: Gist): string => {
  if (gist.description?.trim()) return gist.description.trim();
  const firstFile = Object.keys(gist.files || {})[0];
  return firstFile || `gist:${gist.id.slice(0, 8)}`;
};

export const getGistFileCount = (gist: Gist): number => Object.keys(gist.files || {}).length;

export const getGistPrimaryLanguage = (gist: Gist): string | null => {
  const file = Object.values(gist.files || {}).find(item => item.language);
  return file?.language || null;
};

export const inferGistCodeLanguage = (filename: string, apiLanguage?: string | null): string => {
  if (apiLanguage) return apiLanguage.toLowerCase().replace(/\s+/g, '-');
  const lower = filename.toLowerCase();
  if (lower === 'dockerfile') return 'dockerfile';
  const extension = lower.includes('.') ? lower.split('.').pop() || '' : lower;
  return extensionLanguageMap[extension] || extension || 'plaintext';
};

export const getGistCategoryItems = (
  category: GistCategoryId,
  gists: Gist[],
  starredGists: Gist[],
  currentUserLogin?: string
): Gist[] => {
  const starredIds = new Set(starredGists.map(gist => gist.id));
  const byId = new Map<string, Gist>();

  [...gists, ...starredGists].forEach(gist => {
    const existing = byId.get(gist.id);
    byId.set(gist.id, {
      ...(existing || gist),
      ...gist,
      starred: gist.starred || starredIds.has(gist.id) || existing?.starred,
    });
  });

  const all = Array.from(byId.values());
  if (category === 'starred') return all.filter(gist => starredIds.has(gist.id) || gist.starred);
  if (category === 'mine') return all.filter(gist => gist.owner?.login === currentUserLogin);
  return all;
};

export const filterAndSortGists = (gists: Gist[], filters: GistSearchFilters): Gist[] => {
  const queryWords = filters.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let filtered = gists;

  if (queryWords.length > 0) {
    filtered = filtered.filter(gist => {
      // 逐字段匹配并提前中断，避免把所有文件内容拼接成超大字符串导致的性能问题。
      const fields = [
        gist.description || '',
        gist.owner?.login || '',
        gist.ai_summary || '',
      ];
      const files = Object.values(gist.files || {});
      return queryWords.every(word => {
        if (fields.some(field => field.toLowerCase().includes(word))) return true;
        return files.some(file =>
          file.filename.toLowerCase().includes(word) ||
          (file.language || '').toLowerCase().includes(word) ||
          (file.type || '').toLowerCase().includes(word) ||
          (file.content || '').toLowerCase().includes(word)
        );
      });
    });
  }

  if (filters.isAnalyzed !== undefined) {
    filtered = filtered.filter(gist =>
      filters.isAnalyzed ? (!!gist.analyzed_at && !gist.analysis_failed) : !gist.analyzed_at
    );
  }

  const sorted = [...filtered];
  sorted.sort((a, b) => {
    const getSortValue = (gist: Gist): number | string => {
      switch (filters.sortBy) {
        case 'created':
          return new Date(gist.created_at).getTime();
        case 'name':
          return getGistTitle(gist).toLowerCase();
        case 'files':
          return getGistFileCount(gist);
        case 'updated':
        default:
          return new Date(gist.updated_at).getTime();
      }
    };

    const aValue = getSortValue(a);
    const bValue = getSortValue(b);
    if (aValue < bValue) return filters.sortOrder === 'desc' ? 1 : -1;
    if (aValue > bValue) return filters.sortOrder === 'desc' ? -1 : 1;
    return 0;
  });

  return sorted;
};
