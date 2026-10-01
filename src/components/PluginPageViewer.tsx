
import { TranslateFn } from '../i18n/useT';
import React, { useEffect, useRef, useState } from 'react';
import { pluginClient } from '../plugins/pluginClient';
import { validatePluginPageMessage } from '../plugins/pluginPageMessages';
import { usePluginAI } from '../features/plugins/hooks/usePluginAI';
import { usePluginWebSearch } from '../features/plugins/hooks/usePluginWebSearch';

interface PluginPageViewerProps {
  pluginId: string;
  pluginName: string;
  pageId: string;
  pageTitle: string;
  onClose: () => void;
  t: TranslateFn;
  /** modal：在弹窗内使用，隐藏自带标题栏（由外层 Modal 提供标题与关闭按钮）。 */
  variant?: 'panel' | 'modal';
  /** 随 plugin-page:init 一次性下发给页面的上下文（如仓库元数据），不走能力桥。 */
  initContext?: Record<string, unknown>;
}

export const PluginPageViewer: React.FC<PluginPageViewerProps> = ({ pluginId, pluginName, pageId, pageTitle, onClose, t, variant = 'panel', initContext }) => {
  const isModal = variant === 'modal';
  const generateAI = usePluginAI();
  const searchWeb = usePluginWebSearch();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const tokenRef = useRef(crypto.randomUUID());
  const pendingRef = useRef(new Set<string>());
  const requestTimesRef = useRef<number[]>([]);
  const mountedRef = useRef(true);
  const aiRequestsRef = useRef(new Set<AbortController>());
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    const aiRequests = aiRequestsRef.current;
    return () => {
      mountedRef.current = false;
      for (const controller of aiRequests) controller.abort();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    void pluginClient.getPage(pluginId, pageId).then((result) => {
      if (disposed) return;
      if (result.success) setUrl(result.url);
      else setError(result.error.message);
    }).catch(() => {
      if (!disposed) setError(t('pluginPageViewer.failed-to-load-plugin-page'));
    });
    return () => { disposed = true; };
  }, [pluginId, pageId, t]);

  const initContextRef = useRef(initContext);
  initContextRef.current = initContext;

  // init 只在 iframe onLoad 时发送一次，而弹窗上下文（如 README）是异步到位的。
  // 页面已初始化后上下文发生变化时补发一次，携带同一 token，页面按新上下文刷新。
  const initContextSignature = JSON.stringify(initContext ?? null);
  useEffect(() => {
    const frameWindow = frameRef.current?.contentWindow;
    if (!frameWindow || !tokenRef.current || !initContextRef.current) return;
    frameWindow.postMessage({
      type: 'plugin-page:init', pluginId, pageId, token: tokenRef.current,
      context: initContextRef.current,
    }, '*');
    // initContextSignature 只用来触发重发；实际载荷取 ref，避免把对象身份放进依赖。
  }, [initContextSignature, pluginId, pageId]);

  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      const request = validatePluginPageMessage(event, frameRef.current?.contentWindow ?? null, pluginId, pageId, tokenRef.current);
      if (!request) return;
      const pendingKey = `${tokenRef.current}:${request.requestId}`;
      const rejectRequest = (code: string, message: string) => {
        frameRef.current?.contentWindow?.postMessage({
          type: 'plugin-page:response', pluginId, pageId,
          requestId: request.requestId, token: tokenRef.current,
          success: false, error: { code, message },
        }, '*');
      };
      if (pendingRef.current.has(pendingKey) || pendingRef.current.size >= 8) {
        rejectRequest('PLUGIN_PAGE_RATE_LIMITED', 'Plugin page request limit exceeded');
        return;
      }
      const now = Date.now();
      requestTimesRef.current = requestTimesRef.current.filter((time) => now - time < 60_000);
      if (requestTimesRef.current.length >= 120) {
        rejectRequest('PLUGIN_PAGE_RATE_LIMITED', 'Plugin page request rate limit exceeded');
        return;
      }
      requestTimesRef.current.push(now);
      let requestSize;
      try { requestSize = JSON.stringify(request.args).length; } catch {
        rejectRequest('PLUGIN_PAGE_REQUEST_TOO_LARGE', 'Plugin page request arguments are not serializable');
        return;
      }
      // 与主进程 pluginPageBridge 的预算一致：截图导出回传二进制，放宽到
      // 10 MiB；其余方法维持 1 MiB。这里先拦一层，避免大载荷进 IPC。
      const sizeLimit = request.method === 'clipboard.writeImage' || request.method === 'downloads.saveFile'
        ? 10 * 1024 * 1024
        : 1024 * 1024;
      if (requestSize > sizeLimit) {
        rejectRequest('PLUGIN_PAGE_REQUEST_TOO_LARGE', 'Plugin page request exceeds the size limit');
        return;
      }
      pendingRef.current.add(pendingKey);
      const requestToken = tokenRef.current;
      const aiController = request.method === 'ai.generate' ? new AbortController() : null;
      if (aiController) aiRequestsRef.current.add(aiController);
      try {
        let result;
        try {
          result = request.method === 'ai.generate'
            ? await generateAI(pluginId, pluginName, pageId, request.args,
              () => mountedRef.current && tokenRef.current === requestToken, aiController!.signal)
            : request.method === 'web.search'
              ? await searchWeb(pluginId, pluginName, pageId, request.args,
                () => mountedRef.current && tokenRef.current === requestToken)
            : await pluginClient.requestPageCapability({ pluginId, pageId, method: request.method, args: request.args });
        } catch {
          result = { success: false as const, error: { code: 'PLUGIN_PAGE_REQUEST_FAILED', message: 'Host request failed' } };
        }
        if (tokenRef.current !== requestToken) return;
        frameRef.current?.contentWindow?.postMessage({
          type: 'plugin-page:response', pluginId, pageId,
          requestId: request.requestId, token: requestToken, ...result,
        }, '*');
      } finally {
        pendingRef.current.delete(pendingKey);
        if (aiController) aiRequestsRef.current.delete(aiController);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [pluginId, pageId, pluginName, generateAI, searchWeb, t]);

  return (
    <section className="space-y-3" aria-label={`${pluginName}: ${pageTitle}`}>
      {!isModal && (
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">{pluginName} · {pageTitle}</h3>
            <p className="text-xs text-muted-foreground">{t('pluginPageViewer.this-page-comes-from-a-local-plugin-data-request')}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded border border-border px-3 py-1.5 text-sm">
            {t('pluginPageViewer.back-to-plugins')}
          </button>
        </div>
      )}
      {isModal && (
        <p className="text-xs text-muted-foreground">{t('pluginPageViewer.this-page-comes-from-a-local-plugin-data-request')}</p>
      )}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> :
        url ? <iframe
          ref={frameRef}
          title={`${pluginName}: ${pageTitle}`}
          src={url}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          className={isModal
            ? 'h-[min(72vh,860px)] min-h-[420px] w-full rounded-lg border border-border bg-white'
            : 'h-[min(70vh,800px)] min-h-[480px] w-full rounded-lg border border-border bg-white'}
          onLoad={() => {
            for (const controller of aiRequestsRef.current) controller.abort();
            tokenRef.current = crypto.randomUUID();
            pendingRef.current.clear();
            frameRef.current?.contentWindow?.postMessage({
              type: 'plugin-page:init', pluginId, pageId, token: tokenRef.current,
              ...(initContextRef.current ? { context: initContextRef.current } : {}),
            }, '*');
          }}
        /> : <p role="status">{t('pluginPageViewer.loading-plugin-page')}</p>}
    </section>
  );
};
