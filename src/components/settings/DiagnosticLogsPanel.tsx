
import { TranslateFn } from '../../i18n/useT';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Switch } from '../ui/switch';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
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
  Package,
  Globe,
} from 'lucide-react';
import { logger, LogLevel, LogEntry } from '../../services/logger';
import { maskUrlDomain } from '../../utils/logSanitizer';
import { inferEventType, EVENT_TYPE_LABELS, LogEventType } from '../../utils/logEventTypes';
import { getNetworkEntries } from '../../services/fetchCapture';
import { version as appVersion } from '../../../package.json';
import { useAppStore } from '../../store/useAppStore';
import { useDiagnosticBackendActions, DiagnosticScope } from '../../features/settings/hooks/useDiagnosticBackendActions';
import { cn } from '../../lib/utils';
import {
  SettingsCard,
  SettingsDivider,
  SettingsNotice,
  SettingsPageStack,
  SettingsRow,
  SettingsSection,
} from './SettingsPrimitives';

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

/** Short source badge label (main/plugins come from the desktop journal). */
function sourceBadgeLabel(source: string, t: TranslateFn): string {
  switch (source) {
    case 'frontend': return t('diagnosticLogsPanel.fe');
    case 'backend': return t('diagnosticLogsPanel.be');
    case 'main': return t('diagnosticLogsPanel.source-main');
    default: return t('diagnosticLogsPanel.source-plugins');
  }
}

/** Full source label used in the detail modal. */
function sourceFullLabel(source: string, t: TranslateFn): string {
  switch (source) {
    case 'frontend': return t('diagnosticLogsPanel.frontend');
    case 'backend': return t('diagnosticLogsPanel.backend');
    case 'main': return t('diagnosticLogsPanel.source-main');
    default: return t('diagnosticLogsPanel.source-plugins');
  }
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
              <Badge variant="secondary">{sourceFullLabel(entry.source, t)}</Badge>
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
        className="app-diagnostic-detail-dialog grid-rows-[auto_auto_minmax(0,1fr)] max-h-[80vh] max-w-3xl overflow-hidden p-0 pr-12"
      >
        <DialogHeader className="app-diagnostic-dialog-header items-center justify-between space-y-0 border-b border-subtle px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <Badge variant={LEVEL_BADGE_VARIANTS[entry.level]} className="shrink-0">{entry.level}</Badge>
            <DialogTitle className="truncate text-label font-medium tracking-normal">{entry.message}</DialogTitle>
          </div>
        </DialogHeader>
        <DialogClose asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('diagnosticLogsPanel.close-log-details')}
            className="app-dialog-close"
          >
            <X className="size-4 text-secondary" />
          </Button>
        </DialogClose>

        <div className="flex min-w-0 gap-1 overflow-x-auto border-b border-subtle px-5 py-1.5">
          {MODAL_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-pressed={isActive}
                className={cn(
                  'h-control-sm shrink-0 rounded-sm px-2.5 text-label-sm font-medium whitespace-nowrap transition-[background-color,color] duration-micro ease-out-subtle hover:duration-instant',
                  isActive
                    ? 'bg-fill-selected text-foreground'
                    : 'text-secondary hover:bg-fill-hover hover:text-foreground',
                )}
              >
                {language === 'zh' ? tab.zh : tab.en}
              </button>
            );
          })}
        </div>

        <div className="min-h-0 overflow-y-auto p-5">
          {renderTabContent()}
        </div>
      </DialogContent>
    </Dialog>
  );
};

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-start gap-3">
    <span className="w-24 shrink-0 pt-0.5 text-label-sm font-medium text-tertiary">{label}</span>
    <div className="min-w-0 flex-1 text-label text-foreground">{children}</div>
  </div>
);

const DataBlock: React.FC<{ data: unknown; emptyText: string }> = ({ data, emptyText }) => {
  if (data == null) {
    return <p className="text-label-sm italic text-tertiary">{emptyText}</p>;
  }
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return (
    <pre className="max-h-[400px] overflow-auto whitespace-pre-wrap break-all rounded-md bg-sunken p-3 font-mono text-mono-ui text-secondary shadow-elev-0">
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
  const [selectedScope, setSelectedScope] = useState<DiagnosticScope>('all');
  // Desktop journal scopes (main/plugins) — populated via diagnostics:read.
  const isDesktopJournal = typeof window !== 'undefined' && !!window.electronAPI?.diagnostics;
  const [mainEntries, setMainEntries] = useState<LogEntry[]>([]);
  const [pluginEntries, setPluginEntries] = useState<LogEntry[]>([]);
  const [exportWindow, setExportWindow] = useState<1 | 24 | null>(24);
  const [isExportingBundle, setIsExportingBundle] = useState(false);
  const [showNetworkLedger, setShowNetworkLedger] = useState(false);
  const [networkEntries, setNetworkEntries] = useState<LogEntry[]>(() => getNetworkEntries());
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


  // Desktop journal polling (main-process + plugin entries), 10s cadence.
  useEffect(() => {
    if (!isDesktopJournal) return;
    let active = true;
    const load = async () => {
      try {
        const result = await window.electronAPI?.diagnostics?.read({ limit: 2000 });
        if (!active || !result?.success) return;
        setMainEntries(result.main ?? []);
        setPluginEntries(result.plugins ?? []);
      } catch { /* diagnostics read is best-effort */ }
    };
    void load();
    const interval = setInterval(() => { void load(); }, 10_000);
    return () => { active = false; clearInterval(interval); };
  }, [isDesktopJournal]);

  // Network ledger refresh while visible in debug mode.
  useEffect(() => {
    if (!frontendDebug || !showNetworkLedger) return;
    setNetworkEntries(getNetworkEntries());
    const interval = setInterval(() => setNetworkEntries(getNetworkEntries()), 2000);
    return () => clearInterval(interval);
  }, [frontendDebug, showNetworkLedger]);

  // Merge entries — sorted by timestamp DESCENDING (newest first)
  const sortNewestFirst = (list: LogEntry[]) => [...list].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const allEntries = useMemo(() => {
    if (selectedScope === 'frontend') return sortNewestFirst(entries);
    if (selectedScope === 'backend') return sortNewestFirst(backendEntries);
    if (selectedScope === 'main') return sortNewestFirst(mainEntries);
    if (selectedScope === 'plugins') return sortNewestFirst(pluginEntries);
    return sortNewestFirst([...entries, ...backendEntries, ...mainEntries, ...pluginEntries]);
  }, [entries, backendEntries, mainEntries, pluginEntries, selectedScope]);

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

  // Diagnostics bundle (desktop): the main process merges its journal tail,
  // plugin log tails, and an environment snapshot with what we send here.
  const handleExportBundle = useCallback(async () => {
    const exportApi = window.electronAPI?.diagnostics?.exportBundle;
    if (!exportApi) return;
    setIsExportingBundle(true);
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
      const networkEntries = getNetworkEntries().filter((entry) => selectedLevels.has(entry.level));
      const state = useAppStore.getState();
      const environment = {
        platform: 'electron',
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
      await exportApi({
        windowHours: exportWindow,
        frontendLogs,
        backendLogs,
        networkEntries,
        environment,
        sanitizationNote: t('diagnosticLogsPanel.all-tokens-api-keys-passwords-and-emails-have-be'),
      });
    } catch { /* Bundle export failed */ } finally { setIsExportingBundle(false); }
  }, [selectedScope, selectedLevels, backendAvailable, backendDebug, backendUrl, fetchBackendLogs, frontendDebug, exportWindow, t]);

  const toggleLevel = useCallback((level: LogLevel) => {
    setSelectedLevels(prev => { const next = new Set(prev); if (next.has(level)) next.delete(level); else next.add(level); return next; });
  }, []);

  const toggleEventType = useCallback((et: LogEventType) => {
    setSelectedEventTypes(prev => { const next = new Set(prev); if (next.has(et)) next.delete(et); else next.add(et); return next; });
  }, []);

  const totalCount = allEntries.length;

  return (
    <>
      {detailEntry && <LogDetailModal entry={detailEntry} language={language} t={t} onClose={() => setDetailEntry(null)} />}

      <SettingsPageStack className="app-diagnostic-panel">
        <SettingsSection title={t('diagnosticLogsPanel.debug-mode')} className="app-diagnostic-section">
          <SettingsCard className="app-diagnostic-card">
            <SettingsRow
              className="app-diagnostic-row"
              title={t('diagnosticLogsPanel.frontend-debug')}
              badge={(
                <Badge variant={frontendDebug ? 'default' : 'secondary'}>
                  {frontendDebug ? t('diagnosticLogsPanel.on') : t('diagnosticLogsPanel.off')}
                </Badge>
              )}
              description={t('diagnosticLogsPanel.records-all-frontend-http-request-details-method')}
            >
              <Switch
                checked={frontendDebug}
                onCheckedChange={() => toggleFrontendDebug()}
                aria-label={t('diagnosticLogsPanel.toggle-frontend-debug')}
              />
            </SettingsRow>
            <SettingsDivider />
            <SettingsRow
              className="app-diagnostic-row"
              title={t('diagnosticLogsPanel.backend-debug')}
              badge={(
                <Badge variant={backendAvailable && backendDebug ? 'default' : 'secondary'}>
                  {backendAvailable ? (backendDebug ? t('diagnosticLogsPanel.on') : t('diagnosticLogsPanel.off')) : t('diagnosticLogsPanel.not-connected')}
                </Badge>
              )}
              description={t('diagnosticLogsPanel.records-all-backend-http-request-details')}
            >
              <Switch
                checked={backendDebug}
                onCheckedChange={() => toggleBackendDebug()}
                disabled={!backendAvailable}
                aria-label={t('diagnosticLogsPanel.toggle-backend-debug')}
              />
            </SettingsRow>
            <SettingsDivider />
            <div className="flex items-center gap-2.5 bg-warning-tint px-3.5 py-2.5 text-label-sm text-foreground">
              <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden="true" />
              <span>{t('diagnosticLogsPanel.debug-mode-produces-many-logs-enable-briefly-onl')}</span>
            </div>
          </SettingsCard>
        </SettingsSection>

        <SettingsNotice tone="neutral" icon={<ShieldCheck />}>
          {t('diagnosticLogsPanel.logs-store-only-endpoints-models-status-duration')}
        </SettingsNotice>

        <SettingsSection>
          <SettingsCard className="space-y-3 p-3.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-tertiary" />
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label={t('diagnosticLogsPanel.search-log-modules-or-messages')}
                placeholder={t('diagnosticLogsPanel.search-module-or-message')}
                className="pl-8"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-label-sm font-medium text-tertiary">{t('diagnosticLogsPanel.level')}:</span>
              {(['debug', 'info', 'warn', 'error'] as LogLevel[]).map((level) => (
                <Button
                  key={level}
                  type="button"
                  variant={selectedLevels.has(level) ? LEVEL_FILTER_VARIANTS[level] : 'outline'}
                  size="sm"
                  onClick={() => toggleLevel(level)}
                  aria-pressed={selectedLevels.has(level)}
                >
                  {selectedLevels.has(level) && <Check className="size-3" />}
                  <span>{level}</span>
                </Button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex h-control items-center gap-0.5 rounded-md bg-fill-hover p-0.5">
                {(['all', 'frontend', 'main', 'plugins', 'backend'] as const).map((scope) => {
                  const isDisabled = (scope === 'backend' && !backendAvailable) || ((scope === 'main' || scope === 'plugins') && !isDesktopJournal);
                  const isActive = selectedScope === scope;
                  return (
                    <button
                      key={scope}
                      type="button"
                      onClick={() => setSelectedScope(scope)}
                      disabled={isDisabled}
                      aria-pressed={isActive}
                      className={cn(
                        'h-control-sm rounded-sm px-2.5 text-label-sm font-medium transition-[background-color,color,box-shadow] duration-micro ease-out-subtle hover:duration-instant disabled:pointer-events-none disabled:opacity-40',
                        isActive
                          ? 'bg-floating text-foreground shadow-elev-1'
                          : 'text-secondary hover:text-foreground',
                      )}
                    >
                      {scope === 'all' ? t('diagnosticLogsPanel.all')
                        : scope === 'frontend' ? t('diagnosticLogsPanel.frontend')
                        : scope === 'backend' ? t('diagnosticLogsPanel.backend')
                        : scope === 'main' ? t('diagnosticLogsPanel.source-main')
                        : t('diagnosticLogsPanel.source-plugins')}
                    </button>
                  );
                })}
              </div>

              <DropdownMenu open={showEventTypeDropdown} onOpenChange={setShowEventTypeDropdown}>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" type="button" size="md">
                    <span>{selectedEventTypes.size > 0 ? `${selectedEventTypes.size} ${t('diagnosticLogsPanel.types')}` : t('diagnosticLogsPanel.event-type')}</span>
                    <ChevronDown className="size-3.5 text-tertiary" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-48 min-w-[180px] overflow-y-auto">
                  <DropdownMenuLabel>{t('diagnosticLogsPanel.event-type-filters')}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {availableEventTypes.map((et) => (
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

              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={handleRefresh}
                  disabled={isRefreshing || !backendAvailable}
                  aria-label={t('diagnosticLogsPanel.refresh')}
                  title={t('diagnosticLogsPanel.refresh')}
                >
                  <RefreshCw className={`size-4 text-secondary ${isRefreshing ? 'animate-spin' : ''}`} />
                </Button>
                <Button type="button" variant="outline" size="md" onClick={handleClear}>
                  <Trash2 className="size-3.5" />
                  <span>{t('diagnosticLogsPanel.clear')}</span>
                </Button>
                {isDesktopJournal && (
                  <div className="inline-flex h-control items-center gap-0.5 rounded-md bg-fill-hover p-0.5" role="group" aria-label={t('diagnosticLogsPanel.export-bundle')}>
                    {([1, 24, null] as const).map((windowOption) => {
                      const isActive = exportWindow === windowOption;
                      return (
                        <button
                          key={String(windowOption)}
                          type="button"
                          onClick={() => setExportWindow(windowOption)}
                          aria-pressed={isActive}
                          className={cn(
                            'h-control-sm rounded-sm px-2 text-label-sm font-medium transition-[background-color,color,box-shadow] duration-micro ease-out-subtle hover:duration-instant',
                            isActive
                              ? 'bg-floating text-foreground shadow-elev-1'
                              : 'text-secondary hover:text-foreground',
                          )}
                        >
                          {windowOption === 1 ? t('diagnosticLogsPanel.export-window-hour')
                            : windowOption === 24 ? t('diagnosticLogsPanel.export-window-day')
                            : t('diagnosticLogsPanel.export-window-all')}
                        </button>
                      );
                    })}
                  </div>
                )}
                {isDesktopJournal && (
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={handleExportBundle}
                    disabled={isExportingBundle}
                    title={t('diagnosticLogsPanel.export-bundle')}
                  >
                    {isExportingBundle ? <Loader2 className="size-3.5 animate-spin" /> : <Package className="size-3.5" />}
                    <span>{isExportingBundle ? t('diagnosticLogsPanel.exporting') : t('diagnosticLogsPanel.export-bundle')}</span>
                  </Button>
                )}
                <Button type="button" variant="primary" size="md" onClick={handleExport} disabled={isExporting}>
                  {isExporting ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                  <span>{isExporting ? t('diagnosticLogsPanel.exporting') : t('diagnosticLogsPanel.export')}</span>
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-label-sm text-secondary tabular-nums">
              <span>{t('diagnosticLogsPanel.showing-v1-totalcount-entries', { v1: filteredEntries.length, totalCount })}</span>
              {(frontendDebug || backendDebug) && <Badge variant="secondary">{t('diagnosticLogsPanel.debug-mode-on')}</Badge>}
              {selectedScope !== 'backend' && <span>· {t('diagnosticLogsPanel.frontend-v1', { v1: frontendCounts.total })}</span>}
              {selectedScope !== 'frontend' && backendAvailable && <span>· {t('diagnosticLogsPanel.backend-backendlogcount', { backendLogCount })}</span>}
              {(selectedScope === 'main' || selectedScope === 'all') && isDesktopJournal && <span>· {t('diagnosticLogsPanel.source-main')} {mainEntries.length}</span>}
              {(selectedScope === 'plugins' || selectedScope === 'all') && isDesktopJournal && <span>· {t('diagnosticLogsPanel.source-plugins')} {pluginEntries.length}</span>}
            </div>
          </SettingsCard>
        </SettingsSection>

        {frontendDebug && (
          <SettingsSection>
            <SettingsCard className="p-3.5">
              <button
                type="button"
                onClick={() => setShowNetworkLedger((prev) => !prev)}
                aria-expanded={showNetworkLedger}
                className="flex items-center gap-2 text-label font-medium text-foreground"
              >
                <Globe className="size-4 text-tertiary" />
                <span>{t('diagnosticLogsPanel.network-ledger')}</span>
                <Badge variant="outline" className="tabular-nums">{networkEntries.length}</Badge>
                {showNetworkLedger ? <ChevronDown className="size-3.5 text-tertiary" /> : <ChevronRight className="size-3.5 text-tertiary" />}
              </button>
              {showNetworkLedger && (
                <div className="mt-3 max-h-[300px] divide-y divide-subtle overflow-y-auto">
                  {networkEntries.length === 0 ? (
                    <p className="py-3 text-label-sm text-tertiary">{t('diagnosticLogsPanel.no-logs-yet')}</p>
                  ) : (
                    [...networkEntries].reverse().slice(0, 100).map((entry) => {
                      const entryData = entry.data as Record<string, unknown> | undefined;
                      return (
                        <div key={entry.id} className="py-2">
                          <div className="flex items-center gap-2">
                            <Badge variant={LEVEL_BADGE_VARIANTS[entry.level]}>{entry.level}</Badge>
                            <span className="text-label-sm text-tertiary tabular-nums" title={entry.timestamp}>{formatRelativeTime(entry.timestamp)}</span>
                            <span className="break-all font-mono text-mono-ui text-foreground">{entry.message}</span>
                          </div>
                          {entryData?.durationMs != null && (
                            <p className="mt-0.5 font-mono text-mono-ui text-secondary">
                              {String(entryData.durationMs)}ms{entryData.responseContentType != null ? ` · ${String(entryData.responseContentType)}` : ''}
                            </p>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </SettingsCard>
          </SettingsSection>
        )}

        <SettingsSection>
          <SettingsCard>
            {filteredEntries.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center text-secondary">
                <ScrollText className="size-9 text-tertiary stroke-[1.5]" />
                <p className="text-label">
                  {totalCount === 0 ? t('diagnosticLogsPanel.no-logs-yet') : t('diagnosticLogsPanel.no-matching-logs')}
                </p>
              </div>
            ) : (
              <>
                <div className="max-h-[520px] overflow-y-auto">
                  {visibleEntries.map((entry, index) => {
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
                      <React.Fragment key={entry.id}>
                        {index > 0 && <SettingsDivider />}
                        <div
                          role={hasHttpDetail ? 'button' : undefined}
                          tabIndex={hasHttpDetail ? 0 : undefined}
                          aria-label={hasHttpDetail ? t('diagnosticLogsPanel.view-http-details-v1-v2', { v1: entry.module, v2: entry.message }) : undefined}
                          className={cn(
                            'px-3.5 py-2.5 transition-[background-color] duration-micro ease-out-subtle',
                            hasHttpDetail && 'cursor-pointer hover:bg-fill-hover hover:duration-instant focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset',
                          )}
                          onClick={hasHttpDetail ? () => setDetailEntry(entry) : undefined}
                          onKeyDown={hasHttpDetail ? (event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setDetailEntry(entry);
                            }
                          } : undefined}
                        >
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant={LEVEL_BADGE_VARIANTS[entry.level]}>{entry.level}</Badge>
                            <Badge variant="secondary">{sourceBadgeLabel(entry.source, t)}</Badge>
                            <Badge variant="outline">
                              {language === 'zh' ? EVENT_TYPE_LABELS[eventType].zh : EVENT_TYPE_LABELS[eventType].en}
                            </Badge>
                            <span className="text-label-sm text-tertiary tabular-nums" title={entry.timestamp}>{formatRelativeTime(entry.timestamp)}</span>
                            <Badge variant="outline" className="font-mono">{entry.module}</Badge>
                            {hasHttpDetail && <ChevronRight className="ml-auto size-3.5 shrink-0 text-tertiary" />}
                          </div>
                          <p className="mt-1 break-words text-label text-foreground">{entry.message}</p>
                          {hasHttpDetail && (
                            <div className="mt-1 flex items-center gap-1.5 font-mono text-mono-ui text-secondary">
                              {entryData?.method != null && <span className="font-medium text-foreground">{String(entryData.method)}</span>}
                              {(entryData?.endpoint != null || entryData?.path != null) && <span>{String(entryData.endpoint ?? entryData.path)}</span>}
                              {entryData?.status != null && <span className={`font-medium ${statusColor}`}>→ {String(entryData.status)}</span>}
                              {entryData?.durationMs != null && <span className="text-tertiary tabular-nums">{String(entryData.durationMs)}ms</span>}
                            </div>
                          )}
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>
                {visibleCount < filteredEntries.length && (
                  <>
                    <SettingsDivider />
                    <div className="px-3.5 py-2.5 text-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
                      >
                        {t('diagnosticLogsPanel.load-more-v1-remaining', { v1: filteredEntries.length - visibleCount })}
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}
          </SettingsCard>
        </SettingsSection>
      </SettingsPageStack>
    </>
  );
};
