import React from 'react';
import { Globe, Package, Mail, ExternalLink, Github, Twitter } from 'lucide-react';
import { UpdateChecker } from '../UpdateChecker';
import { useAppStore } from '../../store/useAppStore';
import { version } from '../../../package.json';
import { PROJECT_REPO_URL } from '../../constants/project';

interface GeneralPanelProps {
  t: (zh: string, en: string) => string;
}

export const GeneralPanel: React.FC<GeneralPanelProps> = ({ t }) => {
  const { language, setLanguage } = useAppStore();

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Package className="w-6 h-6 text-status-emerald " />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-text-primary">
          {t('通用设置', 'General Settings')}
        </h3>
      </div>

      <div className="p-6 bg-white dark:bg-panel-dark rounded-xl border border-black/[0.06] dark:border-white/[0.04]">
        <div className="flex items-center space-x-3 mb-4">
          <Globe className="w-5 h-5 text-brand-violet dark:text-brand-violet" />
          <h4 className="font-medium text-gray-900 dark:text-text-primary">
            {t('语言设置', 'Language Settings')}
          </h4>
        </div>
        
        <div className="grid grid-cols-2 gap-4 max-w-md">
          <label className="flex items-center space-x-3 cursor-pointer p-3 rounded-lg border border-black/[0.06] dark:border-white/[0.04] hover:bg-light-bg dark:hover:bg-white/10 transition-colors">
            <input
              type="radio"
              name="language"
              value="zh"
              checked={language === 'zh'}
              onChange={(e) => setLanguage(e.target.value as 'zh' | 'en')}
              className="w-4 h-4 text-brand-violet bg-light-surfaceborder-black/[0.06] focus:ring-brand-violet dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-white/[0.04] dark:border-white/[0.04]"
            />
            <div>
              <span className="text-base font-medium text-gray-900 dark:text-text-primary">
                中文
              </span>
              <p className="text-xs text-gray-500 dark:text-text-tertiary">
                Simplified Chinese
              </p>
            </div>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer p-3 rounded-lg border border-black/[0.06] dark:border-white/[0.04] hover:bg-light-bg dark:hover:bg-white/10 transition-colors">
            <input
              type="radio"
              name="language"
              value="en"
              checked={language === 'en'}
              onChange={(e) => setLanguage(e.target.value as 'zh' | 'en')}
              className="w-4 h-4 text-brand-violet bg-light-surfaceborder-black/[0.06] focus:ring-brand-violet dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-white/[0.04] dark:border-white/[0.04]"
            />
            <div>
              <span className="text-base font-medium text-gray-900 dark:text-text-primary">
                English
              </span>
              <p className="text-xs text-gray-500 dark:text-text-tertiary">
                US English
              </p>
            </div>
          </label>
        </div>
      </div>

      <div className="p-6 bg-white dark:bg-panel-dark rounded-xl border border-black/[0.06] dark:border-white/[0.04]">
        <div className="flex items-center space-x-3 mb-4">
          <Package className="w-5 h-5 text-gray-700 dark:text-text-secondary " />
          <h4 className="font-medium text-gray-900 dark:text-text-primary">
            {t('检查更新', 'Check for Updates')}
          </h4>
        </div>
        
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-700 dark:text-text-tertiary mb-1">
              {t(`当前版本: v${version}`, `Current Version: v${version}`)}
            </p>
            <p className="text-xs text-gray-500 dark:text-text-tertiary">
              {t('检查是否有新版本可用', 'Check if a new version is available')}
            </p>
          </div>
          <UpdateChecker />
        </div>
      </div>

      <div className="p-6 bg-white dark:bg-panel-dark rounded-xl border border-black/[0.06] dark:border-white/[0.04]">
        <div className="flex items-center space-x-3 mb-4">
          <Mail className="w-5 h-5 text-status-emerald " />
          <h4 className="font-medium text-gray-900 dark:text-text-primary">
            {t('联系方式', 'Contact Information')}
          </h4>
        </div>
        
        <p className="text-sm text-gray-700 dark:text-text-tertiary mb-4">
          {t('如果您在使用过程中遇到任何问题或有建议，欢迎通过以下方式联系我：', 'If you encounter any issues or have suggestions while using the app, feel free to contact me through:')}
        </p>
        
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => {
              const newWindow = window.open('https://x.com/GoodMan_Lee', '_blank', 'noopener,noreferrer');
              if (newWindow) {
                newWindow.opener = null;
              }
            }}
            className="flex items-center justify-center space-x-2 px-4 py-3 bg-brand-indigo hover:bg-brand-hover text-white rounded-lg transition-colors"
          >
            <Twitter className="w-5 h-5" />
            <span>Twitter</span>
            <ExternalLink className="w-4 h-4" />
          </button>
          
          <button
            onClick={() => {
              const newWindow = window.open(PROJECT_REPO_URL, '_blank', 'noopener,noreferrer');
              if (newWindow) {
                newWindow.opener = null;
              }
            }}
            className="flex items-center justify-center space-x-2 px-4 py-3 bg-light-surface hover:bg-gray-200 dark:bg-white/[0.04] dark:hover:bg-white/[0.08] text-gray-900 dark:text-text-primary border border-black/[0.06] dark:border-white/[0.04] rounded-lg transition-colors"
          >
            <Github className="w-5 h-5" />
            <span>{t('GitHub', 'GitHub')}</span>
            <ExternalLink className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
