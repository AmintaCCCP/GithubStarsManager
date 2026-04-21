import React, {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
  memo,
} from 'react';

interface VirtualListProps<T> {
  items: T[];
  itemHeight: number | ((index: number) => number);
  containerHeight: number;
  overscan?: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  keyExtractor: (item: T, index: number) => string | number;
  className?: string;
  onScroll?: (scrollTop: number) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingComponent?: React.ReactNode;
  emptyComponent?: React.ReactNode;
}

interface VirtualListHandle {
  scrollToIndex: (index: number, align?: 'start' | 'center' | 'end') => void;
  scrollToTop: () => void;
  getScrollTop: () => number;
}

function VirtualListInner<T>(
  props: VirtualListProps<T>,
  ref: React.ForwardedRef<VirtualListHandle>
) {
  const {
    items,
    itemHeight,
    containerHeight,
    overscan = 3,
    renderItem,
    keyExtractor,
    className = '',
    onScroll,
    onLoadMore,
    hasMore = false,
    loadingComponent,
    emptyComponent,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const loadingRef = useRef(false);

  const isVariableHeight = typeof itemHeight === 'function';
  const fixedItemHeight = typeof itemHeight === 'number' ? itemHeight : 50;

  const getItemHeight = useCallback(
    (index: number) => {
      if (isVariableHeight) {
        return (itemHeight as (index: number) => number)(index);
      }
      return fixedItemHeight;
    },
    [isVariableHeight, itemHeight, fixedItemHeight]
  );

  const itemOffsets = useMemo(() => {
    const offsets: number[] = [];
    let offset = 0;
    for (let i = 0; i < items.length; i++) {
      offsets.push(offset);
      offset += getItemHeight(i);
    }
    return offsets;
  }, [items.length, getItemHeight]);

  const totalHeight = useMemo(() => {
    if (itemOffsets.length === 0) return 0;
    return itemOffsets[itemOffsets.length - 1] + getItemHeight(items.length - 1);
  }, [itemOffsets, items.length, getItemHeight]);

  const visibleRange = useMemo(() => {
    if (items.length === 0) return { start: 0, end: 0 };

    let start = 0;
    let end = items.length - 1;

    for (let i = 0; i < itemOffsets.length; i++) {
      if (itemOffsets[i] + getItemHeight(i) > scrollTop - overscan * fixedItemHeight) {
        start = Math.max(0, i - overscan);
        break;
      }
    }

    for (let i = start; i < itemOffsets.length; i++) {
      if (itemOffsets[i] > scrollTop + containerHeight + overscan * fixedItemHeight) {
        end = Math.min(items.length - 1, i + overscan);
        break;
      }
    }

    return { start, end };
  }, [scrollTop, containerHeight, itemOffsets, items.length, overscan, fixedItemHeight, getItemHeight]);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const newScrollTop = e.currentTarget.scrollTop;
      setScrollTop(newScrollTop);
      onScroll?.(newScrollTop);

      if (hasMore && onLoadMore && !loadingRef.current) {
        const scrollBottom = newScrollTop + containerHeight;
        const threshold = totalHeight - fixedItemHeight * 2;

        if (scrollBottom >= threshold) {
          loadingRef.current = true;
          setIsLoading(true);
          Promise.resolve(onLoadMore()).finally(() => {
            loadingRef.current = false;
            setIsLoading(false);
          });
        }
      }
    },
    [hasMore, onLoadMore, containerHeight, totalHeight, fixedItemHeight, onScroll]
  );

  const scrollToIndex = useCallback(
    (index: number, align: 'start' | 'center' | 'end' = 'start') => {
      if (!containerRef.current || index < 0 || index >= items.length) return;

      const offset = itemOffsets[index];
      const height = getItemHeight(index);
      let targetScrollTop = offset;

      if (align === 'center') {
        targetScrollTop = offset - (containerHeight - height) / 2;
      } else if (align === 'end') {
        targetScrollTop = offset - containerHeight + height;
      }

      containerRef.current.scrollTop = Math.max(0, targetScrollTop);
    },
    [items.length, itemOffsets, getItemHeight, containerHeight]
  );

  const scrollToTop = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, []);

  const getScrollTop = useCallback(() => {
    return containerRef.current?.scrollTop ?? 0;
  }, []);

  useEffect(() => {
    if (ref) {
      (ref as React.MutableRefObject<VirtualListHandle>).current = {
        scrollToIndex,
        scrollToTop,
        getScrollTop,
      };
    }
  }, [ref, scrollToIndex, scrollToTop, getScrollTop]);

  if (items.length === 0) {
    return (
      <div
        className={className}
        style={{ height: containerHeight, overflow: 'auto' }}
      >
        {emptyComponent || (
          <div className="flex items-center justify-center h-full text-gray-400">
            No items to display
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        height: containerHeight,
        overflow: 'auto',
        contain: 'strict',
      }}
      onScroll={handleScroll}
    >
      <div
        style={{
          height: totalHeight,
          position: 'relative',
        }}
      >
        {items.slice(visibleRange.start, visibleRange.end + 1).map((item, i) => {
          const actualIndex = visibleRange.start + i;
          const top = itemOffsets[actualIndex];
          const height = getItemHeight(actualIndex);

          return (
            <div
              key={keyExtractor(item, actualIndex)}
              style={{
                position: 'absolute',
                top,
                left: 0,
                right: 0,
                height,
                containLayout: true,
              }}
            >
              {renderItem(item, actualIndex)}
            </div>
          );
        })}
      </div>
      {isLoading && loadingComponent && (
        <div className="flex justify-center py-4">{loadingComponent}</div>
      )}
    </div>
  );
}

export const VirtualList = memo(
  React.forwardRef(VirtualListInner)
) as <T>(
  props: VirtualListProps<T> & { ref?: React.ForwardedRef<VirtualListHandle> }
) => React.ReactElement;

export type { VirtualListHandle, VirtualListProps };
