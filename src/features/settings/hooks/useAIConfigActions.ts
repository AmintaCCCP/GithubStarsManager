
import { TranslateFn } from '../../../i18n/useT';
import { useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { AIConfig } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { useDialog } from '../../../hooks/useDialog';
import { AIService } from '../../../services/aiService';

interface UseAIConfigActionsOptions {
  t: TranslateFn;
}

export interface AIConfigActions {
  testingId: string | null;
  testingForm: boolean;
  testConfig: (config: AIConfig) => Promise<void>;
  testDraft: (config: AIConfig) => Promise<void>;
}

/**
 * Encapsulates AI connection tests so settings presentation code never creates
 * service instances or turns provider failures into UI messages directly.
 */
export const useAIConfigActions = ({ t }: UseAIConfigActionsOptions): AIConfigActions => {
  const language = useAppStore(useShallow((state) => state.language));
  const { toast } = useDialog();
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testingForm, setTestingForm] = useState(false);

  const runConnectionTest = useCallback(async (config: AIConfig) => {
    try {
      const result = await new AIService(config, language).testConnection();
      if (result.success) {
        toast(t('useAIConfigActions.ai-service-connection-successful'), 'success');
      } else {
        toast(result.message, 'error');
      }
    } catch (error) {
      console.error('AI test failed:', error);
      toast(
        t('useAIConfigActions.ai-service-test-failed-please-check-network-conn'),
        'error',
      );
    }
  }, [language, t, toast]);

  const testConfig = useCallback(async (config: AIConfig) => {
    setTestingId(config.id);
    try {
      await runConnectionTest(config);
    } finally {
      setTestingId(null);
    }
  }, [runConnectionTest]);

  const testDraft = useCallback(async (config: AIConfig) => {
    setTestingForm(true);
    try {
      await runConnectionTest(config);
    } finally {
      setTestingForm(false);
    }
  }, [runConnectionTest]);

  return { testingId, testingForm, testConfig, testDraft };
};
