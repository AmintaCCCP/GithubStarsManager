import { useEffect, useRef, useState } from 'react';
import type { RepositoryChatMessage } from '../../../types/repositoryChat';

export type TurnAnnouncementStatus = '' | RepositoryChatMessage['status'];

/**
 * 仅在回答由流式进入终态时产出一次性的屏幕阅读器通报文本。
 * 进入流式状态时先清空旧通报，保证连续两轮回答完成时同一文案也能再次播报。
 */
export const useTurnStatusAnnouncement = (lastAssistantStatus: TurnAnnouncementStatus, language: 'zh' | 'en'): string => {
  const [announcement, setAnnouncement] = useState('');
  const previousStatusRef = useRef<TurnAnnouncementStatus>('');

  useEffect(() => {
    const previous = previousStatusRef.current;
    previousStatusRef.current = lastAssistantStatus;
    if (lastAssistantStatus === 'streaming') {
      setAnnouncement('');
      return;
    }
    if (previous !== 'streaming') return;
    const zh = language === 'zh';
    if (lastAssistantStatus === 'complete') setAnnouncement(zh ? '回答已完成。' : 'Answer complete.');
    else if (lastAssistantStatus === 'error') setAnnouncement(zh ? '回答生成失败。' : 'Answer generation failed.');
    else if (lastAssistantStatus === 'aborted') setAnnouncement(zh ? '已停止生成。' : 'Generation stopped.');
  }, [lastAssistantStatus, language]);

  return announcement;
};
