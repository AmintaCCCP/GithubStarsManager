import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Release } from '../types';
import { sendToRpcDownload } from '../services/rpcDownloadService';
import { AIService } from '../services/aiService';
import { useAppStore } from '../store/useAppStore';
import { useDialog } from '../hooks/useDialog';

export type ReleaseArtifactSummaryState = {
  status: 'idle' | 'loading' | 'done' | 'error';
  content?: string;
  error?: string;
};

export type RpcDownloadState = 'idle' | 'sending' | 'sent';

export interface RpcDownloadLink {
  url: string;
  name: string;
  updatedAt?: string;
}

// 同一资产更新后 URL 不变但 updatedAt 会变，key 带上版本，
// 否则旧版本的"已发送 ✓"会错误地残留在新版本上。
export const computeRpcDownloadKey = (link: { url: string; updatedAt?: string }): string =>
  `${link.url}@${link.updatedAt ?? ''}`;

export interface ReleaseArtifactActions {
  summaries: Record<number, ReleaseArtifactSummaryState>;
  rpcDownloadStates: Record<string, RpcDownloadState>;
  sendRpcDownload: (link: RpcDownloadLink) => Promise<void>;
  generateSummary: (release: Release) => Promise<void>;
  cancelSummaryRequests: () => void;
  /** 清空 summaries 与 RPC 发送状态（sheet 在 loadReleases 时重置，原为其本地 state 置空）。 */
  reset: () => void;
}

/**
 * Release 资产动作（RPC 发送 + AI 总结），规范语义取自 ReleaseCard 版本；
 * useRepositoryReleaseSheet 委托本 hook（ADR 0001：同一逻辑不允许第三份拷贝）。
 */
export const useReleaseArtifactActions = (): ReleaseArtifactActions => {
  const { language, backendApiSecret, aiConfigs, activeAIConfig } = useAppStore(useShallow((state) => ({
    language: state.language,
    backendApiSecret: state.backendApiSecret,
    aiConfigs: state.aiConfigs,
    activeAIConfig: state.activeAIConfig,
  })));
  const { toast } = useDialog();
  const t = useCallback((zh: string, en: string) => language === 'zh' ? zh : en, [language]);

  const [summaries, setSummaries] = useState<Record<number, ReleaseArtifactSummaryState>>({});
  // 渲染态用 useState Record 取代原 ReleaseCard 的 refs + forceUpdate（渲染等价）；
  // 同步镜像 ref 保留原 ref 的同步短路语义：同一事件循环内的快速连点不会被
  // setState 的异步批处理放过，避免重复发送。
  const rpcDownloadStatesRef = useRef<Record<string, RpcDownloadState>>({});
  const [rpcDownloadStates, setRpcDownloadStates] = useState<Record<string, RpcDownloadState>>({});
  const applyRpcDownloadState = useCallback((key: string, state: RpcDownloadState) => {
    rpcDownloadStatesRef.current = { ...rpcDownloadStatesRef.current, [key]: state };
    setRpcDownloadStates(rpcDownloadStatesRef.current);
  }, []);

  const summaryAbortRefs = useRef<Record<number, AbortController | undefined>>({});

  const cancelSummaryRequests = useCallback(() => {
    Object.values(summaryAbortRefs.current).forEach((controller) => controller?.abort());
    summaryAbortRefs.current = {};
  }, []);

  useEffect(() => cancelSummaryRequests, [cancelSummaryRequests]);

  const reset = useCallback(() => {
    setSummaries({});
    rpcDownloadStatesRef.current = {};
    setRpcDownloadStates({});
  }, []);

  const sendRpcDownload = useCallback(async (link: RpcDownloadLink) => {
    const key = computeRpcDownloadKey(link);
    // 仅在发送进行中时短路，允许发送完成后再次点击重新发送
    if (rpcDownloadStatesRef.current[key] === 'sending') return;

    // 重试开始即清除旧的成功态：若本次失败/异常，行内不得残留 ✓，
    // 否则卡片会把失败的重试报告成成功。
    applyRpcDownloadState(key, 'sending');
    try {
      const result = await sendToRpcDownload(link.url, link.name, backendApiSecret || undefined);
      if (result.success) {
        applyRpcDownloadState(key, 'sent');
        toast(t('已发送到远程下载器', 'Sent to remote downloader'), 'success');
      } else {
        applyRpcDownloadState(key, 'idle');
        toast(
          result.error === 'RPC service not running'
            ? t('远程下载服务未运行，请检查配置', 'Remote download service not running, please check config')
            : result.error || t('发送失败', 'Send failed'),
          'error'
        );
      }
    } catch {
      applyRpcDownloadState(key, 'idle');
      toast(t('远程下载服务未运行，请检查配置', 'Remote download service not running, please check config'), 'error');
    }
  }, [applyRpcDownloadState, backendApiSecret, t, toast]);

  const generateSummary = useCallback(async (release: Release) => {
    const existing = summaries[release.id];
    // 前置守卫：ReleaseCard 侧由 View 的展开短路保证不重复触发，这里同时兼容
    // useRepositoryReleaseSheet 的委托调用（loading 中或已有结论时不重跑）。
    if (existing?.status === 'loading' || (existing?.status === 'done' && existing.content)) return;

    const activeConfig = aiConfigs.find((config) => config.id === activeAIConfig);
    if (!activeConfig) {
      toast(
        language === 'zh' ? '请先在设置中配置 AI 服务。' : 'Please configure AI service in settings first.',
        'error'
      );
      return;
    }

    // 取消上一次未完成的请求
    summaryAbortRefs.current[release.id]?.abort();
    const controller = new AbortController();
    summaryAbortRefs.current[release.id] = controller;

    const config = activeConfig;
    setSummaries((previous) => ({ ...previous, [release.id]: { status: 'loading' } }));
    try {
      const aiService = new AIService(config, language);
      const content = await aiService.analyzeReleaseSummary(
        release.body || '',
        {
          repoName: release.repository.full_name,
          tagName: release.tag_name,
          releaseName: release.name && release.name !== release.tag_name ? release.name : undefined,
        },
        controller.signal
      );
      setSummaries((previous) => ({ ...previous, [release.id]: { status: 'done', content } }));
    } catch (error) {
      // 主动取消（卸载/重新发起）时静默处理，不更新状态、不弹错误
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setSummaries((previous) => ({ ...previous, [release.id]: { status: 'error', error: message } }));
      toast(
        language === 'zh' ? `总结生成失败：${message}` : `Summary failed: ${message}`,
        'error'
      );
    } finally {
      if (summaryAbortRefs.current[release.id] === controller) {
        delete summaryAbortRefs.current[release.id];
      }
    }
  }, [activeAIConfig, aiConfigs, language, summaries, toast]);

  return useMemo(() => ({
    summaries,
    rpcDownloadStates,
    sendRpcDownload,
    generateSummary,
    cancelSummaryRequests,
    reset,
  }), [summaries, rpcDownloadStates, sendRpcDownload, generateSummary, cancelSummaryRequests, reset]);
};
