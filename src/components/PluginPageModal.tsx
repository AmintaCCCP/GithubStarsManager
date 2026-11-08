
import { TranslateFn } from '../i18n/useT';
import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/useAppStore';
import { resolveTheme } from '../store/selectors';
import { usePluginPageReadme } from '../features/plugins/hooks/usePluginPageReadme';
import { Modal } from './Modal';
import { PluginPageViewer } from './PluginPageViewer';
import type { Repository } from '../types';

/**
 * 弹窗动作下发的仓库上下文。字段对齐主进程 `sanitizeRepository` 的白名单，
 * 另加卡片生成需要的两段文本摘要；不包含分析错误、索引时间戳、头像地址等
 * 宿主内部字段。
 */
function repositoryContext(repository: Repository): Record<string, unknown> {
  return {
    id: repository.id,
    name: repository.name,
    full_name: repository.full_name,
    description: repository.description,
    html_url: repository.html_url,
    stargazers_count: repository.stargazers_count,
    forks_count: repository.forks_count,
    language: repository.language,
    created_at: repository.created_at,
    updated_at: repository.updated_at,
    pushed_at: repository.pushed_at,
    owner: { login: repository.owner.login },
    topics: repository.topics,
    license: repository.license ?? null,
    archived: repository.archived ?? null,
    disabled: repository.disabled ?? null,
    fork: repository.fork ?? null,
    is_template: repository.is_template ?? null,
    open_issues_count: repository.open_issues_count ?? null,
    default_branch: repository.default_branch ?? null,
    custom_description: repository.custom_description ?? null,
    ai_summary: repository.ai_summary ?? null,
  };
}

interface PluginPageModalProps {
  pluginId: string;
  pluginName: string;
  pageId: string;
  pageTitle: string;
  repository: Repository;
  /** V1.6：popup 用非全屏小弹窗承载页面；fullscreen（缺省）行为与既有插件一致。 */
  display?: 'fullscreen' | 'popup';
  onClose: () => void;
  t: TranslateFn;
}

/**
 * V1.4 弹窗动作（opensPage）的宿主容器：把插件页面装进弹窗，并随
 * plugin-page:init 一次性下发所点击仓库的元数据与 README 正文。上下文由
 * 宿主主动提供，不经过能力桥；页面访问宿主能力仍只能走受权限约束的桥方法。
 * V1.6 起 manifest 可用 `display: "popup"` 声明非全屏小弹窗，供轻量页面
 * （如自定义信息字段）使用；未声明的动作保持全屏弹窗不变。
 */
export const PluginPageModal: React.FC<PluginPageModalProps> = ({
  pluginId, pluginName, pageId, pageTitle, repository, display = 'fullscreen', onClose, t,
}) => {
  const language = useAppStore(useShallow((state) => state.language));
  const theme = useAppStore((state) => resolveTheme(state.themeMode, state.systemTheme));
  const popup = display === 'popup';
  // popup 形态不抓取 README：轻量页面用不到，省一次 GitHub 请求。
  const { readme } = usePluginPageReadme(popup ? null : repository);

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`${pluginName} · ${pageTitle}`}
      fullscreen={!popup}
      scrollable={!popup}
      // popup：固定高度的小弹窗，比默认的 max-w-md 更宽以容纳字段表单；弹窗本身
      // 不滚动，交给页面 iframe 自己滚。
      maxWidth={popup ? 'max-w-2xl' : undefined}
      dialogClassName={popup ? 'overflow-hidden' : undefined}
      contentClassName={popup ? 'flex h-[min(72vh,640px)] flex-col' : 'flex flex-col'}
      closeLabel={t('pluginPageViewer.close')}
    >
      <PluginPageViewer
        variant="modal"
        pluginId={pluginId}
        pluginName={pluginName}
        pageId={pageId}
        pageTitle={pageTitle}
        onClose={onClose}
        t={t}
        // popup 面向轻量表单页，README 上下文没有意义：不抓取也不下发，避免
        // 每次点开都产生一次 GitHub 请求与一次 init 重发。
        initContext={popup
          ? { repository: repositoryContext(repository), language, theme }
          : { repository: repositoryContext(repository), readme, language, theme }}
      />
    </Modal>
  );
};

export default PluginPageModal;
