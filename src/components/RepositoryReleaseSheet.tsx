import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, CheckCircle2, ChevronLeft, ChevronRight, Code2, Download, ExternalLink, Loader2, PackageOpen, RefreshCw, Sparkles } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import type { Release, Repository } from '../types';
import MarkdownRenderer from './MarkdownRenderer';
import AssetLeadingIcon from './AssetLeadingIcon';
import { useAppStore } from '../store/useAppStore';
import { useRepositoryReleaseSheet } from '../features/repositories/hooks/useRepositoryReleaseSheet';
import { computeRpcDownloadKey } from '../hooks/useReleaseArtifactActions';
import { buildReleaseDownloadLinks, type ReleaseDownloadLink } from '../utils/releaseDownloadLinks';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';
import { Button } from './ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

const RELEASES_PER_PAGE = 10;
const ASSETS_PER_PAGE = 8;

interface RepositoryReleaseSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onCloseAutoFocus?: () => void;
  repository: Repository;
}

const formatFileSize = (bytes: number | null): string => {
  if (bytes === null) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

const Pagination: React.FC<{
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  label: string;
}> = ({ page, totalPages, onPageChange, label }) => {
  if (totalPages <= 1) return null;

  return (
    <nav className="mt-3 flex items-center justify-end gap-1.5" aria-label={label}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={page === 1}
        onClick={() => onPageChange(page - 1)}
        aria-label={`${label} previous page`}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </Button>
      <span className="min-w-14 text-center text-xs text-muted-foreground" aria-live="polite">
        {page} / {totalPages}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={page === totalPages}
        onClick={() => onPageChange(page + 1)}
        aria-label={`${label} next page`}
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Button>
    </nav>
  );
};

const ReleaseAssetsTable: React.FC<{
  release: Release;
  assetPage: number;
  onAssetPageChange: (page: number) => void;
  downloadStates: Record<string, 'idle' | 'sending' | 'sent'>;
  onDownload: (link: ReleaseDownloadLink) => void;
  language: 'zh' | 'en';
}> = ({ release, assetPage, onAssetPageChange, downloadStates, onDownload, language }) => {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const links = useMemo(() => buildReleaseDownloadLinks(release), [release]);
  const totalPages = Math.max(1, Math.ceil(links.length / ASSETS_PER_PAGE));
  const currentPage = Math.min(assetPage, totalPages);
  const displayedLinks = links.slice((currentPage - 1) * ASSETS_PER_PAGE, currentPage * ASSETS_PER_PAGE);

  useEffect(() => {
    if (assetPage !== currentPage) onAssetPageChange(currentPage);
  }, [assetPage, currentPage, onAssetPageChange]);

  if (links.length === 0) {
    return <p className="py-5 text-center text-xs text-muted-foreground">{t('该 Release 没有可下载的资产。', 'This release has no downloadable assets.')}</p>;
  }

  return (
    <>
      <Table aria-label={t(`${release.tag_name} 资产`, `${release.tag_name} assets`)}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('文件名', 'File')}</TableHead>
            <TableHead className="w-20 text-right">{t('大小', 'Size')}</TableHead>
            <TableHead className="w-24 text-right">{t('操作', 'Action')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {displayedLinks.map((link) => {
            const downloadState = downloadStates[computeRpcDownloadKey(link)] ?? 'idle';
            const isSending = downloadState === 'sending';
            const isSent = downloadState === 'sent';
            return (
              <TableRow key={link.id} className={link.isSourceCode ? 'bg-muted/30' : undefined}>
                <TableCell className="max-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    {link.isSourceCode ? <Code2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : <AssetLeadingIcon name={link.name} contentType={link.contentType} />}
                    <span className="truncate text-xs" title={link.name}>{link.name}</span>
                  </div>
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">{formatFileSize(link.size)}</TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={isSending || isSent}
                    onClick={() => onDownload(link)}
                  >
                    {isSending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : isSent ? <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> : <Download className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
                    {isSent ? t('已发送', 'Sent') : t('下载', 'Download')}
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <Pagination
        page={currentPage}
        totalPages={totalPages}
        onPageChange={onAssetPageChange}
        label={t(`${release.tag_name} 资产分页`, `${release.tag_name} asset pagination`)}
      />
    </>
  );
};

const ReleaseContent: React.FC<{
  release: Release;
  assetPage: number;
  onAssetPageChange: (page: number) => void;
  downloadStates: Record<string, 'idle' | 'sending' | 'sent'>;
  onDownload: (link: ReleaseDownloadLink) => void;
  summary: { status: 'idle' | 'loading' | 'done' | 'error'; content?: string; error?: string } | undefined;
  onGenerateSummary: () => void;
  language: 'zh' | 'en';
}> = ({ release, assetPage, onAssetPageChange, downloadStates, onDownload, summary, onGenerateSummary, language }) => {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const [activeTab, setActiveTab] = useState('assets');
  const hasBody = Boolean(release.body?.trim());

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    if (value === 'summary' && hasBody) onGenerateSummary();
  };

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
      <TabsList className="grid h-8 w-full grid-cols-3">
        <TabsTrigger className="text-xs" value="assets">{t('资产', 'Assets')}</TabsTrigger>
        <TabsTrigger className="text-xs" value="notes">{t('更新日志', 'Notes')}</TabsTrigger>
        <TabsTrigger className="text-xs" value="summary">{t('总结', 'Summary')}</TabsTrigger>
      </TabsList>
      <TabsContent value="assets" className="mt-3">
        <ReleaseAssetsTable
          release={release}
          assetPage={assetPage}
          onAssetPageChange={onAssetPageChange}
          downloadStates={downloadStates}
          onDownload={onDownload}
          language={language}
        />
      </TabsContent>
      <TabsContent value="notes" className="mt-3">
        {hasBody ? (
          <div className="rounded-md border border-border bg-muted/20 px-3 py-3">
            <MarkdownRenderer content={release.body || ''} shouldRender fontSize="small" />
          </div>
        ) : (
          <p className="py-5 text-center text-xs text-muted-foreground">{t('该 Release 未提供更新日志。', 'This release has no release notes.')}</p>
        )}
      </TabsContent>
      <TabsContent value="summary" className="mt-3">
        {!hasBody ? (
          <p className="py-5 text-center text-xs text-muted-foreground">{t('该 Release 没有可总结的更新日志。', 'This release has no notes to summarize.')}</p>
        ) : summary?.status === 'loading' ? (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t('正在生成总结…', 'Generating summary…')}
          </div>
        ) : summary?.status === 'done' && summary.content ? (
          <div className="rounded-md border border-border bg-muted/20 px-3 py-3">
            <MarkdownRenderer content={summary.content} shouldRender breaks fontSize="small" />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-5 text-center">
            <p className="text-xs text-muted-foreground">
              {summary?.status === 'error'
                ? t('总结生成失败，请重试。', 'Summary generation failed. Please try again.')
                : t('切换到此标签时会使用当前 AI 配置生成总结。', 'This tab uses the current AI configuration to generate a summary.')}
            </p>
            <Button type="button" variant="secondary" size="sm" onClick={onGenerateSummary}>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {summary?.status === 'error' ? t('重试总结', 'Retry summary') : t('生成总结', 'Generate summary')}
            </Button>
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
};

export const RepositoryReleaseSheet: React.FC<RepositoryReleaseSheetProps> = ({
  isOpen,
  onClose,
  onCloseAutoFocus,
  repository,
}) => {
  const language = useAppStore((state) => state.language);
  const {
    releases,
    isLoading,
    error,
    summaries,
    downloadStates,
    loadReleases,
    downloadAsset,
    generateSummary,
    cancelPendingRequests,
  } = useRepositoryReleaseSheet(repository);
  const [releasePage, setReleasePage] = useState(1);
  const [assetPages, setAssetPages] = useState<Record<number, number>>({});
  const [expandedReleaseIds, setExpandedReleaseIds] = useState<string[]>([]);
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  const totalReleasePages = Math.max(1, Math.ceil(releases.length / RELEASES_PER_PAGE));
  const currentReleasePage = Math.min(releasePage, totalReleasePages);
  const visibleReleases = releases.slice((currentReleasePage - 1) * RELEASES_PER_PAGE, currentReleasePage * RELEASES_PER_PAGE);

  const resetPagination = () => {
    setReleasePage(1);
    setAssetPages({});
    setExpandedReleaseIds([]);
  };

  const refresh = () => {
    resetPagination();
    void loadReleases();
  };

  useEffect(() => {
    if (isOpen) refresh();
    return () => cancelPendingRequests();
  // The request should be started only when the Sheet opens or its repository changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, repository.id, repository.full_name]);

  useEffect(() => {
    if (releasePage !== currentReleasePage) setReleasePage(currentReleasePage);
  }, [currentReleasePage, releasePage]);

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        closeLabel={t('关闭 Release 侧栏', 'Close release sheet')}
        onPointerDownOutside={(event) => {
          // Keep the overlay mounted through the current click sequence. Closing
          // immediately can retarget the browser click to the card beneath it.
          event.preventDefault();
          window.setTimeout(onClose, 0);
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onCloseAutoFocus?.();
        }}
      >
        <SheetHeader>
          <SheetTitle>{t('查看 Release', 'Repository releases')}</SheetTitle>
          <SheetDescription className="truncate" title={repository.full_name}>{repository.full_name}</SheetDescription>
        </SheetHeader>
        <div className="flex shrink-0 items-center gap-2 border-b border-border pb-3">
          <Button type="button" variant="secondary" size="sm" onClick={refresh} disabled={isLoading}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
            {t('刷新', 'Refresh')}
          </Button>
          <Button asChild type="button" variant="ghost" size="sm">
            <a href={`${repository.html_url}/releases`} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              GitHub
            </a>
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {isLoading ? (
            <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground" role="status" aria-live="polite">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              {t('正在获取最新 Release…', 'Loading latest releases…')}
            </div>
          ) : error ? (
            <div className="flex h-40 flex-col items-center justify-center gap-3 text-center">
              <p className="max-w-sm text-sm text-destructive">{error}</p>
              <Button type="button" variant="secondary" size="sm" onClick={refresh}>{t('重试', 'Retry')}</Button>
            </div>
          ) : releases.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <PackageOpen className="h-7 w-7" aria-hidden="true" />
              <p className="text-sm">{t('该仓库暂无 Release。', 'This repository has no releases.')}</p>
            </div>
          ) : (
            <>
              <p className="mb-2 text-xs text-muted-foreground">
                {t(`已实时获取 ${releases.length} 条 Release`, `${releases.length} live releases loaded`)}
              </p>
              <Accordion type="multiple" value={expandedReleaseIds} onValueChange={setExpandedReleaseIds} className="rounded-md border border-border px-3">
                {visibleReleases.map((release) => (
                  <AccordionItem key={release.id} value={String(release.id)}>
                    <AccordionTrigger>
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="truncate font-semibold">{release.tag_name}</span>
                        {release.name && release.name !== release.tag_name && <span className="truncate text-xs font-normal text-muted-foreground">{release.name}</span>}
                      </span>
                      <span className="mr-1 flex shrink-0 items-center gap-1 text-xs font-normal text-muted-foreground">
                        <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                        {formatDistanceToNow(new Date(release.published_at), { addSuffix: true, locale: language === 'zh' ? zhCN : undefined })}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <ReleaseContent
                        release={release}
                        assetPage={assetPages[release.id] ?? 1}
                        onAssetPageChange={(page) => setAssetPages((previous) => ({ ...previous, [release.id]: page }))}
                        downloadStates={downloadStates}
                        onDownload={(link) => void downloadAsset(link)}
                        summary={summaries[release.id]}
                        onGenerateSummary={() => void generateSummary(release)}
                        language={language}
                      />
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
              <Pagination
                page={currentReleasePage}
                totalPages={totalReleasePages}
                onPageChange={(page) => {
                  setReleasePage(page);
                  setExpandedReleaseIds([]);
                }}
                label={t('Release 分页', 'Release pagination')}
              />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};
