import React from 'react';
import { ExternalLink, Github, Globe, Key, Mail, Monitor, Package, Twitter } from 'lucide-react';
import { UpdateChecker } from '../UpdateChecker';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { version } from '../../../package.json';
import { PROJECT_REPO_URL } from '../../constants/project';
import { APP_LANGUAGES, type AppLanguage } from '../../i18n/languages';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Switch } from '../ui/switch';
import { ThemeSettingsCard } from './ThemeSettingsCard';
import { useDesktopActions } from '../../features/settings/hooks/useDesktopActions';
import { useGitHubTokenActions } from '../../features/settings/hooks/useGitHubTokenActions';

interface GeneralPanelProps {
  t: (zh: string, en: string) => string;
}

export const GeneralPanel: React.FC<GeneralPanelProps> = ({ t }) => {
  const { language, setLanguage, user } = useAppStore(useShallow((state) => ({
    language: state.language,
    setLanguage: state.setLanguage,
    user: state.user,
  })));
  const desktop = useDesktopActions({ t });
  const githubToken = useGitHubTokenActions({ t });

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Package className="h-6 w-6 text-muted-foreground dark:text-muted-foreground" />
        <h3 className="text-lg font-semibold text-foreground dark:text-foreground">{t('通用设置', 'General Settings')}</h3>
      </div>

      <ThemeSettingsCard t={t} />

      <Card>
        <CardHeader>
          <div className="flex items-center space-x-3">
            <Key className="h-5 w-5 text-muted-foreground dark:text-muted-foreground" />
            <CardTitle>{t('GitHub Token', 'GitHub Token')}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground dark:text-muted-foreground">
            {t(
              user?.login
                ? `当前账号 ${user.login}。过期后可在此直接更换 token，不必退出登录。`
                : '过期后可在此直接更换 token，不必退出登录。',
              user?.login
                ? `Signed in as ${user.login}. Update an expired token here without logging out.`
                : 'Update an expired token here without logging out.',
            )}
          </p>
          <div className="space-y-2">
            <Label htmlFor="settings-github-token">GitHub Personal Access Token</Label>
            <Input
              id="settings-github-token"
              type="password"
              autoComplete="off"
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              value={githubToken.tokenInput}
              onChange={(event) => githubToken.setTokenInput(event.target.value)}
              disabled={githubToken.isSaving}
            />
          </div>
          <Button type="button" onClick={() => { void githubToken.updateToken(); }} disabled={githubToken.isSaving || !githubToken.tokenInput.trim()}>
            {githubToken.isSaving ? t('更新中…', 'Updating…') : t('更新 Token', 'Update token')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center space-x-3">
            <Globe className="h-5 w-5 text-muted-foreground dark:text-muted-foreground" />
            <CardTitle id="language-settings-title">{t('语言设置', 'Language Settings')}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <RadioGroup
            aria-labelledby="language-settings-title"
            value={language}
            onValueChange={(value) => setLanguage(value as AppLanguage)}
            className="grid max-w-lg grid-cols-2 gap-3 sm:grid-cols-3"
          >
            {APP_LANGUAGES.map((definition) => (
              <Label
                key={definition.code}
                htmlFor={`language-${definition.code}`}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-background dark:border-border dark:hover:bg-card/[0.10]"
              >
                <RadioGroupItem value={definition.code} id={`language-${definition.code}`} aria-labelledby={`language-${definition.code}-label`} />
                <span className="min-w-0">
                  <span id={`language-${definition.code}-label`} className="block truncate text-sm font-medium text-foreground dark:text-foreground">
                    {definition.nativeName}
                  </span>
                  <span className="mt-1 block truncate text-xs font-normal text-muted-foreground dark:text-muted-foreground">
                    {definition.englishName}
                  </span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      {desktop.supported && (
        <Card>
          <CardHeader>
            <div className="flex items-center space-x-3">
              <Monitor className="h-5 w-5 text-muted-foreground dark:text-muted-foreground" />
              <CardTitle>{t('桌面选项', 'Desktop')}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-foreground dark:text-foreground">{t('开机自动启动', 'Launch at startup')}</p>
                <p className="mt-1 text-xs text-muted-foreground dark:text-muted-foreground">{t('登录系统后自动启动客户端（默认关闭）', 'Start the client automatically after login (off by default)')}</p>
              </div>
              <Switch
                aria-label={t('开机自动启动', 'Launch at startup')}
                checked={desktop.prefs.autoLaunch}
                disabled={desktop.loading || desktop.saving}
                onCheckedChange={(checked) => { void desktop.toggleAutoLaunch(checked); }}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-foreground dark:text-foreground">{t('关闭时最小化到托盘', 'Minimize to tray on close')}</p>
                <p className="mt-1 text-xs text-muted-foreground dark:text-muted-foreground">{t('关闭窗口后保持在托盘运行，右键托盘图标可彻底退出（默认开启）', 'Keep running in the tray after closing; right-click the tray icon to quit (on by default)')}</p>
              </div>
              <Switch
                aria-label={t('关闭时最小化到托盘', 'Minimize to tray on close')}
                checked={desktop.prefs.closeToTray}
                disabled={desktop.loading || desktop.saving}
                onCheckedChange={(checked) => { void desktop.toggleCloseToTray(checked); }}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-foreground dark:text-foreground">{t('最小化时隐藏到托盘', 'Hide to tray on minimize')}</p>
                <p className="mt-1 text-xs text-muted-foreground dark:text-muted-foreground">{t('点击最小化按钮时隐藏到托盘（默认开启）', 'Hide to the tray when minimizing (on by default)')}</p>
              </div>
              <Switch
                aria-label={t('最小化时隐藏到托盘', 'Hide to tray on minimize')}
                checked={desktop.prefs.minimizeToTray}
                disabled={desktop.loading || desktop.saving}
                onCheckedChange={(checked) => { void desktop.toggleMinimizeToTray(checked); }}
              />
            </div>
            {desktop.error && (
              <p role="alert" className="text-xs text-destructive dark:text-destructive">{desktop.error}</p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center space-x-3">
            <Package className="h-5 w-5 text-muted-foreground dark:text-muted-foreground" />
            <CardTitle>{t('检查更新', 'Check for Updates')}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div>
            <p className="mb-1 text-sm text-muted-foreground dark:text-muted-foreground">{t(`当前版本: v${version}`, `Current Version: v${version}`)}</p>
            <p className="text-xs text-muted-foreground dark:text-muted-foreground">{t('检查是否有新版本可用', 'Check if a new version is available')}</p>
          </div>
          <UpdateChecker />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center space-x-3">
            <Mail className="h-5 w-5 text-muted-foreground dark:text-muted-foreground" />
            <CardTitle>{t('联系方式', 'Contact Information')}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground dark:text-muted-foreground">{t('如果您在使用过程中遇到任何问题或有建议，欢迎通过以下方式联系我：', 'If you encounter any issues or have suggestions while using the app, feel free to contact me through:')}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button type="button" onClick={() => { const newWindow = window.open('https://x.com/GoodMan_Lee', '_blank', 'noopener,noreferrer'); if (newWindow) newWindow.opener = null; }} className="gap-2">
              <Twitter className="h-5 w-5" />
              <span>Twitter</span>
              <ExternalLink className="h-4 w-4" />
            </Button>
            <Button type="button" variant="outline" onClick={() => { const newWindow = window.open(PROJECT_REPO_URL, '_blank', 'noopener,noreferrer'); if (newWindow) newWindow.opener = null; }} className="gap-2">
              <Github className="h-5 w-5" />
              <span>{t('GitHub', 'GitHub')}</span>
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
