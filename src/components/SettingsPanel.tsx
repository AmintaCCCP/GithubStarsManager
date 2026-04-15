import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Settings,
  Globe,
  Bot,
  Cloud,
  Database,
  Server,
  Package,
  X,
  Trash2,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import {
  GeneralPanel,
  AIConfigPanel,
  WebDAVPanel,
  BackupPanel,
  BackendPanel,
  CategoryPanel,
  DataManagementPanel,
} from './settings';

type SettingsTab = 'general' | 'ai' | 'webdav' | 'backup' | 'backend' | 'category' | 'data';

interface SettingsTabItem {
  id: SettingsTab;
  label: string;
  icon: React.ReactNode;
}

interface SettingsPanelProps {
  isOpen?: boolean;
  onClose?: () => void;
  isModal?: boolean;
}

// 移动端标签导航组件
interface MobileTabNavProps {
  tabs: SettingsTabItem[];
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}

const MobileTabNav: React.FC<MobileTabNavProps> = ({ tabs, activeTab, onTabChange }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Map<SettingsTab, HTMLButtonElement>>(new Map());
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });
  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  // 使用 requestAnimationFrame 更新指示器，避免闪烁
  const updateIndicator = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    
    rafRef.current = requestAnimationFrame(() => {
      const activeButton = tabRefs.current.get(activeTab);
      if (activeButton && scrollContainerRef.current) {
        // 使用 offsetLeft 代替 getBoundingClientRect，避免重排导致的闪烁
        const container = scrollContainerRef.current;
        const left = activeButton.offsetLeft - container.scrollLeft;
        const width = activeButton.offsetWidth;
        
        setIndicatorStyle({ left, width });
      }
    });
  }, [activeTab]);

  // 滚动到活动标签
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

  // 分离 useEffect：初始化和标签切换时更新指示器
  useEffect(() => {
    // 初始计算
    updateIndicator();
  }, [updateIndicator]);

  // 标签切换时先滚动再更新指示器
  useEffect(() => {
    scrollToActiveTab();
    // 延迟更新指示器，等待滚动完成
    const timer = setTimeout(() => {
      updateIndicator();
    }, 350);
    return () => clearTimeout(timer);
  }, [activeTab, scrollToActiveTab]);

  // 处理滚动状态 - 使用 ref 避免重新创建函数
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
    <div 
      className="relative w-full border-b border-gray-200 dark:border-gray-700 bg-gray-50/95 dark:bg-gray-800/95 backdrop-blur-sm"
    >
      {/* 滚动容器 */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        role="tablist"
        className="flex overflow-x-auto scrollbar-hide py-2 px-2 gap-1 snap-x snap-mandatory"
        style={{
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            ref={(el) => {
              if (el) tabRefs.current.set(tab.id, el);
            }}
            onClick={() => onTabChange(tab.id)}
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`tabpanel-${tab.id}`}
            className={`
              flex-shrink-0 flex items-center space-x-1.5 px-3 py-2 rounded-full 
              transition-all duration-200 ease-out snap-center
              min-h-[36px] touch-manipulation
              ${activeTab === tab.id
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700/50'
              }
            `}
            style={{
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <span className="w-4 h-4 flex-shrink-0">{tab.icon}</span>
            <span className="font-medium text-sm whitespace-nowrap">{tab.label}</span>
          </button>
        ))}
      </div>
      
      {/* 底部活动指示器 */}
      <div
        className="absolute bottom-0 h-0.5 bg-blue-600 dark:bg-blue-400 rounded-full transition-transform duration-300 ease-out will-change-transform"
        style={{
          left: indicatorStyle.left,
          width: indicatorStyle.width,
        }}
      />
      
      {/* 左右渐变遮罩 */}
      <div className="absolute left-0 top-0 bottom-0 w-4 bg-gradient-to-r from-gray-50 dark:from-gray-800 to-transparent pointer-events-none md:hidden" />
      <div className="absolute right-0 top-0 bottom-0 w-4 bg-gradient-to-l from-gray-50 dark:from-gray-800 to-transparent pointer-events-none md:hidden" />
    </div>
  );
};

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ 
  isOpen = true, 
  onClose,
  isModal = false 
}) => {
  const { language, setCurrentView } = useAppStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [displayTab, setDisplayTab] = useState<SettingsTab>('general');
  const [isTransitioning, setIsTransitioning] = useState(false);

  const t = (zh: string, en: string) => (language === 'zh' ? zh : en);

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      setCurrentView('repositories');
    }
  };

  // 处理标签切换，添加过渡动画
  // 动画顺序：1.淡出当前内容 2.切换标签 3.淡入新内容
  const handleTabChange = useCallback((tabId: SettingsTab) => {
    if (tabId === activeTab || isTransitioning) return;

    setIsTransitioning(true);

    // 等待淡出动画完成后再切换标签
    setTimeout(() => {
      setActiveTab(tabId);
      setDisplayTab(tabId);

      // 等待淡入动画完成后重置状态
      setTimeout(() => {
        setIsTransitioning(false);
      }, 100);
    }, 100);
  }, [activeTab, isTransitioning]);

  const tabs: SettingsTabItem[] = [
    {
      id: 'general',
      label: t('通用', 'General'),
      icon: <Globe className="w-5 h-5" />,
    },
    {
      id: 'ai',
      label: t('AI配置', 'AI Config'),
      icon: <Bot className="w-5 h-5" />,
    },
    {
      id: 'webdav',
      label: t('WebDAV', 'WebDAV'),
      icon: <Cloud className="w-5 h-5" />,
    },
    {
      id: 'backup',
      label: t('备份恢复', 'Backup'),
      icon: <Database className="w-5 h-5" />,
    },
    {
      id: 'backend',
      label: t('后端同步', 'Backend'),
      icon: <Server className="w-5 h-5" />,
    },
    {
      id: 'category',
      label: t('分类管理', 'Categories'),
      icon: <Package className="w-5 h-5" />,
    },
    {
      id: 'data',
      label: t('数据管理', 'Data Management'),
      icon: <Trash2 className="w-5 h-5" />,
    },
  ];

  const renderTabContent = () => {
    const content = (() => {
      switch (displayTab) {
        case 'general':
          return <GeneralPanel t={t} />;
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
        case 'data':
          return <DataManagementPanel t={t} />;
        default:
          return null;
      }
    })();

    return (
      <div
        role="tabpanel"
        id={`tabpanel-${displayTab}`}
        aria-labelledby={`tab-${displayTab}`}
        className={`
          transition-all duration-100 ease-out
          ${isTransitioning ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'}
        `}
      >
        {content}
      </div>
    );
  };

  if (!isOpen) return null;

  // 模态框模式
  if (isModal) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <div className="w-full max-w-5xl h-[85vh] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            <div className="flex items-center space-x-3">
              <Settings className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                {t('设置', 'Settings')}
              </h2>
            </div>
            <button
              onClick={handleClose}
              className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            </button>
          </div>

          <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
            {/* 侧边栏 - 桌面端 */}
            <div className="hidden md:block w-64 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 overflow-y-auto">
              <nav className="p-4 space-y-1" role="tablist">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => handleTabChange(tab.id)}
                    role="tab"
                    id={`tab-${tab.id}`}
                    aria-selected={activeTab === tab.id}
                    aria-controls={`tabpanel-${tab.id}`}
                    className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors text-left ${
                      activeTab === tab.id
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    {tab.icon}
                    <span className="font-medium">{tab.label}</span>
                  </button>
                ))}
              </nav>
            </div>

            {/* 移动端标签选择器 */}
            <div className="md:hidden">
              <MobileTabNav
                tabs={tabs}
                activeTab={activeTab}
                onTabChange={handleTabChange}
              />
            </div>

            {/* 内容区域 */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-3xl mx-auto">
                {renderTabContent()}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 独立页面模式（兼容原有代码）
  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center space-x-3 mb-6">
        <Settings className="w-6 h-6 text-blue-600 dark:text-blue-400" />
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
          {t('设置', 'Settings')}
        </h2>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* 桌面端侧边栏 */}
        <div className="hidden lg:block w-64 flex-shrink-0 lg:sticky lg:top-4 lg:self-start">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <nav className="p-2 space-y-1" role="tablist">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  role="tab"
                  id={`tab-${tab.id}`}
                  aria-selected={activeTab === tab.id}
                  aria-controls={`tabpanel-${tab.id}`}
                  className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-all duration-200 text-left ${
                    activeTab === tab.id
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  {tab.icon}
                  <span className="font-medium">{tab.label}</span>
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* 移动端标签导航 */}
        <div className="lg:hidden -mx-4 sm:-mx-6">
          <MobileTabNav
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={handleTabChange}
          />
        </div>

        {/* 内容区域 */}
        <div className="flex-1 min-w-0">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-6">
            {renderTabContent()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
