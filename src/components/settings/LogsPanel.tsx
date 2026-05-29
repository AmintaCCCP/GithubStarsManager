import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle, Download, RefreshCw, Search, Trash2 } from 'lucide-react';
import type { AppLogEntry, AppLogLevel, AppLogSource } from '../../types';
import { appLogger } from '../../services/appLogger';

interface LogsPanelProps {
  t: (zh: string, en: string) => string;
}

const levelStyles: Record<AppLogLevel, string> = {
  info: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
  warn: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-300',
  error: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300',
};

const formatTime = (timestamp: string): string => {
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return timestamp;
  }
};

const formatDetails = (entry: AppLogEntry): string => {
  if (!entry.details) return '';
  return Object.entries(entry.details)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join('\n');
};

export const LogsPanel: React.FC<LogsPanelProps> = ({ t }) => {
  const [logs, setLogs] = useState<AppLogEntry[]>([]);
  const [query, setQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState<AppLogLevel | 'all'>('all');
  const [sourceFilter, setSourceFilter] = useState<AppLogSource | 'all'>('all');
  const [isLoading, setIsLoading] = useState(false);

  const loadLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      setLogs(await appLogger.getLogs());
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLogs();
    const handleChange = () => {
      void loadLogs();
    };
    window.addEventListener('gsm:diagnostic-log-added', handleChange);
    window.addEventListener('gsm:diagnostic-logs-cleared', handleChange);
    return () => {
      window.removeEventListener('gsm:diagnostic-log-added', handleChange);
      window.removeEventListener('gsm:diagnostic-logs-cleared', handleChange);
    };
  }, [loadLogs]);

  const filteredLogs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return logs.filter((entry) => {
      if (levelFilter !== 'all' && entry.level !== levelFilter) return false;
      if (sourceFilter !== 'all' && entry.source !== sourceFilter) return false;
      if (!normalizedQuery) return true;

      const text = [
        entry.level,
        entry.source,
        entry.operation,
        entry.message,
        formatDetails(entry),
      ].join(' ').toLowerCase();
      return text.includes(normalizedQuery);
    });
  }, [levelFilter, logs, query, sourceFilter]);

  const clearLogs = async () => {
    await appLogger.clearLogs();
    setLogs([]);
  };

  const exportLogs = () => {
    appLogger.exportLogs(filteredLogs);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-text-primary">
            {t('诊断日志', 'Diagnostic Logs')}
          </h3>
          <p className="text-sm text-gray-500 dark:text-text-tertiary mt-1">
            {t(
              `默认保留最近 ${appLogger.maxEntries} 条脱敏记录`,
              `Keeps the latest ${appLogger.maxEntries} redacted entries`
            )}
          </p>
        </div>
        <button
          onClick={() => void loadLogs()}
          disabled={isLoading}
          className="p-2 rounded-lg bg-light-surface hover:bg-gray-200 dark:bg-white/[0.04] dark:hover:bg-white/[0.08] text-gray-700 dark:text-text-secondary transition-colors disabled:opacity-50"
          aria-label={t('刷新日志', 'Refresh logs')}
          title={t('刷新日志', 'Refresh logs')}
        >
          <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="p-4 rounded-lg border border-black/[0.06] dark:border-white/[0.04] bg-light-surface dark:bg-white/[0.04]">
        <p className="text-sm text-gray-700 dark:text-text-secondary">
          {t(
            '日志只保存接口、模型、状态、耗时、错误和长度摘要；不会保存 API Key、Authorization、完整 prompt 或完整回复。',
            'Logs store endpoints, models, status, timing, errors, and length summaries only; API keys, Authorization headers, full prompts, and full responses are not saved.'
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3">
        <label className="relative block">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('搜索日志', 'Search logs')}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-black/[0.06] dark:border-white/[0.04] bg-white dark:bg-white/[0.04] text-gray-900 dark:text-text-primary"
          />
        </label>

        <select
          value={levelFilter}
          onChange={(event) => setLevelFilter(event.target.value as AppLogLevel | 'all')}
          className="px-3 py-2 rounded-lg border border-black/[0.06] dark:border-white/[0.04] bg-white dark:bg-white/[0.04] text-gray-900 dark:text-text-primary"
          aria-label={t('日志级别', 'Log level')}
        >
          <option value="all">{t('全部级别', 'All levels')}</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </select>

        <select
          value={sourceFilter}
          onChange={(event) => setSourceFilter(event.target.value as AppLogSource | 'all')}
          className="px-3 py-2 rounded-lg border border-black/[0.06] dark:border-white/[0.04] bg-white dark:bg-white/[0.04] text-gray-900 dark:text-text-primary"
          aria-label={t('日志来源', 'Log source')}
        >
          <option value="all">{t('全部来源', 'All sources')}</option>
          <option value="github">github</option>
          <option value="ai">ai</option>
          <option value="backend">backend</option>
          <option value="app">app</option>
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={exportLogs}
          disabled={filteredLogs.length === 0}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-indigo hover:bg-brand-hover text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download className="w-4 h-4" />
          <span>{t('导出', 'Export')}</span>
        </button>
        <button
          onClick={() => void clearLogs()}
          disabled={logs.length === 0}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-light-surface hover:bg-gray-200 dark:bg-white/[0.04] dark:hover:bg-white/[0.08] text-gray-700 dark:text-text-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Trash2 className="w-4 h-4" />
          <span>{t('清空', 'Clear')}</span>
        </button>
        <span className="text-sm text-gray-500 dark:text-text-tertiary">
          {filteredLogs.length} / {logs.length}
        </span>
      </div>

      <div className="rounded-lg border border-black/[0.06] dark:border-white/[0.04] bg-white dark:bg-panel-dark overflow-hidden">
        {filteredLogs.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-text-tertiary">
            {t('暂无日志', 'No logs yet')}
          </div>
        ) : (
          <div className="divide-y divide-black/[0.06] dark:divide-white/[0.04] max-h-[520px] overflow-y-auto">
            {filteredLogs.map((entry) => {
              const details = formatDetails(entry);
              return (
                <div key={entry.id} className="p-4 hover:bg-light-bg dark:hover:bg-white/[0.04]">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${levelStyles[entry.level]}`}>
                      {entry.level}
                    </span>
                    <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-white/[0.06] dark:text-text-secondary">
                      {entry.source}
                    </span>
                    <span className="text-gray-500 dark:text-text-tertiary">{formatTime(entry.timestamp)}</span>
                    {entry.success !== undefined && (
                      entry.success
                        ? <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
                        : <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
                    )}
                    {entry.statusCode !== undefined && (
                      <span className="text-gray-500 dark:text-text-tertiary">HTTP {entry.statusCode}</span>
                    )}
                    {entry.durationMs !== undefined && (
                      <span className="text-gray-500 dark:text-text-tertiary">{entry.durationMs}ms</span>
                    )}
                  </div>
                  <div className="mt-2">
                    <p className="font-medium text-gray-900 dark:text-text-primary">{entry.operation}</p>
                    <p className="text-sm text-gray-700 dark:text-text-secondary mt-1">{entry.message}</p>
                  </div>
                  {details && (
                    <pre className="mt-3 p-3 rounded-lg bg-light-surface dark:bg-white/[0.04] text-xs text-gray-700 dark:text-text-secondary whitespace-pre-wrap break-words">{details}</pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
