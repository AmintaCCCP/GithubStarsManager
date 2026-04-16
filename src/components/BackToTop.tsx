import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowUp } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

export const BackToTop: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [isBouncing, setIsBouncing] = useState(false);
  const language = useAppStore(state => state.language);
  const bounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleVisibility = useCallback(() => {
    if (window.scrollY > 300) {
      setIsVisible(true);
    } else {
      setIsVisible(false);
    }
  }, []);

  const scrollToTop = useCallback(() => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  }, []);

  // 触发跳跃动画
  const triggerBounce = useCallback(() => {
    if (bounceTimeoutRef.current) {
      clearTimeout(bounceTimeoutRef.current);
    }
    setIsBouncing(true);
    bounceTimeoutRef.current = setTimeout(() => {
      setIsBouncing(false);
    }, 600);
  }, []);

  useEffect(() => {
    window.addEventListener('scroll', toggleVisibility, { passive: true });
    toggleVisibility();
    return () => {
      window.removeEventListener('scroll', toggleVisibility);
    };
  }, [toggleVisibility]);

  // 监听全局跳跃动画事件
  useEffect(() => {
    const handleBounceEvent = () => {
      if (isVisible) {
        triggerBounce();
      }
    };

    window.addEventListener('gsm:back-to-top-bounce', handleBounceEvent);
    return () => {
      window.removeEventListener('gsm:back-to-top-bounce', handleBounceEvent);
      if (bounceTimeoutRef.current) {
        clearTimeout(bounceTimeoutRef.current);
      }
    };
  }, [isVisible, triggerBounce]);

  return (
    <button
      type="button"
      onClick={scrollToTop}
      className={`
        fixed z-50
        flex items-center justify-center
        w-12 h-12
        bg-blue-600 hover:bg-blue-700
        dark:bg-blue-500 dark:hover:bg-blue-600
        text-white
        rounded-full
        shadow-lg hover:shadow-xl
        transform transition-all duration-300 ease-out
        hover:scale-110
        focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
        dark:focus:ring-offset-gray-900
        ${isVisible
          ? 'opacity-100 translate-y-0 pointer-events-auto'
          : 'opacity-0 translate-y-4 pointer-events-none'
        }
        ${isBouncing ? 'animate-bounce-twice' : ''}
        /* 移动端：大幅上移避免遮挡底部多选工具栏 */
        bottom-24 right-4
        /* 平板：继续上移 */
        sm:bottom-28 sm:right-6
        /* 桌面：适度上移 */
        lg:bottom-24 lg:right-10
      `}
      aria-label={language === 'zh' ? '回到顶部' : 'Back to top'}
      aria-hidden={!isVisible}
      tabIndex={isVisible ? 0 : -1}
      title={language === 'zh' ? '回到顶部' : 'Back to top'}
    >
      <ArrowUp className="w-5 h-5 sm:w-6 sm:h-6" />
    </button>
  );
};
