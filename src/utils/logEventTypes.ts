export type LogEventType =
  | 'sync'
  | 'aiAnalysis'
  | 'aiSearch'
  | 'githubApi'
  | 'trending'
  | 'release'
  | 'backendSync'
  | 'webdav'
  | 'update'
  | 'store'
  | 'app'
  | 'error'
  | 'other';

export const EVENT_TYPE_LABELS: Record<LogEventType, { zh: string; en: string }> = {
  sync:          { zh: '同步仓库', en: 'Sync Repos' },
  aiAnalysis:    { zh: 'AI 分析', en: 'AI Analysis' },
  aiSearch:      { zh: 'AI 搜索', en: 'AI Search' },
  githubApi:     { zh: 'GitHub API', en: 'GitHub API' },
  trending:      { zh: '刷新趋势', en: 'Refresh Trending' },
  release:       { zh: '更新 Release', en: 'Update Releases' },
  backendSync:   { zh: '后端同步', en: 'Backend Sync' },
  webdav:        { zh: 'WebDAV 备份', en: 'WebDAV Backup' },
  update:        { zh: '应用更新', en: 'App Update' },
  store:         { zh: '数据存储', en: 'Data Store' },
  app:           { zh: '应用', en: 'App' },
  error:         { zh: '错误', en: 'Error' },
  other:         { zh: '其他', en: 'Other' },
};

export function inferEventType(module: string, message: string): LogEventType {
  if (module.startsWith('sync')) return 'sync';
  if (module === 'ai' && /analysis|analyze/i.test(message)) return 'aiAnalysis';
  if (module === 'ai' && /search/i.test(message)) return 'aiSearch';
  if (module === 'githubApi' && /trending/i.test(message)) return 'trending';
  if (module === 'githubApi' && /release/i.test(message)) return 'release';
  if (module === 'backendAdapter') return 'backendSync';
  if (module === 'webdav') return 'webdav';
  if (module === 'update') return 'update';
  if (module.startsWith('store')) return 'store';
  if (module === 'app') return 'app';
  if (module === 'ui.errorBoundary') return 'error';
  if (module === 'githubApi') return 'githubApi';
  return 'other';
}