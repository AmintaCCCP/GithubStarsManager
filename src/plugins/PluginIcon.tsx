import React from 'react';
import { useAppStore } from '../store/useAppStore';
import { getPluginIcon } from './pluginIcons';

export interface PluginIconProps extends React.ComponentPropsWithoutRef<'svg'> {
  pluginId?: string;
  icon?: string | null;
  className?: string;
}

export const PluginIcon: React.FC<PluginIconProps> = ({ pluginId, icon, className, ...props }) => {
  const customIcon = useAppStore((state) => (pluginId ? state.pluginCustomIcons?.[pluginId] : undefined));
  const effectiveIconKey = customIcon || icon || 'plug';
  const IconComponent = getPluginIcon(effectiveIconKey);

  return <IconComponent className={className} {...props} />;
};
