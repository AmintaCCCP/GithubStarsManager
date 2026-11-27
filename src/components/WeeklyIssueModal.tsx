import { getIntlLocale } from '../i18n/format';
import { useT } from "../i18n/useT";
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

  const t = useT('discovery');

  const collectedLabel = issue.labels.find(label => label.toLowerCase() === 'weekly');
  const issueNumberLabel = issue.labels.find(label => /^issue-\d+$/i.test(label));
  const issueNumber = issueNumberLabel ? Number(issueNumberLabel.replace(/^\D+/i, '')) : null;
  const submittedDate = issue.createdAt && Number.isFinite(Date.parse(issue.createdAt))
    ? new Date(issue.createdAt).toLocaleDateString(getIntlLocale(language))
    : '';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={issue.title || t('weeklyIssueModal.submission-v1', { v1: issue.number })}
      maxWidth="max-w-4xl"
      scrollable
      footer={
        <div className="flex items-center justify-between gap-3 w-full">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            {collectedLabel && (
              <span className="rounded-xs bg-accent-tint px-1.5 py-0.5 text-caption font-medium text-accent-text">
                {t('weeklyIssueModal.in-weekly')}
              </span>
            )}
            {issueNumber != null && (
              <span className="rounded-xs bg-fill-hover px-1.5 py-0.5 text-caption font-medium text-secondary tabular-nums">
                {t('weeklyIssueModal.issue-issuenumber', { issueNumber: issueNumber })}
              </span>
            )}
            {submittedDate && (
              <span className="flex items-center gap-1 text-label-sm text-tertiary tabular-nums">
                <Calendar className="size-3" />
                {submittedDate}
              </span>
            )}
          </div>
          <a
            href={issue.html_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-label font-medium text-secondary hover:text-foreground transition-colors"
          >
            <ExternalLink className="size-3.5" />
            {t('weeklyIssueModal.open-on-github')}
          </a>
        </div>
      }
    >
      {loading ? (
        <div className="flex flex-col items-center justify-center py-14 gap-3">
          <Loader2 className="size-6 animate-spin text-accent-text" />
          <p className="text-label text-secondary">{t('weeklyIssueModal.loading-original-post')}</p>
        </div>
      ) : error ? (
        <div className="py-10 text-center text-label text-tertiary">{error}</div>
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
