import React from 'react';
import { Globe, Package, Mail, ExternalLink, Github, Twitter } from 'lucide-react';
import { UpdateChecker } from '../UpdateChecker';
import { useAppStore } from '../../store/useAppStore';

interface GeneralPanelProps {
  t: (zh: string, en: string) => string;
}

export const GeneralPanel: React.FC<GeneralPanelProps> = ({ t }) => {
  const { language, setLanguage } = useAppStore();

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Package className="w-6 h-6 text-green-600 dark:text-green-400" />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          {t('通用设置', 'General Settings')}
        </h3>
      </div>

      <div className="p-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="flex items-center space-x-3 mb-4">
          <Globe className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <h4 className="font-medium text-gray-900 dark:text-white">
            {t('语言设置', 'Language Settings')}
          </h4>
        </div>
        
        <div className="flex items-center space-x-6">
          <label className="flex items-center space-x-3 cursor-pointer p-3 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
            <input
              type="radio"
              name="language"
              value="zh"
              checked={language === 'zh'}
              onChange={(e) => setLanguage(e.target.value as 'zh' | 'en')}
              className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
            />
            <div>
              <span className="text-base font-medium text-gray-900 dark:text-white">
                中文
              </span>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Simplified Chinese
              </p>
            </div>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer p-3 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
            <input
              type="radio"
              name="language"
              value="en"
              checked={language === 'en'}
              onChange={(e) => setLanguage(e.target.value as 'zh' | 'en')}
              className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
            />
            <div>
              <span className="text-base font-medium text-gray-900 dark:text-white">
                English
              </span>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                US English
              </p>
            </div>
          </label>
        </div>
      </div>

      <div className="p-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="flex items-center space-x-3 mb-4">
          <Package className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          <h4 className="font-medium text-gray-900 dark:text-white">
            {t('检查更新', 'Check for Updates')}
          </h4>
        </div>
        
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
              {t('当前版本: v0.3.0', 'Current Version: v0.3.0')}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-500">
              {t('检查是否有新版本可用', 'Check if a new version is available')}
            </p>
          </div>
          <UpdateChecker />
        </div>
      </div>

      <div className="p-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="flex items-center space-x-3 mb-4">
          <Mail className="w-5 h-5 text-green-600 dark:text-green-400" />
          <h4 className="font-medium text-gray-900 dark:text-white">
            {t('联系方式', 'Contact Information')}
          </h4>
        </div>
        
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          {t('如果您在使用过程中遇到任何问题或有建议，欢迎通过以下方式联系我：', 'If you encounter any issues or have suggestions while using the app, feel free to contact me through:')}
        </p>
        
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => window.open('https://x.com/GoodMan_Lee', '_blank')}
            className="flex items-center justify-center space-x-2 px-4 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
          >
            <Twitter className="w-5 h-5" />
            <span>Twitter</span>
            <ExternalLink className="w-4 h-4" />
          </button>
          
          <button
            onClick={() => window.open('https://github.com/AmintaCCCP/GithubStarsManager', '_blank')}
            className="flex items-center justify-center space-x-2 px-4 py-3 bg-gray-800 hover:bg-gray-900 text-white rounded-lg transition-colors"
          >
            <Github className="w-5 h-5" />
            <span>GitHub</span>
            <ExternalLink className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
