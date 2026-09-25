import * as React from 'react';

const SCROLL_STOP_DELAY_MS = 700;

/**
 * 驱动 `scrollbar-on-scroll` 工具类的滚动状态：滚动期间（及停止后一小段
 * 缓冲窗内）返回 true 让 thumb 显形，静止后自动回落，供 `.scrolling` 切换。
 * active 变为 false（如弹窗关闭）时清掉挂起的定时器并复位，避免迟到的
 * 状态更新落在已关闭的视图上。
 */
export const useScrollbarFlash = (active: boolean): {
  isScrolling: boolean;
  handleScroll: () => void;
} => {
  const [isScrolling, setIsScrolling] = React.useState(false);
  const scrollStopTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => () => {
    if (scrollStopTimerRef.current) window.clearTimeout(scrollStopTimerRef.current);
  }, []);

  React.useEffect(() => {
    if (active) return;
    if (scrollStopTimerRef.current) {
      window.clearTimeout(scrollStopTimerRef.current);
      scrollStopTimerRef.current = null;
    }
    setIsScrolling(false);
  }, [active]);

  const handleScroll = React.useCallback(() => {
    setIsScrolling(true);
    if (scrollStopTimerRef.current) window.clearTimeout(scrollStopTimerRef.current);
    scrollStopTimerRef.current = window.setTimeout(() => {
      setIsScrolling(false);
      scrollStopTimerRef.current = null;
    }, SCROLL_STOP_DELAY_MS);
  }, []);

  return { isScrolling, handleScroll };
};
