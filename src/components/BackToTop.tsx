



import { useT } from '../i18n/useT';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowUp } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { Button } from './ui/button';

export const BackToTop: React.FC = () => {
    const t = useT('app');
  const [isVisible, setIsVisible] = useState(false);
  const [isBouncing, setIsBouncing] = useState(false);
  // 当 README 模态框打开时隐藏按钮，避免遮挡模态框内容
  const readmeModalOpen = useAppStore(state => state.readmeModalOpen);
  const reduceMotion = useAppStore(state => state.themeTokens.animation === 'reduced');
  const bounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleVisibility = useCallback(() => {
    if (window.scrollY > 300) {
      setIsVisible(true);
    } else {
      setIsVisible(false);
    }
  }, []);

  const scrollToTop = useCallback(() => {
    const systemReduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({
      top: 0,
      behavior: reduceMotion || systemReduceMotion ? 'auto' : 'smooth',
    });
  }, [reduceMotion]);

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
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={scrollToTop}
      className={`
        fixed z-50
        flex size-9 items-center justify-center
        rounded-lg border-0 bg-floating text-secondary shadow-elev-2
        transition-[opacity,transform,background-color,color] duration-micro ease-out-subtle
        hover:bg-fill-hover hover:text-foreground hover:duration-instant
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50
        ${isVisible && !readmeModalOpen
          ? 'opacity-100 translate-y-0 pointer-events-auto'
          : 'opacity-0 translate-y-3 pointer-events-none'
        }
        ${isBouncing ? 'animate-bounce-twice' : ''}
        bottom-20 right-4
        sm:bottom-20 sm:right-6
      `}
      aria-label={t('backToTop.back-to-top')}
      aria-hidden={!isVisible || readmeModalOpen}
      tabIndex={isVisible && !readmeModalOpen ? 0 : -1}
      title={t('backToTop.back-to-top')}
    >
      <ArrowUp className="size-4" />
    </Button>
  );
};
