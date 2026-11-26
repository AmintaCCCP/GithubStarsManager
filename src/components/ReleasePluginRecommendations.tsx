



import { useT } from '../i18n/useT';
import type { AppLanguage } from '../i18n/languages';
import React, { useMemo, useState } from 'react';
import { Download, Loader2, Sparkles } from 'lucide-react';
import type { Release, Repository } from '../types';
import type { PluginReleaseRecommendation } from '../plugins/types';
import type { RegisteredReleaseProcessor } from '../plugins/types';
import { useReleaseProcessors } from '../plugins/hooks/useReleaseProcessors';
import { Button } from './ui/button';
import { useDialog } from '../hooks/useDialog';

export const ReleasePluginRecommendations: React.FC<{
  release: Release;
  repository?: Repository;
  language: AppLanguage;
}> = ({ release, repository, language }) => {
    const t = useT('releases');
  const { processors, runProcessor, download } = useReleaseProcessors();
  if (processors.length === 0 || release.assets.length === 0) return null;

  return (
    <section className="mb-3 rounded-lg bg-raised p-3 shadow-elev-1" aria-label={t('releasePluginRecommendations.plugin-asset-recommendations')}>
      <div className="mb-2 flex items-center gap-1.5 text-label-sm font-medium text-foreground">
        <Sparkles className="size-3.5 text-accent-text" aria-hidden="true" />
        {t('releasePluginRecommendations.plugin-asset-recommendations')}
      </div>
      <div className="space-y-2">
        {processors.map((processor) => (
          <RecommendationItem
            key={`${processor.pluginId}:${processor.id}`}
            processor={processor}
            release={release}
            repository={repository}
            language={language}
            runProcessor={runProcessor}
            download={download}
          />
        ))}
      </div>
    </section>
  );
};

const RecommendationItem: React.FC<{
  processor: RegisteredReleaseProcessor;
  release: Release;
  repository?: Repository;
  language: AppLanguage;
  runProcessor: ReturnType<typeof useReleaseProcessors>['runProcessor'];
  download: ReturnType<typeof useReleaseProcessors>['download'];
}> = ({ processor, release, repository, runProcessor, download }) => {
  const { toast } = useDialog();
  const [running, setRunning] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, PluginReleaseRecommendation>>({});
  const t = useT('releases');
  const assets = useMemo(() => new Map(release.assets.map((asset) => [asset.id, asset])), [release.assets]);

  const key = `${processor.pluginId}:${processor.id}`;
  const result = results[key];
  const asset = result ? assets.get(result.recommendedAssetId) : undefined;
  return (
    <div className="rounded-md border border-subtle bg-sunken p-2.5 text-label-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium text-foreground" title={`${processor.pluginName}: ${processor.title}`}>
          {processor.pluginName}: {processor.title}
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={running === key}
          onClick={async (event) => {
            event.stopPropagation();
            setRunning(key);
            try {
              const operation = await runProcessor(processor, release, repository);
              if (operation.success) setResults((previous) => ({ ...previous, [key]: operation.result }));
              else toast(operation.error.message, 'error');
            } catch (error) {
              toast(error instanceof Error ? error.message : t('releasePluginRecommendations.plugin-analysis-failed'), 'error');
            } finally {
              setRunning(null);
            }
          }}
        >
          {running === key && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
          {result ? t('releasePluginRecommendations.analyze-again') : t('releasePluginRecommendations.analyze')}
        </Button>
      </div>
      {result && asset && (
        <div className="mt-2 flex items-start justify-between gap-3 border-t border-subtle pt-2">
          <div className="min-w-0">
            <p className="truncate text-label font-medium text-foreground" title={asset.name}>{asset.name}</p>
            <p className="mt-0.5 text-label-sm text-secondary">{result.reason}</p>
            <p className="mt-0.5 text-label-sm text-tertiary tabular-nums">{t('releasePluginRecommendations.confidence')}: {Math.round(result.confidence * 100)}%</p>
          </div>
          {processor.canDownload && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="shrink-0"
              disabled={downloading === key}
              onClick={async (event) => {
                event.stopPropagation();
                setDownloading(key);
                try {
                  const operation = await download(processor, release.id, asset.id);
                  if (operation.success) toast(t('releasePluginRecommendations.saved-v1', { v1: operation.fileName }), 'success');
                  else if (!operation.canceled) toast(operation.error?.message || t('releasePluginRecommendations.download-failed'), 'error');
                } catch (error) {
                  toast(error instanceof Error ? error.message : t('releasePluginRecommendations.download-failed'), 'error');
                } finally {
                  setDownloading(null);
                }
              }}
            >
              {downloading === key ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Download className="size-3.5" aria-hidden="true" />}
              {t('releasePluginRecommendations.host-download')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
};
