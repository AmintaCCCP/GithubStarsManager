import { useCallback, useMemo } from 'react';
import { DiscoveryChannelId, DiscoveryRepo } from '../types';
import { ITEMS_PER_PAGE } from './pagination';

export interface UsePaginationConfig {
  channelId: DiscoveryChannelId;
  repos: DiscoveryRepo[];
  currentPage: number;
  totalCount: number;
  isLoading: boolean;
  onPageChange: (page: number) => void;
}

export interface UsePaginationReturn {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  isFirstPage: boolean;
  isLastPage: boolean;
  pageItems: DiscoveryRepo[];
  isPageInRange: (page: number) => boolean;
  goToNextPage: () => void;
  goToPreviousPage: () => void;
  goToPage: (page: number) => void;
  goToFirstPage: () => void;
  goToLastPage: () => void;
  canNavigate: boolean;
  shouldLoadPage: boolean;
  pageRange: { start: number; end: number };
}

export function usePagination({
  channelId,
  repos,
  currentPage,
  totalCount,
  isLoading,
  onPageChange,
}: UsePaginationConfig): UsePaginationReturn {
  const totalPages = useMemo(() => {
    if (totalCount <= 0) return 0;
    return Math.max(1, Math.ceil(totalCount / ITEMS_PER_PAGE));
  }, [totalCount]);

  const hasNextPage = currentPage < totalPages;
  const hasPreviousPage = currentPage > 1;
  const isFirstPage = currentPage === 1;
  const isLastPage = currentPage >= totalPages;
  const canNavigate = !isLoading && totalPages > 1;

  const pageRange = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE + 1;
    const end = Math.min(currentPage * ITEMS_PER_PAGE, totalCount);
    return { start, end };
  }, [currentPage, totalCount]);

  const pageItems = useMemo(() => {
    const safePage = Math.max(1, Math.min(currentPage, totalPages || 1));
    const startIndex = (safePage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    return repos.slice(startIndex, endIndex);
  }, [repos, currentPage, totalPages]);

  const shouldLoadPage = useMemo(() => {
    return pageItems.length === 0 && !isLoading;
  }, [pageItems.length, isLoading]);

  const isPageInRange = useCallback(
    (page: number) => {
      return page >= 1 && page <= totalPages;
    },
    [totalPages]
  );

  const goToNextPage = useCallback(() => {
    if (hasNextPage && !isLoading) {
      console.log(`[Pagination:${channelId}] goToNextPage: ${currentPage} -> ${currentPage + 1}`);
      onPageChange(currentPage + 1);
    }
  }, [currentPage, hasNextPage, isLoading, channelId, onPageChange]);

  const goToPreviousPage = useCallback(() => {
    if (hasPreviousPage && !isLoading) {
      console.log(`[Pagination:${channelId}] goToPreviousPage: ${currentPage} -> ${currentPage - 1}`);
      onPageChange(currentPage - 1);
    }
  }, [currentPage, hasPreviousPage, isLoading, channelId, onPageChange]);

  const goToPage = useCallback(
    (page: number) => {
      const validPage = Math.max(1, Math.min(page, totalPages || 1));
      if (validPage !== currentPage && !isLoading) {
        console.log(`[Pagination:${channelId}] goToPage: ${currentPage} -> ${validPage}`);
        onPageChange(validPage);
      }
    },
    [currentPage, totalPages, isLoading, channelId, onPageChange]
  );

  const goToFirstPage = useCallback(() => {
    if (!isFirstPage && !isLoading) {
      console.log(`[Pagination:${channelId}] goToFirstPage: ${currentPage} -> 1`);
      onPageChange(1);
    }
  }, [currentPage, isFirstPage, isLoading, channelId, onPageChange]);

  const goToLastPage = useCallback(() => {
    if (!isLastPage && !isLoading && totalPages > 0) {
      console.log(`[Pagination:${channelId}] goToLastPage: ${currentPage} -> ${totalPages}`);
      onPageChange(totalPages);
    }
  }, [currentPage, isLastPage, isLoading, totalPages, channelId, onPageChange]);

  return {
    currentPage,
    totalPages,
    totalCount,
    hasNextPage,
    hasPreviousPage,
    isFirstPage,
    isLastPage,
    pageItems,
    isPageInRange,
    goToNextPage,
    goToPreviousPage,
    goToPage,
    goToFirstPage,
    goToLastPage,
    canNavigate,
    shouldLoadPage,
    pageRange,
  };
}

export function getPageNumbers(
  currentPage: number,
  totalPages: number,
  delta: number = 2
): (number | '...')[] {
  if (totalPages <= 0) return [];
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages: (number | '...')[] = [];

  for (let i = 1; i <= totalPages; i++) {
    if (
      i === 1 ||
      i === totalPages ||
      (i >= currentPage - delta && i <= currentPage + delta)
    ) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== '...') {
      pages.push('...');
    }
  }

  return pages;
}

export function validatePageInput(
  input: string,
  minPage: number,
  maxPage: number
): { isValid: boolean; page: number | null; error: string | null } {
  const trimmed = input.trim();

  if (!trimmed) {
    return { isValid: false, page: null, error: '请输入页码' };
  }

  if (!/^\d+$/.test(trimmed)) {
    return { isValid: false, page: null, error: '请输入有效数字' };
  }

  const page = parseInt(trimmed, 10);

  if (isNaN(page)) {
    return { isValid: false, page: null, error: '请输入有效页码' };
  }

  if (page < minPage) {
    return { isValid: false, page: null, error: `页码不能小于${minPage}` };
  }

  if (page > maxPage) {
    return { isValid: false, page: null, error: `页码不能超过${maxPage}` };
  }

  return { isValid: true, page, error: null };
}
