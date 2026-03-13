import React, { useState, useRef, useEffect } from 'react';
import { Star, Settings, Calendar, Search, Moon, Sun, LogOut, RefreshCw, Shield, ChevronDown } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { backend } from '../services/backendAdapter';

export const Header: React.FC = () => {
  const {
    user,
    theme,
    currentView,
    isLoading,
    lastSync,
    repositories,
    setTheme,
    setCurrentView,
    setLoading,
    setLastSync,
    logout,
    language,
    backendUser,
  } = useAppStore();

  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSync = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/sync/stars', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...backend.getAuthHeaders(),
        },
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Sync failed');
      }

      const result = await response.json();
      
      setLastSync(new Date().toISOString());
      await backend.syncSettings({ lastSync: new Date().toISOString() });
      
      console.log('Sync completed:', result);
      
      if (result.added > 0) {
        alert(`同步完成！发现 ${result.added} 个新仓库，${result.removed} 个仓库被移除。`);
      } else if (result.removed > 0) {
        alert(`同步完成！${result.removed} 个仓库被移除。`);
      } else {
        alert('同步完成！所有仓库都是最新的。');
      }
      
      window.location.reload();
    } catch (error) {
      console.error('Sync failed:', error);
      if (error instanceof Error && error.message.includes('token')) {
        alert('GitHub token 已过期或无效，请重新登录。');
        logout();
      } else {
        alert('同步失败，请检查网络连接。');
      }
    } finally {
      setLoading(false);
    }
  };

  const formatLastSync = (timestamp: string | null) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    
    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  const handleSettingsClick = () => {
    setCurrentView('settings');
    setShowUserMenu(false);
  };

  const handleLogoutClick = () => {
    setShowUserMenu(false);
    logout();
  };

  return (
    <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-50 hd-drag">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo and Title */}
          <div className="flex items-center space-x-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg overflow-hidden">
              <img 
                src="./icon.png" 
                alt="GitHub Stars Manager" 
                className="w-10 h-10 object-cover"
              />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                GitHub Stars Manager
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                AI-powered repository management
              </p>
            </div>
          </div>

          {/* Navigation */}
          <nav className="hidden md:flex items-center space-x-1 hd-btns">
            <button
              onClick={() => setCurrentView('repositories')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                currentView === 'repositories'
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              <Search className="w-4 h-4 inline mr-2" />
              {t('仓库', 'Repositories')} ({repositories.length})
            </button>
            <button
              onClick={() => setCurrentView('releases')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                currentView === 'releases'
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              <Calendar className="w-4 h-4 inline mr-2" />
              {t('发布', 'Releases')}
            </button>
            {backendUser?.role === 'SuperAdmin' && (
              <button
                onClick={() => setCurrentView('admin')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  currentView === 'admin'
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <Shield className="w-4 h-4 inline mr-2" />
                {t('用户', 'Users')}
              </button>
            )}
          </nav>

          {/* User Actions */}
          <div className="flex items-center space-x-3 hd-btns">
            {/* Sync Status */}
            <div className="hidden sm:flex items-center space-x-2 text-sm text-gray-500 dark:text-gray-400">
              <span>{t('上次同步:', 'Last sync:')} {formatLastSync(lastSync)}</span>
              <button
                onClick={handleSync}
                disabled={isLoading}
                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                title={t('同步仓库', 'Sync repositories')}
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Theme Toggle */}
            <button
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title={t('切换主题', 'Toggle theme')}
            >
              {theme === 'light' ? (
                <Moon className="w-5 h-5 text-gray-700 dark:text-gray-300" />
              ) : (
                <Sun className="w-5 h-5 text-gray-700 dark:text-gray-300" />
              )}
            </button>

            {/* User Profile with Dropdown */}
            {(user || backendUser) && (
              <div 
                className="relative"
                ref={userMenuRef}
                onMouseEnter={() => setShowUserMenu(true)}
                onMouseLeave={() => setShowUserMenu(false)}
              >
                <button 
                  className="flex items-center space-x-2 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                  onClick={() => setShowUserMenu(!showUserMenu)}
                >
                  {user?.avatar_url ? (
                    <img
                      src={user.avatar_url}
                      alt={user.name || user.login}
                      className="w-8 h-8 rounded-full"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
                      <span className="text-white text-sm font-medium">
                        {(backendUser?.username || 'U').charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div className="hidden sm:block text-left">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {user?.name || user?.login || backendUser?.username || 'User'}
                    </p>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
                </button>

                {/* Dropdown Menu */}
                {showUserMenu && (
                  <div className="absolute right-0 mt-1 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50">
                    <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {user?.name || user?.login || backendUser?.username || 'User'}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {user?.login || backendUser?.username || ''}
                      </p>
                    </div>
                    
                    <button
                      onClick={handleSettingsClick}
                      className="w-full flex items-center space-x-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      <Settings className="w-4 h-4" />
                      <span>{t('设置', 'Settings')}</span>
                    </button>
                    
                    <div className="border-t border-gray-100 dark:border-gray-700 my-1"></div>
                    
                    <button
                      onClick={handleLogoutClick}
                      className="w-full flex items-center space-x-3 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>{t('退出登录', 'Logout')}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
