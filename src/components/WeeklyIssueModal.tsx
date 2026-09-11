import React from 'react';
import { ExternalLink, Loader2, Calendar } from 'lucide-react';
import { Modal } from './Modal';
import MarkdownRenderer from './MarkdownRenderer';
import { useAppStore } from '../store/useAppStore';
import { useWeeklyIssueBody } from '../features/discovery/hooks/useWeeklyIssueBody';
import type { WeeklyIssueRef } from '../types';

interface WeeklyIssueModalProps {
  isOpen: boolean;
  onClose: () => void;
  issue: WeeklyIssueRef;
}

/**
 * 周刊投稿 issue 的"查看原贴"弹窗：GitHub 渲染样式展示正文。
 * 正文加载（缓存优先 + 实时兜底）收敛在 useWeeklyIssueBody hook。
 */
export const WeeklyIssueModal: React.FC<WeeklyIssueModalProps> = ({ isOpen, onClose, issue }) => {
  const language = useAppStore(state => state.language);
  const { issueData, loading, error } = useWeeklyIssueBody(issue.number, isOpen);

  const t = React.useCallback((zh: string, en: string) => language === 'zh' ? zh : en, [language]);

  const collectedLabel = issue.labels.find(label => label.toLowerCase() === 'weekly');
  const issueNumberLabel = issue.labels.find(label => /^issue-\d+$/i.test(label));
  const issueNumber = issueNumberLabel ? Number(issueNumberLabel.replace(/^\D+/i, '')) : null;
  const submittedDate = issue.createdAt && Number.isFinite(Date.parse(issue.createdAt))
    ? new Date(issue.createdAt).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US')
    : '';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={issue.title || t(`投稿 #${issue.number}`, `Submission #${issue.number}`)}
      maxWidth="max-w-4xl"
      scrollable
      footer={
        <div className="flex items-center justify-between gap-3 w-full">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            {collectedLabel && (
              <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-primary/10 text-primary dark:text-primary">
                {t('周刊收录', 'In Weekly')}
              </span>
            )}
            {issueNumber != null && (
              <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-muted text-muted-foreground dark:text-muted-foreground">
                {t(`第 ${issueNumber} 期`, `Issue #${issueNumber}`)}
              </span>
            )}
            {submittedDate && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground dark:text-muted-foreground">
                <Calendar className="w-3 h-3" />
                {submittedDate}
              </span>
            )}
          </div>
          <a
            href={issue.html_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            {t('在 GitHub 打开', 'Open on GitHub')}
          </a>
        </div>
      }
    >
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground dark:text-muted-foreground">{t('正在加载原贴…', 'Loading original post…')}</p>
        </div>
      ) : error ? (
        <div className="py-10 text-center text-sm text-muted-foreground dark:text-muted-foreground">{error}</div>
      ) : (
        <MarkdownRenderer
          content={issueData?.body ?? ''}
          enableHtml
          baseUrl={issue.html_url}
        />
      )}
    </Modal>
  );
};
