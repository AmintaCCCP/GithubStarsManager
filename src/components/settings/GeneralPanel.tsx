import { ExternalLink, Github, Globe, Mail, Package, Twitter } from 'lucide-react';
import { UpdateChecker } from '../UpdateChecker';
import { useAppStore } from '../../store/useAppStore';
import { version } from '../../../package.json';
import { PROJECT_REPO_URL } from '../../constants/project';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Label } from '../ui/label';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';

interface GeneralPanelProps {
  t: (zh: string, en: string) => string;
}

export const GeneralPanel: React.FC<GeneralPanelProps> = ({ t }) => {
  const { language, setLanguage } = useAppStore();

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Package className="h-6 w-6 text-muted-foreground dark:text-muted-foreground" />
        <h3 className="text-lg font-semibold text-foreground dark:text-foreground">{t('通用设置', 'General Settings')}</h3>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center space-x-3">
            <Globe className="h-5 w-5 text-muted-foreground dark:text-muted-foreground" />
            <CardTitle id="language-settings-title">{t('语言设置', 'Language Settings')}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <RadioGroup aria-labelledby="language-settings-title" value={language} onValueChange={(value) => setLanguage(value as 'zh' | 'en')} className="grid max-w-md grid-cols-2 gap-4">
            <Label htmlFor="language-zh" className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-background dark:border-border dark:hover:bg-white/[0.10]">
              <RadioGroupItem value="zh" id="language-zh" />
              <span>
                <span className="block text-base font-medium text-foreground dark:text-foreground">中文</span>
                <span className="mt-1 block text-xs font-normal text-muted-foreground dark:text-muted-foreground">Simplified Chinese</span>
              </span>
            </Label>
            <Label htmlFor="language-en" className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-background dark:border-border dark:hover:bg-white/[0.10]">
              <RadioGroupItem value="en" id="language-en" />
              <span>
                <span className="block text-base font-medium text-foreground dark:text-foreground">English</span>
                <span className="mt-1 block text-xs font-normal text-muted-foreground dark:text-muted-foreground">US English</span>
              </span>
            </Label>
          </RadioGroup>
        </CardContent>
      </Card>

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
