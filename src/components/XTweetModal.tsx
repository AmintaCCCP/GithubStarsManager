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
            <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-primary/10 text-primary dark:text-primary">
              @{tweet.handle}
            </span>
            {tweetDate && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground dark:text-muted-foreground">
                <Calendar className="w-3 h-3" />
                {tweetDate}
              </span>
            )}
          </div>
          <a
            href={tweet.html_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
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
        <div className="py-10 text-center text-sm text-muted-foreground dark:text-muted-foreground">
          {t('xTweetModal.this-tweet-has-no-text-content')}
        </div>
      )}
    </Modal>
  );
};
