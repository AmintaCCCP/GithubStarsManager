import { useT } from '../i18n/useT';
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Settings,
  Globe,
  Bot,
  Cloud,
  Database,
  Server,
  Package,
  Palette,
  X,
  Trash2,
  Wifi,
  ScrollText,
  Layout,
  Search,
  Cable,
  Star,
  Plug,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { ContextSidebarBody } from './ContextSidebarBody';
import { cn } from '../lib/utils';
import { isElectron } from '../services/electronProxy';
import { useBackendAvailability } from '../features/settings/hooks/useBackendAvailability';
import { useVectorSearchActions } from '../features/settings/hooks/useVectorSearchActions';
import {
  AppearancePanel,
  GeneralPanel,
  AIConfigPanel,
  WebDAVPanel,
  BackupPanel,
  BackendPanel,
  CategoryPanel,
  DataManagementPanel,
  NetworkPanel,
  DiagnosticLogsPanel,
  MenuManagementPanel,
  StarSyncPanel,
  VectorSearchSettings,
  McpSettingsPanel,
  PluginSettingsPanel,
} from './settings';

type SettingsTab =
  | 'general'
  | 'appearance'
  | 'starSync'
  | 'ai'
  | 'webdav'
  | 'backup'
  | 'backend'
  | 'category'
  | 'menu'
  | 'data'
  | 'logs'
  | 'network'
  | 'vectorSearch'
  | 'mcp'
  | 'plugins';

interface SettingsTabItem {
  id: SettingsTab;
  section: 'app' | 'ai-data' | 'connection';
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

interface SettingsPanelProps {
  isOpen?: boolean;
  onClose?: () => void;
  isModal?: boolean;
}

interface MobileTabNavProps {
  tabs: SettingsTabItem[];
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}

const MobileTabNav: React.FC<MobileTabNavProps> = ({ tabs, activeTab, onTabChange }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Map<SettingsTab, HTMLButtonElement>>(new Map());
  const [indicatorStyle, setIndicatorStyle] = useState({ translateX: 0, width: 0 });
  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  const updateIndicator = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(() => {
      const activeButton = tabRefs.current.get(activeTab);
      if (activeButton && scrollContainerRef.current) {
        const container = scrollContainerRef.current;
        const translateX = activeButton.offsetLeft - container.scrollLeft;
        const width = activeButton.offsetWidth;

        setIndicatorStyle({ translateX, width });
      }
    });
  }, [activeTab]);

  const scrollToActiveTab = useCallback(() => {
    const activeButton = tabRefs.current.get(activeTab);
    if (activeButton && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const scrollLeft = activeButton.offsetLeft - (container.offsetWidth / 2) + (activeButton.offsetWidth / 2);

      container.scrollTo({
        left: Math.max(0, scrollLeft),
        behavior: 'smooth',
      });
    }
  }, [activeTab]);

  useEffect(() => {
    updateIndicator();
  }, [updateIndicator]);

  useEffect(() => {
    scrollToActiveTab();
    const timer = setTimeout(() => {
      updateIndicator();
    }, 350);
    return () => clearTimeout(timer);
  }, [activeTab, scrollToActiveTab, updateIndicator]);

  const handleScroll = useCallback(() => {
    if (!isScrollingRef.current) {
      isScrollingRef.current = true;
    }

    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    scrollTimeoutRef.current = setTimeout(() => {
      isScrollingRef.current = false;
      updateIndicator();
    }, 150);
  }, [updateIndicator]);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  return (
    <div className="relative w-full border-b border-subtle bg-navigator/95 backdrop-blur-sm">
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        role="tablist"
        className="flex snap-x snap-mandatory gap-1 overflow-x-auto px-2 py-2 scrollbar-hide"
        style={{
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) {
                  tabRefs.current.set(tab.id, el);
                } else {
                  tabRefs.current.delete(tab.id);
                }
              }}
              type="button"
              onClick={() => onTabChange(tab.id)}
              role="tab"
              id={`settings-tab-mobile-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`settings-tabpanel-${tab.id}`}
              className={cn(
                'inline-flex h-control shrink-0 snap-center items-center gap-1.5 rounded-sm px-2.5 text-label touch-manipulation select-none transition-[background-color,color] duration-micro ease-out-subtle hover:duration-instant',
                isActive
                  ? 'bg-fill-selected font-medium text-foreground'
                  : 'text-secondary hover:bg-fill-hover hover:text-foreground',
              )}
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              <span className={cn('size-4 shrink-0 [&_svg]:size-4', isActive ? 'text-foreground' : 'text-tertiary')}>
                {tab.icon}
              </span>
              <span className="whitespace-nowrap">{tab.label}</span>
              {tab.badge != null && (
                <span
                  aria-hidden={false}
                  aria-label={`${tab.label}: ${tab.badge}`}
                  className="ml-0.5 text-label-sm text-tertiary tabular-nums"
                >
                  {tab.badge > 99 ? '99+' : tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div
        className="absolute bottom-0 left-0 h-0.5 w-[96px] rounded-full bg-accent-solid transition-transform duration-200 ease-out will-change-transform"
        style={{
          transform: `translateX(${indicatorStyle.translateX}px) scaleX(${indicatorStyle.width / 96})`,
          transformOrigin: 'left center',
        }}
      />

      <div className="pointer-events-none absolute bottom-0 left-0 top-0 w-4 bg-gradient-to-r from-navigator/95 to-transparent md:hidden" />
      <div className="pointer-events-none absolute bottom-0 right-0 top-0 w-4 bg-gradient-to-l from-navigator/95 to-transparent md:hidden" />
    </div>
  );
};

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  isOpen = true,
  onClose,
  isModal = false,
}) => {
  const { setCurrentView } = useAppStore(useShallow((state) => ({
    language: state.language,
    setCurrentView: state.setCurrentView,
  })));
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  const t = useT('app');
  const backendAvailable = useBackendAvailability();

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      setCurrentView('repositories');
    }
  };

  const handleTabChange = useCallback((tabId: SettingsTab) => {
    if (tabId === activeTab) return;
    setActiveTab(tabId);
    if (!isModal) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [activeTab, isModal]);

  const VALID_TABS: ReadonlySet<string> = useMemo(
    () => new Set(['general', 'appearance', 'starSync', 'ai', 'webdav', 'backup', 'backend', 'category', 'menu', 'data', 'logs', 'network', 'vectorSearch', 'mcp', 'plugins']),
    [],
  );

  useEffect(() => {
    const stored = sessionStorage.getItem('gsm:pending-settings-tab');
    if (stored && VALID_TABS.has(stored)) {
      sessionStorage.removeItem('gsm:pending-settings-tab');
      setActiveTab(stored as SettingsTab);
    } else if (stored) {
      sessionStorage.removeItem('gsm:pending-settings-tab');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onNavigate = (e: Event) => {
      const tab = (e as CustomEvent<{ tab: SettingsTab }>).detail?.tab;
      if (!tab || !VALID_TABS.has(tab)) return;
      handleTabChange(tab);
    };
    window.addEventListener('gsm:navigate-to-settings-tab', onNavigate);
    return () => window.removeEventListener('gsm:navigate-to-settings-tab', onNavigate);
  }, [handleTabChange, VALID_TABS]);

  const { unindexedRepoCount } = useVectorSearchActions();

  const tabs: SettingsTabItem[] = [
    {
      id: 'general',
      section: 'app',
      label: t('settingsPanel.general'),
      icon: <Globe className="size-4" strokeWidth={1.75} />,
    },
    {
      id: 'appearance',
      section: 'app',
      label: t('settingsPanel.appearance'),
      icon: <Palette className="size-4" strokeWidth={1.75} />,
    },
    {
      id: 'starSync',
      section: 'app',
      label: t('settingsPanel.star-sync'),
      icon: <Star className="size-4" strokeWidth={1.75} />,
    },
    {
      id: 'ai',
      section: 'ai-data',
      label: t('settingsPanel.ai-config'),
      icon: <Bot className="size-4" strokeWidth={1.75} />,
    },
    {
      id: 'webdav',
      section: 'ai-data',
      label: t('settingsPanel.webdav'),
      icon: <Cloud className="size-4" strokeWidth={1.75} />,
    },
    {
      id: 'backup',
      section: 'ai-data',
      label: t('settingsPanel.backup'),
      icon: <Database className="size-4" strokeWidth={1.75} />,
    },
    {
      id: 'backend',
      section: 'ai-data',
      label: t('settingsPanel.backend'),
      icon: <Server className="size-4" strokeWidth={1.75} />,
    },
    {
      id: 'category',
      section: 'ai-data',
      label: t('settingsPanel.categories'),
      icon: <Package className="size-4" strokeWidth={1.75} />,
    },
    {
      id: 'menu',
      section: 'ai-data',
      label: t('settingsPanel.menu'),
      icon: <Layout className="size-4" strokeWidth={1.75} />,
    },
    {
      id: 'data',
      section: 'ai-data',
      label: t('settingsPanel.data-management'),
      icon: <Trash2 className="size-4" strokeWidth={1.75} />,
    },
    {
      id: 'logs',
      section: 'connection',
      label: t('settingsPanel.diagnostic-logs'),
      icon: <ScrollText className="size-4" strokeWidth={1.75} />,
    },
    ...((isElectron() || backendAvailable) ? [{
      id: 'network' as SettingsTab,
      section: 'connection' as const,
      label: t('settingsPanel.network'),
      icon: <Wifi className="size-4" strokeWidth={1.75} />,
    }] : []),
    ...(isElectron() ? [{
      id: 'plugins' as SettingsTab,
      section: 'connection' as const,
      label: t('settingsPanel.plugins'),
      icon: <Plug className="size-4" strokeWidth={1.75} />,
    }] : []),
    {
      id: 'vectorSearch' as SettingsTab,
      section: 'connection' as const,
      label: t('settingsPanel.vector-search'),
      icon: <Search className="size-4" strokeWidth={1.75} />,
      badge: unindexedRepoCount > 0 ? unindexedRepoCount : undefined,
    },
    ...((isElectron() || backendAvailable) ? [{
      id: 'mcp' as SettingsTab,
      section: 'connection' as const,
      label: t('settingsPanel.mcp-server'),
      icon: <Cable className="size-4" strokeWidth={1.75} />,
    }] : []),
  ];

  const activeTabItem = tabs.find((tab) => tab.id === activeTab);

  const sidebarSections = (
    [
      { id: 'app', label: t('settingsPanel.section-app') },
      { id: 'ai-data', label: t('settingsPanel.section-ai-data') },
      { id: 'connection', label: t('settingsPanel.section-connection') },
    ] as const
  )
    .map((section) => ({
      ...section,
      items: tabs.filter((tab) => tab.section === section.id),
    }))
    .filter((section) => section.items.length > 0);

  const renderSidebarRows = () => (
    sidebarSections.map((section) => (
      <div key={section.id} className="app-side-section">
        <p
          className="app-section-label app-side-group-label text-label-sm font-medium text-tertiary select-none"
          aria-hidden="true"
        >
          {section.label}
        </p>
        <div className="app-side-list">
          {section.items.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabChange(tab.id)}
                role="tab"
                id={`settings-tab-${tab.id}`}
                aria-selected={isActive}
                aria-controls={`settings-tabpanel-${tab.id}`}
                className={cn(
                  'app-side-item flex h-row-sidebar min-h-row-sidebar w-full items-center justify-between gap-2 rounded-sm px-2 text-left text-label select-none -outline-offset-2 transition-[background-color,color] duration-micro ease-out-subtle hover:duration-instant',
                  isActive
                    ? 'bg-fill-selected font-medium text-foreground'
                    : 'font-normal text-secondary hover:bg-fill-hover hover:text-foreground',
                )}
              >
                <span className="app-side-item-label min-w-0 flex-1">
                  <span className={cn('flex size-4 shrink-0 items-center justify-center [&_svg]:size-4', isActive ? 'text-foreground' : 'text-tertiary')}>
                    {tab.icon}
                  </span>
                  <span className="truncate">{tab.label}</span>
                </span>
                {tab.badge != null && (
                  <span
                    aria-label={`${tab.label}: ${tab.badge}`}
                    className={cn(
                      'app-side-count ml-auto shrink-0 text-label-sm tabular-nums',
                      isActive ? 'font-medium text-foreground' : 'font-normal text-tertiary',
                    )}
                  >
                    {tab.badge > 99 ? '99+' : tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    ))
  );

  const renderTabContent = () => {
    const content = (() => {
      switch (activeTab) {
        case 'general':
          return <GeneralPanel t={t} />;
        case 'appearance':
          return <AppearancePanel t={t} />;
        case 'starSync':
          return <StarSyncPanel t={t} />;
        case 'ai':
          return <AIConfigPanel t={t} />;
        case 'webdav':
          return <WebDAVPanel t={t} />;
        case 'backup':
          return <BackupPanel t={t} />;
        case 'backend':
          return <BackendPanel t={t} />;
        case 'category':
          return <CategoryPanel t={t} />;
        case 'menu':
          return <MenuManagementPanel t={t} />;
        case 'data':
          return <DataManagementPanel t={t} />;
        case 'logs':
          return <DiagnosticLogsPanel t={t} />;
        case 'network':
          return <NetworkPanel t={t} />;
        case 'vectorSearch':
          return <VectorSearchSettings t={t} />;
        case 'mcp':
          return <McpSettingsPanel t={t} />;
        case 'plugins':
          return <PluginSettingsPanel t={t} />;
        default:
          return null;
      }
    })();

    return (
      <div
        key={activeTab}
        role="tabpanel"
        id={`settings-tabpanel-${activeTab}`}
        aria-label={activeTabItem?.label ?? t('settingsPanel.settings-content')}
        data-settings-sections
        className="motion-safe:animate-tab-fade"
      >
        {content}
      </div>
    );
  };

  if (!isOpen && !isModal) return null;

  if (isModal) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent
          showClose={false}
          aria-labelledby="settings-modal-title"
          aria-describedby={undefined}
          className="h-[85vh] max-w-5xl overflow-hidden bg-paper p-0"
        >
          <div className="flex h-full min-h-0 flex-col md:flex-row">
            <div className="hidden w-(--app-sidebar-width) shrink-0 flex-col border-r border-subtle bg-navigator md:flex">
              <div className="context-sidebar-head h-12 shrink-0 justify-start gap-2 px-4">
                <Settings className="size-4 text-tertiary" strokeWidth={1.75} />
                <DialogTitle id="settings-modal-title" className="app-side-title">
                  {t('settingsPanel.settings')}
                </DialogTitle>
              </div>
              <nav
                className="context-sidebar-body"
                role="tablist"
                aria-label={t('settingsPanel.settings-tabs')}
              >
                {renderSidebarRows()}
              </nav>
            </div>

            <div className="md:hidden">
              <div className="flex h-12 items-center justify-between border-b border-subtle bg-navigator px-4">
                <div className="flex items-center gap-2">
                  <Settings className="size-4 text-tertiary" strokeWidth={1.75} />
                  <span className="text-label-lg font-semibold text-foreground">
                    {t('settingsPanel.settings')}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={handleClose}
                  aria-label={t('settingsPanel.close-settings')}
                >
                  <X className="size-4 text-secondary" />
                </Button>
              </div>
              <MobileTabNav tabs={tabs} activeTab={activeTab} onTabChange={handleTabChange} />
            </div>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-paper">
              <div className="hidden h-12 shrink-0 items-center justify-between border-b border-subtle px-6 md:flex">
                <h2 className="truncate text-label-lg font-semibold text-foreground">
                  {activeTabItem?.label ?? t('settingsPanel.settings')}
                </h2>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={handleClose}
                  aria-label={t('settingsPanel.close-settings')}
                >
                  <X className="size-4 text-secondary" />
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-6">
                <div className="mx-auto max-w-3xl">{renderTabContent()}</div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <div className="w-full">
      <div className="route-workspace">
        <aside
          data-context-sidebar="settings"
          aria-label={t('settingsPanel.settings')}
          className="context-sidebar hidden w-(--app-sidebar-width) flex-shrink-0 bg-navigator lg:flex"
        >
          <div className="context-sidebar-head h-12 px-4">
            <h2 className="app-side-title">{t('settingsPanel.settings')}</h2>
          </div>
          <ContextSidebarBody
            as="nav"
            role="tablist"
            aria-label={t('settingsPanel.settings-tabs')}
          >
            {renderSidebarRows()}
          </ContextSidebarBody>
        </aside>

        <div className="lg:hidden">
          <MobileTabNav
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={handleTabChange}
          />
        </div>

        <div className="min-w-0 flex-1 bg-paper min-h-[calc(100dvh-var(--app-header-offset))]">
          <header className="flex h-12 items-center border-b border-subtle px-5 sm:px-6">
            <h1 className="truncate text-label-lg font-semibold text-foreground">
              {activeTabItem?.label ?? t('settingsPanel.settings')}
            </h1>
          </header>
          <div className="px-5 py-6 sm:px-6">
            <div className="mx-auto max-w-3xl">
              {renderTabContent()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
