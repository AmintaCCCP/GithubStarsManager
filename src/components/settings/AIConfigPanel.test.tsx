import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIConfigPanel } from './AIConfigPanel';
import { useAppStore } from '../../store/useAppStore';

vi.mock('../../store/useAppStore', async (importOriginal) => importOriginal());

vi.mock('../../hooks/useDialog', () => ({
  useDialog: () => ({
    toast: vi.fn(),
    confirm: vi.fn().mockResolvedValue(false),
  }),
}));

vi.mock('../../features/settings/hooks/useAIConfigActions', () => ({
  useAIConfigActions: () => ({
    testingId: null,
    testingForm: false,
    testConfig: vi.fn(),
    testDraft: vi.fn(),
  }),
}));

const t = (key: string) => key;

describe('AIConfigPanel checkbox controls', () => {
  beforeEach(() => {
    const state = useAppStore.getState();
    useAppStore.setState({
      aiConfigs: [],
      activeAIConfig: null,
      autoTranslateRepoDescription: false,
      repositoryChatSettings: {
        ...state.repositoryChatSettings,
        enabled: false,
        enableWebTools: false,
        enableAgentToolLoop: false,
      },
    });
  });

  it('toggles repository chat and automatic translation from the control and label', async () => {
    const user = userEvent.setup();
    render(<AIConfigPanel t={t} />);

    const chat = screen.getByRole('checkbox', { name: 'aIConfigPanel.enable-repository-chat' });
    expect(chat).toHaveAttribute('data-state', 'unchecked');
    await user.click(chat);
    await waitFor(() => {
      expect(chat).toHaveAttribute('data-state', 'checked');
      expect(useAppStore.getState().repositoryChatSettings.enabled).toBe(true);
    });

    const translation = screen.getByRole('checkbox', { name: /aIConfigPanel.auto-translate-repo-descriptions/ });
    expect(translation).toHaveAttribute('data-state', 'unchecked');
    await user.click(screen.getByText('aIConfigPanel.auto-translate-repo-descriptions'));
    await waitFor(() => {
      expect(translation).toHaveAttribute('data-state', 'checked');
      expect(useAppStore.getState().autoTranslateRepoDescription).toBe(true);
    });
  });
});
