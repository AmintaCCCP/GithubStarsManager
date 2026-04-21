import { DiscoveryChannelId } from '../types';

export const ITEMS_PER_PAGE = 20;

export interface PaginationState {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface PageChangeResult {
  newPage: number;
  shouldLoadData: boolean;
  startIndex: number;
  endIndex: number;
}

export function calculatePaginationState(
  currentPage: number,
  totalPages: number,
  totalCount: number
): PaginationState {
  return {
    currentPage: Math.max(1, Math.min(currentPage, totalPages || 1)),
    totalPages: Math.max(0, totalPages),
    totalCount: Math.max(0, totalCount),
    hasNextPage: currentPage < totalPages,
    hasPreviousPage: currentPage > 1,
  };
}

export function calculatePageChange(
  requestedPage: number,
  totalPages: number,
  hasDataForPage: boolean,
  isLoading: boolean
): PageChangeResult {
  const clampedPage = Math.max(1, Math.min(requestedPage, totalPages || 1));
  
  return {
    newPage: clampedPage,
    shouldLoadData: !hasDataForPage && !isLoading,
    startIndex: (clampedPage - 1) * ITEMS_PER_PAGE,
    endIndex: clampedPage * ITEMS_PER_PAGE,
  };
}

export function getPageRange(
  currentPage: number,
  totalPages: number,
  delta: number = 2
): (number | '...')[] {
  if (totalPages <= 1) return [];
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

export function isValidPageNumber(
  page: number,
  totalPages: number
): boolean {
  return !isNaN(page) && page >= 1 && page <= totalPages;
}

export function sanitizePageInput(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) {
    return null;
  }
  const page = parseInt(trimmed, 10);
  return isNaN(page) ? null : page;
}

export interface PaginationParams {
  channelId: DiscoveryChannelId;
  page: number;
  append?: boolean;
}

export function createPaginationParams(
  channelId: DiscoveryChannelId,
  page: number,
  append: boolean = false
): PaginationParams {
  return { channelId, page: Math.max(1, page), append };
}

export function calculateTotalPages(totalCount: number): number {
  if (totalCount <= 0) return 0;
  return Math.max(1, Math.ceil(totalCount / ITEMS_PER_PAGE));
}

export function calculateStartEndIndex(page: number): { startIndex: number; endIndex: number } {
  const safePage = Math.max(1, page);
  return {
    startIndex: (safePage - 1) * ITEMS_PER_PAGE,
    endIndex: safePage * ITEMS_PER_PAGE,
  };
}
