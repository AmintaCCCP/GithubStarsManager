
import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { createGitHubApiService } from '../../../services/githubApiFactory';
import { useAppStore } from '../../../store/useAppStore';
import type { Repository } from '../../../types';

export interface PluginPageRepositoryContext {
  readme: string | null;
}

/**
 * 弹窗动作（V1.4 opensPage）打开时抓取仓库 README，随 plugin-page:init 一次性
 * 下发给插件页面。抓取失败返回 null，插件必须能只依赖元数据工作。
 */
export function usePluginPageReadme(repository: Repository): PluginPageRepositoryContext {
  const githubToken = useAppStore(useShallow((state) => state.githubToken));
  const [readme, setReadme] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    setReadme(null);
    try {
      const api = createGitHubApiService(githubToken ?? '');
      void api.getRepositoryReadme(repository.owner.login, repository.name, controller.signal)
        .then((content) => { if (!disposed) setReadme(content); })
        .catch(() => { if (!disposed) setReadme(null); });
    } catch {
      if (!disposed) setReadme(null);
    }
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [githubToken, repository.id, repository.owner.login, repository.name]);

  return { readme };
}
