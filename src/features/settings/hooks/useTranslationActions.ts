import { useCallback } from 'react';
import { translateBatch } from '../../../services/translateService';
import type { TranslateResult } from '../../../services/translateService';

export type { TranslateResult };

export interface TranslationActions {
  translateBatch: typeof translateBatch;
}

export const useTranslationActions = (): TranslationActions => {
  // Pure passthrough for layering compliance; Parameters<> keeps the signature
  // locked to the service so the two cannot drift apart.
  const run = useCallback(
    (...args: Parameters<typeof translateBatch>) => translateBatch(...args),
    [],
  );
  return { translateBatch: run };
};
