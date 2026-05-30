import React, { useLayoutEffect, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface FloatingTooltipProps {
  content: React.ReactNode;
  visible: boolean;
  triggerRef: React.RefObject<HTMLElement | null>;
  onMouseLeave: () => void;
  onMouseEnter?: () => void;
}

function isPointerNear(el: HTMLElement | null, x: number, y: number, padding: number): boolean {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return (
    x >= rect.left - padding &&
    x <= rect.right + padding &&
    y >= rect.top - padding &&
    y <= rect.bottom + padding
  );
}

export const FloatingTooltip: React.FC<FloatingTooltipProps> = ({
  content,
  visible,
  triggerRef,
  onMouseLeave,
  onMouseEnter,
}) => {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current || !tooltipRef.current || !visible) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipEl = tooltipRef.current;

    tooltipEl.style.maxHeight = '280px';
    const tooltipHeight = tooltipEl.offsetHeight;
    const tooltipWidth = triggerRect.width;

    const top = triggerRect.top - tooltipHeight - 8;
    const left = triggerRect.left;

    if (top < 8) {
      tooltipEl.style.top = `${triggerRect.bottom + 8}px`;
      tooltipEl.style.bottom = 'auto';
    } else {
      tooltipEl.style.top = `${top}px`;
      tooltipEl.style.bottom = 'auto';
    }

    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.width = `${tooltipWidth}px`;
  }, [triggerRef, visible]);

  useLayoutEffect(() => {
    if (visible) {
      updatePosition();
      const handleResize = () => {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(updatePosition);
      };
      window.addEventListener('resize', handleResize);
      window.addEventListener('scroll', handleResize, true);
      return () => {
        cancelAnimationFrame(rafRef.current);
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('scroll', handleResize, true);
      };
    }
  }, [visible, updatePosition]);

  // Safety net: detect when pointer is far from both trigger and tooltip,
  // covering edge cases where mouseenter/mouseleave events don't fire correctly
  // (e.g., portal gap, fast mouse movement, scroll repositioning).
  // Uses a debounce so the pointer can travel through the gap between
  // trigger and tooltip without premature dismissal.
  useEffect(() => {
    if (!visible) return;

    let rafId = 0;
    let awayTimer = 0;
    const handlePointerMove = (e: PointerEvent) => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const nearTrigger = isPointerNear(triggerRef.current, e.clientX, e.clientY, 10);
        const nearTooltip = isPointerNear(tooltipRef.current, e.clientX, e.clientY, 10);
        if (!nearTrigger && !nearTooltip) {
          if (!awayTimer) {
            awayTimer = window.setTimeout(() => onMouseLeave(), 100);
          }
        } else {
          clearTimeout(awayTimer);
          awayTimer = 0;
        }
      });
    };

    document.addEventListener('pointermove', handlePointerMove);
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(awayTimer);
      document.removeEventListener('pointermove', handlePointerMove);
    };
  }, [visible, onMouseLeave, triggerRef]);

  if (!visible) return null;

  return createPortal(
    <div
      ref={tooltipRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="fixed z-[9999] p-4 bg-white dark:bg-surface-3 text-gray-900 dark:text-text-primary text-[13px] leading-[1.625] rounded-xl shadow-dialog border border-gray-200/80 dark:border-white/[0.04] animate-fade-in max-h-[280px] overflow-y-auto scrollbar-auto"
      style={{ pointerEvents: 'auto' }}
    >
      <div className="whitespace-pre-wrap break-words pr-2">
        {content}
      </div>
    </div>,
    document.body
  );
};