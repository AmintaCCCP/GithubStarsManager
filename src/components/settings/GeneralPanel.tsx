import React from 'react';
import { ExternalLink, Github, Globe, Mail, Monitor, Package, Twitter } from 'lucide-react';
import { UpdateChecker } from '../UpdateChecker';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { version } from '../../../package.json';
import { PROJECT_REPO_URL } from '../../constants/project';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Label } from '../ui/label';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Switch } from '../ui/switch';
import { ThemeSettingsCard } from './ThemeSettingsCard';
import { useDesktopActions } from '../../features/settings/hooks/useDesktopActions';

interface GeneralPanelProps {
  t: (zh: string, en: string) => string;
}

export const GeneralPanel: React.FC<GeneralPanelProps> = ({ t }) => {
  const { language, setLanguage } = useAppStore(useShallow((state) => ({
    language: state.language,
    setLanguage: state.setLanguage,
  })));
  const desktop = useDesktopActions({ t });

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
            <Globe className="h-5 w-5 text-muted-foreground dark:text-muted-foreground" />
            <CardTitle id="language-settings-title">{t('语言设置', 'Language Settings')}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <RadioGroup aria-labelledby="language-settings-title" value={language} onValueChange={(value) => setLanguage(value as 'zh' | 'en')} className="grid max-w-md grid-cols-2 gap-4">
            <Label htmlFor="language-zh" className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-background dark:border-border dark:hover:bg-card/[0.10]">
              <RadioGroupItem value="zh" id="language-zh" aria-labelledby="language-zh-label" />
              <span>
                <span id="language-zh-label" className="block text-base font-medium text-foreground dark:text-foreground">中文</span>
                <span className="mt-1 block text-xs font-normal text-muted-foreground dark:text-muted-foreground">Simplified Chinese</span>
              </span>
            </Label>
            <Label htmlFor="language-en" className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-background dark:border-border dark:hover:bg-card/[0.10]">
              <RadioGroupItem value="en" id="language-en" aria-labelledby="language-en-label" />
              <span>
                <span id="language-en-label" className="block text-base font-medium text-foreground dark:text-foreground">English</span>
                <span className="mt-1 block text-xs font-normal text-muted-foreground dark:text-muted-foreground">US English</span>
              </span>
            </Label>
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
