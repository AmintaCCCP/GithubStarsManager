import React from 'react';
import { X, Download, Calendar, Package } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { UpdateService } from '../services/updateService';

export const UpdateNotificationBanner: React.FC = () => {
  const { updateNotification, dismissUpdateNotification, language } = useAppStore();

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  if (!updateNotification || updateNotification.dismissed) {
    return null;
  }

  const handleDownload = () => {
    UpdateService.openDownloadUrl(updateNotification.downloadUrl);
    dismissUpdateNotification();
  };

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US');
    } catch {
      return dateString;
    }
  };

  return (
    <div className="bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
              <Package className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1">
              <div className="flex items-center space-x-2">
                <h4 className="text-sm font-medium text-blue-900 dark:text-blue-100">
                  {t('发现新版本', 'New Version Available')} v{updateNotification.version}
                </h4>
                <div className="flex items-center space-x-1 text-xs text-blue-700 dark:text-blue-300">
                  <Calendar className="w-3 h-3" />
                  <span>{formatDate(updateNotification.releaseDate)}</span>
                </div>
              </div>
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                {updateNotification.changelog.slice(0, 2).join(' • ')}
                {updateNotification.changelog.length > 2 && '...'}
              </p>
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            <button
              onClick={handleDownload}
              className="flex items-center space-x-1 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-md hover:bg-blue-700 transition-colors"
            >
              <Download className="w-3 h-3" />
              <span>{t('立即下载', 'Download')}</span>
            </button>
            <button
              onClick={dismissUpdateNotification}
              className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-800 rounded-md transition-colors"
              title={t('关闭', 'Close')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};