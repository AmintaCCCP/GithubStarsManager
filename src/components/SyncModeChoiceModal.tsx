import React, { useEffect, useRef, useId } from 'react';
import { Star, ListChecks } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * 首次登录 / 首次使用 GitHub Lists 同步时，选择同步范围。
 * 必须渲染在已认证的组件树内（例如 App 的已登录 shell），
 * 不能在 LoginScreen 里触发——因为 setUser 后 LoginScreen 会被卸载，弹窗无法显示。
 *
 * 该弹窗是阻塞式（blocking）模态：必须完成选择，不可关闭、不可点背景跳过。
 */
export const SyncModeChoiceModal: React.FC = () => {
  const language = useAppStore((state) => state.language);
  const syncModeConfigured = useAppStore((state) => state.syncModeConfigured);
  const setSyncMode = useAppStore((state) => state.setSyncMode);
  const setSyncModeConfigured = useAppStore((state) => state.setSyncModeConfigured);

  const dialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  const isOpen = !syncModeConfigured;

  // 打开时：记录先前焦点、锁定背景滚动、聚焦首个选项并捕获焦点（不允许 Tab 逃逸）；
  // 关闭/卸载时：恢复先前焦点与滚动。
  useEffect(() => {
    if (!isOpen) return;

    previousActiveElement.current = document.activeElement as HTMLElement;
    document.body.style.overflow = 'hidden';

    const getFocusable = (): HTMLElement[] => {
      const dialog = dialogRef.current;
      if (!dialog) return [];
      return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter(el => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');
    };

    // 初始聚焦到第一个可聚焦元素（首个同步模式选项）
    const first = getFocusable()[0];
    first?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const firstEl = focusable[0];
      const lastEl = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement;
      // Shift+Tab 在第一个元素上：跳到最后一个；Tab 在最后一个（或焦点已逃逸）时：回到第一个
      if (event.shiftKey && (active === firstEl || !dialogRef.current.contains(active))) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && (active === lastEl || !dialogRef.current.contains(active))) {
        event.preventDefault();
        firstEl.focus();
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      // 阻止焦点逃逸到背景控件
      if (dialogRef.current && !dialogRef.current.contains(event.target as Node)) {
        getFocusable()[0]?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('focusin', handleFocusIn, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('focusin', handleFocusIn, true);
      document.body.style.overflow = '';
      previousActiveElement.current?.focus();
    };
  }, [isOpen]);

  const handleChooseSyncMode = (mode: 'stars' | 'stars-and-lists') => {
    setSyncMode(mode);
    setSyncModeConfigured(true);
  };

  // 尚未配置过同步范围时弹出选择（结果持久化，可在设置中切换）
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-w-md w-full linear-login-card p-6 sm:p-7"
      >
        <h2 id={titleId} className="text-xl font-semibold text-gray-900 dark:text-text-primary mb-2">
          {t('选择同步范围', 'Choose sync scope')}
        </h2>
        <p className="text-sm text-gray-700 dark:text-text-tertiary mb-5">
          {t('您希望同步哪些数据？此选择可在设置中随时切换。', 'What should be synced? You can change this anytime in Settings.')}
        </p>
        <div className="space-y-3">
          <button
            onClick={() => handleChooseSyncMode('stars')}
            className="w-full flex items-start gap-3 p-4 rounded-xl border border-black/[0.06] dark:border-white/[0.04] bg-white dark:bg-white/[0.04] text-left hover:border-brand-violet/40 transition-colors"
          >
            <Star className="w-5 h-5 text-brand-violet mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-gray-900 dark:text-text-primary">{t('仅同步星标仓库', 'Starred repos only')}</p>
              <p className="text-xs text-gray-700 dark:text-text-tertiary mt-1">
                {t('同步你的全部星标仓库（默认，与以前行为一致）。', 'Sync all your starred repositories (default, same as before).')}
              </p>
            </div>
          </button>
          <button
            onClick={() => handleChooseSyncMode('stars-and-lists')}
            className="w-full flex items-start gap-3 p-4 rounded-xl border border-black/[0.06] dark:border-white/[0.04] bg-white dark:bg-white/[0.04] text-left hover:border-brand-violet/40 transition-colors"
          >
            <ListChecks className="w-5 h-5 text-brand-violet mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-gray-900 dark:text-text-primary">{t('同步星标仓库及 list', 'Starred repos & lists')}</p>
              <p className="text-xs text-gray-700 dark:text-text-tertiary mt-1">
                {t('除星标仓库外，还将拉取你的 Lists（星标列表）并按标签归类；未锁定分类的仓库会被自动锁定。', 'Also fetch your Lists and categorize by tags; unlocked repos will be auto-locked.')}
              </p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

export default SyncModeChoiceModal;