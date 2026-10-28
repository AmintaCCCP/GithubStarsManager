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
  eyebrow,
  section,
  title,
  description,
  meta,
  actions,
}) => (
  <header className="app-workspace-page-header">
    <div className="app-workspace-page-header-copy">
      {(eyebrow || section) && (
        <div className="app-workspace-breadcrumb">
          {eyebrow && <span>{eyebrow}</span>}
          {eyebrow && section && <span aria-hidden="true">/</span>}
          {section && <span>{section}</span>}
        </div>
      )}
      <div className="app-workspace-title-row">
        <h1 className="app-workspace-title">{title}</h1>
        {meta && <div className="app-workspace-meta">{meta}</div>}
      </div>
      {description && <p className="app-workspace-description">{description}</p>}
    </div>
    {actions && <div className="app-workspace-page-actions">{actions}</div>}
  </header>
);
