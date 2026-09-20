
import { TranslateFn } from '../../i18n/useT';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Switch } from '../ui/switch';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ScrollText,
  Search,
  Download,
  Trash2,
  Loader2,
  ShieldCheck,
  RefreshCw,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Check,
  X,
} from 'lucide-react';
import { logger, LogLevel, LogEntry } from '../../services/logger';
import { maskUrlDomain } from '../../utils/logSanitizer';
import { inferEventType, EVENT_TYPE_LABELS, LogEventType } from '../../utils/logEventTypes';
import { version as appVersion } from '../../../package.json';
import { useAppStore } from '../../store/useAppStore';
import { useDiagnosticBackendActions } from '../../features/settings/hooks/useDiagnosticBackendActions';

interface DiagnosticLogsPanelProps {
  t: TranslateFn;
}

const LEVEL_BADGE_VARIANTS: Record<LogLevel, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  debug: 'secondary',
  info: 'default',
  warn: 'outline',
  error: 'destructive',
};

const LEVEL_FILTER_VARIANTS: Record<LogLevel, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  debug: 'default',
  info: 'secondary',
  warn: 'secondary',
  error: 'destructive',
};

const STATUS_COLORS: Record<string, string> = {
  '2': 'text-muted-foreground',
  '4': 'text-foreground',
  '5': 'text-destructive',
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
  t: TranslateFn;
  onClose: () => void;
}

const LogDetailModal: React.FC<LogDetailModalProps> = ({ entry, language, t, onClose }) => {
  const [activeTab, setActiveTab] = useState<ModalTab>('general');
  const eventType = inferEventType(entry.module, entry.message, entry.data);
  const entryData = entry.data as Record<string, unknown> | undefined;

  const renderTabContent = () => {
    switch (activeTab) {
      case 'general':
        return (
          <div className="space-y-3 text-sm">
            <Row label={t('diagnosticLogsPanel.level')}>
              <Badge variant={LEVEL_BADGE_VARIANTS[entry.level]}>{entry.level}</Badge>
            </Row>
            <Row label={t('diagnosticLogsPanel.source')}>
              <Badge variant="secondary">
                {entry.source === 'frontend' ? t('diagnosticLogsPanel.frontend') : t('diagnosticLogsPanel.backend')}
              </Badge>
            </Row>
            <Row label={t('diagnosticLogsPanel.event-type')}>
              <span className="text-sm">{language === 'zh' ? EVENT_TYPE_LABELS[eventType].zh : EVENT_TYPE_LABELS[eventType].en}</span>
            </Row>
            <Row label={t('diagnosticLogsPanel.module')}>
              <span className="font-mono text-xs">{entry.module}</span>
            </Row>
            <Row label={t('diagnosticLogsPanel.message')}>
              <span className="break-words">{entry.message}</span>
            </Row>
            <Row label={t('diagnosticLogsPanel.timestamp')}>
              <span className="font-mono text-xs">{entry.timestamp}</span>
            </Row>
            {(entryData?.url != null || entryData?.endpoint != null || entryData?.path != null) && (
              <Row label={t('diagnosticLogsPanel.url')}>
                <span className="font-mono text-xs break-all">{String(entryData.url ?? entryData.endpoint ?? entryData.path)}</span>
              </Row>
            )}
            {entryData?.status != null && (
              <Row label={t('diagnosticLogsPanel.status')}>
                <span className={`font-bold ${getStatusColor(entryData.status)}`}>{String(entryData.status)}</span>
              </Row>
            )}
          </div>
        );
      case 'timing':
        return (
          <div className="space-y-3 text-sm">
            {entryData?.durationMs != null && (
              <Row label={t('diagnosticLogsPanel.duration')}>
                <span className="font-mono">{String(entryData.durationMs)}ms</span>
              </Row>
            )}
            {entryData?.method != null && (
              <Row label={t('diagnosticLogsPanel.method')}>
                <span className="font-mono">{String(entryData.method)}</span>
              </Row>
            )}
            {(entryData?.endpoint != null || entryData?.path != null) && (
              <Row label={t('diagnosticLogsPanel.path')}>
                <span className="font-mono break-all">{String(entryData.endpoint ?? entryData.path)}</span>
              </Row>
            )}
            {entryData?.apiType != null && (
              <Row label={t('diagnosticLogsPanel.api-type')}>
                <span className="font-mono">{String(entryData.apiType)}</span>
              </Row>
            )}
            {entryData?.model != null && (
              <Row label={t('diagnosticLogsPanel.model')}>
                <span className="font-mono">{String(entryData.model)}</span>
              </Row>
            )}
            {entryData?.responseLength != null && (
              <Row label={t('diagnosticLogsPanel.response-length')}>
                <span className="font-mono">{String(entryData.responseLength)} chars</span>
              </Row>
            )}
            {entryData?.durationMs == null && entryData?.method == null && (
              <p className="text-muted-foreground dark:text-muted-foreground/70 italic">{t('diagnosticLogsPanel.no-timing-info-enable-debug-mode')}</p>
            )}
          </div>
        );
      case 'requestHeader':
        return <DataBlock data={entryData?.requestHeaders} emptyText={t('diagnosticLogsPanel.no-request-header-data')} />;
      case 'requestBody':
        return <DataBlock data={entryData?.requestBody} emptyText={t('diagnosticLogsPanel.no-request-body-data')} />;
      case 'responseHeader':
        return <DataBlock data={entryData?.responseHeaders} emptyText={t('diagnosticLogsPanel.no-response-header-data')} />;
      case 'responseBody':
        return <DataBlock data={entryData?.responseBody ?? entryData?.data} emptyText={t('diagnosticLogsPanel.no-response-body-data-see-general-tab')} />;
      default:
        return null;
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        showClose={false}
        className="grid-rows-[auto_auto_minmax(0,1fr)] max-w-3xl max-h-[80vh] overflow-hidden p-0"
      >
        {/* Header */}
        <DialogHeader className="flex-row items-center justify-between space-y-0 border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-center space-x-3">
            <Badge variant={LEVEL_BADGE_VARIANTS[entry.level]} className="shrink-0">{entry.level}</Badge>
            <DialogTitle className="truncate text-sm font-medium leading-normal tracking-normal">{entry.message}</DialogTitle>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label={t('diagnosticLogsPanel.close-log-details')}
            className="ml-2 h-8 w-8 shrink-0"
          >
            <X className="h-5 w-5 text-muted-foreground dark:text-muted-foreground" />
          </Button>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex min-w-0 overflow-x-auto border-b border-border px-5">
          {MODAL_TABS.map(tab => (
            <Button
              key={tab.id}
              variant="ghost"
              onClick={() => setActiveTab(tab.id)}
              aria-pressed={activeTab === tab.id}
              className={`px-3 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-primary text-primary dark:text-primary'
                  : 'border-transparent text-muted-foreground dark:text-muted-foreground hover:text-muted-foreground dark:hover:text-muted-foreground'
              }`}
            >
              {language === 'zh' ? tab.zh : tab.en}
            </Button>
          ))}
        </div>

        {/* Content */}
        <div className="min-h-0 overflow-y-auto p-5">
          {renderTabContent()}
        </div>
      </DialogContent>
    </Dialog>
  );
};

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-start space-x-3">
    <span className="text-muted-foreground dark:text-muted-foreground w-24 shrink-0 pt-0.5">{label}</span>
    <div className="flex-1">{children}</div>
  </div>
);

const DataBlock: React.FC<{ data: unknown; emptyText: string }> = ({ data, emptyText }) => {
  if (data == null) {
    return <p className="text-muted-foreground dark:text-muted-foreground/70 text-sm italic">{emptyText}</p>;
  }
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return (
    <pre className="text-xs bg-accent/50 dark:bg-muted/20 rounded-lg p-3 overflow-auto max-h-[400px] font-mono text-muted-foreground dark:text-muted-foreground whitespace-pre-wrap break-all">
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
  // Log entries state
  const [entries, setEntries] = useState<LogEntry[]>(() => logger.getEntries());
  const [isExporting, setIsExporting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [detailEntry, setDetailEntry] = useState<LogEntry | null>(null);

  // Pagination
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLevels, setSelectedLevels] = useState<Set<LogLevel>>(new Set(['info', 'warn', 'error']));
  const [selectedScope, setSelectedScope] = useState<'all' | 'frontend' | 'backend'>('all');
  const {
    backendAvailable, backendUrl, backendDebug, backendEntries, backendLogCount,
    clear: clearBackend, refresh: refreshBackend, toggleDebug: toggleBackendDebug, fetchLogs: fetchBackendLogs,
  } = useDiagnosticBackendActions({ selectedScope });
  const [selectedEventTypes, setSelectedEventTypes] = useState<Set<LogEventType>>(new Set());
  const [showEventTypeDropdown, setShowEventTypeDropdown] = useState(false);

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
  const frontendCounts = useMemo(() => {
    const counts = { total: entries.length, debug: 0, info: 0, warn: 0, error: 0 };
    for (const entry of entries) {
      counts[entry.level]++;
    }
    return counts;
  }, [entries]);

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


  // Clear logs
  const handleClear = useCallback(async () => {
    if (selectedScope === 'frontend' || selectedScope === 'all') { logger.clear(); setEntries([]); }
    if ((selectedScope === 'backend' || selectedScope === 'all') && backendAvailable) {
      await clearBackend();
    }
  }, [selectedScope, backendAvailable, clearBackend]);

  // Refresh
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try { await refreshBackend(); } finally { setIsRefreshing(false); }
  }, [refreshBackend]);

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
        backendLogs = ((await fetchBackendLogs(minLevelName))?.logs ?? []).filter((entry) => selectedLevels.has(entry.level));
      }
      const state = useAppStore.getState();
      const isElectron = typeof window !== 'undefined' && window.electronAPI;
      const environment = {
        platform: isElectron ? 'electron' : 'web',
        electronVersion: isElectron ? navigator.userAgent.match(/Electron\/([\d.]+)/)?.[1] ?? 'unknown' : null,
        osPlatform: navigator.platform,
        screenResolution: `${screen.width}x${screen.height}`,
        backendAvailable,
        backendUrl: backendAvailable ? maskUrlDomain(backendUrl) : null,
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
        sanitizationNote: t('diagnosticLogsPanel.all-tokens-api-keys-passwords-and-emails-have-be'),
        frontendLogs, backendLogs,
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `github-stars-manager-logs-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch { /* Export failed */ } finally { setIsExporting(false); }
  }, [selectedScope, selectedLevels, backendAvailable, backendDebug, backendUrl, fetchBackendLogs, frontendDebug, t]);

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
          <h3 className="text-lg font-semibold text-foreground dark:text-foreground mb-4 flex items-center">
            <ScrollText className="w-5 h-5 mr-2 text-muted-foreground dark:text-muted-foreground" />
            {t('diagnosticLogsPanel.debug-mode')}
          </h3>
          <div className="bg-card dark:bg-card rounded-lg border border-border dark:border-border p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <span className="font-medium text-foreground dark:text-foreground">{t('diagnosticLogsPanel.frontend-debug')}</span>
                  <Badge variant={frontendDebug ? 'default' : 'secondary'}>
                    {frontendDebug ? t('diagnosticLogsPanel.on') : t('diagnosticLogsPanel.off')}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground dark:text-muted-foreground mt-1">
                  {t('diagnosticLogsPanel.records-all-frontend-http-request-details-method')}
                </p>
              </div>
              <Switch
                checked={frontendDebug}
                onCheckedChange={() => toggleFrontendDebug()}
                aria-label={t('diagnosticLogsPanel.toggle-frontend-debug')}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <span className={`font-medium ${backendAvailable ? 'text-foreground dark:text-foreground' : 'text-muted-foreground dark:text-muted-foreground/70'}`}>{t('diagnosticLogsPanel.backend-debug')}</span>
                  <Badge variant={backendAvailable && backendDebug ? 'default' : 'secondary'}>
                    {backendAvailable ? (backendDebug ? t('diagnosticLogsPanel.on') : t('diagnosticLogsPanel.off')) : t('diagnosticLogsPanel.not-connected')}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground dark:text-muted-foreground mt-1">{t('diagnosticLogsPanel.records-all-backend-http-request-details')}</p>
              </div>
              <Switch
                checked={backendDebug}
                onCheckedChange={() => toggleBackendDebug()}
                disabled={!backendAvailable}
                aria-label={t('diagnosticLogsPanel.toggle-backend-debug')}
              />
            </div>
            <p className="flex items-center gap-2 rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{t('diagnosticLogsPanel.debug-mode-produces-many-logs-enable-briefly-onl')}</span>
            </p>
          </div>
        </section>

        {/* Privacy Notice */}
        <p className="flex items-center gap-2 rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t('diagnosticLogsPanel.logs-store-only-endpoints-models-status-duration')}</span>
        </p>

        {/* Toolbar */}
        <section className="bg-card dark:bg-card rounded-lg border border-border dark:border-border p-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground dark:text-muted-foreground" />
            <Input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              aria-label={t('diagnosticLogsPanel.search-log-modules-or-messages')}
              placeholder={t('diagnosticLogsPanel.search-module-or-message')}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-border dark:border-border bg-muted dark:bg-muted/40 text-foreground dark:text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>

          {/* Level pills — debug pill always clickable */}
          <div className="flex items-center space-x-2">
            <span className="text-sm font-medium text-foreground dark:text-foreground">{t('diagnosticLogsPanel.level')}:</span>
            {(['debug', 'info', 'warn', 'error'] as LogLevel[]).map(level => (
              <Button
                key={level}
                type="button"
                variant={selectedLevels.has(level) ? LEVEL_FILTER_VARIANTS[level] : 'outline'}
                size="sm"
                onClick={() => toggleLevel(level)}
                aria-pressed={selectedLevels.has(level)}
                className="h-8 gap-1 rounded-md px-3 text-sm"
              >
                {selectedLevels.has(level) && <Check className="h-3 w-3" />}
                <span>{level}</span>
              </Button>
            ))}
          </div>

          {/* Scope + Event type + Actions */}
          <div className="flex items-center space-x-3 flex-wrap gap-y-2">
            <div className="flex items-center rounded-lg border border-border dark:border-border overflow-hidden">
              {(['all', 'frontend', 'backend'] as const).map(scope => (
                <Button key={scope} onClick={() => setSelectedScope(scope)} disabled={scope === 'backend' && !backendAvailable}
                  aria-pressed={selectedScope === scope}
                  variant={selectedScope === scope ? 'default' : 'outline'}
                  size="sm"
                  className={`h-8 rounded-none border-0 px-3 text-sm first:rounded-l-md last:rounded-r-md ${scope === 'backend' && !backendAvailable ? 'opacity-40 cursor-not-allowed' : ''}`}>
                  {scope === 'all' ? t('diagnosticLogsPanel.all') : scope === 'frontend' ? t('diagnosticLogsPanel.frontend') : t('diagnosticLogsPanel.backend')}
                </Button>
              ))}
            </div>
            <DropdownMenu open={showEventTypeDropdown} onOpenChange={setShowEventTypeDropdown}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" type="button" className="h-8 gap-1 px-3 text-sm">
                  <span>{selectedEventTypes.size > 0 ? `${selectedEventTypes.size} ${t('diagnosticLogsPanel.types')}` : t('diagnosticLogsPanel.event-type')}</span>
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-48 min-w-[180px] overflow-y-auto">
                <DropdownMenuLabel>{t('diagnosticLogsPanel.event-type-filters')}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {availableEventTypes.map(et => (
                  <DropdownMenuCheckboxItem
                    key={et}
                    checked={selectedEventTypes.has(et)}
                    onCheckedChange={() => toggleEventType(et)}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {language === 'zh' ? EVENT_TYPE_LABELS[et].zh : EVENT_TYPE_LABELS[et].en}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="flex items-center space-x-2 ml-auto">
                <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={isRefreshing || !backendAvailable}
                aria-label={t('diagnosticLogsPanel.refresh')} className="size-9" title={t('diagnosticLogsPanel.refresh')}>
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              </Button>
              <Button variant="secondary" onClick={handleClear} className="h-9 gap-1 px-3 text-sm font-medium">
                <Trash2 className="w-4 h-4" /><span>{t('diagnosticLogsPanel.clear')}</span>
              </Button>
              <Button onClick={handleExport} disabled={isExporting}
                className="h-9 gap-1 px-3 text-sm font-medium">
                {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                <span>{isExporting ? t('diagnosticLogsPanel.exporting') : t('diagnosticLogsPanel.export')}</span>
              </Button>
            </div>
          </div>

          <div className="text-xs text-muted-foreground dark:text-muted-foreground">
            {t('diagnosticLogsPanel.showing-v1-totalcount-entries', { v1: filteredEntries.length, totalCount: totalCount })}
            {(frontendDebug || backendDebug) && <Badge variant="secondary" className="ml-2">{t('diagnosticLogsPanel.debug-mode-on')}</Badge>}
            {selectedScope !== 'backend' && <span className="ml-1">· {t('diagnosticLogsPanel.frontend-v1', { v1: frontendCounts.total })}</span>}
            {selectedScope !== 'frontend' && backendAvailable && <span className="ml-1">· {t('diagnosticLogsPanel.backend-backendlogcount', { backendLogCount: backendLogCount })}</span>}
          </div>
        </section>

        {/* Log Entry List */}
        <section className="bg-card dark:bg-card rounded-lg border border-border dark:border-border overflow-hidden">
          {filteredEntries.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground dark:text-muted-foreground/70">
              <ScrollText className="w-8 h-8 mx-auto mb-2 opacity-50" />
              {totalCount === 0 ? t('diagnosticLogsPanel.no-logs-yet') : t('diagnosticLogsPanel.no-matching-logs')}
            </div>
          ) : (
            <>
              <div className="max-h-[520px] overflow-y-auto divide-y divide-border">
                {visibleEntries.map(entry => {
                  const eventType = inferEventType(entry.module, entry.message, entry.data);
                  const entryData = entry.data as Record<string, unknown> | undefined;
                  const statusColor = entryData?.status ? getStatusColor(entryData.status) : '';
                  const hasHttpDetail =
                    entryData?.method != null ||
                    entryData?.status != null ||
                    entryData?.durationMs != null ||
                    entryData?.url != null ||
                    entryData?.endpoint != null ||
                    entryData?.path != null ||
                    entryData?.requestHeaders != null ||
                    entryData?.requestBody != null ||
                    entryData?.responseHeaders != null ||
                    entryData?.responseBody != null;

                  return (
                    <div
                      key={entry.id}
                      role={hasHttpDetail ? 'button' : undefined}
                      tabIndex={hasHttpDetail ? 0 : undefined}
                      aria-label={hasHttpDetail ? t('diagnosticLogsPanel.view-http-details-v1-v2', { v1: entry.module, v2: entry.message }) : undefined}
                      className={`px-4 py-3 transition-colors ${hasHttpDetail ? 'cursor-pointer hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset' : ''}`}
                      onClick={hasHttpDetail ? () => setDetailEntry(entry) : undefined}
                      onKeyDown={hasHttpDetail ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setDetailEntry(entry);
                        }
                      } : undefined}
                    >
                      <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                        <Badge variant={LEVEL_BADGE_VARIANTS[entry.level]}>{entry.level}</Badge>
                        <Badge variant="secondary">
                          {entry.source === 'frontend' ? t('diagnosticLogsPanel.fe') : t('diagnosticLogsPanel.be')}
                        </Badge>
                        <Badge variant="outline">
                          {language === 'zh' ? EVENT_TYPE_LABELS[eventType].zh : EVENT_TYPE_LABELS[eventType].en}
                        </Badge>
                        <span className="text-xs text-muted-foreground dark:text-muted-foreground" title={entry.timestamp}>{formatRelativeTime(entry.timestamp)}</span>
                        <Badge variant="outline" className="font-mono">{entry.module}</Badge>
                        {hasHttpDetail && <ChevronRight className="w-3 h-3 text-muted-foreground ml-auto shrink-0" />}
                      </div>
                      <p className="text-sm text-foreground dark:text-foreground mt-1 break-words">{entry.message}</p>
                      {hasHttpDetail && (
                        <div className="text-xs mt-1 font-mono flex items-center space-x-1 text-muted-foreground dark:text-muted-foreground">
                          {entryData?.method != null && <span className="font-bold">{String(entryData.method)}</span>}
                          {(entryData?.endpoint != null || entryData?.path != null) && <span>{String(entryData.endpoint ?? entryData.path)}</span>}
                          {entryData?.status != null && <span className={`font-bold ${statusColor}`}>→ {String(entryData.status)}</span>}
                          {entryData?.durationMs != null && <span className="text-muted-foreground">{String(entryData.durationMs)}ms</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* Load more */}
              {visibleCount < filteredEntries.length && (
                <div className="border-t border-border p-3 text-center">
                  <Button variant="ghost" onClick={() => setVisibleCount(prev => prev + PAGE_SIZE)}
                    className="text-sm text-primary hover:text-primary/90 transition-colors">
                    {t('diagnosticLogsPanel.load-more-v1-remaining', { v1: filteredEntries.length - visibleCount })}
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
};
