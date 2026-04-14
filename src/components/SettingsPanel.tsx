import React, { useState } from 'react';
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

interface SettingsPanelProps {
  isOpen?: boolean;
  onClose?: () => void;
  isModal?: boolean;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ 
  isOpen = true, 
  onClose,
  isModal = false 
}) => {
  const { language, setCurrentView } = useAppStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  const t = (zh: string, en: string) => (language === 'zh' ? zh : en);

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      setCurrentView('repositories');
    }
  };

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
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
    switch (activeTab) {
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

          <div className="flex flex-1 overflow-hidden">
            {/* 侧边栏 - 桌面端 */}
            <div className="hidden md:block w-64 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 overflow-y-auto">
              <nav className="p-4 space-y-1">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
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
            <div className="md:hidden w-full border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 overflow-x-auto">
              <nav className="flex p-2 space-x-1">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex-shrink-0 flex items-center space-x-2 px-3 py-2 rounded-lg transition-colors ${
                      activeTab === tab.id
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    {tab.icon}
                    <span className="font-medium text-sm">{tab.label}</span>
                  </button>
                ))}
              </nav>
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
        {/* 侧边栏 */}
        <div className="w-full lg:w-64 flex-shrink-0">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <nav className="p-2 space-y-1">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors text-left ${
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

        {/* 内容区域 */}
        <div className="flex-1">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            {renderTabContent()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
