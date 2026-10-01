
import { TranslateFn } from '../i18n/useT';
import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/useAppStore';
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
  onClose: () => void;
  t: TranslateFn;
}

/**
 * V1.4 弹窗动作（opensPage）的宿主容器：把插件页面装进弹窗，并随
 * plugin-page:init 一次性下发所点击仓库的元数据与 README 正文。上下文由
 * 宿主主动提供，不经过能力桥；页面访问宿主能力仍只能走受权限约束的桥方法。
 */
export const PluginPageModal: React.FC<PluginPageModalProps> = ({
  pluginId, pluginName, pageId, pageTitle, repository, onClose, t,
}) => {
  const language = useAppStore(useShallow((state) => state.language));
  const { readme } = usePluginPageReadme(repository);

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`${pluginName} · ${pageTitle}`}
      maxWidth="h-[calc(100vh_-_2rem)] max-h-[calc(100vh_-_2rem)] w-[calc(100vw_-_2rem)] max-w-none"
      scrollable
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
        initContext={{ repository: repositoryContext(repository), readme, language }}
      />
    </Modal>
  );
};

export default PluginPageModal;
