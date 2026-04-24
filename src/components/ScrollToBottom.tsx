import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowDown } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

interface ScrollToBottomProps {
  scrollContainerRef: React.RefObject<HTMLElement>;
}

export const ScrollToBottom: React.FC<ScrollToBottomProps> = ({ 
  scrollContainerRef 
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const language = useAppStore(state => state.language);
  // 当 README 模态框打开时隐藏按钮，避免遮挡模态框内容
  const readmeModalOpen = useAppStore(state => state.readmeModalOpen);
  const containerRef = useRef<HTMLElement | null>(null);

  const checkVisibility = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    
    const { scrollTop, scrollHeight, clientHeight } = container;
    const containerCanScroll = scrollHeight > clientHeight + 50;
    
    if (containerCanScroll) {
      const isNearBottom = scrollTop + clientHeight >= scrollHeight - 50;
      setIsVisible(scrollTop > 50 && !isNearBottom);
    } else {
      const windowScrollY = window.scrollY;
      const documentHeight = document.documentElement.scrollHeight;
      const viewportHeight = window.innerHeight;
      const isNearBottom = windowScrollY + viewportHeight >= documentHeight - 50;
      setIsVisible(windowScrollY > 50 && !isNearBottom);
    }
  }, [scrollContainerRef]);

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollHeight, clientHeight } = container;
    const containerCanScroll = scrollHeight > clientHeight + 50;
    
    if (containerCanScroll) {
      container.scrollTo({
        top: scrollHeight,
        behavior: 'smooth',
      });
    } else {
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [scrollContainerRef]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    containerRef.current = container;

    container.addEventListener('scroll', checkVisibility, { passive: true });
    window.addEventListener('scroll', checkVisibility, { passive: true });
    checkVisibility();
    
    return () => {
      if (containerRef.current) {
        containerRef.current.removeEventListener('scroll', checkVisibility);
      }
      window.removeEventListener('scroll', checkVisibility);
    };
  }, [checkVisibility]);

  return (
    <button
      type="button"
      onClick={scrollToBottom}
      className={`
        fixed z-[1000]
        flex items-center justify-center
        w-12 h-12
        bg-brand-indigo hover:bg-gray-100 dark:bg-white/[0.04]
        dark:bg-status-emerald0 dark:hover:bg-brand-indigo
        text-white
        rounded-full
        shadow-lg hover:shadow-xl
        transform transition-[opacity,transform] duration-300 ease-out
        hover:scale-110
        focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2
        dark:focus:ring-offset-gray-900
        ${isVisible && !readmeModalOpen
          ? 'opacity-100 translate-y-0 pointer-events-auto'
          : 'opacity-0 translate-y-4 pointer-events-none'
        }
        bottom-24 left-4
        sm:bottom-28 sm:left-6
        lg:bottom-24 lg:left-10
      `}
      aria-label={language === 'zh' ? '滚动到底部' : 'Scroll to bottom'}
      aria-hidden={!isVisible || readmeModalOpen}
      tabIndex={isVisible && !readmeModalOpen ? 0 : -1}
      title={language === 'zh' ? '滚动到底部' : 'Scroll to bottom'}
    >
      <ArrowDown className="w-5 h-5 sm:w-6 sm:h-6" />
    </button>
  );
};
