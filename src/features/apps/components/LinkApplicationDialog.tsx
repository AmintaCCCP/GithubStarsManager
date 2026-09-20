import React, { useEffect, useMemo, useState } from 'react';
import { useT } from '../../../i18n/useT';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Switch } from '../../../components/ui/switch';
import type { Repository } from '../../../types';
import {
  LINKED_APPLICATION_ARCHITECTURES,
  LINKED_APPLICATION_PLATFORMS,
  type CreateLinkedApplicationInput,
  type LinkedApplicationArchitecture,
  type LinkedApplicationPlatform,
} from '../../../types/linkedApplication';
import type { LinkApplicationOutcome } from '../hooks/useLinkedApplications';
import { useLinkedApplicationLabels } from '../hooks/useLinkedApplicationLabels';

interface LinkApplicationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 已收藏且尚未关联的仓库。 */
  repositories: Repository[];
  defaultPlatform: LinkedApplicationPlatform;
  onSubmit: (input: CreateLinkedApplicationInput) => LinkApplicationOutcome;
}

/**
 * 手动关联表单（开发守则 §3，阶段 1a 唯一的写入入口）。
 *
 * 只收集「哪个仓库 / 叫什么 / 装的是哪个版本 / 什么平台」，不会触发安装、更新或卸载；
 * installed version 是自由文本，因为很多项目不按 semver 发版，输不出版本时应留空而不是猜。
 */
export const LinkApplicationDialog: React.FC<LinkApplicationDialogProps> = ({
  open,
  onOpenChange,
  repositories,
  defaultPlatform,
  onSubmit,
}) => {
  const t = useT('app');
  const labels = useLinkedApplicationLabels();
  const [search, setSearch] = useState('');
  const [repositoryFullName, setRepositoryFullName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [installedVersion, setInstalledVersion] = useState('');
  const [platform, setPlatform] = useState<LinkedApplicationPlatform>(defaultPlatform);
  const [architecture, setArchitecture] = useState<LinkedApplicationArchitecture | 'unset'>('unset');
  const [includePrereleases, setIncludePrereleases] = useState(false);
  const [outcome, setOutcome] = useState<LinkApplicationOutcome | null>(null);

  // 每次重新打开都从干净状态开始，避免上次失败的选择残留
  useEffect(() => {
    if (!open) return;
    setSearch('');
    setRepositoryFullName('');
    setDisplayName('');
    setInstalledVersion('');
    setPlatform(defaultPlatform);
    setArchitecture('unset');
    setIncludePrereleases(false);
    setOutcome(null);
  }, [open, defaultPlatform]);

  const filteredRepositories = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return repositories;
    return repositories.filter((repository) => (
      repository.full_name.toLowerCase().includes(keyword)
      || (repository.description ?? '').toLowerCase().includes(keyword)
    ));
  }, [repositories, search]);

  const selectedRepository = useMemo(
    () => repositories.find((repository) => repository.full_name === repositoryFullName) ?? null,
    [repositories, repositoryFullName],
  );

  const handleSubmit = () => {
    if (!selectedRepository) {
      setOutcome('invalid');
      return;
    }
    const result = onSubmit({
      repositoryFullName: selectedRepository.full_name,
      repositorySourceUrl: selectedRepository.html_url,
      displayName: displayName.trim() || selectedRepository.name,
      installedVersion,
      platform,
      architecture: architecture === 'unset' ? undefined : architecture,
      includePrereleases,
    });
    setOutcome(result);
    if (result === 'linked') {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('myApps.link-dialog-title')}</DialogTitle>
          <DialogDescription>{t('myApps.link-dialog-description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="my-apps-repository-search">{t('myApps.search-repositories')}</Label>
            <Input
              id="my-apps-repository-search"
              value={search}
              placeholder={t('myApps.repository-placeholder')}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div
              className="max-h-44 overflow-y-auto rounded-md border border-border"
              role="listbox"
              aria-label={t('myApps.search-repositories')}
            >
              {filteredRepositories.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">{t('myApps.no-matching-repositories')}</p>
              ) : (
                filteredRepositories.map((repository) => {
                  const isSelected = repository.full_name === repositoryFullName;
                  return (
                    <button
                      key={repository.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        setRepositoryFullName(repository.full_name);
                        setDisplayName((current) => current || repository.name);
                        setOutcome(null);
                      }}
                      className={`block w-full px-3 py-2 text-left text-sm hover:bg-accent ${isSelected ? 'bg-accent' : ''}`}
                    >
                      <span className="block font-medium text-foreground">{repository.full_name}</span>
                      {repository.description ? (
                        <span className="block truncate text-xs text-muted-foreground">{repository.description}</span>
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="my-apps-display-name">{t('myApps.display-name')}</Label>
            <Input
              id="my-apps-display-name"
              value={displayName}
              placeholder={t('myApps.display-name-placeholder')}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="my-apps-installed-version">{t('myApps.installed-version')}</Label>
            <Input
              id="my-apps-installed-version"
              value={installedVersion}
              placeholder={t('myApps.installed-version-placeholder')}
              onChange={(event) => setInstalledVersion(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t('myApps.installed-version-hint')}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="my-apps-platform">{t('myApps.platform')}</Label>
              <Select value={platform} onValueChange={(value) => setPlatform(value as LinkedApplicationPlatform)}>
                <SelectTrigger id="my-apps-platform" className="h-10 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LINKED_APPLICATION_PLATFORMS.map((value) => (
                    <SelectItem key={value} value={value}>{labels.platform[value]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="my-apps-architecture">{t('myApps.architecture')}</Label>
              <Select value={architecture} onValueChange={(value) => setArchitecture(value as LinkedApplicationArchitecture | 'unset')}>
                <SelectTrigger id="my-apps-architecture" className="h-10 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">{t('myApps.architecture-not-set')}</SelectItem>
                  {LINKED_APPLICATION_ARCHITECTURES.map((value) => (
                    <SelectItem key={value} value={value}>{labels.architecture[value]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
            <div className="space-y-1">
              <Label htmlFor="my-apps-include-prereleases">{t('myApps.include-prereleases')}</Label>
              <p className="text-xs text-muted-foreground">{t('myApps.include-prereleases-hint')}</p>
            </div>
            <Switch
              id="my-apps-include-prereleases"
              checked={includePrereleases}
              onCheckedChange={setIncludePrereleases}
            />
          </div>

          {outcome === 'duplicate' ? (
            <p role="alert" className="text-sm text-destructive">{t('myApps.link-duplicate')}</p>
          ) : null}
          {outcome === 'invalid' ? (
            <p role="alert" className="text-sm text-destructive">{t('myApps.repository-required')}</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t('useDialog.cancel')}</Button>
          <Button type="button" onClick={handleSubmit} disabled={!selectedRepository}>{t('myApps.link')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
