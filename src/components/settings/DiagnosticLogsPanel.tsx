import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  ScrollText,
  Search,
  Download,
  Trash2,
  Loader2,
  ShieldCheck,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Check,
  X,
} from 'lucide-react';
import { logger, LogLevel, LogEntry } from '../../services/logger';
import { backend } from '../../services/backendAdapter';
import { maskUrlDomain } from '../../utils/logSanitizer';
import { inferEventType, EVENT_TYPE_LABELS, LogEventType } from '../../utils/logEventTypes';
import { version as appVersion } from '../../../package.json';
import { useAppStore } from '../../store/useAppStore';

interface DiagnosticLogsPanelProps {
  t: (zh: string, en: string) => string;
}

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: 'bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-400',
  info: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
  warn: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400',
  error: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400',
};

const STATUS_COLORS: Record<string, string> = {
  '2': 'text-green-600 dark:text-green-400',
  '4': 'text-amber-600 dark:text-amber-400',
  '5': 'text-red-600 dark:text-red-400',
};

type ModalTab = 'general' | 'timing' | 'requestHeader' | 'requestBody' | 'responseHeader' | 'responseBody';

const MODAL_TABS: { id: ModalTab; zh: string; en: string }[] = [
  { id: 'general', zh: '概览', en: 'General' },
  { id: 'timing', zh: '耗时', en: 'Timing & Notes' },
  { id: 'requestHeader', zh: '请求头', en: 'Request Header' },
  { id: 'requestBody', zh: '请求体', en: 'Request Body' },
  { id: 'responseHeader', zh: '返回头', en: 'Response Header' },
  { id: 'responseBody', zh: '返回体', en: 'Response Body' },
];

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return `${Math.floor(diff / 86400000)}d`;
}

function getStatusColor(status: unknown): string {
  if (!status) return '';
  const s = String(status);
  return STATUS_COLORS[s.charAt(0)] || '';
}

const PAGE_SIZE = 100;

// ─── Detail Modal ──────────────────────────────────────────────
interface LogDetailModalProps {
  entry: LogEntry;
  language: string;
  t: (zh: string, en: string) => string;
  onClose: () => void;
}

const LogDetailModal: React.FC<LogDetailModalProps> = ({ entry, language, t, onClose }) => {
  const [activeTab, setActiveTab] = useState<ModalTab>('general');
  const eventType = inferEventType(entry.module, entry.message, entry.data);
  const entryData = entry.data as Record<string, unknown> | undefined;

  // Escape to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const renderTabContent = () => {
    switch (activeTab) {
      case 'general':
        return (
          <div className="space-y-3 text-sm">
            <Row label={t('级别', 'Level')}>
              <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${LEVEL_COLORS[entry.level]}`}>{entry.level}</span>
            </Row>
            <Row label={t('来源', 'Source')}>
              <span className={`px-2 py-0.5 text-xs rounded-full ${entry.source === 'frontend' ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-400' : 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400'}`}>
                {entry.source === 'frontend' ? t('前端', 'Frontend') : t('后端', 'Backend')}
              </span>
            </Row>
            <Row label={t('事件类型', 'Event Type')}>
              <span className="text-sm">{language === 'zh' ? EVENT_TYPE_LABELS[eventType].zh : EVENT_TYPE_LABELS[eventType].en}</span>
            </Row>
            <Row label={t('模块', 'Module')}>
              <span className="font-mono text-xs">{entry.module}</span>
            </Row>
            <Row label={t('消息', 'Message')}>
              <span className="break-words">{entry.message}</span>
            </Row>
            <Row label={t('时间', 'Timestamp')}>
              <span className="font-mono text-xs">{entry.timestamp}</span>
            </Row>
            {(entryData?.url || entryData?.endpoint || entryData?.path) && (
              <Row label={t('请求地址', 'URL')}>
                <span className="font-mono text-xs break-all">{String(entryData.url ?? entryData.endpoint ?? entryData.path)}</span>
              </Row>
            )}
            {entryData?.status && (
              <Row label={t('状态码', 'Status')}>
                <span className={`font-bold ${getStatusColor(entryData.status)}`}>{String(entryData.status)}</span>
              </Row>
            )}
          </div>
        );
      case 'timing':
        return (
          <div className="space-y-3 text-sm">
            {entryData?.durationMs != null && (
              <Row label={t('耗时', 'Duration')}>
                <span className="font-mono">{String(entryData.durationMs)}ms</span>
              </Row>
            )}
            {entryData?.method && (
              <Row label={t('方法', 'Method')}>
                <span className="font-mono">{String(entryData.method)}</span>
              </Row>
            )}
            {(entryData?.endpoint || entryData?.path) && (
              <Row label={t('路径', 'Path')}>
                <span className="font-mono break-all">{String(entryData.endpoint ?? entryData.path)}</span>
              </Row>
            )}
            {entryData?.apiType && (
              <Row label={t('API 类型', 'API Type')}>
                <span className="font-mono">{String(entryData.apiType)}</span>
              </Row>
            )}
            {entryData?.model && (
              <Row label={t('模型', 'Model')}>
                <span className="font-mono">{String(entryData.model)}</span>
              </Row>
            )}
            {entryData?.responseLength != null && (
              <Row label={t('响应长度', 'Response Length')}>
                <span className="font-mono">{String(entryData.responseLength)} chars</span>
              </Row>
            )}
            {!entryData?.durationMs && !entryData?.method && (
              <p className="text-gray-400 dark:text-text-quaternary italic">{t('无耗时信息（需开启调试模式）', 'No timing info (enable debug mode)')}</p>
            )}
          </div>
        );
      case 'requestHeader':
        return <DataBlock data={entryData?.requestHeaders} emptyText={t('无请求头数据', 'No request header data')} />;
      case 'requestBody':
        return <DataBlock data={entryData?.requestBody} emptyText={t('无请求体数据', 'No request body data')} />;
      case 'responseHeader':
        return <DataBlock data={entryData?.responseHeaders} emptyText={t('无返回头数据', 'No response header data')} />;
      case 'responseBody':
        return <DataBlock data={entryData?.responseBody ?? entryData?.data} emptyText={t('无返回体数据（完整数据见概览标签）', 'No response body data (see General tab)')} />;
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-[80vh] bg-white dark:bg-panel-dark rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.06] dark:border-white/[0.04]">
          <div className="flex items-center space-x-3 min-w-0">
            <span className={`px-2 py-0.5 text-xs rounded-full font-medium shrink-0 ${LEVEL_COLORS[entry.level]}`}>{entry.level}</span>
            <span className="font-medium text-gray-900 dark:text-text-primary truncate">{entry.message}</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors shrink-0 ml-2">
            <X className="w-5 h-5 text-gray-500 dark:text-text-tertiary" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-black/[0.06] dark:border-white/[0.04] px-5 overflow-x-auto">
          {MODAL_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-brand-indigo text-brand-indigo dark:text-brand-violet'
                  : 'border-transparent text-gray-500 dark:text-text-tertiary hover:text-gray-700 dark:hover:text-text-secondary'
              }`}
            >
              {language === 'zh' ? tab.zh : tab.en}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {renderTabContent()}
        </div>
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-start space-x-3">
    <span className="text-gray-500 dark:text-text-tertiary w-24 shrink-0 pt-0.5">{label}</span>
    <div className="flex-1">{children}</div>
  </div>
);

const DataBlock: React.FC<{ data: unknown; emptyText: string }> = ({ data, emptyText }) => {
  if (data == null) {
    return <p className="text-gray-400 dark:text-text-quaternary text-sm italic">{emptyText}</p>;
  }
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return (
    <pre className="text-xs bg-gray-50 dark:bg-white/[0.02] rounded-lg p-3 overflow-auto max-h-[400px] font-mono text-gray-700 dark:text-text-secondary whitespace-pre-wrap break-all">
      {text}
    </pre>
  );
};

// ─── Main Panel ────────────────────────────────────────────────
export const DiagnosticLogsPanel: React.FC<DiagnosticLogsPanelProps> = ({ t }) => {
  const language = useAppStore.getState().language;

  // Debug mode state
  const [frontendDebug, setFrontendDebug] = useState(() => {
    const saved = sessionStorage.getItem('gsm:frontend-debug');
    if (saved === 'true') {
      logger.setLevel('debug');
      return true;
    }
    return false;
  });
  const [backendDebug, setBackendDebug] = useState(false);
  const backendAvailable = backend.isAvailable;

  // Initialize backend debug state from server on mount
  useEffect(() => {
    if (!backendAvailable) return;
    const fetchDebugState = async () => {
      try {
        const secret = sessionStorage.getItem('github-stars-manager-backend-secret');
        const res = await fetch('/api/logs/debug', {
          headers: { Authorization: `Bearer ${secret}` },
        });
        if (res.ok) {
          const data = await res.json();
          setBackendDebug(data.debugMode);
          sessionStorage.setItem('gsm:backend-debug', String(data.debugMode));
        }
      } catch { /* Backend unreachable */ }
    };
    fetchDebugState();
  }, [backendAvailable]);

  // Log entries state
  const [entries, setEntries] = useState<LogEntry[]>(() => logger.getEntries());
  const [backendEntries, setBackendEntries] = useState<LogEntry[]>([]);
  const [backendLogCount, setBackendLogCount] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [detailEntry, setDetailEntry] = useState<LogEntry | null>(null);

  // Pagination
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLevels, setSelectedLevels] = useState<Set<LogLevel>>(new Set(['info', 'warn', 'error']));
  const [selectedScope, setSelectedScope] = useState<'all' | 'frontend' | 'backend'>('all');
  const [selectedEventTypes, setSelectedEventTypes] = useState<Set<LogEventType>>(new Set());
  const [showEventTypeDropdown, setShowEventTypeDropdown] = useState(false);
  const eventTypeRef = useRef<HTMLDivElement>(null);

  // Close event type dropdown on outside click or Escape
  useEffect(() => {
    if (!showEventTypeDropdown) return;
    const onDocClick = (e: MouseEvent) => {
      if (eventTypeRef.current && !eventTypeRef.current.contains(e.target as Node)) {
        setShowEventTypeDropdown(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowEventTypeDropdown(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [showEventTypeDropdown]);

  // Real-time frontend log subscription
  useEffect(() => {
    const handleLogAdded = (e: Event) => {
      const entry = (e as CustomEvent<LogEntry>).detail;
      if (entry) {
        setEntries(prev => {
          const next = [...prev, entry];
          return next.length > 2000 ? next.slice(-2000) : next;
        });
      }
    };
    const handleLogsCleared = () => { setEntries([]); };
    window.addEventListener('gsm:diagnostic-log-added', handleLogAdded);
    window.addEventListener('gsm:diagnostic-logs-cleared', handleLogsCleared);
    return () => {
      window.removeEventListener('gsm:diagnostic-log-added', handleLogAdded);
      window.removeEventListener('gsm:diagnostic-logs-cleared', handleLogsCleared);
    };
  }, []);

  // Backend log fetching
  useEffect(() => {
    if (selectedScope === 'frontend') { setBackendEntries([]); setBackendLogCount(0); return; }
    if (!backendAvailable) return;
    const fetchBackend = async () => {
      try {
        const secret = sessionStorage.getItem('github-stars-manager-backend-secret');
        const res = await fetch('/api/logs?limit=2000', { headers: { Authorization: `Bearer ${secret}` } });
        if (res.ok) {
          const raw = await res.json();
          const logs = Array.isArray(raw) ? raw : [];
          setBackendEntries(logs);
          const totalHeader = res.headers.get('X-Log-Count');
          setBackendLogCount(totalHeader ? parseInt(totalHeader) || 0 : logs.length);
        }
      } catch { /* Backend unreachable */ }
    };
    fetchBackend();
    const interval = setInterval(fetchBackend, 10000);
    return () => clearInterval(interval);
  }, [selectedScope, backendAvailable]);

  // Merge entries — sorted by timestamp DESCENDING (newest first)
  const allEntries = useMemo(() => {
    if (selectedScope === 'frontend') return [...entries].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    if (selectedScope === 'backend') return [...backendEntries].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return [...entries, ...backendEntries].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [entries, backendEntries, selectedScope]);

  // Derived: available event types
  const availableEventTypes = useMemo(() => {
    const types = new Set<LogEventType>();
    for (const entry of allEntries) types.add(inferEventType(entry.module, entry.message, entry.data));
    return Array.from(types).sort();
  }, [allEntries]);

  // Filter entries
  const filteredEntries = useMemo(() => {
    return allEntries.filter(entry => {
      if (!selectedLevels.has(entry.level)) return false;
      if (selectedEventTypes.size > 0 && !selectedEventTypes.has(inferEventType(entry.module, entry.message, entry.data))) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!entry.module.toLowerCase().includes(q) && !entry.message.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [allEntries, selectedLevels, selectedEventTypes, searchQuery]);

  // Visible entries (pagination)
  const visibleEntries = useMemo(() => filteredEntries.slice(0, visibleCount), [filteredEntries, visibleCount]);

  // Reset visible count when filters change
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [searchQuery, selectedLevels, selectedEventTypes, selectedScope]);

  // Frontend counts
  const frontendCounts = useMemo(() => logger.getCounts(), [entries]);

  // Toggle frontend debug mode
  const toggleFrontendDebug = useCallback(() => {
    const next = !frontendDebug;
    setFrontendDebug(next);
    logger.setLevel(next ? 'debug' : 'info');
    sessionStorage.setItem('gsm:frontend-debug', String(next));
    if (next) {
      setSelectedLevels(prev => new Set([...prev, 'debug']));
    }
  }, [frontendDebug]);

  // Toggle backend debug mode
  const toggleBackendDebug = useCallback(async () => {
    const next = !backendDebug;
    try {
      const secret = sessionStorage.getItem('github-stars-manager-backend-secret');
      const res = await fetch('/api/logs/debug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
        body: JSON.stringify({ enabled: next }),
      });
      if (res.ok) {
        const data = await res.json();
        setBackendDebug(data.debugMode);
        sessionStorage.setItem('gsm:backend-debug', String(data.debugMode));
      }
    } catch { /* Backend unreachable */ }
  }, [backendDebug]);

  // Clear logs
  const handleClear = useCallback(async () => {
    if (selectedScope === 'frontend' || selectedScope === 'all') { logger.clear(); setEntries([]); }
    if ((selectedScope === 'backend' || selectedScope === 'all') && backendAvailable) {
      try {
        const secret = sessionStorage.getItem('github-stars-manager-backend-secret');
        await fetch('/api/logs', { method: 'DELETE', headers: { Authorization: `Bearer ${secret}` } });
        setBackendEntries([]); setBackendLogCount(0);
      } catch { /* Backend unreachable */ }
    }
  }, [selectedScope, backendAvailable]);

  // Refresh
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const secret = sessionStorage.getItem('github-stars-manager-backend-secret');
      const res = await fetch('/api/logs?limit=2000', { headers: { Authorization: `Bearer ${secret}` } });
      if (res.ok) {
        const raw = await res.json();
        setBackendEntries(Array.isArray(raw) ? raw : []);
        const totalHeader = res.headers.get('X-Log-Count');
        setBackendLogCount(totalHeader ? parseInt(totalHeader) || 0 : raw.length);
      }
    } catch { /* Backend unreachable */ } finally { setIsRefreshing(false); }
  }, []);

  // Export
  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const levelOrder: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
      const minLevel = selectedLevels.size > 0
        ? (Object.entries(levelOrder).find(([l]) => selectedLevels.has(l as LogLevel))?.[1] ?? 3)
        : 3;
      const minLevelName = (Object.entries(levelOrder).find(([, v]) => v === minLevel)?.[0] as LogLevel) || 'info';
      const frontendLogs = selectedScope !== 'backend'
        ? logger.getEntries({ level: minLevelName }).filter(e => selectedLevels.has(e.level)) : [];
      let backendLogs: LogEntry[] = [];
      if (selectedScope !== 'frontend' && backendAvailable) {
        try {
          const secret = sessionStorage.getItem('github-stars-manager-backend-secret');
          const res = await fetch(`/api/logs?limit=2000&level=${minLevelName}`, { headers: { Authorization: `Bearer ${secret}` } });
          if (res.ok) { const raw = await res.json(); backendLogs = Array.isArray(raw) ? raw.filter((e: LogEntry) => selectedLevels.has(e.level)) : []; }
        } catch { /* Backend unreachable */ }
      }
      const state = useAppStore.getState();
      const isElectron = typeof window !== 'undefined' && window.electronAPI;
      const environment = {
        platform: isElectron ? 'electron' : 'web',
        electronVersion: isElectron ? navigator.userAgent.match(/Electron\/([\d.]+)/)?.[1] ?? 'unknown' : null,
        osPlatform: navigator.platform,
        screenResolution: `${screen.width}x${screen.height}`,
        backendAvailable,
        backendUrl: backendAvailable ? maskUrlDomain(backend.backendUrl || '') : null,
        language: state.language,
        repoCount: state.repositories?.length ?? 0,
        frontendDebugMode: frontendDebug,
        backendDebugMode: backendDebug,
        appVersion,
      };
      const exportData = {
        format: 'github-stars-manager-logs-v1',
        exportDate: new Date().toISOString(),
        appVersion, environment,
        sanitizationNote: t('所有 Token、API Key、密码、邮箱已脱敏为 ***格式', 'All tokens, API keys, passwords, and emails have been masked as ***<last4>'),
        frontendLogs, backendLogs,
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `github-stars-manager-logs-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch { /* Export failed */ } finally { setIsExporting(false); }
  }, [selectedScope, selectedLevels, backendAvailable, frontendDebug, backendDebug, t]);

  const toggleLevel = useCallback((level: LogLevel) => {
    setSelectedLevels(prev => { const next = new Set(prev); if (next.has(level)) next.delete(level); else next.add(level); return next; });
  }, []);

  const toggleEventType = useCallback((et: LogEventType) => {
    setSelectedEventTypes(prev => { const next = new Set(prev); if (next.has(et)) next.delete(et); else next.add(et); return next; });
  }, []);

  const totalCount = allEntries.length;

  return (
    <>
      {/* Detail modal */}
      {detailEntry && <LogDetailModal entry={detailEntry} language={language} t={t} onClose={() => setDetailEntry(null)} />}

      <div className="space-y-4">
        {/* Debug Mode Section */}
        <section>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-text-primary mb-4 flex items-center">
            <ScrollText className="w-5 h-5 mr-2 text-gray-700 dark:text-text-secondary" />
            {t('调试模式', 'Debug Mode')}
          </h3>
          <div className="bg-white dark:bg-panel-dark rounded-lg border border-black/[0.06] dark:border-white/[0.04] p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <span className="font-medium text-gray-900 dark:text-text-primary">{t('前端调试', 'Frontend Debug')}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${frontendDebug ? 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400' : 'bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-400'}`}>
                    {frontendDebug ? t('已开启', 'ON') : t('已关闭', 'OFF')}
                  </span>
                </div>
                <p className="text-sm text-gray-500 dark:text-text-tertiary mt-1">
                  {t('开启后将记录所有前端 HTTP 请求详情（方法、路径、状态码、耗时）', 'Records all frontend HTTP request details (method, path, status, duration)')}
                </p>
              </div>
              <button onClick={toggleFrontendDebug} className={`p-2 rounded-lg transition-colors ${frontendDebug ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-gray-500'}`}>
                {frontendDebug ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8" />}
              </button>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <span className={`font-medium ${backendAvailable ? 'text-gray-900 dark:text-text-primary' : 'text-gray-400 dark:text-text-quaternary'}`}>{t('后端调试', 'Backend Debug')}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${backendDebug ? 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400' : 'bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-400'}`}>
                    {backendAvailable ? (backendDebug ? t('已开启', 'ON') : t('已关闭', 'OFF')) : t('后端未连接', 'Not connected')}
                  </span>
                </div>
                <p className="text-sm text-gray-500 dark:text-text-tertiary mt-1">{t('开启后将记录所有后端 HTTP 请求详情', 'Records all backend HTTP request details')}</p>
              </div>
              <button onClick={backendAvailable ? toggleBackendDebug : undefined} disabled={!backendAvailable}
                className={`p-2 rounded-lg transition-colors ${!backendAvailable ? 'opacity-50 cursor-not-allowed' : ''} ${backendDebug ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-gray-500'}`}>
                {backendDebug ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8" />}
              </button>
            </div>
            <div className="flex items-center space-x-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 p-2 rounded-lg">
              <AlertTriangle className="w-4 h-4" />
              <span>{t('调试模式会产生大量日志，仅用于排障时短暂开启', 'Debug mode produces many logs — enable briefly only for troubleshooting')}</span>
            </div>
          </div>
        </section>

        {/* Privacy Notice */}
        <div className="flex items-center space-x-2 text-xs text-gray-500 dark:text-text-tertiary bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-3 rounded-lg">
          <ShieldCheck className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span>{t('日志仅记录端点、模型、状态、耗时和错误摘要。所有 Token、API Key、密码、邮箱已自动脱敏为 ***格式', 'Logs store only endpoints, models, status, duration, and error summaries. All sensitive info is automatically masked as ***')}</span>
        </div>

        {/* Toolbar */}
        <section className="bg-white dark:bg-panel-dark rounded-lg border border-black/[0.06] dark:border-white/[0.04] p-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder={t('搜索模块或消息...', 'Search module or message...')}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-black/[0.06] dark:border-white/[0.04] bg-light-surface dark:bg-white/[0.04] text-gray-900 dark:text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-brand-violet" />
          </div>

          {/* Level pills — debug pill always clickable */}
          <div className="flex items-center space-x-2">
            <span className="text-sm font-medium text-gray-900 dark:text-text-primary">{t('级别', 'Level')}:</span>
            {(['debug', 'info', 'warn', 'error'] as LogLevel[]).map(level => (
              <button key={level} onClick={() => toggleLevel(level)}
                className={`px-3 py-1 text-sm rounded-full transition-colors border cursor-pointer flex items-center space-x-1 ${selectedLevels.has(level) ? LEVEL_COLORS[level] : 'border-gray-200 dark:border-white/[0.06] text-gray-500 dark:text-text-tertiary bg-transparent'}`}>
                {selectedLevels.has(level) && <Check className="w-3 h-3" />}
                <span>{level}</span>
              </button>
            ))}
          </div>

          {/* Scope + Event type + Actions */}
          <div className="flex items-center space-x-3 flex-wrap gap-y-2">
            <div className="flex items-center rounded-lg border border-black/[0.06] dark:border-white/[0.04] overflow-hidden">
              {(['all', 'frontend', 'backend'] as const).map(scope => (
                <button key={scope} onClick={() => setSelectedScope(scope)} disabled={scope === 'backend' && !backendAvailable}
                  className={`px-3 py-1.5 text-sm transition-colors ${selectedScope === scope ? 'bg-brand-indigo text-white' : 'bg-transparent text-gray-600 dark:text-text-secondary hover:bg-gray-100 dark:hover:bg-white/[0.06]'} ${scope === 'backend' && !backendAvailable ? 'opacity-40 cursor-not-allowed' : ''}`}>
                  {scope === 'all' ? t('全部', 'All') : scope === 'frontend' ? t('前端', 'Frontend') : t('后端', 'Backend')}
                </button>
              ))}
            </div>
            <div className="relative" ref={eventTypeRef}>
              <button onClick={() => setShowEventTypeDropdown(!showEventTypeDropdown)}
                className="px-3 py-1.5 text-sm rounded-lg border border-black/[0.06] dark:border-white/[0.04] bg-transparent text-gray-600 dark:text-text-secondary hover:bg-gray-100 dark:hover:bg-white/[0.06] flex items-center space-x-1">
                <span>{selectedEventTypes.size > 0 ? `${selectedEventTypes.size} ${t('类型', 'types')}` : t('事件类型', 'Event Type')}</span>
                <ChevronDown className="w-4 h-4" />
              </button>
              {showEventTypeDropdown && (
                <div className="absolute top-full left-0 mt-1 bg-white dark:bg-panel-dark rounded-lg border border-black/[0.06] dark:border-white/[0.04] shadow-lg z-10 p-2 max-h-48 overflow-y-auto min-w-[160px]">
                  {availableEventTypes.map(et => (
                    <button key={et} onClick={() => toggleEventType(et)}
                      className={`w-full text-left px-2 py-1 text-sm rounded ${selectedEventTypes.has(et) ? 'bg-brand-indigo/10 text-brand-indigo dark:bg-brand-violet/20 dark:text-brand-violet' : 'text-gray-700 dark:text-text-secondary hover:bg-gray-100 dark:hover:bg-white/[0.06]'}`}>
                      <span>{language === 'zh' ? EVENT_TYPE_LABELS[et].zh : EVENT_TYPE_LABELS[et].en}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center space-x-2 ml-auto">
              <button onClick={handleRefresh} disabled={isRefreshing || !backendAvailable}
                className="p-2 rounded-lg text-gray-600 dark:text-text-secondary hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors disabled:opacity-50" title={t('刷新', 'Refresh')}>
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
              <button onClick={handleClear} className="px-3 py-1.5 text-sm font-medium rounded-lg text-gray-700 dark:text-text-secondary bg-gray-100 dark:bg-white/[0.04] hover:bg-gray-200 dark:hover:bg-white/[0.08] transition-colors flex items-center space-x-1">
                <Trash2 className="w-4 h-4" /><span>{t('清空', 'Clear')}</span>
              </button>
              <button onClick={handleExport} disabled={isExporting}
                className="px-3 py-1.5 text-sm font-medium rounded-lg bg-brand-indigo hover:bg-brand-hover text-white transition-colors disabled:opacity-50 flex items-center space-x-1">
                {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                <span>{isExporting ? t('导出中...', 'Exporting...') : t('导出', 'Export')}</span>
              </button>
            </div>
          </div>

          <div className="text-xs text-gray-500 dark:text-text-tertiary">
            {t(`显示 ${filteredEntries.length} / ${totalCount} 条`, `Showing ${filteredEntries.length} / ${totalCount} entries`)}
            {(frontendDebug || backendDebug) && <span className="ml-2 text-amber-600 dark:text-amber-400">{t('调试模式已开启', 'Debug mode ON')}</span>}
            {selectedScope !== 'backend' && <span className="ml-1">· {t(`前端 ${frontendCounts.total}`, `Frontend ${frontendCounts.total}`)}</span>}
            {selectedScope !== 'frontend' && backendAvailable && <span className="ml-1">· {t(`后端 ${backendLogCount}`, `Backend ${backendLogCount}`)}</span>}
          </div>
        </section>

        {/* Log Entry List */}
        <section className="bg-white dark:bg-panel-dark rounded-lg border border-black/[0.06] dark:border-white/[0.04] overflow-hidden">
          {filteredEntries.length === 0 ? (
            <div className="p-8 text-center text-gray-400 dark:text-text-quaternary">
              <ScrollText className="w-8 h-8 mx-auto mb-2 opacity-50" />
              {totalCount === 0 ? t('暂无日志', 'No logs yet') : t('无匹配日志', 'No matching logs')}
            </div>
          ) : (
            <>
              <div className="max-h-[520px] overflow-y-auto divide-y divide-black/[0.04] dark:divide-white/[0.02]">
                {visibleEntries.map(entry => {
                  const eventType = inferEventType(entry.module, entry.message, entry.data);
                  const entryData = entry.data as Record<string, unknown> | undefined;
                  const statusColor = entryData?.status ? getStatusColor(entryData.status) : '';
                  const hasHttpDetail = entryData?.method || entryData?.status || entryData?.durationMs;

                  return (
                    <div key={entry.id}
                      className={`px-4 py-3 transition-colors ${hasHttpDetail ? 'hover:bg-light-surface dark:hover:bg-white/[0.02] cursor-pointer' : ''}`}
                      onClick={hasHttpDetail ? () => setDetailEntry(entry) : undefined}>
                      <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                        <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${LEVEL_COLORS[entry.level]}`}>{entry.level}</span>
                        <span className={`px-2 py-0.5 text-xs rounded-full ${entry.source === 'frontend' ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-400' : 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400'}`}>
                          {entry.source === 'frontend' ? t('前端', 'FE') : t('后端', 'BE')}
                        </span>
                        <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-400">
                          {language === 'zh' ? EVENT_TYPE_LABELS[eventType].zh : EVENT_TYPE_LABELS[eventType].en}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-text-tertiary" title={entry.timestamp}>{formatRelativeTime(entry.timestamp)}</span>
                        <span className="px-1.5 py-0.5 text-xs bg-brand-indigo/10 text-brand-indigo dark:bg-brand-violet/20 dark:text-brand-violet rounded font-mono">{entry.module}</span>
                        {hasHttpDetail && <ChevronRight className="w-3 h-3 text-gray-400 ml-auto shrink-0" />}
                      </div>
                      <p className="text-sm text-gray-900 dark:text-text-primary mt-1 break-words">{entry.message}</p>
                      {hasHttpDetail && (
                        <div className="text-xs mt-1 font-mono flex items-center space-x-1 text-gray-500 dark:text-text-tertiary">
                          {entryData?.method && <span className="font-bold">{String(entryData.method)}</span>}
                          {(entryData?.endpoint || entryData?.path) && <span>{String(entryData.endpoint ?? entryData.path)}</span>}
                          {entryData?.status && <span className={`font-bold ${statusColor}`}>→ {String(entryData.status)}</span>}
                          {entryData?.durationMs != null && <span className="text-blue-600 dark:text-blue-400">{String(entryData.durationMs)}ms</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* Load more */}
              {visibleCount < filteredEntries.length && (
                <div className="p-3 text-center border-t border-black/[0.04] dark:border-white/[0.02]">
                  <button onClick={() => setVisibleCount(prev => prev + PAGE_SIZE)}
                    className="text-sm text-brand-indigo hover:text-brand-hover transition-colors">
                    {t(`加载更多（还有 ${filteredEntries.length - visibleCount} 条）`, `Load more (${filteredEntries.length - visibleCount} remaining)`)}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
};
