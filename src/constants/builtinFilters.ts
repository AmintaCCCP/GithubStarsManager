export const BUILTIN_FILTER_PREFIX = 'builtin-';
export const BUILTIN_CURRENT_SYSTEM_FILTER_ID = 'builtin-current-system';

export const isBuiltinFilterId = (id: string): boolean => id.startsWith(BUILTIN_FILTER_PREFIX);
