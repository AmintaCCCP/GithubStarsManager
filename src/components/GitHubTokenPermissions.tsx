import { useT } from '../i18n/useT';

/** Explains the permissions before a token is saved, without probing account-changing APIs. */
export function GitHubTokenPermissions() {
  const t = useT('login');

  return (
    <div className="rounded-md border border-border bg-muted/50 p-4 text-xs leading-5 text-muted-foreground">
      <h3 className="mb-2 text-sm font-medium text-foreground">{t('loginScreen.token-permissions-title')}</h3>
      <p>{t('loginScreen.token-permissions-stars')}</p>
      <p className="mt-2">{t('loginScreen.token-permissions-optional')}</p>
      <p className="mt-2">{t('loginScreen.token-permissions-check')}</p>
      <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className="mt-2 inline-block font-medium text-primary hover:underline">
        {t('loginScreen.create-token-on-github')}
      </a>
    </div>
  );
}
