import React from 'react';

interface WorkspacePageHeaderProps {
  eyebrow?: string;
  section?: string;
  title: string;
  description?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}

export const WorkspacePageHeader: React.FC<WorkspacePageHeaderProps> = ({
  title,
  description,
  meta,
  actions,
}) => (
  <header className="mb-4 flex h-auto min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-subtle pb-3">
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h1 className="m-0 truncate text-[15px] font-semibold leading-5 tracking-[-0.011em] text-foreground">
          {title}
        </h1>
        {meta && (
          <div className="flex flex-wrap items-center gap-2 text-label-sm font-normal text-tertiary tabular-nums [&_.app-workspace-meta-pill]:min-h-0 [&_.app-workspace-meta-pill]:border-0 [&_.app-workspace-meta-pill]:bg-transparent [&_.app-workspace-meta-pill]:p-0 [&_.app-workspace-meta-pill]:font-normal [&_.app-workspace-meta-pill]:text-tertiary">
            {meta}
          </div>
        )}
      </div>
      {description && (
        <p className="mt-0.5 truncate text-label-sm text-tertiary">
          {description}
        </p>
      )}
    </div>
    {actions && (
      <div className="app-workspace-page-actions flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        {actions}
      </div>
    )}
  </header>
);
