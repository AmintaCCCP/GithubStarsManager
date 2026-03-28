import { Repository, Category } from '../types';

export const SNAPSHOT_VERSION = 1;

export interface GithubStarsSnapshot {
  version: number;
  exportedAt: string;
  repositories: Repository[];
  categories: Category[];
}

export interface SearchOptions {
  query?: string;
  limit?: number;
}

export interface SearchResult {
  repositories: Repository[];
  total: number;
  query: string;
}
