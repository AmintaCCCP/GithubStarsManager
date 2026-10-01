import React, { useState } from 'react';
import { FileText, GitFork, Info, KeyRound, List, ShieldCheck, Star, Workflow } from 'lucide-react';
import { useT } from '../i18n/useT';
import { cn } from '../lib/utils';

const CODE_SPAN_RE = /`([^`]+)`/g;

type TokenMode = 'fine-grained' | 'classic';

const MODE_TABS: Array<{ mode: TokenMode; labelKey: string }> = [
  { mode: 'fine-grained', labelKey: 'loginScreen.token-permissions-tab-finegrained' },
  { mode: 'classic', labelKey: 'loginScreen.token-permissions-tab-classic' },
];

const FINE_GRAINED_ROWS = [
  { icon: Star, featureKey: 'loginScreen.token-permissions-feature-star', valueKey: 'loginScreen.token-permissions-fine-star' },
  { icon: FileText, featureKey: 'loginScreen.token-permissions-feature-gists', valueKey: 'loginScreen.token-permissions-fine-gists' },
  { icon: GitFork, featureKey: 'loginScreen.token-permissions-feature-fork-sync', valueKey: 'loginScreen.token-permissions-fine-fork-sync' },
  { icon: Workflow, featureKey: 'loginScreen.token-permissions-feature-workflows', valueKey: 'loginScreen.token-permissions-fine-workflows' },
] as const;

const CLASSIC_ROWS = [
  { icon: Star, featureKey: 'loginScreen.token-permissions-feature-star', valueKey: 'loginScreen.token-permissions-classic-star' },
  { icon: FileText, featureKey: 'loginScreen.token-permissions-feature-gists', valueKey: 'loginScreen.token-permissions-classic-gists' },
  { icon: List, featureKey: 'loginScreen.token-permissions-feature-star-lists', valueKey: 'loginScreen.token-permissions-classic-star-lists' },
  { icon: GitFork, featureKey: 'loginScreen.token-permissions-feature-fork-workflows', valueKey: 'loginScreen.token-permissions-classic-fork-workflows' },
] as const;

/** Renders a locale string, showing `backtick` spans as highlighted permission
 *  tokens (bold, tinted, dashed underline — no code styling). */
function renderWithHighlights(text: string): React.ReactNode[] {
  return text.split(CODE_SPAN_RE).map((part, index) => index % 2 === 1
    ? (
        <span
          key={index}
          className="font-semibold text-primary underline decoration-dashed decoration-primary/50 underline-offset-[3px]"
        >
          {part}
        </span>
      )
    : <React.Fragment key={index}>{part}</React.Fragment>);
}

/** Explains the permissions before a token is saved, without probing account-changing APIs. */
export function GitHubTokenPermissions() {
  const t = useT('login');
  const [mode, setMode] = useState<TokenMode>('fine-grained');
  const rows = mode === 'fine-grained' ? FINE_GRAINED_ROWS : CLASSIC_ROWS;

  return (
    <div className="text-xs leading-5 text-muted-foreground">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
        <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden />
        {t('loginScreen.token-permissions-title')}
      </h3>

      <div role="tablist" className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        {MODE_TABS.map(({ mode: tabMode, labelKey }) => (
          <button
            key={tabMode}
            type="button"
            role="tab"
            aria-selected={mode === tabMode}
            onClick={() => setMode(tabMode)}
            className={cn(
              'rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
              mode === tabMode ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      <ul className="space-y-2.5">
        {rows.map(({ icon: Icon, featureKey, valueKey }) => (
          <li key={featureKey + valueKey} className="flex gap-2.5">
            <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
            <span className="w-[7.5rem] shrink-0 font-medium text-foreground">{t(featureKey)}</span>
            <span>{renderWithHighlights(t(valueKey))}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 space-y-2 border-t border-border pt-3">
        <p className="flex gap-2">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
          <span>{renderWithHighlights(t('loginScreen.token-permissions-check'))}</span>
        </p>
        <p className="flex gap-2">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
          <span>{renderWithHighlights(t('loginScreen.token-permissions-local-storage'))}</span>
        </p>
      </div>

      <a
        href="https://github.com/settings/tokens"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-block font-medium text-primary hover:underline"
      >
        {t('loginScreen.create-token-on-github')}
      </a>
    </div>
  );
}
