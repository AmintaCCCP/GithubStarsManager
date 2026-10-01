
import { TranslateFn } from '../i18n/useT';
import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/useAppStore';
import { usePluginPageReadme } from '../features/plugins/hooks/usePluginPageReadme';
import { Modal } from './Modal';
import { PluginPageViewer } from './PluginPageViewer';
import type { Repository } from '../types';

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
    <Modal isOpen onClose={onClose} title={`${pluginName} · ${pageTitle}`} maxWidth="max-w-5xl" scrollable>
      <PluginPageViewer
        variant="modal"
        pluginId={pluginId}
        pluginName={pluginName}
        pageId={pageId}
        pageTitle={pageTitle}
        onClose={onClose}
        t={t}
        initContext={{ repository, readme, language }}
      />
    </Modal>
  );
};

export default PluginPageModal;
