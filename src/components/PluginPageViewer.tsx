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
  t: (zh: string, en: string) => string;
}

export const PluginPageViewer: React.FC<PluginPageViewerProps> = ({ pluginId, pluginName, pageId, pageTitle, onClose, t }) => {
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
      if (!disposed) setError(t('插件页面加载失败', 'Failed to load plugin page'));
    });
    return () => { disposed = true; };
  }, [pluginId, pageId, t]);

  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      const request = validatePluginPageMessage(event, frameRef.current?.contentWindow ?? null, pluginId, pageId, tokenRef.current);
      if (!request) return;
      const pendingKey = `${tokenRef.current}:${request.requestId}`;
      if (pendingRef.current.has(pendingKey) || pendingRef.current.size >= 8) return;
      const now = Date.now();
      requestTimesRef.current = requestTimesRef.current.filter((time) => now - time < 60_000);
      if (requestTimesRef.current.length >= 120) return;
      requestTimesRef.current.push(now);
      let requestSize;
      try { requestSize = JSON.stringify(request.args).length; } catch { return; }
      if (requestSize > 1024 * 1024) return;
      pendingRef.current.add(pendingKey);
      const requestToken = tokenRef.current;
      const aiController = request.method === 'ai.generate' ? new AbortController() : null;
      if (aiController) aiRequestsRef.current.add(aiController);
      try {
        let result;
        try {
          result = request.method === 'ai.generate'
            ? await generateAI(pluginId, pluginName, pageId, request.args, t,
              () => mountedRef.current && tokenRef.current === requestToken, aiController!.signal)
            : request.method === 'web.search'
              ? await searchWeb(pluginId, pluginName, pageId, request.args, t,
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
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">{pluginName} · {pageTitle}</h3>
          <p className="text-xs text-muted-foreground">{t('此页面由本地插件提供，数据请求仍需经过宿主权限检查。', 'This page comes from a local plugin; data requests still require Host permission checks.')}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded border border-border px-3 py-1.5 text-sm">
          {t('返回插件列表', 'Back to plugins')}
        </button>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> :
        url ? <iframe
          ref={frameRef}
          title={`${pluginName}: ${pageTitle}`}
          src={url}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          className="h-[min(70vh,800px)] min-h-[480px] w-full rounded-lg border border-border bg-white"
          onLoad={() => {
            for (const controller of aiRequestsRef.current) controller.abort();
            tokenRef.current = crypto.randomUUID();
            pendingRef.current.clear();
            frameRef.current?.contentWindow?.postMessage({
              type: 'plugin-page:init', pluginId, pageId, token: tokenRef.current,
            }, '*');
          }}
        /> : <p role="status">{t('正在加载插件页面…', 'Loading plugin page…')}</p>}
    </section>
  );
};
