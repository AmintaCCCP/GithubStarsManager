import { TranslateFn } from '../i18n/useT';
import React, { useEffect, useRef, useState } from 'react';
import { pluginClient } from '../plugins/pluginClient';
import { validatePluginPageMessage } from '../plugins/pluginPageMessages';
import { usePluginAccountTag } from '../features/plugins/hooks/usePluginAccountTag';
import { usePluginAI } from '../features/plugins/hooks/usePluginAI';
import { usePluginNetwork } from '../features/plugins/hooks/usePluginNetwork';
import { usePluginWebSearch } from '../features/plugins/hooks/usePluginWebSearch';
import { Button } from './ui/button';

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
  const accountTag = usePluginAccountTag();
  const generateAI = usePluginAI();
  const requestNetwork = usePluginNetwork();
  const searchWeb = usePluginWebSearch();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const tokenRef = useRef(crypto.randomUUID());
  const pendingRef = useRef(new Set<string>());
  const requestTimesRef = useRef<number[]>([]);
  const mountedRef = useRef(true);
  const aiRequestsRef = useRef(new Set<AbortController>());
  const networkSignalRef = useRef<AbortController>(new AbortController());
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    const aiRequests = aiRequestsRef.current;
    return () => {
      mountedRef.current = false;
      for (const controller of aiRequests) controller.abort();
      networkSignalRef.current.abort();
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
  const accountTagRef = useRef(accountTag);
  accountTagRef.current = accountTag;

  const initContextSignature = JSON.stringify(initContext ?? null);
  useEffect(() => {
    const frameWindow = frameRef.current?.contentWindow;
    if (!frameWindow || !tokenRef.current || !initContextRef.current) return;
    frameWindow.postMessage({
      type: 'plugin-page:init', pluginId, pageId, token: tokenRef.current,
      context: { ...initContextRef.current, accountTag: accountTagRef.current },
    }, `plugin-page://${pluginId}`);
  }, [initContextSignature, pluginId, pageId, accountTag]);

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
        }, `plugin-page://${pluginId}`);
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
              : request.method === 'network.request'
                ? await requestNetwork(pluginId, pageId, request.args,
                  () => mountedRef.current && tokenRef.current === requestToken,
                  networkSignalRef.current.signal)
                : await pluginClient.requestPageCapability({ pluginId, pageId, method: request.method, args: request.args });
        } catch {
          result = { success: false as const, error: { code: 'PLUGIN_PAGE_REQUEST_FAILED', message: 'Host request failed' } };
        }
        if (tokenRef.current !== requestToken) return;
        frameRef.current?.contentWindow?.postMessage({
          type: 'plugin-page:response', pluginId, pageId,
          requestId: request.requestId, token: requestToken, ...result,
        }, `plugin-page://${pluginId}`);
      } finally {
        pendingRef.current.delete(pendingKey);
        if (aiController) aiRequestsRef.current.delete(aiController);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [pluginId, pageId, pluginName, generateAI, requestNetwork, searchWeb, t]);

  return (
    <section
      className={isModal ? 'flex h-full min-h-0 flex-1 flex-col gap-2.5' : 'flex flex-col gap-3'}
      aria-label={`${pluginName}: ${pageTitle}`}
    >
      {!isModal && (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-label-lg font-semibold text-foreground">{pluginName} · {pageTitle}</h3>
            <p className="mt-0.5 text-label-sm text-secondary">{t('pluginPageViewer.this-page-comes-from-a-local-plugin-data-request')}</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {t('pluginPageViewer.back-to-plugins')}
          </Button>
        </div>
      )}
      {isModal && (
        <p className="shrink-0 text-label-sm text-secondary">{t('pluginPageViewer.this-page-comes-from-a-local-plugin-data-request')}</p>
      )}
      {error ? (
        <p role="alert" className="rounded-md bg-destructive-tint px-3 py-2 text-label text-destructive">{error}</p>
      ) : url && accountTag ? (
        <iframe
          ref={frameRef}
          title={`${pluginName}: ${pageTitle}`}
          src={url}
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="no-referrer"
          className={isModal
            ? 'min-h-0 w-full flex-1 rounded-lg bg-white shadow-elev-0'
            : 'h-[min(70vh,800px)] min-h-[480px] w-full rounded-lg bg-white shadow-elev-0'}
          onLoad={() => {
            for (const controller of aiRequestsRef.current) controller.abort();
            networkSignalRef.current.abort();
            networkSignalRef.current = new AbortController();
            tokenRef.current = crypto.randomUUID();
            pendingRef.current.clear();
            frameRef.current?.contentWindow?.postMessage({
              type: 'plugin-page:init', pluginId, pageId, token: tokenRef.current,
              ...(initContextRef.current ? { context: { ...initContextRef.current, accountTag: accountTagRef.current } } : {}),
            }, `plugin-page://${pluginId}`);
          }}
        />
      ) : (
        <p role="status" className="py-8 text-center text-label-sm text-secondary">
          {t('pluginPageViewer.loading-plugin-page')}
        </p>
      )}
    </section>
  );
};
