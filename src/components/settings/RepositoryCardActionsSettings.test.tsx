import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RepositoryCardActionsSettings } from './RepositoryCardActionsSettings';
import { useAppStore } from '../../store/useAppStore';
import { DEFAULT_REPOSITORY_CARD_ACTIONS, type RepositoryCardActionPreference } from '../../types/repositoryCardActions';
import { usePluginActions } from '../../plugins/hooks/usePluginActions';

vi.mock('../../plugins/hooks/usePluginActions', () => ({
  usePluginActions: vi.fn(),
}));

const mockUseAppStore = vi.mocked(useAppStore);
const mockUsePluginActions = vi.mocked(usePluginActions);

interface MockSettingsState {
  language: string;
  repositoryCardActions: RepositoryCardActionPreference[];
  setRepositoryCardActions: (actions: RepositoryCardActionPreference[]) => void;
  pluginCustomIcons: Record<string, string>;
}

describe('RepositoryCardActionsSettings', () => {
  const setRepositoryCardActions = vi.fn();
  let state: MockSettingsState;

  beforeEach(() => {
    vi.clearAllMocks();
    state = {
      language: 'zh',
      repositoryCardActions: DEFAULT_REPOSITORY_CARD_ACTIONS.map((item) => ({ ...item })),
      setRepositoryCardActions: setRepositoryCardActions.mockImplementation((actions) => {
        state.repositoryCardActions = actions;
      }),
      pluginCustomIcons: {
        'com.example.insights': 'activity',
      },
    };

    mockUseAppStore.mockImplementation(((selector?: (s: MockSettingsState) => unknown) =>
      (selector ? selector(state) : state)) as unknown as typeof useAppStore,
    );

    mockUsePluginActions.mockReturnValue({
      actions: [
        {
          id: 'view-insights',
          title: '仓库洞察',
          placement: 'repository-card',
          pluginId: 'com.example.insights',
          pluginName: 'Repo Insights',
        },
      ],
      runAction: vi.fn(),
    });
  });

  const renderComponent = () =>
    render(
      <RepositoryCardActionsSettings
        title="快捷操作设置"
        hint="调整按钮顺序"
        resetLabel="恢复默认按钮排列"
        moveUpLabel={(a) => `${a}上移`}
        moveDownLabel={(a) => `${a}下移`}
        visibilityLabel={(a) => `显示${a}`}
      />,
    );

  it('renders enabled plugins in the actions list alongside built-in actions', () => {
    renderComponent();

    // Built-in actions and plugin action are visible
    expect(screen.getByText('AI 分析')).toBeInTheDocument();
    expect(screen.getByText('仓库洞察')).toBeInTheDocument();
    expect(screen.getByText('(Repo Insights)')).toBeInTheDocument();
  });

  it('allows toggling visibility of the plugin action', async () => {
    const user = userEvent.setup();
    renderComponent();

    const switchBtn = screen.getByRole('switch', { name: '显示仓库洞察' });
    expect(switchBtn).not.toBeChecked(); // defaults to false for newly discovered plugins

    await user.click(switchBtn);
    expect(setRepositoryCardActions).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'plugin:com.example.insights:view-insights',
          visible: true,
        }),
      ]),
    );
  });

  it('allows moving the plugin action up', async () => {
    const user = userEvent.setup();
    renderComponent();

    const moveUpBtn = screen.getByRole('button', { name: '仓库洞察上移' });
    await user.click(moveUpBtn);

    expect(setRepositoryCardActions).toHaveBeenCalled();
    const lastCall = setRepositoryCardActions.mock.calls[0][0] as RepositoryCardActionPreference[];
    const pluginIndex = lastCall.findIndex((a) => a.id === 'plugin:com.example.insights:view-insights');
    // Originally at index 7 (after 7 built-ins), should now be at index 6
    expect(pluginIndex).toBe(6);
  });

  it('resets actions including enabled plugin actions', async () => {
    const user = userEvent.setup();
    state.repositoryCardActions = [
      { id: 'plugin:com.example.insights:view-insights', visible: true },
      ...DEFAULT_REPOSITORY_CARD_ACTIONS,
    ];
    renderComponent();

    const resetBtn = screen.getByRole('button', { name: '恢复默认按钮排列' });
    await user.click(resetBtn);

    expect(setRepositoryCardActions).toHaveBeenCalledWith([
      ...DEFAULT_REPOSITORY_CARD_ACTIONS.map((item) => ({ ...item })),
      { id: 'plugin:com.example.insights:view-insights', visible: false },
    ]);
  });

  it('preserves inactive plugin slots between built-in actions when toggling visibility', async () => {
    const user = userEvent.setup();
    state.repositoryCardActions = [
      DEFAULT_REPOSITORY_CARD_ACTIONS[0],
      { id: 'plugin:com.inactive.plugin:inactive-action', visible: false },
      ...DEFAULT_REPOSITORY_CARD_ACTIONS.slice(1),
    ];
    renderComponent();

    const switches = screen.getAllByRole('switch');
    await user.click(switches[1]);

    expect(setRepositoryCardActions).toHaveBeenCalled();
    const savedActions = setRepositoryCardActions.mock.calls[0][0] as RepositoryCardActionPreference[];
    expect(savedActions.map((action) => action.id)).toEqual([
      DEFAULT_REPOSITORY_CARD_ACTIONS[0].id,
      'plugin:com.inactive.plugin:inactive-action',
      ...DEFAULT_REPOSITORY_CARD_ACTIONS.slice(1).map((action) => action.id),
      'plugin:com.example.insights:view-insights',
    ]);
    expect(savedActions[2].visible).toBe(!DEFAULT_REPOSITORY_CARD_ACTIONS[1].visible);
  });
});
