import React from 'react';
import { cn } from '../../lib/utils';

interface SettingsPageStackProps {
  children: React.ReactNode;
  className?: string;
}

/** Vertical stack for preference sections with consistent 24px spacing. */
export const SettingsPageStack: React.FC<SettingsPageStackProps> = ({ children, className }) => (
  <div className={cn('flex flex-col gap-6', className)}>{children}</div>
);

interface SettingsSectionProps {
  title?: React.ReactNode;
  titleId?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * Grouped desktop preferences section with a quiet 12px tertiary header
 * above a surface-raised card container.
 */
export const SettingsSection: React.FC<SettingsSectionProps> = ({
  title,
  titleId,
  description,
  actions,
  children,
  className,
}) => (
  <section className={cn('flex flex-col gap-2', className)}>
    {(title || actions || description) && (
      <div className="flex flex-wrap items-end justify-between gap-2 px-0.5">
        <div className="min-w-0">
          {title && (
            <h3 id={titleId} className="text-label-sm font-medium text-tertiary">
              {title}
            </h3>
          )}
          {description && (
            <p className="mt-0.5 text-label-sm text-secondary">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    )}
    {children}
  </section>
);

interface SettingsCardProps {
  children: React.ReactNode;
  className?: string;
}

/** Grouped card container (`rounded-lg bg-raised shadow-elev-1 overflow-hidden`). */
export const SettingsCard: React.FC<SettingsCardProps> = ({ children, className }) => (
  <div className={cn('overflow-hidden rounded-lg bg-raised shadow-elev-1', className)}>
    {children}
  </div>
);

interface SettingsDividerProps {
  className?: string;
}

/** Full-width 1px hairline separator between grouped settings rows. */
export const SettingsDivider: React.FC<SettingsDividerProps> = ({ className }) => (
  <div className={cn('h-px bg-separator', className)} />
);

interface SettingsRowProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  titleId?: string;
  badge?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  align?: 'center' | 'start';
}

/**
 * Standard preference row (`min-h-14 gap-4 px-3.5 py-2.5`) with 13px title,
 * 12px secondary description, and right-aligned control slot.
 */
export const SettingsRow: React.FC<SettingsRowProps> = ({
  icon,
  title,
  titleId,
  badge,
  description,
  children,
  className,
  align = 'center',
}) => (
  <div
    className={cn(
      'flex min-h-14 justify-between gap-4 px-3.5 py-2.5',
      align === 'start' ? 'items-start' : 'items-center',
      className,
    )}
  >
    <div className={cn('flex min-w-0 flex-1 gap-3', align === 'start' ? 'items-start' : 'items-center')}>
      {icon && (
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-tertiary [&_svg]:size-4">
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span id={titleId} className="text-label font-medium text-foreground">
            {title}
          </span>
          {badge}
        </div>
        {description && (
          <p className="mt-px text-label-sm leading-[18px] text-secondary">{description}</p>
        )}
      </div>
    </div>
    {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
  </div>
);

type SettingsNoticeTone = 'neutral' | 'warning' | 'destructive' | 'success';

interface SettingsNoticeProps {
  tone?: SettingsNoticeTone;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  role?: string;
}

const NOTICE_TONE_CLASSES: Record<SettingsNoticeTone, string> = {
  neutral: 'bg-sunken text-secondary shadow-elev-0 [&_svg]:text-tertiary',
  // Body copy stays on `foreground`: status hues on their own tint land at
  // 2.4–4.3:1, so only the icon keeps the hue.
  warning: 'bg-warning-tint text-foreground [&_svg]:text-warning',
  destructive: 'bg-destructive-tint text-foreground [&_svg]:text-destructive',
  success: 'bg-success-tint text-foreground [&_svg]:text-status-green',
};

/** Subtle desktop-toned inline notice banner without heavy borders. */
export const SettingsNotice: React.FC<SettingsNoticeProps> = ({
  tone = 'neutral',
  icon,
  children,
  className,
  role,
}) => (
  <div
    role={role}
    className={cn(
      'flex items-start gap-2.5 rounded-lg px-3.5 py-2.5 text-label-sm leading-[18px]',
      NOTICE_TONE_CLASSES[tone],
      className,
    )}
  >
    {icon && <span className="mt-0.5 shrink-0 [&_svg]:size-4">{icon}</span>}
    <div className="min-w-0 flex-1">{children}</div>
  </div>
);
