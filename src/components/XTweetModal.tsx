import { getIntlLocale } from '../i18n/format';
import { useT } from "../i18n/useT";
import React from 'react';
import { ExternalLink, Calendar } from 'lucide-react';
import { Modal } from './Modal';
import MarkdownRenderer from './MarkdownRenderer';
import { useAppStore } from '../store/useAppStore';
import type { XTweetRef } from '../types';

interface XTweetModalProps {
  isOpen: boolean;
  onClose: () => void;
  tweet: XTweetRef;
}

/**
 * X 推文的"查看原贴"弹窗：展示抓取到的推文正文（RSS 输出的 HTML 片段，
 * 渲染走 rehype-sanitize），页脚附作者、时间与原推链接。
 */
export const XTweetModal: React.FC<XTweetModalProps> = ({ isOpen, onClose, tweet }) => {
  const language = useAppStore(state => state.language);
  const t = useT('plugins');

  const tweetDate = tweet.createdAt && Number.isFinite(Date.parse(tweet.createdAt))
    ? new Date(tweet.createdAt).toLocaleString(getIntlLocale(language))
    : '';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('xTweetModal.tweet-from-v1', { v1: tweet.handle })}
      maxWidth="max-w-4xl"
      scrollable
      footer={
        <div className="flex items-center justify-between gap-3 w-full">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <span className="rounded-xs bg-accent-tint px-1.5 py-0.5 text-caption font-medium text-accent-text">
              @{tweet.handle}
            </span>
            {tweetDate && (
              <span className="flex items-center gap-1 text-label-sm text-tertiary tabular-nums">
                <Calendar className="size-3" />
                {tweetDate}
              </span>
            )}
          </div>
          <a
            href={tweet.html_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-label font-medium text-secondary hover:text-foreground transition-colors"
          >
            <ExternalLink className="size-3.5" />
            {t('xTweetModal.open-on-x')}
          </a>
        </div>
      }
    >
      {tweet.content ? (
        <MarkdownRenderer
          content={tweet.content}
          enableHtml
          baseUrl={tweet.html_url}
        />
      ) : (
        <div className="py-10 text-center text-label text-tertiary">
          {t('xTweetModal.this-tweet-has-no-text-content')}
        </div>
      )}
    </Modal>
  );
};
