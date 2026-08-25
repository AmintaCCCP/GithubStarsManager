import React, { useMemo, useState } from 'react';
import { Bot, Clock, Copy, Edit3, ExternalLink, FileCode2, Loader2, StarOff, Trash2, User } from 'lucide-react';
import type { Gist } from '../types';
import { createGitHubApiService } from '../services/githubApiFactory';
import { AIService } from '../services/aiService';
import { useAppStore } from '../store/useAppStore';
import { useDialog } from '../hooks/useDialog';
import { safeWriteText } from '../utils/clipboardUtils';
import { getGistFileCount, getGistPrimaryLanguage, getGistTitle } from '../utils/gistUtils';
import { Button } from './ui/button';

interface GistCardProps {
  gist: Gist;
  isMine: boolean;
  onOpen: (gist: Gist) => void;
  onEdit: (gist: Gist) => void;
  onDeleted: (gistId: string) => void;
  onUnstarred: (gistId: string) => void;
}

export const GistCard: React.FC<GistCardProps> = ({
  gist,
  isMine,
  onOpen,
  onEdit,
  onDeleted,
  onUnstarred,
}) => {
  const {
    githubToken,
    aiConfigs,
    activeAIConfig,
    language,
    updateGist,
    deleteGist,
    setAnalyzingGist,
  } = useAppStore();
  const isStoreAnalyzing = useAppStore(state => state.analyzingGistIds.has(gist.id));
  const { toast, confirm } = useDialog();
  const [isAnalyzingLocal, setIsAnalyzingLocal] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const title = getGistTitle(gist);
  const primaryLanguage = getGistPrimaryLanguage(gist);
  const fileCount = getGistFileCount(gist);
  const isAnalyzing = isStoreAnalyzing || isAnalyzingLocal;

  const fileNames = useMemo(() =>
    Object.values(gist.files || {}).slice(0, 3).map(file => file.filename).join(', '),
    [gist.files]
  );

  const handleCopyLink = async (event: React.MouseEvent) => {
    event.stopPropagation();
    const result = await safeWriteText(gist.html_url);
    toast(result.success ? t('链接已复制', 'Link copied') : (result.error || t('复制失败', 'Copy failed')), result.success ? 'success' : 'error');
  };

  const handleAnalyze = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!githubToken) {
      toast(t('GitHub token 未找到，请重新登录。', 'GitHub token not found. Please login again.'), 'error');
      return;
    }
    const activeConfig = aiConfigs.find(config => config.id === activeAIConfig);
    if (!activeConfig) {
      toast(t('请先在设置中配置AI服务。', 'Please configure AI service in settings first.'), 'error');
      return;
    }
    if (!activeConfig.baseUrl || !activeConfig.apiKey || !activeConfig.model || activeConfig.apiKeyStatus === 'decrypt_failed' || activeConfig.apiKeyStatus === 'empty') {
      toast(t('AI服务配置不完整，请检查设置。', 'AI service configuration is incomplete. Please check settings.'), 'error');
      return;
    }

    if (gist.analyzed_at) {
      const shouldContinue = await confirm(
        t('重新分析确认', 'Re-analyze Confirmation'),
        t('此 gist 已经分析过，是否覆盖现有摘要？', 'This gist has already been analyzed. Overwrite the existing summary?'),
        { type: 'warning' }
      );
      if (!shouldContinue) return;
    }

    setAnalyzingGist(gist.id, true);
    setIsAnalyzingLocal(true);
    try {
      const githubApi = createGitHubApiService(githubToken);
      const detail = await githubApi.getGistForAnalysis(gist.id, gist);
      const aiService = new AIService(activeConfig, language);
      const summary = await aiService.analyzeGist(detail, githubApi.getGistContentPreview(detail));
      updateGist({
        ...detail,
        ai_summary: summary.trim(),
        analyzed_at: new Date().toISOString(),
        analysis_failed: false,
        analysis_error: undefined,
      });
      toast(t('Gist AI分析完成', 'Gist AI analysis completed'), 'success');
    } catch (error) {
      updateGist({
        ...gist,
        analyzed_at: new Date().toISOString(),
        analysis_failed: true,
        analysis_error: error instanceof Error ? error.message : String(error),
      });
      toast(t('Gist AI分析失败', 'Gist AI analysis failed'), 'error');
    } finally {
      setIsAnalyzingLocal(false);
      setAnalyzingGist(gist.id, false);
    }
  };

  const handleUnstar = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!githubToken) return;
    const confirmed = await confirm(
      t('取消收藏 Gist', 'Unstar Gist'),
      t('确定要取消收藏这个 gist 吗？', 'Are you sure you want to unstar this gist?'),
      { type: 'warning', confirmText: t('取消收藏', 'Unstar') }
    );
    if (!confirmed) return;

    setIsMutating(true);
    try {
      await createGitHubApiService(githubToken).unstarGist(gist.id);
      onUnstarred(gist.id);
      updateGist({ ...gist, starred: false });
      toast(t('已取消收藏', 'Unstarred'), 'success');
    } catch {
      toast(t('取消收藏失败', 'Failed to unstar'), 'error');
    } finally {
      setIsMutating(false);
    }
  };

  const handleDelete = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!githubToken || !isMine) return;
    const confirmed = await confirm(
      t('删除 Gist', 'Delete Gist'),
      t('确定要删除这个 gist 吗？此操作不可撤销。', 'Are you sure you want to delete this gist? This cannot be undone.'),
      { type: 'danger', confirmText: t('删除', 'Delete') }
    );
    if (!confirmed) return;

    setIsMutating(true);
    try {
      await createGitHubApiService(githubToken).deleteGist(gist.id);
      deleteGist(gist.id);
      onDeleted(gist.id);
      toast(t('Gist 已删除', 'Gist deleted'), 'success');
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      const isPermission = /403|404|forbidden|scope|permission/i.test(msg);
      toast(
        t(
          `删除 Gist 失败${msg ? `：${msg}` : ''}${isPermission ? '（请确认 token 已勾选 gist 权限，并在设置中重新输入 token 登录）' : ''}`,
          `Failed to delete gist${msg ? `: ${msg}` : ''}${isPermission ? ' (Make sure your token has the gist scope and re-login with the updated token)' : ''}`
        ),
        'error'
      );
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <article
      onClick={() => onOpen(gist)}
      className="ui-card group cursor-pointer p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-foreground dark:text-foreground">{title}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground dark:text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <User className="h-4 w-4" />
              {gist.owner?.login || t('未知', 'Unknown')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              {new Date(gist.updated_at).toLocaleDateString()}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <FileCode2 className="h-4 w-4" />
              {fileCount} {t('个文件', 'files')}
            </span>
            {primaryLanguage && <span>{primaryLanguage}</span>}
            <span>{gist.public ? t('公开', 'Public') : t('私有', 'Secret')}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            className="h-8 w-8 rounded-lg p-0 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-50 dark:text-muted-foreground dark:hover:bg-primary/15 dark:hover:text-primary"
            title={t('AI分析', 'AI analyze')}
          >
            {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={handleCopyLink}
            className="h-8 w-8 rounded-lg p-0 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            title={t('复制链接', 'Copy link')}
          >
            <Copy className="h-4 w-4" />
          </Button>
          <a
            href={gist.html_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg p-0 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            title={t('打开链接', 'Open link')}
          >
            <ExternalLink className="h-4 w-4" />
          </a>
          {gist.starred && (
            <Button
              type="button"
              variant="ghost"
              onClick={handleUnstar}
              disabled={isMutating}
              className="h-8 w-8 rounded-lg p-0 text-muted-foreground transition-colors hover:bg-warning/10 hover:text-warning disabled:opacity-50 dark:text-muted-foreground"
              title={t('取消收藏', 'Unstar')}
            >
              <StarOff className="h-4 w-4" />
            </Button>
          )}
          {isMine && (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={(event) => {
                  event.stopPropagation();
                  onEdit(gist);
                }}
                className="h-8 w-8 rounded-lg p-0 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                title={t('编辑', 'Edit')}
              >
                <Edit3 className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={handleDelete}
                disabled={isMutating}
                className="h-8 w-8 rounded-lg p-0 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50 dark:text-muted-foreground"
                title={t('删除', 'Delete')}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      <p className="mt-4 line-clamp-2 text-sm leading-6 text-muted-foreground dark:text-muted-foreground">
        {gist.ai_summary || gist.description || fileNames || t('暂无描述', 'No description')}
      </p>

      {gist.analysis_failed && (
        <div className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {gist.analysis_error || t('AI 分析失败', 'AI analysis failed')}
        </div>
      )}
    </article>
  );
};
