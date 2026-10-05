import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../store/useAppStore';
import { resolvePluginAccountTag } from '../../../plugins/pluginAccountTag';

/**
 * 当前 GitHub 身份的账号标签（null 表示尚未解析完成）。
 *
 * 弹窗在标签就绪前不渲染插件页面：页面首帧的 `plugin-page:init` 就能拿到
 * 账号标签，从而在绘制任何本地缓存之前完成账号校验（缓存按账号隔离）。
 */
export function usePluginAccountTag(): string | null {
  const githubToken = useAppStore(useShallow((state) => state.githubToken));
  const [tag, setTag] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    setTag(null);
    void resolvePluginAccountTag(githubToken ?? null).then((value) => {
      if (!disposed) setTag(value);
    });
    return () => { disposed = true; };
  }, [githubToken]);

  return tag;
}
