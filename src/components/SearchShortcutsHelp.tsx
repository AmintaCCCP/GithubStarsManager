import React, { useState } from 'react';
import { Keyboard, X, HelpCircle } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { searchShortcuts } from '../hooks/useSearchShortcuts';

export const SearchShortcutsHelp: React.FC = () => {
  const [showHelp, setShowHelp] = useState(false);
  const { language } = useAppStore();

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  if (!showHelp) {
    return (
      <button
        onClick={() => setShowHelp(true)}
        className="flex items-center space-x-1 px-2 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors rounded"
        title={t('查看搜索快捷键', 'View search shortcuts')}
      >
        <Keyboard className="w-3 h-3" />
        <span>{t('快捷键', 'Shortcuts')}</span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 max-w-md w-full mx-4 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <Keyboard className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {t('搜索快捷键', 'Search Shortcuts')}
            </h3>
          </div>
          <button
            onClick={() => setShowHelp(false)}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          {searchShortcuts.map((shortcut, index) => (
            <div key={index} className="flex items-center justify-between py-2 px-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div className="flex items-center space-x-3">
                <kbd className="px-2 py-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-xs font-mono text-gray-700 dark:text-gray-300">
                  {shortcut.key}
                </kbd>
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {language === 'zh' ? shortcut.description : shortcut.descriptionEn}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-start space-x-2 text-sm text-gray-600 dark:text-gray-400">
            <HelpCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div>
              <p className="mb-1">
                {t('提示:', 'Tips:')}
              </p>
              <ul className="space-y-1 text-xs">
                <li>• {t('快捷键在任何页面都可使用', 'Shortcuts work on any page')}</li>
                <li>• {t('在输入框中按 Escape 清除搜索', 'Press Escape in input to clear search')}</li>
                <li>• {t('使用 / 键快速开始搜索', 'Use / key to quickly start searching')}</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={() => setShowHelp(false)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            {t('知道了', 'Got it')}
          </button>
        </div>
      </div>
    </div>
  );
};