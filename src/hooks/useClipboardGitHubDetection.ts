import { useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/useAppStore';
import { parseGitHubClipboardTarget, type GitHubClipboardTarget } from '../utils/githubClipboard';

export interface ClipboardGitHubDetectionState {
  /** 当前识别到的目标；关闭开关或用户忽略后为 null。 */
  target: GitHubClipboardTarget | null;
  dismiss: () => void;
}

/**
 * 剪贴板 GitHub 链接识别（开发守则 §11）。
 *
 * 只用一条通道：窗口重新获得焦点（也就是用户主动切回应用）时读一次剪贴板。
 * 不做定时器、不做后台轮询、不保存剪贴板原文——解析结果以外的东西读完即丢。
 * 浏览器/桌面都可能因为没有剪贴板权限而拒绝，这里静默放弃：它只是个便捷入口。
 */
export const useClipboardGitHubDetection = (): ClipboardGitHubDetectionState => {
  const enabled = useAppStore(useShallow((state) => state.clipboardDetectionEnabled));
  const [target, setTarget] = useState<GitHubClipboardTarget | null>(null);
  const dismissedUrlRef = useRef<string | null>(null);
  const readSequenceRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setTarget(null);
      return;
    }

    let disposed = false;
    const readOnce = async () => {
      if (typeof navigator === 'undefined' || typeof navigator.clipboard?.readText !== 'function') return;
      const sequence = ++readSequenceRef.current;
      try {
        const text = await navigator.clipboard.readText();
        if (disposed || sequence !== readSequenceRef.current) return;
        const parsed = parseGitHubClipboardTarget(text);
        if (!parsed) {
          dismissedUrlRef.current = null;
          setTarget(null);
          return;
        }
        // 同一个链接被忽略过就不再打扰；看到其它内容后可以再次提示。
        if (parsed.url === dismissedUrlRef.current) return;
        dismissedUrlRef.current = null;
        setTarget((previous) => (previous?.url === parsed.url ? previous : parsed));
      } catch {
        // 无权限或读取失败：保持安静，不弹错误
      }
    };

    const handleFocus = () => { void readOnce(); };
    window.addEventListener('focus', handleFocus);
    return () => {
      disposed = true;
      window.removeEventListener('focus', handleFocus);
    };
  }, [enabled]);

  const dismiss = useCallback(() => {
    setTarget((previous) => {
      dismissedUrlRef.current = previous?.url ?? null;
      return null;
    });
  }, []);

  return { target, dismiss };
};
