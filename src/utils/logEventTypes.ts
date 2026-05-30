export type LogEventType =
  | 'sync'
  | 'aiAnalysis'
  | 'aiSearch'
  | 'githubApi'
  | 'trending'
  | 'release'
  | 'fork'
  | 'workflow'
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
  fork:          { zh: '刷新复刻', en: 'Refresh Forks' },
  workflow:      { zh: '执行 Workflow', en: 'Run Workflow' },
  backendSync:   { zh: '后端同步', en: 'Backend Sync' },
  webdav:        { zh: 'WebDAV 备份', en: 'WebDAV Backup' },
  update:        { zh: '应用更新', en: 'App Update' },
  store:         { zh: '数据存储', en: 'Data Store' },
  app:           { zh: '应用', en: 'App' },
  error:         { zh: '错误', en: 'Error' },
  other:         { zh: '其他', en: 'Other' },
};

export function inferEventType(module: string, message: string, data?: unknown): LogEventType {
  // Check for explicit operationTag first (set by makeRequest callers)
  const operationTag = (data as Record<string, unknown>)?.operationTag;
  if (typeof operationTag === 'string') {
    if (operationTag === 'trending') return 'trending';
    if (operationTag === 'release') return 'release';
    if (operationTag === 'fork') return 'fork';
    if (operationTag === 'workflow') return 'workflow';
  }

  if (module.startsWith('sync')) return 'sync';
  if (module === 'ai' && /analysis|analyze/i.test(message)) return 'aiAnalysis';
  if (module === 'ai' && /search/i.test(message)) return 'aiSearch';
  if (module === 'ai' && /request/i.test(message)) return 'aiAnalysis';
  if (module === 'githubApi' && /trending/i.test(message)) return 'trending';
  if (module === 'githubApi' && /release/i.test(message)) return 'release';
  if (module === 'githubApi' && /fork/i.test(message)) return 'fork';
  if (module === 'githubApi' && /workflow/i.test(message)) return 'workflow';
  if (module === 'backendAdapter') return 'backendSync';
  if (module === 'webdav') return 'webdav';
  if (module === 'update') return 'update';
  if (module.startsWith('store')) return 'store';
  if (module === 'app') return 'app';
  if (module === 'ui.errorBoundary') return 'error';
  if (module === 'githubApi') return 'githubApi';
  return 'other';
}